// Guarda de credenciais, com o melhor mecanismo que cada sistema oferece.
//
//   macOS   → Keychain, via /usr/bin/security
//   Windows → DPAPI, via PowerShell ConvertFrom-SecureString: o resultado só
//             pode ser decifrado pelo mesmo usuário na mesma máquina
//   Linux   → libsecret (secret-tool) quando disponível; senão, arquivo com
//             permissão 0600 e um aviso explícito no log
//
// Em nenhum caso a senha fica em texto claro num arquivo legível por outros.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { SISTEMA } from "./plataforma.js";
import { aviso } from "./log.js";

const executar = promisify(execFile);
const CONTA = "mm-notify";

export const SERVICOS = {
  login: "mm-notify-login",
  senha: "mm-notify-password",
  token: "mm-notify-token",
  usuarioId: "mm-notify-userid",
  github: "mm-notify-github",   // token de leitura do repositório, para o atualizador
};

// ------------------------------------------------------------------ macOS

const macos = {
  async ler(servico) {
    try {
      const { stdout } = await executar("/usr/bin/security", [
        "find-generic-password", "-a", CONTA, "-s", servico, "-w",
      ]);
      return stdout.trimEnd() || null;
    } catch { return null; }
  },
  async gravar(servico, valor) {
    await macos.apagar(servico);
    // -T /usr/bin/security: quem realmente abre o item é o binário security,
    // não o node. Autorizar o node faz o macOS pedir a senha a cada leitura.
    await executar("/usr/bin/security", [
      "add-generic-password", "-a", CONTA, "-s", servico, "-w", valor,
      "-U", "-T", "/usr/bin/security", "-D", "mm-notify",
      "-j", "Credencial do mm-notify (notificacoes do Mattermost)",
    ]);
  },
  async apagar(servico) {
    try {
      await executar("/usr/bin/security", [
        "delete-generic-password", "-a", CONTA, "-s", servico,
      ]);
      return true;
    } catch { return false; }
  },
};

// ---------------------------------------------------------------- Windows

const PASTA_WIN = join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "mm-notify");
const arquivoWin = (servico) => join(PASTA_WIN, `${servico}.dpapi`);

const windows = {
  async ler(servico) {
    const arq = arquivoWin(servico);
    if (!existsSync(arq)) return null;
    try {
      // O texto cifrado vai por stdin, nunca na linha de comando: argumentos
      // de processo são visíveis para outros usuários da máquina.
      const { stdout } = await executar("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command",
        "$cifrado = [Console]::In.ReadToEnd().Trim();" +
        "$seguro = ConvertTo-SecureString $cifrado;" +
        "[Runtime.InteropServices.Marshal]::PtrToStringAuto(" +
        "[Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro))",
      ], { input: readFileSync(arq, "utf8") });
      return stdout.replace(/\r?\n$/, "") || null;
    } catch { return null; }
  },
  async gravar(servico, valor) {
    mkdirSync(PASTA_WIN, { recursive: true });
    const { stdout } = await executar("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "$texto = [Console]::In.ReadToEnd().TrimEnd([char]10,[char]13);" +
      "ConvertTo-SecureString $texto -AsPlainText -Force | ConvertFrom-SecureString",
    ], { input: valor });
    writeFileSync(arquivoWin(servico), stdout.trim(), { mode: 0o600 });
  },
  async apagar(servico) {
    try { unlinkSync(arquivoWin(servico)); return true; } catch { return false; }
  },
};

// ------------------------------------------------------------------ Linux

const PASTA_LINUX = join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "mm-notify");
const arquivoLinux = (servico) => join(PASTA_LINUX, `${servico}.txt`);
let avisouArquivo = false;

const linux = {
  async temSecretTool() {
    try { await executar("which", ["secret-tool"]); return true; } catch { return false; }
  },
  async ler(servico) {
    if (await linux.temSecretTool()) {
      try {
        const { stdout } = await executar("secret-tool", [
          "lookup", "conta", CONTA, "servico", servico,
        ]);
        return stdout.replace(/\n$/, "") || null;
      } catch { return null; }
    }
    const arq = arquivoLinux(servico);
    if (!existsSync(arq)) return null;
    try { return readFileSync(arq, "utf8").replace(/\n$/, "") || null; } catch { return null; }
  },
  async gravar(servico, valor) {
    if (await linux.temSecretTool()) {
      await executar("secret-tool", [
        "store", "--label", `mm-notify ${servico}`, "conta", CONTA, "servico", servico,
      ], { input: valor });
      return;
    }
    if (!avisouArquivo) {
      aviso(
        "secret-tool (libsecret) não encontrado. As credenciais vão para um " +
        `arquivo com permissão 0600 em ${PASTA_LINUX}. Para guardá-las no ` +
        "chaveiro do sistema, instale libsecret-tools.",
      );
      avisouArquivo = true;
    }
    mkdirSync(PASTA_LINUX, { recursive: true, mode: 0o700 });
    const arq = arquivoLinux(servico);
    writeFileSync(arq, valor, { mode: 0o600 });
    chmodSync(arq, 0o600);
  },
  async apagar(servico) {
    if (await linux.temSecretTool()) {
      try {
        await executar("secret-tool", ["clear", "conta", CONTA, "servico", servico]);
        return true;
      } catch { return false; }
    }
    try { unlinkSync(arquivoLinux(servico)); return true; } catch { return false; }
  },
};

const IMPL = { macos, windows, linux }[SISTEMA];

export const ler = (servico) => IMPL.ler(servico);
export const gravar = (servico, valor) => IMPL.gravar(servico, valor);
export const apagar = (servico) => IMPL.apagar(servico);

/** Nome do cofre usado, para o mm-login informar o usuário. */
export const NOME_COFRE = {
  macos: "Keychain do macOS",
  windows: "DPAPI do Windows",
  linux: "chaveiro do sistema (libsecret) ou arquivo protegido",
}[SISTEMA];
