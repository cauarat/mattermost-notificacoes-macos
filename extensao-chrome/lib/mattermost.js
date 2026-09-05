// Camada Mattermost da extensão: login REST + WebSocket.
//
// Mesma lógica do daemon (src/auth.js e src/websocket.js), adaptada ao
// navegador: sem Node, sem Keychain, e ciente de que o service worker do
// Manifest V3 pode ser encerrado a qualquer momento pelo Chrome.

const INTERVALO_PING_MS = 30_000;
const TIMEOUT_PING_MS = 15_000;
const BACKOFF_INICIAL_MS = 1_000;
const BACKOFF_MAXIMO_MS = 30_000;

export class ErroCredenciais extends Error {}

/** POST /users/login — o token vem no cabeçalho Token, não no corpo. */
export async function autenticar(servidor, loginId, senha) {
  const resp = await fetch(`${servidor}/api/v4/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login_id: loginId, password: senha }),
  });

  if (!resp.ok) {
    if (resp.status === 401) throw new ErroCredenciais("Usuário ou senha incorretos.");
    throw new Error(`Falha no login: HTTP ${resp.status}`);
  }

  const token = resp.headers.get("Token");
  if (!token) throw new Error("Servidor não devolveu o cabeçalho Token.");
  return { token, usuario: await resp.json() };
}

export async function buscarUsuario(servidor, token) {
  try {
    const r = await fetch(`${servidor}/api/v4/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export async function buscarTimes(servidor, token) {
  try {
    const r = await fetch(`${servidor}/api/v4/users/me/teams`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return r.ok ? await r.json() : [];
  } catch {
    return [];
  }
}

/**
 * Conexão WebSocket com reconexão automática.
 *
 * Diferença importante para a versão do daemon: aqui o socket pode morrer
 * junto com o service worker, sem emitir "close". Por isso o background.js
 * usa um chrome.alarms como rede de segurança, além do heartbeat daqui.
 */
export class ConexaoMattermost extends EventTarget {
  constructor(servidor, token) {
    super();
    this.servidor = servidor;
    this.token = token;
    this.ws = null;
    this.seq = 1;
    this.backoff = BACKOFF_INICIAL_MS;
    this.autenticado = false;
    this.abriu = false;
    this.encerrando = false;
    this.timerPing = null;
    this.timerTimeout = null;
    this.timerReconexao = null;
  }

  emitir(nome, detalhe) {
    this.dispatchEvent(new CustomEvent(nome, { detail: detalhe }));
  }

  conectar() {
    if (this.encerrando) return;
    this.limparTimers();
    this.autenticado = false;
    this.abriu = false;

    const url = this.servidor.replace(/^http/, "ws") + "/api/v4/websocket";
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this.emitir("log", `Falha ao abrir WebSocket: ${e.message}`);
      this.agendarReconexao();
      return;
    }
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.abriu = true;
      ws.send(JSON.stringify({
        seq: this.seq++,
        action: "authentication_challenge",
        data: { token: this.token },
      }));
    });

    ws.addEventListener("message", (ev) => this.aoReceber(ev));

    ws.addEventListener("close", (ev) => {
      const estava = this.autenticado;
      this.autenticado = false;
      this.limparTimers();
      if (this.encerrando) return;

      // O servidor fecha com 1006 tanto para rede caída quanto para token
      // recusado. O "open" separa os dois: se o socket abriu, o servidor está
      // no ar e quem foi recusada foi a credencial.
      if (this.abriu && !estava) {
        this.emitir("log", "Servidor recusou a autenticação — token expirado.");
        this.emitir("token-invalido");
      } else if (!this.abriu) {
        this.emitir("log", `Servidor inalcançável (código ${ev.code}).`);
      } else {
        this.emitir("log", `Conexão perdida (código ${ev.code}).`);
      }
      this.agendarReconexao();
    });

    ws.addEventListener("error", () => {
      // "close" sempre vem em seguida; reconectar lá evita agendar duas vezes.
    });
  }

  aoReceber(ev) {
    clearTimeout(this.timerTimeout);
    this.timerTimeout = null;

    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }

    if (msg.event === "hello") {
      this.autenticado = true;
      this.backoff = BACKOFF_INICIAL_MS;
      this.iniciarHeartbeat();
      this.emitir("log", "Conectado e autenticado.");
      this.emitir("conectado");
      return;
    }

    if (msg.status === "FAIL" || msg.error) {
      if (String(msg.error?.status_code) === "401") this.emitir("token-invalido");
      return;
    }

    if (msg.event) this.emitir("evento", msg);
  }

  iniciarHeartbeat() {
    clearInterval(this.timerPing);
    this.timerPing = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      try {
        this.ws.send(JSON.stringify({ seq: this.seq++, action: "ping" }));
      } catch {
        return;
      }
      clearTimeout(this.timerTimeout);
      this.timerTimeout = setTimeout(() => {
        this.emitir("log", "Sem resposta ao ping; derrubando socket zumbi.");
        try { this.ws?.close(); } catch {}
      }, TIMEOUT_PING_MS);
    }, INTERVALO_PING_MS);
  }

  agendarReconexao() {
    if (this.encerrando || this.timerReconexao) return;
    const espera = this.backoff;
    this.backoff = Math.min(this.backoff * 2, BACKOFF_MAXIMO_MS);
    this.emitir("log", `Nova tentativa em ${Math.round(espera / 1000)}s.`);
    this.timerReconexao = setTimeout(() => {
      this.timerReconexao = null;
      this.conectar();
    }, espera);
  }

  get conectado() {
    return this.autenticado && this.ws?.readyState === WebSocket.OPEN;
  }

  limparTimers() {
    clearInterval(this.timerPing);
    clearTimeout(this.timerTimeout);
    this.timerPing = null;
    this.timerTimeout = null;
  }

  encerrar() {
    this.encerrando = true;
    this.limparTimers();
    clearTimeout(this.timerReconexao);
    try { this.ws?.close(); } catch {}
  }
}
