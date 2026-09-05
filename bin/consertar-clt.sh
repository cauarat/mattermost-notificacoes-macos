#!/bin/bash
# Reinstala o Xcode Command Line Tools.
#
# Diagnóstico desta máquina (03/09/2026): a atualização do CLT ficou pela
# metade — os executáveis subiram para 26.6.0 mas o SDK ficou em 26.5.
# Resultado: falta o header MacErrors.h e o compilador Swift 6.3.3 recusa um
# SDK construído com 6.3.2. Nada que use Foundation compila.
#
# Precisa de sudo, e o download é de ~1 GB.
set -euo pipefail

echo "=== Estado atual ==="
echo "  SDK:          $(xcrun --show-sdk-version 2>/dev/null || echo '?')"
echo "  Executáveis:  $(pkgutil --pkg-info=com.apple.pkg.CLTools_Executables 2>/dev/null | awk '/version:/{print $2}' || echo '?')"
echo ""
echo "Isto vai apagar /Library/Developer/CommandLineTools e baixar de novo (~1 GB)."

# Aceita --sim para pular a pergunta (util quando se cola varios comandos de uma vez).
if [[ "${1:-}" == "--sim" || "${1:-}" == "-y" ]]; then
  echo "Confirmado por --sim."
else
  # Descarta o que ja estava no buffer do terminal: se o usuario colou duas
  # linhas de uma vez, a segunda seria lida aqui como se fosse a resposta.
  read -r -t 0.1 -n 10000 _lixo < /dev/tty 2>/dev/null || true

  read -r -p "Continuar? [s/N] " r < /dev/tty
  if [[ ! "$r" =~ ^[SsYy]$ ]]; then
    echo "Cancelado. (Para pular esta pergunta: bin/consertar-clt.sh --sim)"
    exit 0
  fi
fi

echo ""
echo "==> Removendo instalação quebrada (pede sua senha)"
sudo rm -rf /Library/Developer/CommandLineTools

echo "==> Disparando o instalador"
echo "    Uma janela do macOS vai abrir. Clique em 'Instalar' e aguarde."
sudo xcode-select --install || true

echo ""
echo "Quando a instalação terminar, valide com:"
echo "    ~/mm-notify/bin/verificar-compilador.sh"
