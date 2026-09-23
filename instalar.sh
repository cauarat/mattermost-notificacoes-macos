#!/bin/bash
# Instalador do mm-notify em outro Mac.
#
# Faz tudo: confere pré-requisitos, compila o popup, cria os atalhos, pede o
# login e sobe o serviço. Para Windows/Linux, use a extensão do Chrome em
# extensao-chrome/ — o popup sobreposto é específico do macOS.
#
# Modos:
#   (default)        primeira instalação — confere tudo, pede login.
#   --atualizar      re-instala por cima de uma instalação existente — pula a
#                    checagem de pré-requisitos, pula o login (credenciais já
#                    estão no Keychain). Mantém config.json e logs/ intactos.
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
falhou=0
passo() { echo ""; echo "==> $1"; }

# Códigos de saída (documentados ao final do script):
#   0 = sucesso
#   1 = pré-requisito faltando
#   2 = credenciais ausentes (apenas em --atualizar)
#   3 = falha na compilação do Swift
#   4 = falha na instalação do LaunchAgent
#   5 = falha na verificação ponta a ponta

MODO_ATUALIZAR=0
case "${1:-}" in
  --atualizar) MODO_ATUALIZAR=1; shift ;;
  --help|-h)
    sed -n '2,16p' "$0"
    exit 0
    ;;
esac

echo ""
if [ "$MODO_ATUALIZAR" = 1 ]; then
  echo "  mm-notify — atualização"
  echo "  ────────────────────────────────────"
else
  echo "  mm-notify — instalação"
  echo "  ────────────────────────────────────"
fi

# ---------------------------------------------------------------- requisitos
# Em modo --atualizar pulamos tudo isso: a máquina já provou que tem Node 22 e
# Swift funcional quando fez a primeira instalação. Re-checar só atrapalha o
# caminho rápido do auto-update.
if [ "$MODO_ATUALIZAR" = 0 ]; then
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
    rm -f "/tmp/mm-teste-$$" "/tmp/mm-teste-$$.swift"
    exit 1
  fi
  rm -f "/tmp/mm-teste-$$" "/tmp/mm-teste-$$.swift"
fi

# ------------------------------------------------------------------ pastas
passo "Preparando pastas e permissões"
# Descompactar pelo Finder pode perder o bit de execução dos scripts.
chmod +x "$RAIZ"/bin/* "$RAIZ"/mmpopup/build.sh "$RAIZ"/instalar.sh 2>/dev/null
echo "  ✓ scripts executáveis"
# O launchd falha ao iniciar se o diretório do StandardOutPath não existir.
mkdir -p "$RAIZ/logs"
echo "  ✓ logs/"

# ------------------------------------------------------------------ compilar
passo "Compilando o MMPopup.app"
BUILD_LOG="${TMPDIR:-/tmp}/mm-build-$$.log"
if ! bash "$RAIZ/mmpopup/build.sh" >"$BUILD_LOG" 2>&1; then
  echo "  ✗ falhou:"
  grep -E "error:" "$BUILD_LOG" | head -5 | sed 's/^/    /'
  rm -f "$BUILD_LOG"
  exit 3
fi
echo "  ✓ compilado"
rm -f "$BUILD_LOG"

# ------------------------------------------------------------------- atalhos
passo "Criando atalhos de linha de comando"
mkdir -p "$HOME/.local/bin"
for c in mm-ctl mm-login mm-test mm-verificar mm-doutor; do
  ln -sf "$RAIZ/bin/$c" "$HOME/.local/bin/$c"
done
echo "  ✓ mm-ctl, mm-login, mm-test, mm-verificar em ~/.local/bin"

if [ "$MODO_ATUALIZAR" = 0 ]; then
  if ! echo "$PATH" | tr ':' '\n' | grep -qx "$HOME/.local/bin"; then
    echo "  ⚠ ~/.local/bin não está no PATH. Adicione ao seu ~/.zshrc:"
    echo "      export PATH=\"\$HOME/.local/bin:\$PATH\""
  fi
fi

# --------------------------------------------------------- caminhos do plist
passo "Ajustando o serviço para esta máquina"
# Dois plists: o do daemon e o da atualização automática. Ambos usam `node`
# por nome + EnvironmentVariables.PATH; só os paths internos do projeto
# precisam ser patchados.
for PLIST in "$RAIZ/com.cauatoledo.mmnotify.plist" "$RAIZ/com.cauatoledo.mmnotify.atualizar.plist"; do
  [ -f "$PLIST" ] || continue
  python3 - "$PLIST" "$RAIZ" <<'PY'
import sys, re, pathlib
plist, raiz = sys.argv[1], sys.argv[2]
p = pathlib.Path(plist); s = p.read_text()
s = re.sub(r"<string>[^<]*/mm-notify(/[^<]*)?</string>",
           lambda m: f"<string>{raiz}{m.group(1) or ''}</string>", s)
