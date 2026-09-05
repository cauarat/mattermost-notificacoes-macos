// MMPopup — camada visual e sonora do mm-notify.
//
// Lê um JSON por linha no stdin e, para cada um, mostra um popup sobreposto
// e toca um som. O banner nativo é responsabilidade do daemon Node, via
// osascript: o macOS 26 recusa o UNUserNotificationCenter para apps com
// assinatura ad-hoc (verificado com um app-sonda).
//
// O popup é um NSPanel, não uma notificação: é por isso que Foco / Não
// Perturbe não conseguem escondê-lo. É essa a garantia central do sistema.

import AppKit
import QuartzCore          // CAMediaTimingFunction (o AppKit reexporta, mas explícito não custa)

// MARK: - Modelo

struct ConfigInsistir: Decodable {
    var ativado = false
    var intervaloSegundos: Double = 4
    var maximo = 3

    enum CodingKeys: String, CodingKey { case ativado, intervaloSegundos, maximo }

    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        ativado = try c.decodeIfPresent(Bool.self, forKey: .ativado) ?? false
        intervaloSegundos = try c.decodeIfPresent(Double.self, forKey: .intervaloSegundos) ?? 4
        maximo = try c.decodeIfPresent(Int.self, forKey: .maximo) ?? 3
    }
}

/// Todos os campos são opcionais na decodificação: se o lado Node mudar de
/// versão e parar de mandar algum campo, o alerta ainda aparece.
struct Alerta: Decodable {
    var tipo = "dm"
    var remetente = "alguém"
    var canal = ""
    var corpo = ""
    var som = "Hero"
    var volume: Float = 0.8
    var somAtivado = true
    var insistir = ConfigInsistir()
    var duracao: Double = 12
    var nativa = true
    var link = ""
    var linkWeb = ""

    enum CodingKeys: String, CodingKey {
        case tipo, remetente, canal, corpo, som, volume, somAtivado
        case insistir, duracao, nativa, link, linkWeb
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tipo = try c.decodeIfPresent(String.self, forKey: .tipo) ?? "dm"
        remetente = try c.decodeIfPresent(String.self, forKey: .remetente) ?? "alguém"
        canal = try c.decodeIfPresent(String.self, forKey: .canal) ?? ""
        corpo = try c.decodeIfPresent(String.self, forKey: .corpo) ?? ""
        som = try c.decodeIfPresent(String.self, forKey: .som) ?? "Hero"
        volume = try c.decodeIfPresent(Float.self, forKey: .volume) ?? 0.8
        somAtivado = try c.decodeIfPresent(Bool.self, forKey: .somAtivado) ?? true
        insistir = try c.decodeIfPresent(ConfigInsistir.self, forKey: .insistir) ?? ConfigInsistir()
        duracao = try c.decodeIfPresent(Double.self, forKey: .duracao) ?? 12
        nativa = try c.decodeIfPresent(Bool.self, forKey: .nativa) ?? true
        link = try c.decodeIfPresent(String.self, forKey: .link) ?? ""
        linkWeb = try c.decodeIfPresent(String.self, forKey: .linkWeb) ?? ""
    }

    var cor: NSColor {
        switch tipo {
        case "mencao": return .systemOrange
        case "canal":  return .systemGray
        default:       return .systemBlue
        }
    }

    var rotuloTipo: String {
        switch tipo {
        case "mencao": return "MENÇÃO"
        case "canal":  return "CANAL"
        default:       return "MENSAGEM DIRETA"
        }
    }
}

// MARK: - Som

