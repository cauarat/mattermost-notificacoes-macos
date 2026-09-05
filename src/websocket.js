// Conexão WebSocket com o Mattermost.
// Usa o WebSocket global do Node 22 — nenhuma dependência npm.
//
// Um daemon de notificação que morre em silêncio é pior do que nenhum daemon,
// então a robustez mora toda aqui: heartbeat, backoff exponencial e detecção
// de socket zumbi (o caso mais comum — o Mac dorme, acorda, e o socket está
// morto sem nunca ter emitido "close").
import { EventEmitter } from "node:events";
import { log, aviso, erro } from "./log.js";

const INTERVALO_PING_MS = 30_000;
const TIMEOUT_PING_MS = 15_000;
// Prazo para a conexão completar (abrir + autenticar). Ver conectar().
const TIMEOUT_ABERTURA_MS = 20_000;
const BACKOFF_INICIAL_MS = 1_000;
const BACKOFF_MAXIMO_MS = 30_000;

export class ConexaoMattermost extends EventEmitter {
  /**
   * @param {string} servidor   URL https do Mattermost
   * @param {() => Promise<string>} obterToken  devolve um token válido;
   *        é chamado de novo a cada tentativa, então uma renovação de sessão
   *        entra em vigor sozinha na próxima reconexão.
   */
  constructor(servidor, obterToken) {
    super();
    this.servidor = servidor;
    this.obterToken = obterToken;
    this.ws = null;
    this.seq = 1;
    this.backoff = BACKOFF_INICIAL_MS;
    this.timerPing = null;
    this.timerTimeout = null;
    this.timerReconexao = null;
    this.timerAbertura = null;
    this.geracao = 0;
    this.autenticado = false;
    this.abriu = false;
    this.encerrando = false;
    this.falhasAuth = 0;
    this.desconectadoDesde = null;
  }

  conectar() {
    if (this.encerrando) return;
    this.limparTimers();

    const url = this.servidor.replace(/^http/, "ws") + "/api/v4/websocket";
    // Cada tentativa ganha um número: eventos de um socket abandonado chegam
    // com geração antiga e são ignorados, sem agendar reconexões duplicadas.
    const geracao = ++this.geracao;

    this.obterToken()
      .then((token) => {
        if (this.encerrando) return;
        log(`Conectando em ${url} …`);
        this.autenticado = false;
        this.abriu = false;

        const ws = new WebSocket(url);
        this.ws = ws;

        ws.addEventListener("open", () => {
          this.abriu = true;
          // O WebSocket nativo do Node não aceita cabeçalhos customizados,
          // então a autenticação usa o desafio oficial do Mattermost.
          ws.send(JSON.stringify({
            seq: this.seq++,
            action: "authentication_challenge",
            data: { token },
          }));
        });

        // Um WebSocket pode ficar preso em CONNECTING indefinidamente — sem
        // open, sem close, sem error — tipicamente depois que o Mac dorme ou
        // a rede troca. O heartbeat não cobre isso, porque só começa depois de
        // autenticar. Sem este prazo o daemon fica "rodando" e mudo.
        clearTimeout(this.timerAbertura);
        this.timerAbertura = setTimeout(() => {
          if (geracao !== this.geracao || this.autenticado) return;
          aviso(
            `Conexão não completou em ${TIMEOUT_ABERTURA_MS / 1000}s; ` +
            "abandonando este socket e tentando de novo.",
          );
          try { ws.close(); } catch {}
          this.ws = null;
          // Reconecta direto: se o socket travou, o evento close pode nunca vir.
          this.agendarReconexao();
        }, TIMEOUT_ABERTURA_MS);

        ws.addEventListener("message", (ev) => {
          if (geracao !== this.geracao) return;
          this.aoReceber(ev);
        });
        ws.addEventListener("error", () => {
          // O evento "close" sempre vem em seguida; a reconexão é tratada lá
          // para não agendar duas tentativas para a mesma queda.
        });
        ws.addEventListener("close", (ev) => {
          if (geracao !== this.geracao) return;   // socket já abandonado
          const estava = this.autenticado;
          this.autenticado = false;
          this.limparTimers();
          if (this.encerrando) return;

          // O servidor fecha com 1006 tanto para rede caída quanto para
          // token recusado. O que separa os dois é o "open": se o socket
          // chegou a abrir, o servidor está no ar e a recusa foi da credencial.
          if (this.abriu && !estava) {
            this.falhasAuth++;
            aviso(
              `Servidor aceitou a conexão mas recusou a autenticação ` +
              `(código ${ev.code}, ${this.falhasAuth}ª vez). Token expirado ou inválido.`,
            );
            this.emit("token-invalido");
          } else if (!this.abriu) {
            aviso(`Servidor inalcançável (código ${ev.code}).`);
          } else {
            aviso(`Conexão perdida (código ${ev.code}).`);
          }
          this.agendarReconexao();
        });
      })
      .catch((e) => {
        erro(`Não foi possível obter token: ${e.message}`);
        this.emit("token-invalido");
        this.agendarReconexao();
      });
  }

  aoReceber(ev) {
    // Qualquer tráfego do servidor é prova de vida.
    this.marcarVivo();

    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }

    if (msg.event === "hello") {
      this.autenticado = true;
      const foraPor = this.desconectadoDesde ? Date.now() - this.desconectadoDesde : 0;
      this.desconectadoDesde = null;
      this.backoff = BACKOFF_INICIAL_MS;
      this.falhasAuth = 0;
      clearTimeout(this.timerAbertura);
      this.timerAbertura = null;
      log("Conectado e autenticado no Mattermost.");
      this.iniciarHeartbeat();
      this.emit("conectado", { foraPorMs: foraPor });
      return;
    }

    if (msg.status === "FAIL" || msg.error) {
      aviso(`Servidor recusou: ${JSON.stringify(msg.error ?? msg)}`);
      if (String(msg.error?.status_code) === "401") this.emit("token-invalido");
      return;
    }

    if (msg.event) this.emit("evento", msg);
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
      // Se nada chegar dentro da janela, o socket é zumbi: derruba na marra.
      clearTimeout(this.timerTimeout);
      this.timerTimeout = setTimeout(() => {
        aviso("Servidor não respondeu ao ping; derrubando socket zumbi.");
        try { this.ws?.close(); } catch {}
      }, TIMEOUT_PING_MS);
    }, INTERVALO_PING_MS);
  }

  marcarVivo() {
    clearTimeout(this.timerTimeout);
    this.timerTimeout = null;
  }

  agendarReconexao() {
    if (this.encerrando || this.timerReconexao) return;
    if (this.desconectadoDesde === null) this.desconectadoDesde = Date.now();

    const espera = this.backoff;
    this.backoff = Math.min(this.backoff * 2, BACKOFF_MAXIMO_MS);
    log(`Nova tentativa em ${Math.round(espera / 1000)}s.`);

    this.timerReconexao = setTimeout(() => {
      this.timerReconexao = null;
      this.conectar();
    }, espera);
  }

  limparTimers() {
    clearInterval(this.timerPing);
    clearTimeout(this.timerTimeout);
    clearTimeout(this.timerAbertura);
    this.timerPing = null;
    this.timerTimeout = null;
    this.timerAbertura = null;
  }

  encerrar() {
    this.encerrando = true;
    this.limparTimers();
    clearTimeout(this.timerReconexao);
    try { this.ws?.close(); } catch {}
  }
}
