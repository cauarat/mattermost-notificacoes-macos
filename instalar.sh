#!/bin/bash
# Instalador do mm-notify em outro Mac.
#
# Faz tudo: confere pré-requisitos, compila o popup, cria os atalhos, pede o
# login e sobe o serviço. Para Windows/Linux, use a extensão do Chrome em
# extensao-chrome/ — o popup sobreposto é específico do macOS.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
falhou=0
passo() { echo ""; echo "==> $1"; }

echo ""
echo "  mm-notify — instalação"
echo "  ────────────────────────────────────"

# ---------------------------------------------------------------- requisitos
passo "Conferindo pré-requisitos"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "  ✗ Este instalador é para macOS."
  echo "    Em Windows ou Linux, use a extensão do Chrome:"
  echo "    veja extensao-chrome/LEIA-ME.md"
  exit 1
fi
echo "  ✓ macOS $(sw_vers -productVersion)"

if ! command -v node >/dev/null 2>&1; then
  echo "  ✗ Node.js não encontrado. Instale de https://nodejs.org (versão 22 ou maior)."
  exit 1
fi
VERSAO_NODE="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$VERSAO_NODE" -lt 22 ]; then
  echo "  ✗ Node $(node -v) é antigo. O daemon usa o WebSocket nativo do Node 22+."
  exit 1
fi
echo "  ✓ Node $(node -v)"

NODE_CAMINHO="$(command -v node)"
echo "  ✓ node em $NODE_CAMINHO"

if ! swiftc --version >/dev/null 2>&1; then
  echo "  ✗ Compilador Swift indisponível. Rode: xcode-select --install"
  exit 1
fi
printf '%s\n' 'import AppKit' 'print("ok")' > "/tmp/mm-teste-$$.swift"
if swiftc -o "/tmp/mm-teste-$$" "/tmp/mm-teste-$$.swift" 2>/dev/null; then
  echo "  ✓ Swift compila"
else
  echo "  ✗ O Swift não compila nesta máquina (SDK quebrado?)."
  echo "    Rode: $RAIZ/bin/consertar-clt.sh"
  falhou=1
fi
rm -f "/tmp/mm-teste-$$" "/tmp/mm-teste-$$.swift"
[ $falhou -eq 1 ] && exit 1

# ------------------------------------------------------------------ pastas
passo "Preparando pastas e permissões"
# Descompactar pelo Finder pode perder o bit de execução dos scripts.
chmod +x "$RAIZ"/bin/* "$RAIZ"/mmpopup/build.sh "$RAIZ"/instalar.sh 2>/dev/null
echo "  ✓ scripts executáveis"
# O launchd falha ao iniciar se o diretório do StandardOutPath não existir,
# e a pasta de logs não vai no pacote (só teria lixo da outra máquina).
mkdir -p "$RAIZ/logs"
echo "  ✓ logs/"

# ------------------------------------------------------------------ compilar
passo "Compilando o MMPopup.app"
bash "$RAIZ/mmpopup/build.sh" >/tmp/mm-build-$$.log 2>&1 \
  && echo "  ✓ compilado" \
  || { echo "  ✗ falhou:"; grep -E "error:" /tmp/mm-build-$$.log | head -5 | sed 's/^/    /'; exit 1; }
rm -f /tmp/mm-build-$$.log

# ------------------------------------------------------------------- atalhos
passo "Criando atalhos de linha de comando"
mkdir -p "$HOME/.local/bin"
for c in mm-ctl mm-login mm-test mm-verificar mm-doutor; do
  ln -sf "$RAIZ/bin/$c" "$HOME/.local/bin/$c"
done
echo "  ✓ mm-ctl, mm-login, mm-test, mm-verificar em ~/.local/bin"

if ! echo "$PATH" | tr ':' '\n' | grep -qx "$HOME/.local/bin"; then
  echo "  ⚠ ~/.local/bin não está no PATH. Adicione ao seu ~/.zshrc:"
  echo "      export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

# --------------------------------------------------------- caminhos do plist
passo "Ajustando o serviço para esta máquina"
PLIST="$RAIZ/com.cauatoledo.mmnotify.plist"
# O launchd não herda o PATH do shell: precisa do caminho absoluto do node,
# e os caminhos do projeto mudam de máquina para máquina.
python3 - "$PLIST" "$NODE_CAMINHO" "$RAIZ" <<'PY'
import sys, re, pathlib
plist, node, raiz = sys.argv[1], sys.argv[2], sys.argv[3]
p = pathlib.Path(plist); s = p.read_text()
s = re.sub(r"<string>[^<]*/bin/node</string>", f"<string>{node}</string>", s)
s = re.sub(r"<string>[^<]*/mm-notify(/[^<]*)?</string>",
           lambda m: f"<string>{raiz}{m.group(1) or ''}</string>", s)
p.write_text(s)
PY
plutil -lint "$PLIST" >/dev/null && echo "  ✓ plist ajustado para $RAIZ"

# --------------------------------------------------------------------- login
passo "Login no Mattermost"
if security find-generic-password -a mm-notify -s mm-notify-token >/dev/null 2>&1; then
  echo "  ✓ credenciais já existem no Keychain (pule com Ctrl-C se quiser mantê-las)"
fi
"$RAIZ/bin/mm-login" || { echo "  ✗ login não concluído; rode mm-login e depois mm-ctl instalar"; exit 1; }

# ------------------------------------------------------------------- serviço
passo "Instalando o serviço"
"$RAIZ/bin/mm-ctl" instalar || exit 1

# --------------------------------------------------------------- verificação
passo "Verificando ponta a ponta"
sleep 3
"$RAIZ/bin/mm-verificar"
