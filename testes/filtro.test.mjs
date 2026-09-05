import { avaliar, MARCA_TESTE } from "../src/filter.js";

const EU = "meu-user-id";
const OUTRO = "outro-user-id";
const canais = ["financeiro", "Avisos Gerais"];

// Monta um evento no formato exato da API: post e mentions são STRINGS JSON.
const ev = ({ tipoCanal = "O", autor = OUTRO, texto = "oi", mentions = null,
              nome = "aleatorio", exibido = "Aleatório", tipoPost = "" }) => ({
  event: "posted",
  data: {
    channel_type: tipoCanal,
    channel_name: nome,
    channel_display_name: exibido,
    sender_name: "@fulano",
    ...(mentions ? { mentions: JSON.stringify(mentions) } : {}),
    post: JSON.stringify({ user_id: autor, message: texto, type: tipoPost }),
  },
});

const casos = [
  ["DM alerta",                      ev({ tipoCanal: "D" }),                              "dm"],
  ["Grupo privado alerta",           ev({ tipoCanal: "G" }),                              "dm"],
  ["Menção a mim alerta",            ev({ mentions: [EU] }),                              "mencao"],
  ["Menção a outro NÃO alerta",      ev({ mentions: [OUTRO] }),                           null],
  ["Canal monitorado alerta",        ev({ nome: "financeiro" }),                          "canal"],
  ["Canal por nome exibido alerta",  ev({ nome: "avisos", exibido: "Avisos Gerais" }),     "canal"],
  ["Canal não monitorado ignora",    ev({ nome: "random" }),                              null],
  ["Minha própria msg ignora",       ev({ tipoCanal: "D", autor: EU }),                    null],
  ["Minha própria menção ignora",    ev({ autor: EU, mentions: [EU] }),                    null],
  ["Msg de sistema ignora",          ev({ tipoCanal: "D", tipoPost: "system_join_channel" }), null],
  ["mentions malformado não quebra", { event: "posted", data: { channel_type: "O", channel_name: "financeiro",
       mentions: "{lixo", post: JSON.stringify({ user_id: OUTRO, message: "x" }) } },      "canal"],
  ["post malformado não quebra",     { event: "posted", data: { channel_type: "D", post: "{quebrado" } }, null],
  ["evento de outro tipo ignora",    { event: "typing", data: {} },                       null],
  ["evento sem data ignora",         { event: "posted" },                                 null],

  // Marca de autoteste: só vale para mensagem sua, e só com a marca presente.
  ["autoteste meu alerta",           ev({ tipoCanal: "D", autor: EU, texto: `oi ${MARCA_TESTE}` }),  "dm"],
  ["minha msg sem a marca ignora",   ev({ tipoCanal: "D", autor: EU, texto: "oi comum" }),           null],
  ["marca de outro segue regra normal", ev({ tipoCanal: "D", autor: OUTRO, texto: MARCA_TESTE }),    "dm"],
  ["marca em canal não monitorado ignora", ev({ autor: EU, nome: "random", texto: MARCA_TESTE }),    "dm"],
];

let ok = 0, falhou = 0;
for (const [nome, evento, esperado] of casos) {
  let obtido;
  try {
    const r = avaliar(evento, EU, canais);
    obtido = r ? r.tipo : null;
  } catch (e) {
    obtido = `EXCEÇÃO: ${e.message}`;
  }
  const passou = obtido === esperado;
  passou ? ok++ : falhou++;
  console.log(`${passou ? "  ✓" : "  ✗"} ${nome.padEnd(34)} esperado=${String(esperado).padEnd(7)} obtido=${obtido}`);
}
console.log(`\n  ${ok} passaram, ${falhou} falharam`);
process.exit(falhou ? 1 : 0);
