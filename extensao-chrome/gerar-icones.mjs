// Gera os ícones PNG da extensão sem dependência nenhuma.
// Escreve o PNG na mão (IHDR + IDAT + IEND) usando o zlib do próprio Node.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

// --- CRC32, exigido em cada chunk do PNG ---
const TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABELA[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(tipo, dados) {
  const t = Buffer.from(tipo, "ascii");
  const corpo = Buffer.concat([t, dados]);
  const tam = Buffer.alloc(4); tam.writeUInt32BE(dados.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tam, corpo, crc]);
}

function png(largura, altura, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8;   // 8 bits por canal
  ihdr[9] = 6;   // RGBA
  // linhas com byte de filtro 0 na frente
  const linhas = Buffer.alloc(altura * (largura * 4 + 1));
  for (let y = 0; y < altura; y++) {
    linhas[y * (largura * 4 + 1)] = 0;
    rgba.copy(linhas, y * (largura * 4 + 1) + 1, y * largura * 4, (y + 1) * largura * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(linhas, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- desenho ---
// Quadrado arredondado azul com um balão de fala branco. Amostragem 3x3 por
// pixel para as bordas não ficarem serrilhadas em 16px.

const AZUL = [31, 111, 235];
const BRANCO = [255, 255, 255];

const dentroArredondado = (x, y, lado, raio) => {
  const dx = Math.max(raio - x, 0, x - (lado - raio));
  const dy = Math.max(raio - y, 0, y - (lado - raio));
  return Math.hypot(dx, dy) <= raio;
};

function dentroBalao(x, y, lado) {
  const e = lado * 0.20, d = lado * 0.80;
  const topo = lado * 0.26, base = lado * 0.62;
  const raio = lado * 0.09;
  // corpo do balão
  const dx = Math.max(e + raio - x, 0, x - (d - raio));
  const dy = Math.max(topo + raio - y, 0, y - (base - raio));
  if (Math.hypot(dx, dy) <= raio) return true;
  // rabinho no canto inferior esquerdo
  const tx = lado * 0.30, ty = base;
  return y >= ty && y <= lado * 0.78 && x >= tx && x <= tx + (lado * 0.78 - y) * 0.9;
}

function desenhar(lado) {
  const px = Buffer.alloc(lado * lado * 4);
  const amostras = 3;
  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      let fundo = 0, balao = 0;
      for (let sy = 0; sy < amostras; sy++) {
        for (let sx = 0; sx < amostras; sx++) {
          const ax = x + (sx + 0.5) / amostras;
          const ay = y + (sy + 0.5) / amostras;
          if (dentroArredondado(ax, ay, lado, lado * 0.22)) {
            fundo++;
            if (dentroBalao(ax, ay, lado)) balao++;
          }
        }
      }
      const total = amostras * amostras;
      const alfa = fundo / total;
      const mistura = balao / total;
      const i = (y * lado + x) * 4;
      for (let c = 0; c < 3; c++) {
        px[i + c] = Math.round(AZUL[c] * (1 - mistura) + BRANCO[c] * mistura);
      }
      px[i + 3] = Math.round(alfa * 255);
    }
  }
  return png(lado, lado, px);
}

for (const lado of [16, 48, 128]) {
  const arquivo = `icones/${lado}.png`;
  writeFileSync(arquivo, desenhar(lado));
  console.log(`  ✓ ${arquivo}`);
}
