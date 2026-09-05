// Service worker da extensão: conecta no Mattermost e dispara os alertas.
//
// O desafio do Manifest V3: o Chrome encerra o service worker depois de ~30s
// ocioso. Atividade de WebSocket adia esse encerramento, mas não é garantia —
// então um chrome.alarms de 30s serve de rede de segurança, acordando o worker
// e reconectando se o socket tiver morrido junto com ele.

import { avaliar } from "./lib/filtro.js";
import {
  ConexaoMattermost, autenticar, buscarUsuario, buscarTimes, ErroCredenciais,
} from "./lib/mattermost.js";

const PADRAO = {
  servidor: "https://team.actuar.group",
  ativado: true,
  canaisMonitorados: [],
  som: { ativado: true, volume: 0.8 },
};

const ALARME = "mm-keepalive";
const MAX_LOG = 50;

let conexao = null;
let sessao = null;      // { token, usuario }
let timeNome = null;
let renovando = false;

// ---------------------------------------------------------------- utilidades

async function cfg() {
  const g = await chrome.storage.local.get(["config"]);
  const c = g.config ?? {};
  return {
    ...PADRAO, ...c,
    som: { ...PADRAO.som, ...(c.som ?? {}) },
    servidor: (c.servidor ?? PADRAO.servidor).replace(/\/+$/, ""),
  };
}

async function anotar(msg) {
  const hora = new Date().toLocaleTimeString("pt-BR");
  const { log = [] } = await chrome.storage.local.get(["log"]);
  log.unshift(`${hora} — ${msg}`);
  await chrome.storage.local.set({ log: log.slice(0, MAX_LOG) });
  console.log(`[mm] ${msg}`);
}

async function definirEstado(estado) {
  await chrome.storage.local.set({ estado });
  const cores = { conectado: "#22c55e", conectando: "#f59e0b", parado: "#94a3b8", erro: "#ef4444" };
  try {
    await chrome.action.setBadgeBackgroundColor({ color: cores[estado] ?? "#94a3b8" });
    await chrome.action.setBadgeText({ text: estado === "conectado" ? "" : "!" });
  } catch {}
}

// ---------------------------------------------------------------------- som
// Service worker não toca áudio. A saída é um documento offscreen, que também
// evita depender de arquivos de som do sistema — os tons são sintetizados,
// então soam igual no macOS, Windows e Linux.

async function garantirOffscreen() {
  const existe = await chrome.offscreen.hasDocument?.();
  if (existe) return;
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Tocar o som de alerta das mensagens do Mattermost.",
    });
  } catch (e) {
    if (!String(e.message).includes("Only a single offscreen")) throw e;
  }
}

async function tocarSom(tipo, volume) {
  try {
    await garantirOffscreen();
    await chrome.runtime.sendMessage({ alvo: "offscreen", acao: "tocar", tipo, volume });
  } catch (e) {
    console.warn("som falhou:", e.message);
  }
}

// ------------------------------------------------------------------- alertas