p.write_text(s)
PY
  plutil -lint "$PLIST" >/dev/null && echo "  ✓ $(basename "$PLIST") ajustado para $RAIZ" || {
    echo "  ✗ $(basename "$PLIST") ficou inválido após patch"
    exit 4
  }
done

# --------------------------------------------------------------------- login
# Em modo --atualizar, exigir que as credenciais já existam. Se não existirem,
# falhar com código distinto — é erro de configuração do usuário, não de
# pré-requisito do sistema.
passo "Login no Mattermost"
if security find-generic-password -a mm-notify -s mm-notify-token >/dev/null 2>&1; then
  echo "  ✓ credenciais já existem no Keychain"
else
  if [ "$MODO_ATUALIZAR" = 1 ]; then
    echo "  ✗ Credenciais não estão no Keychain."
    echo "    Rode mm-login uma vez antes de atualizar."
    exit 2
  fi
  "$RAIZ/bin/mm-login" || { echo "  ✗ login não concluído; rode mm-login e depois mm-ctl instalar"; exit 1; }
fi

# ------------------------------------------------------------------- serviço
passo "Instalando o serviço"
"$RAIZ/bin/mm-ctl" instalar || exit 4

# --------------------------------------------------------------- verificação
passo "Verificando ponta a ponta"
sleep 3
"$RAIZ/bin/mm-verificar" || exit 5

# Persistir a versão instalada em config.json para o updater saber o que está
# rodando. Em modo normal, parte de 1.0.0; em --atualizar, o bin/mm-atualizar já
# gravou o valor novo e nós só garantimos que ele existe.
if [ -f "$RAIZ/config.json" ]; then
  python3 - "$RAIZ/config.json" <<'PY'
import json, pathlib, sys, os
p = pathlib.Path(sys.argv[1])
try:
    cfg = json.loads(p.read_text() or "{}")
except Exception:
    cfg = {}
cfg.setdefault("_interno", {})
# A versão dos arquivos instalados é a do package.json, carimbada pela release.
# Sem isto, quem instala copiando o zip à mão ficaria registrado com a versão
# antiga, e o atualizador baixaria de novo a mesma release.
try:
    versao = json.loads((p.parent / "package.json").read_text())["version"]
except Exception:
    versao = None
if versao:
    cfg["_interno"]["versaoInstalada"] = versao
cfg["_interno"].setdefault("versaoInstalada", os.environ.get("MM_NOTIFY_VERSAO", "1.0.0"))
cfg["_interno"].setdefault("ultimaVerificacao", None)
# Separar bloco interno do resto na impressão, mas manter no mesmo arquivo.
p.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n")
PY
  echo "  ✓ versão registrada em config.json"
fi

# O repositório é privado: sem token do GitHub a atualização automática não
# enxerga as releases.
if ! security find-generic-password -a mm-notify -s mm-notify-github >/dev/null 2>&1 \
   && ! gh auth token >/dev/null 2>&1; then
  echo ""
  echo "  ⚠ Atualização automática sem token do GitHub. Para ativá-la, rode:"
  echo "      mm-ctl token"
fi

echo ""
echo "  ✓ Concluído."
