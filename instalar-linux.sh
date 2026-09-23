#!/bin/bash
# Instalador do mm-notify no Linux.
# Popup sobreposto (tkinter), som e banner (notify-send), com serviço systemd.
set -uo pipefail
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
passo() { echo ""; echo "==> $1"; }

echo ""; echo "  mm-notify — instalação (Linux)"; echo "  ────────────────────────────────"

passo "Conferindo pré-requisitos"
command -v node >/dev/null || { echo "  ✗ Node.js não encontrado. Instale a versão 22 ou maior."; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] \
  || { echo "  ✗ Node $(node -v) é antigo; o daemon usa o WebSocket nativo do Node 22+."; exit 1; }
echo "  ✓ Node $(node -v)"

python3 -c "import tkinter" 2>/dev/null \
  && echo "  ✓ python3 com tkinter" \
  || { echo "  ✗ tkinter ausente. Instale:"
       echo "      Debian/Ubuntu: sudo apt install python3-tk"
       echo "      Fedora:        sudo dnf install python3-tkinter"
       echo "      Arch:          sudo pacman -S tk"; exit 1; }

command -v notify-send >/dev/null && echo "  ✓ notify-send (banner)" \
  || echo "  ⚠ notify-send ausente — sem banner. O popup e o som funcionam. (apt install libnotify-bin)"
command -v secret-tool >/dev/null && echo "  ✓ secret-tool (chaveiro do sistema)" \
  || echo "  ⚠ secret-tool ausente — credenciais irão para arquivo 0600. (apt install libsecret-tools)"
command -v paplay >/dev/null && echo "  ✓ paplay (som)" \
  || echo "  ⚠ paplay ausente — o som pode não sair. (apt install pulseaudio-utils)"

passo "Preparando pastas e permissões"
chmod +x "$RAIZ"/bin/* "$RAIZ"/mmpopup/popup-linux.py "$RAIZ"/instalar-linux.sh 2>/dev/null
mkdir -p "$RAIZ/logs"
echo "  ✓ pronto"

passo "Criando atalhos"
mkdir -p "$HOME/.local/bin"
for c in mm-ctl mm-login mm-test mm-verificar mm-doutor; do ln -sf "$RAIZ/bin/$c" "$HOME/.local/bin/$c"; done
echo "  ✓ mm-ctl, mm-login, mm-test, mm-verificar"
echo "$PATH" | tr ':' '\n' | grep -qx "$HOME/.local/bin" \
  || echo "  ⚠ adicione ao ~/.bashrc:  export PATH=\"\$HOME/.local/bin:\$PATH\""

passo "Testando o popup"
echo "  Um popup de teste deve aparecer no canto da tela."
( printf '%s\n' '{"tipo":"dm","remetente":"mm-notify","canal":"Instalacao","corpo":"Se voce esta vendo isto, o popup funciona neste sistema.","volume":0.8,"somAtivado":true,"linkWeb":""}'
  sleep 8 ) | python3 "$RAIZ/mmpopup/popup-linux.py" 2>&1 | head -3
echo "  ✓ popup executado"

passo "Login no Mattermost"
"$RAIZ/bin/mm-login" || { echo "  ✗ login não concluído"; exit 1; }

passo "Instalando o serviço (systemd de usuário)"
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/mm-notify.service" <<UNIT
[Unit]
Description=mm-notify — notificacoes do Mattermost
After=graphical-session.target

[Service]
Type=simple
ExecStart=$(command -v node) $RAIZ/src/index.js
Restart=always
RestartSec=15
WorkingDirectory=$RAIZ

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now mm-notify.service && echo "  ✓ ativo e habilitado no login"
# Sem isto, o serviço só roda enquanto houver sessão aberta.
loginctl enable-linger "$USER" 2>/dev/null && echo "  ✓ continua rodando após logout" || true

passo "Verificando ponta a ponta"
sleep 3
"$RAIZ/bin/mm-verificar"
