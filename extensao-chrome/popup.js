// Popup da barra: mostra estado da conexão e as últimas linhas do log.
const $ = (id) => document.getElementById(id);

const ROTULOS = {
  conectado: "Conectado",
  conectando: "Conectando…",
  parado: "Desligada",
  erro: "Precisa de atenção",
};

async function atualizar() {
  const { estado = "parado", log = [], usuarioNome } =
    await chrome.storage.local.get(["estado", "log", "usuarioNome"]);

  $("bolinha").className = `bolinha ${estado}`;
  $("estado").textContent = ROTULOS[estado] ?? estado;
  $("quem").textContent = usuarioNome ? `@${usuarioNome}` : "sem login — abra as opções";

  $("log").replaceChildren(
    ...(log.length ? log : ["(sem registros ainda)"]).slice(0, 25).map((linha) => {
      const d = document.createElement("div");
      d.textContent = linha;     // textContent, nunca innerHTML: o log traz
      return d;                  // nomes vindos do servidor
    }),
  );
}

$("opcoes").addEventListener("click", () => chrome.runtime.openOptionsPage());
atualizar();
setInterval(atualizar, 2000);
