// Acesso ao Keychain do macOS via o binário /usr/bin/security.
// Nenhuma credencial é gravada em disco em texto claro.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const executar = promisify(execFile);
const CONTA = "mm-notify";

/** Lê um segredo. Retorna null se não existir (em vez de lançar). */
export async function ler(servico) {
  try {
    const { stdout } = await executar("/usr/bin/security", [
      "find-generic-password",
      "-a", CONTA,
      "-s", servico,
      "-w",
    ]);
    return stdout.trimEnd() || null;
  } catch {
    return null;
  }
}

export async function apagar(servico) {
  try {
    await executar("/usr/bin/security", [
      "delete-generic-password",
      "-a", CONTA,
      "-s", servico,
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Grava um segredo.
 *
 * O valor vai por argumento do `security`, nunca por shell — execFile não passa
 * por shell, então não há risco de interpretação de caracteres.
 *
 * Sobre o `-T /usr/bin/security`: a lista de apps autorizados precisa conter
 * quem REALMENTE abre o item. Como o daemon lê chamando `/usr/bin/security`,
 * é esse o binário que precisa estar na lista — autorizar o node não adianta,
 * e foi esse engano que fazia o macOS pedir a senha de login a cada leitura.
 *
 * O que isso significa na prática: qualquer programa rodando como você pode
 * pedir esses segredos ao `security`. O Keychain continua protegendo em disco
 * e enquanto estiver trancado, mas não isola de outros processos seus.
 */
export async function gravar(servico, valor) {
  // Apaga antes de gravar: atualizar um item existente pode exigir autorização
  // e reabrir a caixa de senha. Recriar do zero já nasce com a ACL correta.
  await apagar(servico);
  await executar("/usr/bin/security", [
    "add-generic-password",
    "-a", CONTA,
    "-s", servico,
    "-w", valor,
    "-U",
    "-T", "/usr/bin/security",
    "-D", "mm-notify",
    "-j", "Credencial do mm-notify (notificacoes do Mattermost)",
  ]);
}

export const SERVICOS = {
  login: "mm-notify-login",
  senha: "mm-notify-password",
  token: "mm-notify-token",
  usuarioId: "mm-notify-userid",
};
