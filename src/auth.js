// Login no Mattermost e manutenção da sessão.
// A sessão do servidor expira (~30 dias); qualquer 401 dispara novo login
// automático a partir das credenciais do Keychain, sem intervenção do usuário.
import * as kc from "./keychain.js";
import { log, aviso } from "./log.js";

export class ErroCredenciais extends Error {}

/** Faz login com login_id + senha. Devolve { token, usuario }. */
export async function autenticar(servidor, loginId, senha) {
  const resp = await fetch(`${servidor}/api/v4/users/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login_id: loginId, password: senha }),
  });

  if (!resp.ok) {
    const corpo = await resp.text().catch(() => "");
    if (resp.status === 401) {
      throw new ErroCredenciais(`Usuário ou senha incorretos (401). ${corpo}`);
    }
    throw new Error(`Falha no login: HTTP ${resp.status}. ${corpo}`);
  }

  // O token da sessão vem no cabeçalho, não no corpo.
  const token = resp.headers.get("Token");
  if (!token) throw new Error("Login aceito mas o servidor não devolveu o cabeçalho Token.");

  return { token, usuario: await resp.json() };
}

/** Refaz o login usando o que está no Keychain e regrava o token novo. */
export async function renovarSessao(servidor) {
  const loginId = await kc.ler(kc.SERVICOS.login);
  const senha = await kc.ler(kc.SERVICOS.senha);
  if (!loginId || !senha) {
    throw new ErroCredenciais(
      "Credenciais não encontradas no Keychain. Rode: ~/mm-notify/bin/mm-login",
    );
  }

  log("Renovando sessão no Mattermost…");
  const { token, usuario } = await autenticar(servidor, loginId, senha);
  await kc.gravar(kc.SERVICOS.token, token);
  await kc.gravar(kc.SERVICOS.usuarioId, usuario.id);
  log(`Sessão renovada para @${usuario.username}.`);
  return { token, usuario };
}

/**
 * Devolve um token válido: reaproveita o do Keychain se ainda funcionar,
 * senão refaz o login. Evita um login novo a cada reinício do daemon.
 */
export async function obterSessao(servidor) {
  const token = await kc.ler(kc.SERVICOS.token);
  if (token) {
    const usuario = await buscarUsuario(servidor, token);
    if (usuario) {
      await kc.gravar(kc.SERVICOS.usuarioId, usuario.id);
      return { token, usuario };
    }
    aviso("Token guardado expirou ou foi invalidado.");
  }
  return renovarSessao(servidor);
}

/** GET /users/me — devolve o usuário, ou null se o token não vale mais. */
export async function buscarUsuario(servidor, token) {
  try {
    const resp = await fetch(`${servidor}/api/v4/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return resp.ok ? await resp.json() : null;
  } catch (e) {
    aviso(`Não foi possível validar o token: ${e.message}`);
    return null;
  }
}

/** Chamada REST autenticada que sinaliza 401 para quem chamou tratar. */
export async function api(servidor, token, caminho) {
  const resp = await fetch(`${servidor}/api/v4${caminho}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (resp.status === 401) throw new ErroCredenciais("401 na API");
  if (!resp.ok) throw new Error(`GET ${caminho} → HTTP ${resp.status}`);
  return resp.json();
}