async function alertar(veredito, dados, config) {
  const remetente = (dados.sender_name ?? "alguém").replace(/^@/, "");
  const ehDireta = dados.channel_type === "D" || dados.channel_type === "G";
  const canal = ehDireta
    ? (dados.channel_type === "G" ? "Grupo privado" : "Mensagem direta")
    : (dados.channel_display_name || dados.channel_name || "");

  let corpo = (veredito.post.message ?? "").trim();
  if (!corpo && veredito.post.file_ids?.length) corpo = "📎 Enviou um arquivo";
  if (corpo.length > 200) corpo = corpo.slice(0, 199) + "…";

  const id = `mm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const destino = timeNome && dados.channel_name
    ? `${config.servidor}/${timeNome}/channels/${dados.channel_name}`
    : config.servidor;

  // Em storage, não em memória: o service worker do MV3 pode ser encerrado
  // entre a notificação aparecer e o clique acontecer, e um Map não sobrevive.
  await chrome.storage.session.set({ [`destino-${id}`]: destino });

  chrome.notifications.create(id, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icones/128.png"),
    title: remetente,
    message: corpo || "(mensagem sem texto)",
    contextMessage: canal,
    priority: 2,
    requireInteraction: false,
  });

  if (config.som.ativado) tocarSom(veredito.tipo, config.som.volume);
  await anotar(`Alerta [${veredito.tipo}] de ${remetente}`);
}

chrome.notifications.onClicked.addListener(async (id) => {
  const chave = `destino-${id}`;
  const guardado = await chrome.storage.session.get([chave]);
  const url = guardado[chave];
  if (url) chrome.tabs.create({ url });
  chrome.notifications.clear(id);
  await chrome.storage.session.remove([chave]);
});

// Notificação fechada sem clique: não deixa lixo acumulado no storage.
chrome.notifications.onClosed.addListener((id) => {
  chrome.storage.session.remove([`destino-${id}`]).catch(() => {});
});

// ------------------------------------------------------------------- conexão

async function renovarSessao(config) {
  if (renovando) return null;
  renovando = true;
  try {
    const { credenciais } = await chrome.storage.local.get(["credenciais"]);
    if (!credenciais?.login || !credenciais?.senha) {
      await anotar("Sessão expirou. Abra as opções e faça login de novo.");
      await definirEstado("erro");
      return null;
    }
    const nova = await autenticar(config.servidor, credenciais.login, credenciais.senha);
    await chrome.storage.local.set({ token: nova.token, usuarioId: nova.usuario.id });
    await anotar(`Sessão renovada para @${nova.usuario.username}.`);
    return nova;
  } catch (e) {
    await anotar(`Falha ao renovar sessão: ${e.message}`);
    await definirEstado("erro");
    return null;
  } finally {
    renovando = false;
  }
}

async function conectar() {
  const config = await cfg();
  if (!config.ativado) {
    await definirEstado("parado");
    return;
  }

  if (conexao?.conectado) return;      // já estamos no ar
  if (conexao) conexao.encerrar();

  const guardado = await chrome.storage.local.get(["token"]);
  let token = guardado.token;
  let usuario = token ? await buscarUsuario(config.servidor, token) : null;

  if (!usuario) {
    const nova = await renovarSessao(config);
    if (!nova) return;
    token = nova.token;
    usuario = nova.usuario;
  }

  sessao = { token, usuario };
  await chrome.storage.local.set({ usuarioId: usuario.id, usuarioNome: usuario.username });

  const times = await buscarTimes(config.servidor, token);
  timeNome = times?.[0]?.name ?? null;

  await definirEstado("conectando");
  conexao = new ConexaoMattermost(config.servidor, token);

  conexao.addEventListener("log", (e) => anotar(e.detail));
  conexao.addEventListener("conectado", () => definirEstado("conectado"));
  conexao.addEventListener("token-invalido", async () => {
    await definirEstado("erro");
    const nova = await renovarSessao(config);
    if (nova) { conexao.token = nova.token; sessao = nova; }
  });

  conexao.addEventListener("evento", async (e) => {
    const atual = await cfg();
    if (!atual.ativado) return;
    const veredito = avaliar(e.detail, sessao.usuario.id, atual.canaisMonitorados);
    if (veredito) alertar(veredito, e.detail.data, atual);
  });

  conexao.conectar();
}

// --------------------------------------------------------- ciclo de vida MV3

chrome.runtime.onStartup.addListener(() => conectar());
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARME, { periodInMinutes: 0.5 });
  conectar();
});

// A rede de segurança: se o worker foi encerrado e revivido, o socket antigo
// não existe mais — este alarme percebe e reconecta.
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARME) conectar();
});

chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
  if (msg?.acao === "reconectar") {
    conexao?.encerrar();
    conexao = null;
    conectar().then(() => responder({ ok: true }));
    return true;
  }
  if (msg?.acao === "status") {
    responder({ conectado: !!conexao?.conectado, usuario: sessao?.usuario?.username ?? null });
    return true;
  }
  if (msg?.acao === "testar") {
    (async () => {
      const c = await cfg();
      await alertar(
        { tipo: msg.tipo ?? "dm", post: { message: "Alerta de teste da extensão." } },
        { sender_name: "Teste", channel_type: "D", channel_display_name: "", channel_name: "" },
        c,
      );
      responder({ ok: true });
    })();
    return true;
  }
});

chrome.alarms.create(ALARME, { periodInMinutes: 0.5 });
conectar();
