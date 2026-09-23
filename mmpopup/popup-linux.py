#!/usr/bin/env python3
"""Popup sobreposto do mm-notify para Linux.

Equivalente ao MMPopup.app (Swift) do macOS: lê um JSON por linha no stdin e,
para cada um, mostra uma janela flutuante no canto da tela e toca um som.
A janela fica até ser clicada (abre a conversa) ou fechada no X.

Usa tkinter, que vem junto com o Python na maioria das distribuições — sem
dependência para instalar.

Limitação honesta: `-topmost` é um pedido ao gerenciador de janelas, não uma
garantia. No X11 funciona de forma consistente; no Wayland o comportamento
varia conforme o compositor (GNOME costuma respeitar, alguns tiling não).
"""
import json
import queue
import shutil
import subprocess
import sys
import threading
import tkinter as tk
import tkinter.font as tkfont

LARGURA = 380
MARGEM = 20
ESPACO = 10
MAX_SIMULTANEOS = 5

CORES = {
    "dm":     "#1f6feb",
    "mencao": "#d97706",
    "canal":  "#6b7280",
}
ROTULOS = {
    "dm":     "MENSAGEM DIRETA",
    "mencao": "MENÇÃO",
    "canal":  "CANAL",
}

# Sons do tema freedesktop, presentes na maioria dos ambientes de desktop.
SONS_PADRAO = {
    "dm":     "/usr/share/sounds/freedesktop/stereo/message-new-instant.oga",
    "mencao": "/usr/share/sounds/freedesktop/stereo/complete.oga",
    "canal":  "/usr/share/sounds/freedesktop/stereo/message.oga",
}


