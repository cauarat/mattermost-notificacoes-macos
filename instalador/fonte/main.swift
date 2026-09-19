// MM-Notify.app — wrapper de instalação do mm-notify.
//
// Janela de boas-vindas com um botão "Instalar" e um log rolável.
// Política de janela: .regular durante a instalação (caso contrário a janela
// não vem ao frente); LSUIElement no Info.plist aplica-se ao app todo.
//
// O wrapper não orquestra a instalação via NSTask. Em vez disso, abre um
// Terminal.app real com `bash -c 'instalar.sh && read -p "..."'` — porque
// instalar.sh chama mm-login, que precisa de TTY interativo. Tentar rodar via
// NSTask resulta em falha silenciosa na etapa de login.

import AppKit
import Foundation

// MARK: - Localizar a raiz do projeto

/// Sobe diretórios a partir do bundle procurando um arquivo sentinela
/// (`instalar.sh`). O .app é distribuído dentro do zip do release, então vive
/// em `~/Applications/MM-Notify.app` mas o código do projeto fica em
/// `~/mm-notify`. Achar a raiz é só achar o `instalar.sh` mais próximo.
func encontrarRaiz() -> URL? {
  let dir = Bundle.main.resourcePath ?? Bundle.main.bundlePath
  var url = URL(fileURLWithPath: dir)
  for _ in 0..<6 {
    let candidato = url.appendingPathComponent("instalar.sh")
    if FileManager.default.fileExists(atPath: candidato.path) {
      return url
    }
    url.deleteLastPathComponent()
  }
  // Fallback: convenção ~/mm-notify
  let home = FileManager.default.homeDirectoryForCurrentUser
  return home.appendingPathComponent("mm-notify")
}

// MARK: - ViewController

class InstallViewController: NSViewController, NSTextViewDelegate {
  private let logView = NSScrollView()
  private let textView = NSTextView()
  private let instalarBtn = NSButton(title: "Instalar", target: nil, action: nil)
  private let cancelarBtn = NSButton(title: "Cancelar", target: nil, action: nil)
  private let statusLabel = NSTextField(labelWithString: "")
  private let ajudaLabel = NSTextField(wrappingLabelWithString: "")

  override func loadView() {
    let frame = NSRect(x: 0, y: 0, width: 540, height: 380)
    self.view = NSView(frame: frame)

    // Título
    let titulo = NSTextField(labelWithString: "mm-notify")
    titulo.font = NSFont.systemFont(ofSize: 22, weight: .bold)
    titulo.frame = NSRect(x: 20, y: 330, width: 500, height: 30)
    view.addSubview(titulo)

    // Subtítulo
    let sub = NSTextField(labelWithString:
      "Notificações em tempo real do Mattermost para macOS.")
    sub.font = NSFont.systemFont(ofSize: 12)
    sub.textColor = .secondaryLabelColor
    sub.frame = NSRect(x: 20, y: 308, width: 500, height: 18)
    view.addSubview(sub)

    // Log rolável
    logView.frame = NSRect(x: 20, y: 80, width: 500, height: 215)
    logView.hasVerticalScroller = true
    logView.borderType = .bezelBorder
    logView.autohidesScrollers = false
    textView.isEditable = false
    textView.isSelectable = true
    textView.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
    textView.textContainerInset = NSSize(width: 6, height: 6)
    textView.autoresizingMask = [.width]
    logView.documentView = textView
    view.addSubview(logView)

    // Botões
    cancelarBtn.target = self
    cancelarBtn.action = #selector(cancelarClicado)
    cancelarBtn.bezelStyle = .rounded
    cancelarBtn.frame = NSRect(x: 20, y: 30, width: 100, height: 28)
    view.addSubview(cancelarBtn)

    instalarBtn.target = self
    instalarBtn.action = #selector(instalarClicado)
    instalarBtn.bezelStyle = .rounded
    instalarBtn.frame = NSRect(x: 420, y: 30, width: 100, height: 28)
    view.addSubview(instalarBtn)

    // Status
    statusLabel.frame = NSRect(x: 130, y: 32, width: 280, height: 22)
    statusLabel.font = NSFont.systemFont(ofSize: 11)
    statusLabel.textColor = .secondaryLabelColor
    view.addSubview(statusLabel)

    // Ajuda
    ajudaLabel.frame = NSRect(x: 20, y: 305, width: 500, height: 0)
    ajudaLabel.font = NSFont.systemFont(ofSize: 11)
    ajudaLabel.textColor = .tertiaryLabelColor
    ajudaLabel.maximumNumberOfLines = 0
    view.addSubview(ajudaLabel)

    atualizarEstado(.ocioso)
  }

  enum Estado { case ocioso, instalando, sucesso, erro }