enum Som {
    /// Aceita nome de som do sistema ou caminho para um arquivo próprio.
    /// Um nome inválido cai para Hero e avisa — ficar mudo em silêncio seria
    /// a pior falha possível num sistema de notificação.
    static func carregar(_ nome: String, volume: Float) -> NSSound? {
        var som: NSSound?
        if nome.contains("/") {
            som = NSSound(contentsOf: URL(fileURLWithPath: nome), byReference: true)
        } else {
            som = NSSound(named: NSSound.Name(nome))
        }
        if som == nil {
            Registro.aviso("som '\(nome)' não encontrado; usando Hero.")
            som = NSSound(named: NSSound.Name("Hero"))
        }
        som?.volume = max(0, min(1, volume))
        return som
    }
}

enum Registro {
    static func info(_ msg: String) {
        FileHandle.standardOutput.write(Data((msg + "\n").utf8))
    }
    static func aviso(_ msg: String) {
        FileHandle.standardError.write(Data((msg + "\n").utf8))
    }
}

// MARK: - View clicável

final class AreaClicavel: NSView {
    var aoClicar: (() -> Void)?

    // Sem isto o primeiro clique num painel que não tem foco seria engolido.
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { aoClicar?() }
    override var isFlipped: Bool { true }
}

// MARK: - Popup

final class Popup {
    let painel: NSPanel
    let alerta: Alerta
    private var timerFechar: Timer?
    private var timerContagem: Timer?
    private var timerInsistir: Timer?
    private var somAtual: NSSound?          // precisa ficar retido enquanto toca
    private var repeticoes = 0
    private var restante: Int
    private let rotuloContagem = NSTextField(labelWithString: "")
    private var fechando = false

    static let largura: CGFloat = 380
    static let margem: CGFloat = 20
    static let espaco: CGFloat = 10

    init(alerta: Alerta) {
        self.alerta = alerta
        self.restante = Int(alerta.duracao.rounded())

        let altura = Popup.calcularAltura(alerta: alerta)

        painel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: Popup.largura, height: altura),
            // .nonactivatingPanel: aparece sem roubar o foco do que você digita.
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        painel.isFloatingPanel = true
        painel.level = .screenSaver          // acima inclusive de apps em tela cheia
        painel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        painel.hidesOnDeactivate = false
        painel.isOpaque = false
        painel.backgroundColor = .clear
        painel.hasShadow = true
        painel.ignoresMouseEvents = false

