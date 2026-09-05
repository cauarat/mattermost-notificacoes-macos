// GERADO AUTOMATICAMENTE — não edite aqui.
// Fonte: src/filter.js  |  Regenerar: extensao-chrome/sincronizar.sh
// Testes: node testes/filtro.test.mjs

// Decide se um evento "posted" merece alerta e de que tipo ele é.
//
// Atenção ao formato do evento: data.post e data.mentions chegam como
// STRINGS JSON, não como objetos — é o tropeço clássico da API do Mattermost.

/** Marca usada por bin/mm-verificar para testar a cadeia ponta a ponta. */
export const MARCA_TESTE = "[mm-notify-autoteste]";

/** @returns {{tipo: 'dm'|'mencao'|'canal', post: object} | null} */
export function avaliar(evento, meuUserId, canaisMonitorados) {
  if (evento.event !== "posted") return null;
  const data = evento.data ?? {};

  let post;
  try {
    post = JSON.parse(data.post);
  } catch {
    return null;
  }

  if (!post) return null;

  // Nunca alertar sobre as próprias mensagens (inclusive as enviadas de outro
  // dispositivo, que chegam por este mesmo socket).
  //
  // A exceção é a marca de autoteste: ela permite validar a cadeia inteira
  // — servidor, WebSocket, filtro, popup, som e banner — mandando mensagem
  // para si mesmo, sem depender de outra pessoa estar disponível.
  if (post.user_id === meuUserId) {
    const ehTeste = typeof post.message === "string"
      && post.message.includes(MARCA_TESTE);
    return ehTeste ? { tipo: "dm", post } : null;
  }

  // Mensagens de sistema: entrou no canal, saiu, mudou o tópico…
  if (typeof post.type === "string" && post.type.startsWith("system_")) return null;

  const tipoCanal = data.channel_type;

  // 1) Mensagem direta ou grupo privado.
  if (tipoCanal === "D" || tipoCanal === "G") return { tipo: "dm", post };

  // 2) Menção a você em qualquer canal.
  if (data.mentions) {
    try {
      if (JSON.parse(data.mentions).includes(meuUserId)) return { tipo: "mencao", post };
    } catch {
      // mentions malformado: cai para a checagem de canal.
    }
  }

  // 3) Canal que o usuário escolheu monitorar (aceita o nome interno ou o
  //    nome exibido, porque é fácil confundir os dois ao editar o config).
  if (canaisMonitorados.length) {
    const alvos = canaisMonitorados.map((c) => c.toLowerCase().replace(/^#/, ""));
    const nome = (data.channel_name ?? "").toLowerCase();
    const exibido = (data.channel_display_name ?? "").toLowerCase();
    if (alvos.includes(nome) || alvos.includes(exibido)) return { tipo: "canal", post };
  }

  return null;
}
