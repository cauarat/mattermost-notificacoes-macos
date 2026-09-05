// Diferenças entre macOS, Windows e Linux, concentradas num lugar só.
//
// Tudo o mais no daemon é portátil: WebSocket, filtro, autenticação e a lógica
// de alerta rodam igual nos três. O que muda é como se desenha na tela, como
// se toca som, como se guarda segredo e como o programa sobe sozinho.
import { join } from "node:path";
import { RAIZ } from "./config.js";

export const SISTEMA =
  process.platform === "darwin" ? "macos"
  : process.platform === "win32" ? "windows"
  : "linux";

export const EH_MACOS = SISTEMA === "macos";

/** Comando que exibe os popups: recebe um JSON por linha no stdin. */
export function comandoPopup() {
  switch (SISTEMA) {
    case "macos":
      return {
        programa: join(RAIZ, "mmpopup", "MMPopup.app", "Contents", "MacOS", "MMPopup"),
        args: [],
        precisaBuild: true,
        comoObter: "bash mmpopup/build.sh",
      };

    case "windows":
      return {
        programa: "powershell.exe",
        // -ExecutionPolicy Bypass: sem isto, a política padrão do Windows
        // recusa scripts .ps1 não assinados.
        args: [
          "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
          "-File", join(RAIZ, "mmpopup", "popup-windows.ps1"),
        ],
        precisaBuild: false,
      };

    default:
      return {
        programa: "python3",
        args: [join(RAIZ, "mmpopup", "popup-linux.py")],
        precisaBuild: false,
      };
  }
}

/** Som de emergência, quando o popup caiu e precisa avisar mesmo assim. */
export function comandoSomEmergencia(nomeSom) {
  switch (SISTEMA) {
    case "macos": {
      const caminho = nomeSom?.includes("/")
        ? nomeSom
        : `/System/Library/Sounds/${nomeSom || "Hero"}.aiff`;
      return { programa: "/usr/bin/afplay", args: [caminho] };
    }
    case "windows":
      return {
        programa: "powershell.exe",
        args: ["-NoProfile", "-Command", "[System.Media.SystemSounds]::Asterisk.Play()"],
      };
    default:
      return {
        programa: "paplay",
        args: ["/usr/share/sounds/freedesktop/stereo/message-new-instant.oga"],
      };
  }
}

/**
 * Banner nativo do sistema, junto com o popup.
 *
 * O texto sempre viaja por argumento, nunca interpolado no script — uma
 * mensagem do Mattermost não pode virar comando.
 */
export function comandoBanner({ remetente, canal, corpo }) {
  switch (SISTEMA) {
    case "macos":
      return {
        programa: "/usr/bin/osascript",
        args: [
          "-e", "on run argv",
          "-e", "display notification (item 1 of argv) with title (item 2 of argv) subtitle (item 3 of argv)",
          "-e", "end run",
          "--", corpo, remetente, canal ?? "",
        ],
      };

    case "windows":
      // O popup já é a notificação visível no Windows. Um toast exigiria
      // registrar um AppUserModelID, o que dá pouco retorno aqui.
      return null;

    default:
      return {
        programa: "notify-send",
        args: ["-a", "Mattermost", "--", `${remetente}${canal ? ` · ${canal}` : ""}`, corpo],
      };
  }
}
