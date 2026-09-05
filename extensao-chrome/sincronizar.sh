#!/bin/bash
# Copia a lógica de filtragem do daemon para a extensão.
#
# O filtro é idêntico nos dois lados e tem 14 testes em testes/filtro.test.mjs.
# Manter duas cópias editadas à mão seria pedir para elas divergirem, então a
# fonte da verdade é src/filter.js e esta cópia é gerada.
set -euo pipefail
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORIGEM="$AQUI/../src/filter.js"
DESTINO="$AQUI/lib/filtro.js"

{
  echo "// GERADO AUTOMATICAMENTE — não edite aqui."
  echo "// Fonte: src/filter.js  |  Regenerar: extensao-chrome/sincronizar.sh"
  echo "// Testes: node testes/filtro.test.mjs"
  echo ""
  cat "$ORIGEM"
} > "$DESTINO"

echo "✓ lib/filtro.js sincronizado com src/filter.js"