def tocar(tipo, nome_som, volume):
    """Toca o som fora da thread de interface, para não travar a animação."""
    caminho = nome_som if nome_som and "/" in nome_som else SONS_PADRAO.get(tipo)

    def executar():
        for programa, args in (
            ("paplay", ["--volume", str(int(max(0.0, min(1.0, volume)) * 65536))]),
            ("canberra-gtk-play", ["-f"]),
            ("aplay", ["-q"]),
            ("ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet"]),
        ):
            if not shutil.which(programa) or not caminho:
                continue
            try:
                cmd = [programa] + (args if programa != "canberra-gtk-play" else [])
                cmd += (["-f", caminho] if programa == "canberra-gtk-play" else [caminho])
                subprocess.run(cmd, timeout=6,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return
            except Exception:
                continue
        # Último recurso: o bip do terminal. Melhor que silêncio absoluto.
        try:
            sys.stdout.write("\a")
            sys.stdout.flush()
        except Exception:
            pass

    threading.Thread(target=executar, daemon=True).start()


def abrir(url):
    if not url:
        return
    for programa in ("xdg-open", "gio", "gnome-open", "open"):
        if shutil.which(programa):
            args = [programa, "open", url] if programa == "gio" else [programa, url]
            try:
                subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return
            except Exception:
                continue


class Popup:
    def __init__(self, raiz, alerta, aoFechar):
        self.alerta = alerta
        self.aoFechar = aoFechar
        self.fechando = False

        tipo = alerta.get("tipo", "dm")
        cor = CORES.get(tipo, CORES["dm"])

        self.win = tk.Toplevel(raiz)
        self.win.overrideredirect(True)          # sem barra de título
        self.win.attributes("-topmost", True)    # acima das outras janelas
        self.win.configure(bg="#d0d4da")         # serve de borda fina

        quadro = tk.Frame(self.win, bg="#ffffff")
        quadro.pack(fill="both", expand=True, padx=1, pady=1)

        # Barra colorida indicando o tipo do alerta
        tk.Frame(quadro, bg=cor, width=4).pack(side="left", fill="y")

        corpo = tk.Frame(quadro, bg="#ffffff")
        corpo.pack(side="left", fill="both", expand=True, padx=14, pady=12)

        fonte_rotulo = tkfont.Font(family="DejaVu Sans", size=7, weight="bold")
        fonte_nome = tkfont.Font(family="DejaVu Sans", size=11, weight="bold")
        fonte_canal = tkfont.Font(family="DejaVu Sans", size=8)
        fonte_corpo = tkfont.Font(family="DejaVu Sans", size=10)

        cabecalho = tk.Frame(corpo, bg="#ffffff")
        cabecalho.pack(fill="x")
        tk.Label(cabecalho, text=ROTULOS.get(tipo, ROTULOS["dm"]), fg=cor,
                 bg="#ffffff", font=fonte_rotulo).pack(side="left")
        # O X fecha sem abrir a conversa.
        fechar = tk.Label(cabecalho, text="✕", fg="#9aa4b2", bg="#ffffff",
                          font=fonte_corpo, cursor="hand2", padx=4)
        fechar.pack(side="right")
        fechar.bind("<Button-1>", self._clique_fechar)
        fechar.bind("<Enter>", lambda _e: fechar.config(fg="#14171c", bg="#eef0f3"))
        fechar.bind("<Leave>", lambda _e: fechar.config(fg="#9aa4b2", bg="#ffffff"))

        tk.Label(corpo, text=alerta.get("remetente", "alguém"), fg="#14171c",
                 bg="#ffffff", font=fonte_nome, anchor="w").pack(fill="x", pady=(6, 0))

        canal = alerta.get("canal", "")
        if canal:
            tk.Label(corpo, text=canal, fg="#667085", bg="#ffffff",
                     font=fonte_canal, anchor="w").pack(fill="x")

        tk.Label(corpo, text=alerta.get("corpo", ""), fg="#14171c", bg="#ffffff",
                 font=fonte_corpo, anchor="w", justify="left",
                 wraplength=LARGURA - 46).pack(fill="x", pady=(8, 0))

        # Clique em qualquer lugar abre a conversa. Ligado só na janela: todo
        # widget filho a tem nos bindtags, então o clique chega aqui de
        # qualquer ponto — menos do X, que interrompe a cadeia.
        self.win.bind("<Button-1>", lambda _e: self.clicado())
        self.win.update_idletasks()

    def _clique_fechar(self, _evento):
        self.fechar()
        return "break"   # não deixa o clique seguir até a janela e abrir a conversa

    def altura(self):
        return self.win.winfo_reqheight()

    def posicionar(self, topo):
        tela_l = self.win.winfo_screenwidth()
        x = tela_l - LARGURA - MARGEM
        self.win.geometry(f"{LARGURA}x{self.altura()}+{x}+{int(topo)}")

    def iniciar(self):
        tocar(self.alerta.get("tipo", "dm"),
              self.alerta.get("som"),
              float(self.alerta.get("volume", 0.8)))

    def clicado(self):
        if self.fechando:
            return
        abrir(self.alerta.get("link") or self.alerta.get("linkWeb"))
        self.fechar()

    def fechar(self):
        if self.fechando:
            return
        self.fechando = True
        try:
            self.win.destroy()
        except Exception:
            pass
        self.aoFechar(self)


class Gerenciador:
    def __init__(self, raiz):
        self.raiz = raiz
        self.ativos = []

    def exibir(self, alerta):
        while len(self.ativos) >= MAX_SIMULTANEOS:
            self.ativos[0].fechar()

        popup = Popup(self.raiz, alerta, self.remover)
        self.ativos.append(popup)
        self.reposicionar()
        popup.iniciar()

    def remover(self, popup):
        if popup in self.ativos:
            self.ativos.remove(popup)
        self.reposicionar()

    def reposicionar(self):
        topo = MARGEM
        for p in self.ativos:
            if p.fechando:
                continue
            p.posicionar(topo)
            topo += p.altura() + ESPACO


def main():
    raiz = tk.Tk()
    raiz.withdraw()                     # a janela principal nunca aparece

    fila = queue.Queue()

    def ler_entrada():
        for linha in sys.stdin:
            linha = linha.strip()
            if not linha:
                continue
            try:
                fila.put(json.loads(linha))
            except Exception as e:
                print(f"JSON inválido: {e}", file=sys.stderr, flush=True)
        # stdin fechou: o daemon encerrou, então encerramos junto.
        fila.put(None)

    threading.Thread(target=ler_entrada, daemon=True).start()

    gerenciador = Gerenciador(raiz)

    def drenar():
        try:
            while True:
                item = fila.get_nowait()
                if item is None:
                    raiz.quit()
                    return
                gerenciador.exibir(item)
        except queue.Empty:
            pass
        raiz.after(120, drenar)

    raiz.after(120, drenar)
    raiz.mainloop()


if __name__ == "__main__":
    main()
