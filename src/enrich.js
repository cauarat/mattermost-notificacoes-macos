// Monta o que o popup mostra: título, corpo e o link para abrir a conversa.
// sender_name e channel_display_name já vêm no evento, então o caminho quente
// não faz nenhuma chamada REST — só o nome do time é buscado, uma única vez.
import { api } from "./auth.js";
import { aviso } from "./log.js";

let timeCache = null;

export async function nomeDoTime(servidor, token) {
  if (timeCache) return timeCache;
  try {
    const times = await api(servidor, token, "/users/me/teams");
    timeCache = times?.[0]?.name ?? null;
  } catch (e) {
    aviso(`Não foi possível descobrir o time: ${e.message}`);
  }
  return timeCache;
}

export function limparCredenciaisCache() {
  timeCache = null;
}

const LIMITE_CORPO = 200;

export function montarAlerta({ tipo, post, data, servidor, time, cfg }) {
  const remetente = (data.sender_name ?? "alguém").replace(/^@/, "");
  const ehDireta = data.channel_type === "D" || data.channel_type === "G";

  // Em DMs o channel_display_name vem vazio ou com o nome do usuário; usar o
  // remetente é mais claro do que repetir o mesmo nome duas vezes.
  const canal = ehDireta
    ? (data.channel_type === "G" ? "Grupo privado" : "Mensagem direta")
    : (data.channel_display_name || data.channel_name || "");

  let corpo = (post.message ?? "").trim();
  if (!corpo && post.file_ids?.length) corpo = "📎 Enviou um arquivo";
  if (corpo.length > LIMITE_CORPO) corpo = corpo.slice(0, LIMITE_CORPO - 1) + "…";

  const host = servidor.replace(/^https?:\/\//, "");
  const rota = time && data.channel_name ? `${time}/channels/${data.channel_name}` : "";

  return {
    tipo,
    remetente,
    canal,
    corpo: corpo || "(mensagem sem texto)",
    som: cfg.som.porTipo[tipo] ?? cfg.som.porTipo.dm,
    volume: cfg.som.volume,
    somAtivado: cfg.som.ativado,
    insistir: cfg.som.insistir,
    duracao: cfg.duracaoPopupSegundos,
    nativa: cfg.notificacaoNativa,
    // O app desktop registra o esquema mattermost://; o https é o plano B.
    link: rota ? `mattermost://${host}/${rota}` : `${servidor}`,
    linkWeb: rota ? `${servidor}/${rota}` : servidor,
  };
}