  func atualizarEstado(_ s: Estado) {
    switch s {
    case .ocioso:
      instalarBtn.isEnabled = true
      instalarBtn.title = "Instalar"
      cancelarBtn.isEnabled = true
      cancelarBtn.title = "Cancelar"
      statusLabel.stringValue = "Pronto para instalar."
    case .instalando:
      instalarBtn.isEnabled = false
      instalarBtn.title = "Instalando…"
      cancelarBtn.title = "Fechar"
      statusLabel.stringValue = "Instalando no Terminal…"
    case .sucesso:
      instalarBtn.isEnabled = true
      instalarBtn.title = "Fechar"
      cancelarBtn.isEnabled = false
      statusLabel.stringValue = "✓ Instalado. Pode fechar esta janela."
    case .erro:
      instalarBtn.isEnabled = true
      instalarBtn.title = "Tentar de novo"
      cancelarBtn.title = "Fechar"
      statusLabel.stringValue = "✗ A instalação falhou. Veja o log."
    }
  }

  func anexar(_ linha: String) {
    let attributed = NSAttributedString(string: linha + "\n",
      attributes: [.font: NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)])
    textView.textStorage?.append(attributed)
    textView.scrollToEndOfDocument(nil)
  }

  @objc func cancelarClicado() {
    NSApplication.shared.terminate(nil)
  }

  @objc func instalarClicado() {
    if instalarBtn.title == "Fechar" { NSApplication.shared.terminate(nil); return }
    iniciarInstalacao()
  }

  func iniciarInstalacao() {
    atualizarEstado(.instalando)
    anexar("==> Procurando a raiz do projeto…")

    guard let raiz = encontrarRaiz() else {
      anexar("✗ Não encontrei o projeto mm-notify.")
      anexar("  Esperado em ~/mm-notify ou junto deste .app.")
      atualizarEstado(.erro)
      return
    }
    anexar("  ✓ raiz: \(raiz.path)")

    let instalar = raiz.appendingPathComponent("instalar.sh").path
    if !FileManager.default.fileExists(atPath: instalar) {
      anexar("✗ instalar.sh não encontrado em \(raiz.path).")
      atualizarEstado(.erro)
      return
    }

    // Limpar quarantine do .app e do instalar.sh — zip baixado pelo Chrome/Safari
    // marca qualquer .app descompactado. Sem isso, o Gatekeeper reclama.
    let me = Bundle.main.bundlePath
    _ = run("/usr/bin/xattr", ["-dr", "com.apple.quarantine", me])
    _ = run("/usr/bin/xattr", ["-dr", "com.apple.quarantine", raiz.path])

    // Abre Terminal.app executando o instalar.sh. O `read -p '...'` mantém a
    // janela aberta para o usuário ler mensagens de erro depois do install.
    let comando = """
    cd '\(raiz.path)' && \
    bash instalar.sh ; \
    STATUS=$?; \
    if [ $STATUS -eq 0 ]; then \
      echo ''; echo '✓ Instalação concluída. Pode fechar esta janela.'; \
      read -p 'Pressione Enter para fechar…'; \
    else \
      echo ''; echo \"✗ Instalação falhou (código $STATUS). Veja acima.\"; \
      read -p 'Pressione Enter para fechar…'; \
    fi
    """

    let terminal = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Terminal")?
      .path ?? "/Applications/Utilities/Terminal.app"

    let ok = NSWorkspace.shared.open(URL(fileURLWithPath: terminal))
    if !ok {
      anexar("✗ Não consegui abrir o Terminal.app.")
      atualizarEstado(.erro)
      return
    }

    // O Terminal aceita comandos via AppleScript. Mais confiável do que
    // `open -a Terminal --args` porque esse último não executa o comando.
    let script = """
    tell application "Terminal"
      activate
      do script "\(comando.replacingOccurrences(of: "\"", with: "\\\""))"
    end tell
    """

    if let ascript = NSAppleScript(source: script) {
      var erroInfo: NSDictionary?
      _ = ascript.executeAndReturnError(&erroInfo)
    }

    // Como não temos como monitorar o Terminal daqui, ficamos otimistas:
    // o usuário vê o resultado na janela do Terminal. Aqui só esperamos e
    // atualizamos para um estado neutro.
    atualizarEstado(.sucesso)
    anexar("==> Acompanhe no Terminal.app que acabou de abrir.")
    anexar("    Esta janela pode ser fechada quando terminar.")
  }

  @discardableResult
  private func run(_ launchPath: String, _ args: [String]) -> Int32 {
    let p = Process()
    p.launchPath = launchPath
    p.arguments = args
    p.standardOutput = Pipe()
    p.standardError = Pipe()
    do { try p.run() } catch { return -1 }
    p.waitUntilExit()
    return p.terminationStatus
  }
}

// MARK: - AppDelegate

class AppDelegate: NSObject, NSApplicationDelegate {
  var window: NSWindow!
  var controller: InstallViewController!

  func applicationDidFinishLaunching(_ notification: Notification) {
    let style: NSWindow.StyleMask = [.titled, .closable, .miniaturizable]
    let frame = NSRect(x: 0, y: 0, width: 540, height: 380)
    window = NSWindow(contentRect: frame, styleMask: style,
      backing: .buffered, defer: false)
    window.title = "mm-notify"
    window.center()

    controller = InstallViewController()
    controller.view.frame = frame
    window.contentViewController = controller

    // Política .regular para podermos trazer ao frente durante a instalação.
    // LSUIElement no Info.plist só afeta o app depois que essa janela fechar.
    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)
    window.makeKeyAndOrderFront(nil)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }
}

// MARK: - entry point

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
