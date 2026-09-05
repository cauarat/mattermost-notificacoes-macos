// Página de opções: login e configuração.
import { autenticar, ErroCredenciais } from "./lib/mattermost.js";

const $ = (id) => document.getElementById(id);
const recado = $("recado");

function dizer(texto, classe = "") {
  recado.textContent = texto;
  recado.className = classe;
}

const PADRAO = {
  servidor: "https://team.actuar.group",
  ativado: true,
  canaisMonitorados: [],
  som: { ativado: true, volume: 0.8 },
};

async function carregar() {
  const { config = {}, credenciais = {}, usuarioNome } =
    await chrome.storage.local.get(["config", "credenciais", "usuarioNome"]);
  const c = { ...PADRAO, ...config, som: { ...PADRAO.som, ...(config.som ?? {}) } };

  $("servidor").value = c.servidor;
  $("canais").value = (c.canaisMonitorados ?? []).join("\n");
  $("ativado").checked = c.ativado;
  $("somAtivado").checked = c.som.ativado;
  $("volume").value = c.som.volume;
  $("login").value = credenciais.login ?? "";
  $("senha").value = credenciais.senha ?? "";

  if (usuarioNome) dizer(`Conectado como @${usuarioNome}.`, "ok");
}

function lerFormulario() {
  return {
    servidor: $("servidor").value.trim().replace(/\/+$/, "") || PADRAO.servidor,
    ativado: $("ativado").checked,
    canaisMonitorados: $("canais").value
      .split("\n").map((l) => l.trim()).filter(Boolean),
    som: {
      ativado: $("somAtivado").checked,
      volume: parseFloat($("volume").value),
    },
  };
}

async function salvar() {
  await chrome.storage.local.set({ config: lerFormulario() });
  dizer("Configuração salva.", "ok");
}

$("salvar").addEventListener("click", salvar);

$("entrar").addEventListener("click", async () => {
  const config = lerFormulario();
  const login = $("login").value.trim();
  const senha = $("senha").value;

  if (!login || !senha) return dizer("Preencha e-mail e senha.", "erro");

  dizer("Validando no servidor…");
  try {
    // Valida antes de guardar: credencial errada gravada vira falha silenciosa.
    const { token, usuario } = await autenticar(config.servidor, login, senha);
    await chrome.storage.local.set({
      config,
      credenciais: { login, senha },
      token,
      usuarioId: usuario.id,
      usuarioNome: usuario.username,
    });
    dizer(`Conectado como @${usuario.username} (${usuario.email}).`, "ok");
    chrome.runtime.sendMessage({ acao: "reconectar" });
  } catch (e) {
    dizer(
      e instanceof ErroCredenciais
        ? "Usuário ou senha incorretos. Nada foi guardado."
        : `Falhou: ${e.message}`,
      "erro",
    );
  }
});

$("sair").addEventListener("click", async () => {
  await chrome.storage.local.remove(["credenciais", "token", "usuarioId", "usuarioNome"]);
  $("login").value = "";
  $("senha").value = "";
  dizer("Dados de acesso apagados desta máquina.", "ok");
});

$("reconectar").addEventListener("click", async () => {
  await salvar();
  chrome.runtime.sendMessage({ acao: "reconectar" });
  dizer("Reconectando…", "ok");
});

for (const b of document.querySelectorAll("[data-testar]")) {
  b.addEventListener("click", async () => {
    await salvar();
    chrome.runtime.sendMessage({ acao: "testar", tipo: b.dataset.testar });
  });
}

carregar();
