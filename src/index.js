// mm-notify — daemon principal.
// Conecta no Mattermost, filtra o que importa e manda para o MMPopup.
import { carregarConfig } from "./config.js";
import { obterSessao, renovarSessao, api, ErroCredenciais } from "./auth.js";
import { ConexaoMattermost } from "./websocket.js";
import { avaliar } from "./filter.js";
import { nomeDoTime, montarAlerta } from "./enrich.js";
import { iniciarPopup, enviarAlerta, pararPopup } from "./alert.js";
import { log, aviso, erro } from "./log.js";

const cfg = carregarConfig();

// Depois de uma queda longa vale conferir o que chegou enquanto estávamos fora.
const LIMIAR_LACUNA_MS = 60_000;

let sessao = null;
let renovando = null;

async function garantirSessao() {
  if (!sessao) sessao = await obterSessao(cfg.servidor);
  return sessao.token;
}

// Serializa a renovação: várias falhas simultâneas não devem virar vários logins.
function renovar() {
  renovando ??= renovarSessao(cfg.servidor)
    .then((s) => { sessao = s; })
    .catch((e) => { erro(e.message); })
    .finally(() => { renovando = null; });
  return renovando;
}

async function avisarSobreLacuna(foraPorMs) {
  if (foraPorMs < LIMIAR_LACUNA_MS) return;
  const minutos = Math.round(foraPorMs / 60_000);
  log(`Ficamos ${minutos} min fora; conferindo mensagens não lidas…`);

  try {
    const times = await api(cfg.servidor, sessao.token, "/users/me/teams");
    let total = 0;
    for (const time of times ?? []) {
      const membros = await api(
        cfg.servidor, sessao.token,
        `/users/me/teams/${time.id}/channels/members`,
      );
      total += (membros ?? []).reduce((s, m) => s + (m.mention_count ?? 0), 0);
    }
    if (total > 0) {
      enviarAlerta(montarAlerta({
        tipo: "dm",
        post: { message: `Você tem ${total} menção(ões) não lida(s) recebida(s) enquanto a conexão estava fora.` },
        data: { sender_name: "mm-notify", channel_type: "D" },
        servidor: cfg.servidor,
        time: await nomeDoTime(cfg.servidor, sessao.token),
        cfg,
      }));
    }
  } catch (e) {
    aviso(`Não foi possível conferir não lidas: ${e.message}`);
  }
}

async function principal() {
  log("=== mm-notify iniciando ===");
  log(`Servidor: ${cfg.servidor}`);
  log(`Canais monitorados: ${cfg.canaisMonitorados.length ? cfg.canaisMonitorados.join(", ") : "(nenhum)"}`);
  log(`Som: ${cfg.som.ativado ? `ligado (dm=${cfg.som.porTipo.dm}, menção=${cfg.som.porTipo.mencao}, canal=${cfg.som.porTipo.canal})` : "desligado"}`);

  try {
    await garantirSessao();
  } catch (e) {
    erro(e.message);
    if (e instanceof ErroCredenciais) process.exit(78); // EX_CONFIG
    process.exit(1);
  }
  log(`Autenticado como @${sessao.usuario.username} (${sessao.usuario.id}).`);

  iniciarPopup();

  const conexao = new ConexaoMattermost(cfg.servidor, garantirSessao);

  conexao.on("token-invalido", () => { renovar(); });

  conexao.on("conectado", ({ foraPorMs }) => {
    nomeDoTime(cfg.servidor, sessao.token);
    avisarSobreLacuna(foraPorMs);
  });

  conexao.on("evento", async (evento) => {
    const veredito = avaliar(evento, sessao.usuario.id, cfg.canaisMonitorados);
    if (!veredito) return;

    const alerta = montarAlerta({
      tipo: veredito.tipo,
      post: veredito.post,
      data: evento.data,
      servidor: cfg.servidor,
      time: await nomeDoTime(cfg.servidor, sessao.token),
      cfg,
    });

    log(`Alerta [${alerta.tipo}] de ${alerta.remetente}${alerta.canal ? ` em ${alerta.canal}` : ""}`);
    enviarAlerta(alerta);
  });

  conexao.conectar();

  // Vigia de último recurso.
  //
  // Em 04/09/2026 o daemon ficou 28 minutos preso numa tentativa de reconexão
  // que nunca completou, e mensagens reais se perderam. A causa foi corrigida
  // em websocket.js (prazo de abertura), mas um sistema de notificação que
  // falha em silêncio é pior que nenhum: se por qualquer outro motivo ficarmos
  // muito tempo sem conexão, encerramos e deixamos o launchd subir limpo.
  const LIMITE_MUDO_MS = 5 * 60_000;
  let ultimoOk = Date.now();
  setInterval(() => {
    if (conexao.autenticado) {
      ultimoOk = Date.now();
      return;
    }
    const mudoPor = Date.now() - ultimoOk;
    if (mudoPor > LIMITE_MUDO_MS) {
      erro(
        `Sem conexão há ${Math.round(mudoPor / 60000)} min. ` +
        "Encerrando para o launchd reiniciar do zero.",
      );
      pararPopup();
      process.exit(1);
    }
  }, 30_000);

  const desligar = (sinal) => {
    log(`Recebido ${sinal}; encerrando.`);
    conexao.encerrar();
    pararPopup();
    process.exit(0);
  };
  process.on("SIGTERM", () => desligar("SIGTERM"));
  process.on("SIGINT", () => desligar("SIGINT"));

  // Um erro solto não pode derrubar o daemon: registra e segue.
  process.on("unhandledRejection", (e) => erro(`Promessa rejeitada: ${e?.message ?? e}`));
  process.on("uncaughtException", (e) => erro(`Exceção não tratada: ${e?.message ?? e}`));
}

principal();
