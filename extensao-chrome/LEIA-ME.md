# Mattermost Alertas — extensão do Chrome

Complemento do `mm-notify` para **outras máquinas**. Conecta no mesmo servidor
Mattermost por WebSocket e dispara notificação do sistema com som.

Funciona em Chrome, Edge, Brave e Opera (qualquer navegador baseado em Chromium),
no macOS, Windows e Linux.

---

## Instalar em outro computador

1. Copie a pasta `extensao-chrome/` para a máquina (pendrive, Drive, `scp`, o que for).
2. No Chrome, abra `chrome://extensions`.
3. Ligue o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactação** e escolha a pasta.
5. Clique no ícone da extensão → **Abrir opções**.
6. Preencha e-mail/usuário e senha, clique em **Entrar e conectar**.

Pronto. O ícone na barra mostra o estado da conexão.

---

## ⚠️ Não instale nesta máquina junto com o daemon

Este Mac já roda o `mm-notify` com popup sobreposto. Se a extensão também rodar
aqui, **cada mensagem alerta duas vezes**. Se quiser instalar mesmo assim (para
testar), desmarque **"Extensão ligada"** nas opções.

---

## O que ela faz — e o que não faz

| | Extensão | Daemon (este Mac) |
|---|---|---|
| Notificação do sistema + som | ✅ | ✅ |
| Popup acima de outros apps | ❌ **impossível** | ✅ |
| Aparece mesmo com Foco / Não Perturbe | ❌ | ✅ |
| Funciona com o navegador fechado | ❌ | ✅ |
| Roda em qualquer sistema operacional | ✅ | ❌ só macOS |

Extensão roda dentro do navegador e não consegue desenhar por cima de outros
aplicativos, nem escapar do Não Perturbe. Para isso serve o daemon.

---

## Detalhes técnicos

**Filtro compartilhado.** `lib/filtro.js` é gerado a partir de `src/filter.js`
do daemon — mesma lógica, mesmos 14 testes. Depois de mexer no filtro do daemon,
rode `./sincronizar.sh` para as duas cópias não divergirem.

**Som sintetizado.** Os tons são gerados com Web Audio, não são arquivos: nada
para empacotar, soa igual em qualquer sistema, e não distribui os sons da Apple.
Cada tipo tem seu desenho — mensagem direta sobe, menção é aguda e curta, canal
é uma nota só e discreta.

**Service worker do Manifest V3.** O Chrome encerra o service worker depois de
~30 s ocioso. Atividade de WebSocket adia isso, mas não garante — por isso um
`chrome.alarms` de 30 s acorda o worker e reconecta se o socket tiver morrido
junto. Pelo mesmo motivo, o link de cada notificação fica em
`chrome.storage.session` e não em memória: se o worker reiniciar entre a
notificação aparecer e você clicar, o clique ainda funciona.

**Senha.** Fica no `chrome.storage.local`, que é bem menos protegido que o
Keychain do macOS — é o preço de rodar em qualquer sistema. Use só em máquinas
suas. O botão **Sair e apagar dados** remove tudo daquela máquina. Sem guardar a
senha, você precisa refazer o login quando a sessão expira (~30 dias).

**Mudar de servidor.** O `manifest.json` libera acesso só a
`https://team.actuar.group/*`. Para outro servidor, edite `host_permissions`
antes de carregar a extensão.

---

## Estrutura

```
manifest.json       Manifest V3
background.js       service worker: WebSocket, filtro, notificações
lib/mattermost.js   login REST + WebSocket com reconexão
lib/filtro.js       GERADO de src/filter.js — não edite
offscreen.html/js   toca o som (service worker não reproduz áudio)
opcoes.html/js      login e configuração
popup.html/js       estado da conexão e log recente
gerar-icones.mjs    gera os PNGs sem dependências
sincronizar.sh      copia o filtro do daemon
```

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| Ícone com `!` | Abra o popup e veja o log; normalmente é login expirado |
| Nenhuma notificação | Verifique se o Chrome pode notificar nos ajustes do sistema |
| Sem som | Confira "Tocar som" e o volume nas opções |
| Parou depois de horas | Abra o popup — isso força o worker a acordar e reconectar |
