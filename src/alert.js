// Ponte com o MMPopup.app.
//
// O app fica vivo em vez de ser lançado a cada mensagem: economiza ~300ms de
// inicialização por alerta e deixa o empilhamento de popups simultâneos com
// quem tem a informação para resolvê-lo (o próprio app sabe o que já está na
// tela). Se ele morrer, relançamos — e o som sai pelo afplay nesse meio-tempo,
// para que uma falha da camada visual não vire um alerta mudo.
import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { RAIZ } from "./config.js";
import { log, aviso, erro } from "./log.js";

const BINARIO = join(RAIZ, "mmpopup", "MMPopup.app", "Contents", "MacOS", "MMPopup");
const SONS_SISTEMA = "/System/Library/Sounds";

let processo = null;
let relancando = false;

function vivo() {
  return processo && !processo.killed && processo.exitCode === null;
}

export function iniciarPopup() {
  if (vivo() || relancando) return;

  if (!existsSync(BINARIO)) {
    erro(`MMPopup.app não encontrado em ${BINARIO}. Rode: bash mmpopup/build.sh`);
    return;
  }

  processo = spawn(BINARIO, [], { stdio: ["pipe", "pipe", "pipe"] });

  processo.stdout.on("data", (d) => {
    const txt = d.toString().trim();
    if (txt) log(`[popup] ${txt}`);
  });
  processo.stderr.on("data", (d) => {
    const txt = d.toString().trim();
    if (txt) aviso(`[popup] ${txt}`);
  });

  processo.on("exit", (codigo) => {
    aviso(`MMPopup encerrou (código ${codigo}); será relançado no próximo alerta.`);
    processo = null;
  });

  // Um stdin fechado do outro lado vira EPIPE aqui; tratar evita derrubar o daemon.
  processo.stdin.on("error", (e) => aviso(`stdin do popup: ${e.message}`));

  log("MMPopup iniciado.");
}

/**
 * Banner nativo do macOS, via osascript.
 *
 * Por que não pelo app Swift: o UNUserNotificationCenter recusa autorização
 * para apps com assinatura ad-hoc no macOS 26 ("Notifications are not allowed
 * for this application") — confirmado com um app-sonda, tanto rodando o
 * binário direto quanto lançando por `open` e a partir de ~/Applications.
 * Assinar com Developer ID exigiria conta paga da Apple. O osascript já tem
 * permissão concedida nesta máquina, então é por ali.
 *
 * Sem `sound name` de propósito: quem toca é o popup. Se os dois tocassem,
 * cada mensagem soaria duas vezes.
 *
 * O texto vai por argumentos (`on run argv`), nunca interpolado no script —
 * assim aspas, barras e quebras de linha vindas de uma mensagem do Mattermost
 * não conseguem alterar o AppleScript.
 */
function bannerNativo({ remetente, canal, corpo }) {
  const script = [
    "on run argv",
    "display notification (item 1 of argv) with title (item 2 of argv) subtitle (item 3 of argv)",
    "end run",
  ];
  const args = script.flatMap((linha) => ["-e", linha]);
  execFile(
    "/usr/bin/osascript",
    [...args, "--", corpo, remetente, canal ?? ""],
    (e) => { if (e) aviso(`banner nativo falhou: ${e.message}`); },
  );
}

/** Toca um som direto pelo sistema — rede de segurança quando o popup falha. */
function tocarDeEmergencia(nomeSom) {
  const caminho = nomeSom?.includes("/")
    ? nomeSom
    : `${SONS_SISTEMA}/${nomeSom || "Hero"}.aiff`;
  try {
    spawn("/usr/bin/afplay", [caminho], { stdio: "ignore", detached: true }).unref();
  } catch (e) {
    aviso(`afplay falhou: ${e.message}`);
  }
}

export function enviarAlerta(alerta) {
  if (alerta.nativa) bannerNativo(alerta);

  if (!vivo()) {
    if (alerta.somAtivado) tocarDeEmergencia(alerta.som);
    iniciarPopup();
    if (!vivo()) return;
  }

  try {
    processo.stdin.write(JSON.stringify(alerta) + "\n");
  } catch (e) {
    aviso(`Não foi possível enviar ao popup: ${e.message}`);
    if (alerta.somAtivado) tocarDeEmergencia(alerta.som);
  }
}

export function pararPopup() {
  if (vivo()) {
    try { processo.stdin.end(); } catch {}
    try { processo.kill(); } catch {}
  }
  processo = null;
}