        montarConteudo(altura: altura)
    }

    // MARK: Layout

    private static let fonteCorpo = NSFont.systemFont(ofSize: 13)
    private static let larguraTexto = largura - 24 - 16   // margens internas + barra

    private static func alturaTexto(_ texto: String) -> CGFloat {
        let limite = NSSize(width: larguraTexto, height: 200)
        let attrs: [NSAttributedString.Key: Any] = [.font: fonteCorpo]
        let r = (texto as NSString).boundingRect(
            with: limite,
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: attrs
        )
        return min(max(ceil(r.height), 18), 80)
    }

    private static func calcularAltura(alerta: Alerta) -> CGFloat {
        // cabeçalho + remetente + canal + corpo + folgas
        return 16 + 14 + 6 + 18 + 4 + 14 + 8 + alturaTexto(alerta.corpo) + 16
    }

    private func montarConteudo(altura: CGFloat) {
        let raiz = AreaClicavel(frame: NSRect(x: 0, y: 0, width: Popup.largura, height: altura))
        raiz.wantsLayer = true
        raiz.layer?.cornerRadius = 12
        raiz.layer?.masksToBounds = true
        raiz.aoClicar = { [weak self] in self?.abrirConversa() }

        // Fundo translúcido que acompanha claro/escuro do sistema.
        let fundo = NSVisualEffectView(frame: raiz.bounds)
        fundo.material = .popover
        fundo.blendingMode = .behindWindow
        fundo.state = .active
        fundo.autoresizingMask = [.width, .height]
        raiz.addSubview(fundo)

        // Barra colorida indicando o tipo do alerta.
        let barra = NSView(frame: NSRect(x: 0, y: 0, width: 4, height: altura))
        barra.wantsLayer = true
        barra.layer?.backgroundColor = alerta.cor.cgColor
        barra.autoresizingMask = [.height]
        raiz.addSubview(barra)

        let x: CGFloat = 16
        var y: CGFloat = 14

        // Cabeçalho: tipo do alerta + contagem regressiva
        let tipo = NSTextField(labelWithString: alerta.rotuloTipo)
        tipo.font = .systemFont(ofSize: 9, weight: .bold)
        tipo.textColor = alerta.cor
        tipo.frame = NSRect(x: x, y: y, width: 220, height: 12)
        raiz.addSubview(tipo)

        rotuloContagem.stringValue = "\(restante)s"
        rotuloContagem.font = .systemFont(ofSize: 9, weight: .medium)
        rotuloContagem.textColor = .tertiaryLabelColor
        rotuloContagem.alignment = .right
        rotuloContagem.frame = NSRect(x: Popup.largura - 60, y: y, width: 44, height: 12)
        raiz.addSubview(rotuloContagem)

        y += 12 + 6

        // Remetente
        let remetente = NSTextField(labelWithString: alerta.remetente)
        remetente.font = .systemFont(ofSize: 14, weight: .semibold)
        remetente.textColor = .labelColor
        remetente.lineBreakMode = .byTruncatingTail
        remetente.frame = NSRect(x: x, y: y, width: Popup.largura - x - 16, height: 18)
        raiz.addSubview(remetente)

        y += 18 + 2

        // Canal
        let canal = NSTextField(labelWithString: alerta.canal)
        canal.font = .systemFont(ofSize: 11)
        canal.textColor = .secondaryLabelColor
        canal.lineBreakMode = .byTruncatingTail
        canal.frame = NSRect(x: x, y: y, width: Popup.largura - x - 16, height: 14)
        raiz.addSubview(canal)

        y += 14 + 8

        // Corpo da mensagem
        let corpo = NSTextField(wrappingLabelWithString: alerta.corpo)
        corpo.font = Popup.fonteCorpo
        corpo.textColor = .labelColor
        corpo.isSelectable = false
        corpo.lineBreakMode = .byTruncatingTail
        corpo.maximumNumberOfLines = 4
        corpo.frame = NSRect(x: x, y: y,
                             width: Popup.larguraTexto,
                             height: Popup.alturaTexto(alerta.corpo))
        raiz.addSubview(corpo)

        painel.contentView = raiz
    }

    // MARK: Exibição

    func mostrar(emY topoY: CGFloat) {
        guard let tela = NSScreen.main else { return }
        let area = tela.visibleFrame
        let altura = painel.frame.height
        let destinoX = area.maxX - Popup.largura - Popup.margem
        let destinoY = topoY - altura

        // Entra deslizando pela direita.
        painel.setFrame(
            NSRect(x: area.maxX, y: destinoY, width: Popup.largura, height: altura),
            display: false
        )
        painel.alphaValue = 0
        painel.orderFrontRegardless()

        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.25
            ctx.timingFunction = CAMediaTimingFunction(name: .easeOut)
            painel.animator().setFrame(
                NSRect(x: destinoX, y: destinoY, width: Popup.largura, height: altura),
                display: true
            )
            painel.animator().alphaValue = 1
        }

        tocarSom()
        iniciarTimers()
    }

    func reposicionar(paraY topoY: CGFloat) {
        guard let tela = NSScreen.main, !fechando else { return }
        let area = tela.visibleFrame
        let altura = painel.frame.height
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.18
            painel.animator().setFrame(
                NSRect(x: area.maxX - Popup.largura - Popup.margem,
                       y: topoY - altura, width: Popup.largura, height: altura),
                display: true
            )
        }
    }

    private func iniciarTimers() {
        timerContagem = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.restante -= 1
            self.rotuloContagem.stringValue = "\(max(self.restante, 0))s"
        }

        timerFechar = Timer.scheduledTimer(withTimeInterval: alerta.duracao, repeats: false) { [weak self] _ in
            self?.fechar()
        }

        if alerta.somAtivado && alerta.insistir.ativado && alerta.insistir.maximo > 1 {
            timerInsistir = Timer.scheduledTimer(
                withTimeInterval: max(alerta.insistir.intervaloSegundos, 1), repeats: true
            ) { [weak self] t in
                guard let self else { return }
                self.repeticoes += 1
                if self.repeticoes >= self.alerta.insistir.maximo - 1 {
                    t.invalidate()
                }
                self.tocarSom()
            }
        }
    }

    private func tocarSom() {
        guard alerta.somAtivado else { return }
        // Fora da thread de UI para o carregamento do arquivo não travar a animação.
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self, let som = Som.carregar(self.alerta.som, volume: self.alerta.volume) else { return }
            DispatchQueue.main.async {
                self.somAtual = som   // retido enquanto toca
                som.play()
            }
        }
    }

    private func abrirConversa() {
        let alvo = alerta.link.isEmpty ? alerta.linkWeb : alerta.link
        if let url = URL(string: alvo) {
            // Se o esquema mattermost:// não estiver registrado, cai para o navegador.
            if !NSWorkspace.shared.open(url), let web = URL(string: alerta.linkWeb) {
                NSWorkspace.shared.open(web)
            }
        }
        fechar()
    }

    func fechar() {
        guard !fechando else { return }
        fechando = true
        timerFechar?.invalidate()
        timerContagem?.invalidate()
        timerInsistir?.invalidate()
        somAtual?.stop()

        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.2
            painel.animator().alphaValue = 0
        } completionHandler: { [weak self] in
            guard let self else { return }
            self.painel.orderOut(nil)
            Gerenciador.compartilhado.remover(self)
        }
    }
}

