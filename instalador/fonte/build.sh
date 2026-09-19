#!/bin/bash
# Compila o MM-Notify.app (wrapper de instalação) a partir de instalador/fonte/.
#
# Saída: instalador/MM-Notify.app/ — bundle completo pronto para mover para
# ~/Applications/. É ad-hoc signed (não precisa de Developer ID para abrir,
# mas o usuário vai precisar de "clique direito → Abrir" na primeira vez em
# razão do Gatekeeper).
#
# Pré-requisito: Xcode Command Line Tools (xcode-select --install).
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
APP="$AQUI/../MM-Notify.app"

# Versão injetada via TAG (CI) ou package.json (local).
VERSAO="${TAG:-}"
if [ -z "$VERSAO" ] && command -v node >/dev/null 2>&1 && [ -f "$RAIZ/package.json" ]; then
  VERSAO="v$(node -p "require('$RAIZ/package.json').version" 2>/dev/null || echo)"
fi
VERSAO="${VERSAO#v}"
[ -z "$VERSAO" ] && VERSAO="1.0.0"

echo "==> Limpando build anterior"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "==> Compilando main.swift → MM-Notify"
# Compila todos os .swift do diretório fonte. Hoje só tem main.swift, mas a
# estrutura permite quebrar em arquivos sem mudar este script.
swiftc -O \
  -o "$APP/Contents/MacOS/MM-Notify" \
  -framework AppKit \
  -framework Foundation \
  $(find "$AQUI" -name '*.swift')

echo "==> Escrevendo Info.plist"
# LSUIElement=true: sem ícone no Dock, sem entrada em Cmd-Tab. Só fica no
# menu-bar depois que a janela principal fecha. Durante a instalação, a janela
# é .regular via NSApp.setActivationPolicy(.regular).
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>            <string>MM-Notify</string>
    <key>CFBundleDisplayName</key>     <string>MM-Notify</string>
    <key>CFBundleExecutable</key>      <string>MM-Notify</string>
    <key>CFBundleIdentifier</key>      <string>com.cauarat.mmnotify.installer</string>
    <key>CFBundlePackageType</key>     <string>APPL</string>
    <key>CFBundleShortVersionString</key> <string>$VERSAO</string>
    <key>CFBundleVersion</key>         <string>$VERSAO</string>
    <key>LSMinimumSystemVersion</key>  <string>13.0</string>
    <key>LSUIElement</key>             <true/>
    <key>NSHighResolutionCapable</key> <true/>
    <key>NSAppleScriptEnabled</key>    <true/>
</dict>
</plist>
PLIST

printf 'APPL????' > "$APP/Contents/PkgInfo"

echo "==> Assinando (ad-hoc)"
codesign --force --deep --sign - "$APP"
codesign -dv "$APP" 2>&1 | sed 's/^/    /'

echo ""
echo "✓ Pronto: $APP"
echo "  Mover para ~/Applications e dar duplo-clique."
