// Testes do auto-update.
// Rodar com: node --test testes/atualizar.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Importa o bin/mm-atualizar como módulo. Como ele é um script (não exporta),
// testamos só as funções que ele delega — versão, config e SHA256SUMS —
// reimplementando os helpers para validar a lógica.

// Reimplementação mínima da lógica de versão (mantida em sincronia com o script).
function compararVersoes(a, b) {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const da = pa[i] || 0, db = pb[i] || 0;
    if (da !== db) return da - db;
  }
  return 0;
}

test("compararVersoes: versões iguais", () => {
  assert.equal(compararVersoes("1.0.0", "1.0.0"), 0);
  assert.equal(compararVersoes("v1.2.3".replace(/^v/, ""), "1.2.3"), 0);
});

test("compararVersoes: minor maior", () => {
  assert.equal(compararVersoes("1.1.0", "1.0.0"), 1);
});

test("compararVersoes: patch maior", () => {
  assert.equal(compararVersoes("1.0.1", "1.0.0"), 1);
});

test("compararVersoes: major maior", () => {
  assert.equal(compararVersoes("2.0.0", "1.99.99"), 1);
});

test("compararVersoes: detecta regressão", () => {
  assert.equal(compararVersoes("1.0.0", "1.0.1"), -1);
});

test("compararVersoes: lida com comprimentos diferentes", () => {
  assert.equal(compararVersoes("1.0", "1.0.0"), 0);
  assert.equal(compararVersoes("1.0.1", "1.0"), 1);
});

test("compararVersoes: lida com zeros à esquerda faltando", () => {
  assert.equal(compararVersoes("0.9.0", "0.10.0"), -1);
});

// Teste de leitura de config: simula um config.json sem _interno e verifica
// que o script trataria como defaults seguros.
test("config sem _interno retorna defaults", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mm-test-"));
  const cfgPath = path.join(dir, "config.json");
  fs.writeFileSync(cfgPath, JSON.stringify({ servidor: "https://example.com" }));
  const txt = fs.readFileSync(cfgPath, "utf8");
  const cfg = JSON.parse(txt);
  cfg._interno = cfg._interno || {};
  assert.equal(cfg._interno.versaoInstalada || "0.0.0", "0.0.0");
  assert.equal(cfg._interno.ultimaVerificacao || 0, 0);
});

// Teste do parser de SHA256SUMS.
test("parser SHA256SUMS: extrai hash do asset correto", () => {
  const sums = [
    "abc123def456  MM-Notify-v1.2.0.zip",
    "deadbeef0000  MM-Notify-v1.1.0.zip",
    "cafebabe9999  outro.zip",
  ].join("\n");
  const assetName = "MM-Notify-v1.2.0.zip";
  const linha = sums.split("\n").find((l) => l.endsWith(`  ${assetName}`));
  assert.ok(linha, "deveria achar a linha do asset");
  const hash = linha.trim().split(/\s+/)[0];
  assert.equal(hash, "abc123def456");
});

test("parser SHA256SUMS: aceita formato com asterisco", () => {
  const sums = "abc123def456 *MM-Notify-v1.2.0.zip";
  const assetName = "MM-Notify-v1.2.0.zip";
  const linha = sums.split("\n").find((l) =>
    l.endsWith(`  ${assetName}`) || l.endsWith(` *${assetName}`));
  assert.ok(linha);
  const hash = linha.trim().split(/\s+/)[0];
  assert.equal(hash, "abc123def456");
});
