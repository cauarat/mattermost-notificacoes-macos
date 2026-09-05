#!/bin/bash
# Diz em uma linha se o compilador nativo voltou a funcionar.
S="$(mktemp -d)"
trap 'rm -rf "$S"' EXIT
printf 'import AppKit\nprint("ok")\n' > "$S/t.swift"

echo "SDK:         $(xcrun --show-sdk-version 2>/dev/null || echo '?')"
echo "Executáveis: $(pkgutil --pkg-info=com.apple.pkg.CLTools_Executables 2>/dev/null | awk '/version:/{print $2}' || echo '?')"
echo ""
if swiftc -o "$S/t" "$S/t.swift" 2>"$S/err"; then
  echo "✓ Compilador OK — rode agora: bash ~/mm-notify/mmpopup/build.sh"
  exit 0
else
  echo "✗ Ainda quebrado. Primeiros erros:"
  grep -E "error:" "$S/err" | head -5 | sed 's/^/    /'
  exit 1
fi
