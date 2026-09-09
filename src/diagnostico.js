// Descobre se o daemon e o popup estão de fato rodando.
//
// Existe como módulo próprio porque o mm-doutor e o mm-verificar precisam da
// mesma resposta, e a primeira versão desta lógica estava duplicada — e errada
// nos dois: procurava termos soltos na saída do `ps`, então casava com o
// próprio comando de diagnóstico e reportava "rodando" com o daemon morto.
//
// A fonte confiável é o gerenciador de serviços do sistema. O `ps` só entra
// como plano B, e ainda assim descartando linhas de shell, que carregam o
// texto do comando e envenenam a busca.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SISTEMA } from "./plataforma.js";

const executar = promisify(execFile);

export const ROTULO_SERVICO = "com.cauatoledo.mmnotify";

/** Saída de `ps`, já sem as linhas de shell que atrapalham a busca. */
export async function listaProcessos() {
  try {
    if (SISTEMA === "windows") {
      const { stdout } = await executar("powershell.exe", [
        "-NoProfile", "-Command",
        "Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }",
      ]);
      return limpar(stdout);
    }
    const { stdout } = await executar("/bin/ps", ["-Ao", "command"]);
    return limpar(stdout);
  } catch { return []; }
}

// `/bin/zsh -c ...` carrega o texto inteiro do comando executado; se alguém
// rodar um grep mencionando o daemon, essa linha casaria com qualquer busca.
const ehShell = (linha) => /^\/?(bin\/)?(ba|z|k)?sh\b.*\s-c\b/.test(linha.trim());

function limpar(saida) {
  return saida.split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !ehShell(l));
}

/** Algum processo cuja linha de comando contenha TODOS os termos. */
export function temProcesso(linhas, ...termos) {
  return linhas.some((linha) => termos.every((t) => linha.includes(t)));
}

/** PID que o gerenciador de serviços reporta, ou null se ele não souber. */
async function pidDoServico() {
  try {
    if (SISTEMA === "macos") {
      const { stdout } = await executar("launchctl", ["print", `gui/${process.getuid()}/${ROTULO_SERVICO}`]);
      const m = stdout.match(/^\s*pid\s*=\s*(\d+)/m);
      return m ? Number(m[1]) : null;
    }
    if (SISTEMA === "linux") {
      const { stdout } = await executar("systemctl", [
        "--user", "show", "-p", "MainPID", "--value", "mm-notify.service",
      ]);
      const pid = Number(stdout.trim());
      return pid > 0 ? pid : null;
    }
  } catch { /* serviço não carregado, ou gerenciador indisponível */ }
  return null;
}

const vivo = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

/**
 * O daemon está rodando?
 * @returns {{rodando: boolean, pid: number|null, origem: string}}
 */
export async function daemonAtivo(linhas) {
  const pid = await pidDoServico();
  if (pid && vivo(pid)) return { rodando: true, pid, origem: "gerenciador de serviços" };
  if (pid === null) {
    // Sem serviço carregado ainda pode haver um daemon iniciado à mão.
    const achou = temProcesso(linhas ?? await listaProcessos(), "src/index.js", "mm-notify");
    if (achou) return { rodando: true, pid: null, origem: "processo avulso" };
  }
  return { rodando: false, pid: null, origem: pid ? "serviço sem processo" : "nenhum" };
}

export const MARCA_POPUP = {
  macos: "MMPopup.app/Contents/MacOS/MMPopup",
  windows: "popup-windows.ps1",
  linux: "popup-linux.py",
}[SISTEMA];

export async function popupAtivo(linhas) {
  return temProcesso(linhas ?? await listaProcessos(), MARCA_POPUP);
}