// MARK: - Empilhamento

final class Gerenciador {
    static let compartilhado = Gerenciador()
    private var ativos: [Popup] = []
    private let maximoSimultaneos = 5

    func exibir(_ alerta: Alerta) {
        guard let tela = NSScreen.main else { return }

        // Popups demais viram uma parede ilegível: o mais antigo sai.
        while ativos.count >= maximoSimultaneos {
            ativos.first?.fechar()
            if !ativos.isEmpty { ativos.removeFirst() }
        }

        var topo = tela.visibleFrame.maxY - Popup.margem
        for p in ativos { topo -= p.painel.frame.height + Popup.espaco }

        let popup = Popup(alerta: alerta)
        ativos.append(popup)
        popup.mostrar(emY: topo)
    }

    func remover(_ popup: Popup) {
        ativos.removeAll { $0 === popup }
        reflow()
    }

    /// Reposiciona os que sobraram, para não deixar buracos na pilha.
    private func reflow() {
        guard let tela = NSScreen.main else { return }
        var topo = tela.visibleFrame.maxY - Popup.margem
        for p in ativos {
            p.reposicionar(paraY: topo)
            topo -= p.painel.frame.height + Popup.espaco
        }
    }
}

// MARK: - Entrada

final class Delegado: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ n: Notification) {
        lerEntrada()
    }

    /// Lê uma linha JSON por vez, numa thread separada para não bloquear a UI.
    private func lerEntrada() {
        Thread.detachNewThread {
            while let linha = readLine(strippingNewline: true) {
                let texto = linha.trimmingCharacters(in: .whitespaces)
                guard !texto.isEmpty, let dados = texto.data(using: .utf8) else { continue }
                do {
                    let alerta = try JSONDecoder().decode(Alerta.self, from: dados)
                    DispatchQueue.main.async { Gerenciador.compartilhado.exibir(alerta) }
                } catch {
                    Registro.aviso("JSON inválido: \(error)")
                }
            }
            // stdin fechou: o daemon encerrou, então encerramos junto.
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }
}

let app = NSApplication.shared
let delegado = Delegado()
app.delegate = delegado
app.setActivationPolicy(.accessory)   // sem ícone no Dock
app.run()
