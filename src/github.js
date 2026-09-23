// Acesso ao GitHub para o atualizador.
//
// O repositório é privado: sem token, a API responde 404 como se ele não
// existisse. O token é procurado, nesta ordem, em:
//   1. variável de ambiente MM_NOTIFY_GITHUB_TOKEN, GITHUB_TOKEN ou GH_TOKEN
//   2. cofre do sistema (gravado pelo `mm-ctl token`)
//   3. GitHub CLI (`gh auth token`), se estiver instalado e logado
import https from "node:https";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import * as cofre from "./segredos.js";

const executar = promisify(execFile);

export const REPO = "cauarat/mattermost-notificacoes-macos";
export const API_REPO = `https://api.github.com/repos/${REPO}`;

/** @returns {Promise<{token: string, origem: string} | null>} */
export async function obterToken() {
  for (const nome of ["MM_NOTIFY_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"]) {
    if (process.env[nome]) return { token: process.env[nome].trim(), origem: `variável ${nome}` };
  }
  const guardado = await cofre.ler(cofre.SERVICOS.github);
  if (guardado) return { token: guardado, origem: cofre.NOME_COFRE };
  try {
    const { stdout } = await executar("gh", ["auth", "token"], { timeout: 10_000 });
    if (stdout.trim()) return { token: stdout.trim(), origem: "GitHub CLI (gh)" };
  } catch { /* gh ausente ou deslogado */ }
  return null;
}

function cabecalhos(token, extra = {}) {
  return {
    "User-Agent": "mm-notify-updater",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

export class ErroHttp extends Error {
  constructor(status, url) {
    super(`HTTP ${status} ao acessar ${url}`);
    this.status = status;
  }
}

/** GET de JSON na API do GitHub. */
export function getJson(url, token) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: cabecalhos(token, { Accept: "application/vnd.github+json" }) }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new ErroHttp(res.statusCode, url));
      }
      let corpo = "";
      res.setEncoding("utf8");
      res.on("data", (c) => corpo += c);
      res.on("end", () => {
        try { resolve(JSON.parse(corpo)); }
        catch (e) { reject(new Error(`JSON inválido da API: ${e.message}`)); }
      });
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => req.destroy(new Error("timeout HTTP")));
  });
}

/**
 * Baixa um asset de release para `destino`.
 *
 * Com token, usa a URL de API do asset (a única que funciona em repositório
 * privado). Nos dois casos o GitHub redireciona para um armazenamento
 * externo: o redirecionamento é seguido, e o token nunca vai para outro host.
 */
export function baixarAsset(asset, destino, token) {
  const url = token ? asset.url : asset.browser_download_url;
  const inicial = new URL(url).host;

  const pedir = (alvo, saltos) => new Promise((resolve, reject) => {
    const mesmoHost = new URL(alvo).host === inicial;
    const req = https.get(alvo, {
      headers: cabecalhos(mesmoHost ? token : null, { Accept: "application/octet-stream" }),
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (saltos >= 5) return reject(new Error("redirecionamentos demais no download"));
        return resolve(pedir(new URL(res.headers.location, alvo).toString(), saltos + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new ErroHttp(res.statusCode, alvo.split("?")[0]));
      }
      const arq = fs.createWriteStream(destino);
      res.pipe(arq);
      arq.on("finish", () => arq.close(() => resolve(destino)));
      arq.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(120_000, () => req.destroy(new Error("timeout no download")));
  });

  return pedir(url, 0);
}
