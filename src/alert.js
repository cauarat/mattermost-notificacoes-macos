// Ponte com o programa de popup, seja qual for o sistema.
//
// O popup fica vivo em vez de ser lançado a cada mensagem: economiza a
// inicialização por alerta e deixa o empilhamento de popups simultâneos com
// quem tem a informação para resolvê-lo. Se ele morrer, relançamos — e o som
// sai pelo caminho de emergência nesse meio-tempo, para que uma falha da
// camada visual não vire um alerta mudo.
import { spawn, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { log, aviso, erro } from "./log.js";
import { comandoPopup, comandoSomEmergencia, comandoBanner, SISTEMA } from "./plataforma.js";

let processo = null;

function vivo() {
  return processo && !processo.killed && processo.exitCode === null;
}

export function iniciarPopup() {
  if (vivo()) return;

  const { programa, args, precisaBuild, comoObter } = comandoPopup();

  // Só faz sentido conferir existência quando é um binário nosso; `powershell`
  // e `python3` vêm do PATH e não são caminhos absolutos.
  if (precisaBuild && !existsSync(programa)) {
    erro(`Programa de popup não encontrado em ${programa}. Rode: ${comoObter}`);
    return;
  }

  try {
    processo = spawn(programa, args, { stdio: ["pipe", "pipe", "pipe"] });
  } catch (e) {
    erro(`Não consegui iniciar o popup (${programa}): ${e.message}`);
    processo = null;
    return;
  }

  processo.on("error", (e) => {
    erro(`Falha no processo de popup: ${e.message}`);
    processo = null;
  });

  processo.stdout.on("data", (d) => {
    const txt = d.toString().trim();
    if (txt) log(`[popup] ${txt}`);
  });
  processo.stderr.on("data", (d) => {
    const txt = d.toString().trim();
    if (txt) aviso(`[popup] ${txt}`);
  });

  processo.on("exit", (codigo) => {
    aviso(`Popup encerrou (código ${codigo}); será relançado no próximo alerta.`);
    processo = null;
  });

  // Um stdin fechado do outro lado vira EPIPE aqui; tratar evita derrubar o daemon.
  processo.stdin.on("error", (e) => aviso(`stdin do popup: ${e.message}`));

  log(`Popup iniciado (${SISTEMA}).`);
}

/** Rede de segurança sonora quando o popup falha. */
function tocarDeEmergencia(nomeSom) {
  const { programa, args } = comandoSomEmergencia(nomeSom);
  try {
    spawn(programa, args, { stdio: "ignore", detached: true }).unref();
  } catch (e) {
    aviso(`som de emergência falhou: ${e.message}`);
  }
}

/**
 * Banner nativo do sistema.
 *
 * No macOS sai pelo osascript, e não pelo app Swift, porque o macOS 26 recusa
 * o UNUserNotificationCenter para apps com assinatura ad-hoc — verificado com
 * um app-sonda em quatro configurações. No Linux usa notify-send. No Windows
 * não há banner: o popup já cumpre o papel.
 */
function bannerNativo(alerta) {
  const cmd = comandoBanner(alerta);
  if (!cmd) return;
  execFile(cmd.programa, cmd.args, (e) => {
    if (e) aviso(`banner nativo falhou: ${e.message}`);
  });
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
