#!/bin/bash
# Compila o MMPopup e monta o bundle .app.
#
# O bundle e a assinatura não são detalhe cosmético: o UNUserNotificationCenter
# recusa autorização para binário solto ou não assinado. É justamente o registro
# correto no Centro de Notificações que falta ao Mattermost.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$AQUI/MMPopup.app"
BUNDLE_ID="group.actuar.mmnotify"

# Versão injetada via TAG (CI) ou lida do package.json (instalação local).
# Sem nenhuma das duas, cai para 1.0.0 — comportamento histórico.
VERSAO="${TAG:-}"
if [ -z "$VERSAO" ] && command -v node >/dev/null 2>&1 && [ -f "$AQUI/../package.json" ]; then
  VERSAO="v$(node -p "require('$AQUI/../package.json').version" 2>/dev/null || echo)"
fi
VERSAO="${VERSAO#v}"
[ -z "$VERSAO" ] && VERSAO="1.0.0"

echo "==> Limpando build anterior"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "==> Compilando main.swift"
swiftc -O \
  -o "$APP/Contents/MacOS/MMPopup" \
  -framework AppKit \
  "$AQUI/main.swift"

echo "==> Escrevendo Info.plist"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>            <string>Mattermost Alertas</string>
    <key>CFBundleDisplayName</key>     <string>Mattermost Alertas</string>
    <key>CFBundleExecutable</key>      <string>MMPopup</string>
    <key>CFBundleIdentifier</key>      <string>$BUNDLE_ID</string>
    <key>CFBundlePackageType</key>     <string>APPL</string>
    <key>CFBundleShortVersionString</key> <string>$VERSAO</string>
    <key>CFBundleVersion</key>         <string>$VERSAO</string>
    <key>LSMinimumSystemVersion</key>  <string>13.0</string>
    <!-- LSUIElement: sem ícone no Dock, sem menu. -->
    <key>LSUIElement</key>             <true/>
    <key>NSHighResolutionCapable</key> <true/>
</dict>
</plist>
PLIST

printf 'APPL????' > "$APP/Contents/PkgInfo"

echo "==> Assinando (ad-hoc)"
codesign --force --deep --sign - "$APP"
codesign -dv "$APP" 2>&1 | sed 's/^/    /'

echo ""
echo "✓ Pronto: $APP"
