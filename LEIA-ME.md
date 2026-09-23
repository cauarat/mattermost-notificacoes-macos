# mm-notify

Notificações em tempo real do Mattermost: **popup sobreposto + banner + som**.

Roda em **macOS, Windows e Linux** — com popup acima dos outros aplicativos nos três.

Conecta direto na API do Mattermost (`team.actuar.group`) por WebSocket, independente do app desktop.

> **Algo parou de funcionar?** Rode `mm-doutor` — ele diz o que está errado e o
> comando que resolve. Guia completo em **[MANUTENCAO.md](MANUTENCAO.md)**.

---

## Por que isto existe

O Mattermost desktop não entrega notificações nesta máquina. A causa está no macOS, não no app: em `~/Library/Preferences/com.apple.ncprefs.plist` — o banco do Centro de Notificações — há 117 apps registrados (Slack, Discord, WhatsApp, Chrome, Mail…), mas **`Mattermost.Desktop` não aparece em nenhum deles**. O app nunca completou o registro de permissão, então o sistema descarta silenciosamente tudo que ele emite, enquanto internamente ele acha que está tudo certo.

O `mm-notify` resolve isso por fora, e de quebra dá controle que o app não oferece: escolher exatamente quais canais alertam, e um popup que **Foco / Não Perturbe não conseguem suprimir** — porque é uma janela, não uma notificação.

---

## Instalação

Antes, no Mac novo:

- **Node.js 22 ou maior:** instalador em <https://nodejs.org> (versão LTS).
- **Ferramentas de linha de comando da Apple**, para compilar o popup: rode `xcode-select --install` no Terminal e aceite.
- **Um token do GitHub só de leitura**, porque o repositório é privado. Crie em <https://github.com/settings/personal-access-tokens/new>: *Repository access* → só `mattermost-notificacoes-macos`; *Permissions* → *Contents: Read-only*.

Depois:

1. Com a conta do GitHub aberta no navegador, baixe o `MM-Notify-vX.Y.Z.zip` da [release mais recente](https://github.com/cauarat/mattermost-notificacoes-macos/releases/latest).
2. No Terminal, troque `X.Y.Z` pela versão baixada:

```bash
cd ~ && mkdir -p mm-notify \
  && unzip -o -q ~/Downloads/MM-Notify-vX.Y.Z.zip -d mm-notify \
  && cd mm-notify && bash instalar.sh
```

Se o Safari já tiver descompactado o zip (fica uma pasta `MM-Notify-vX.Y.Z` em Downloads), troque a linha do `unzip` por
`&& cp -R ~/Downloads/MM-Notify-vX.Y.Z/ mm-notify/ \`.

O instalador confere os pré-requisitos, compila o popup, pede o login do Mattermost, sobe o serviço, testa com uma mensagem real e, por último, pede o token do GitHub. Daí em diante o daemon sobe sozinho a cada login, e as versões novas chegam sozinhas.

## Atualizações

No macOS, um serviço à parte (`com.cauatoledo.mmnotify.atualizar`) verifica no login e a cada 6 horas se há release nova no GitHub. Quando encontra, baixa o zip, valida o SHA256 e re-roda o instalador em modo `--atualizar`, que pula o login e mantém seu `config.json` e seus `logs/` intactos. O registro fica em `logs/mm-atualizar.log`, e `mm-ctl status` mostra se a atualização automática está ligada.

**Token do GitHub (uma vez por máquina).** O repositório é privado, e sem login o GitHub responde 404 como se ele não existisse. O atualizador precisa de um token só de leitura:

1. Crie em <https://github.com/settings/personal-access-tokens/new>: *Repository access* → só `mattermost-notificacoes-macos`; *Permissions* → *Contents: Read-only*; a validade mais longa que aceitar.
2. Rode `mm-ctl token` e cole. Ele confere o acesso antes de guardar o token no Keychain.

Se a máquina tiver o GitHub CLI logado (`gh auth login`), ele é usado sem precisar do passo acima. Quando o token vencer, `logs/mm-atualizar.log` avisa; é só rodar `mm-ctl token` de novo.

Instalações anteriores à v1.2.1 têm um atualizador que não sabe usar token, então precisam receber a v1.2.1 à mão uma vez (veja o MANUTENCAO.md). Para desligar a atualização automática, ponha `"atualizacaoAutomatica": false` no `config.json`.

Para forçar a checagem manualmente:

```bash
mm-ctl checar-atualizacao    # só consulta
mm-ctl atualizar             # consulta + baixa + instala
```

Se você moveu o projeto para outro lugar (ex: de `~/mm-notify` para `~/Code/mm-notify`):

```bash
mm-ctl reinstalar    # re-aponta o LaunchAgent para o caminho atual
```

---

## Está funcionando mesmo?

```bash
mm-verificar
```

Manda uma mensagem de verdade pelo servidor Mattermost e confere se ela
percorre toda a cadeia: servidor → WebSocket → daemon → filtro → popup.
Não depende de outra pessoa mandar mensagem — usa uma marca de autoteste para
driblar a regra que descarta as próprias mensagens.

Ele valida tudo que é verificável por software. O que só você pode confirmar é
o que aparece na tela e o que sai no alto-falante.

⚠️ Depois de mexer em qualquer arquivo de `src/`, rode `mm-ctl restart` — o
Node carrega os módulos na inicialização e não vê alterações sem reiniciar.

## Uso diário

```bash
mm-ctl status      # daemon rodando? popup rodando? app compilado?
mm-ctl logs        # acompanhar em tempo real
mm-ctl restart     # aplicar mudanças do config.json
mm-ctl stop        # parar (o launchd relança)
mm-ctl desinstalar # desligar de vez, não sobe mais no login
```

---

## Configuração — `config.json`

```json
{
  "servidor": "https://team.actuar.group",
  "canaisMonitorados": [],
  "notificacaoNativa": true,
  "som": {
    "ativado": true,
    "volume": 0.8,
    "porTipo": { "dm": "Hero", "mencao": "Glass", "canal": "Tink" },
    "insistir": { "ativado": false, "intervaloSegundos": 4, "maximo": 3 }
  }
}
```

Rode `mm-ctl restart` depois de editar.

| Campo | O que faz |
|---|---|
| `canaisMonitorados` | Canais que alertam mesmo sem menção. Aceita o nome interno (`financeiro`) ou o exibido (`Financeiro`). |
| `atualizacaoAutomatica` | Se `false`, o Mac não instala versões novas sozinho; use `mm-ctl atualizar`. Padrão: ligado. |
| `notificacaoNativa` | Se `false`, só o popup sobreposto — sem banner na Central de Notificações. O banner é emitido via `osascript`. |
| `som.volume` | 0.0 a 1.0, independente do volume do sistema. |
| `som.porTipo` | Timbre por tipo de alerta. Aceita nome de som do sistema **ou** caminho para um arquivo (`.aiff`, `.wav`, `.mp3`). |
| `som.insistir` | Repete o som enquanto o popup está na tela. Útil se você sai da frente do Mac. |

**Sons do sistema disponíveis:** `Basso`, `Blow`, `Bottle`, `Frog`, `Funk`, `Glass`, `Hero`, `Morse`, `Ping`, `Pop`, `Purr`, `Sosumi`, `Submarine`, `Tink`.

---

## O que gera alerta

1. **Mensagens diretas** e grupos privados
2. **Menções a você** (`@seu-usuario`) em qualquer canal
3. Mensagens nos **canais listados** em `canaisMonitorados`

Nunca alerta: suas próprias mensagens (mesmo enviadas de outro dispositivo) e mensagens de sistema ("fulano entrou no canal").

**O popup não some sozinho.** Ele fica na tela até você clicar nele — o que abre
aquela conversa no Mattermost — ou no **X** do canto, que só fecha. Com
cinco popups já na tela, o próximo toma o lugar do mais antigo.

---

## Como funciona

```
                        ┌── JSON por stdin ──> MMPopup.app (Swift): popup + som
Mattermost ──wss──> daemon Node (src/) ──┤
                        └── osascript ──────> banner nativo do macOS
```

O daemon cuida da rede e do banner; o app Swift cuida da tela e do som.

**Por que o banner sai pelo `osascript` e não pelo app Swift:** o macOS 26 recusa
o `UNUserNotificationCenter` para apps com assinatura ad-hoc — `"Notifications
are not allowed for this application"`. Isso foi verificado com um app-sonda em
quatro configurações: binário direto, lançado via `open`, registrado no
LaunchServices e instalado em `~/Applications`. Todas negadas. Emitir o banner
pelo próprio app exigiria assinatura com Developer ID, ou seja, conta paga da
Apple. O `osascript` já tem permissão nesta máquina, então é por ali.

O texto do banner vai por argumentos (`on run argv`), nunca interpolado no
script — testado inclusive contra tentativa de injeção de AppleScript.

**Robustez:** heartbeat a cada 30 s com timeout de 15 s (detecta socket morto depois que o Mac dorme), backoff exponencial de 1 s a 30 s, re-login automático quando a sessão expira, e consulta de não lidas ao voltar de uma queda longa.

**Segurança:** e-mail, senha e token ficam no Keychain do macOS, gravados via `/usr/bin/security`. Nada em texto claro no disco.

---

## Estrutura

```
src/index.js       orquestrador
src/websocket.js   conexão, heartbeat, backoff
src/filter.js      decide o que merece alerta
src/auth.js        login e renovação de sessão
src/keychain.js    acesso ao Keychain
src/enrich.js      monta título, corpo e link
src/alert.js       ponte com o MMPopup + banner via osascript
src/config.js      carrega config.json com padrões
mmpopup/main.swift popup (NSPanel) + som
testes/            testes do filtro
```

## Instalação por sistema

| Sistema | Comando | Popup | Serviço |
|---|---|---|---|
| macOS | `bash instalar.sh` | `MMPopup.app` (Swift, `NSPanel`) | launchd |
| Windows | `powershell -ExecutionPolicy Bypass -File .\instalar-windows.ps1` | WinForms `TopMost` | pasta Inicializar |
| Linux | `bash instalar-linux.sh` | tkinter `-topmost` | systemd de usuário |

O daemon Node é o mesmo nos três: WebSocket, filtro e autenticação não mudam.
O que varia está isolado em `src/plataforma.js` — como desenhar na tela, tocar
som, guardar segredo e subir sozinho.

**Onde ficam as credenciais:** Keychain (macOS), DPAPI (Windows), libsecret ou
arquivo 0600 (Linux). Nunca em texto claro legível por outros.

**Ressalva do Linux:** `-topmost` é um pedido ao gerenciador de janelas, não
uma garantia. No X11 funciona de forma consistente; no Wayland varia conforme
o compositor.

**Ressalva do Windows:** a janela fica acima de tudo, exceto jogos em tela
cheia exclusiva — nenhuma janela aparece por cima desses, em sistema nenhum.

## Extensão do Chrome (outras máquinas)

Em `extensao-chrome/` há uma extensão que faz o mesmo para **outros
computadores** — Chrome/Edge/Brave, em macOS, Windows ou Linux. Ela dá
notificação do sistema com som, mas **não** o popup sobreposto: extensão roda
dentro do navegador e não desenha por cima de outros apps nem escapa do Foco.

Instruções em `extensao-chrome/LEIA-ME.md`.

⚠️ Não rode as duas nesta máquina ao mesmo tempo, senão cada mensagem alerta
duas vezes.

O filtro é compartilhado: `extensao-chrome/lib/filtro.js` é gerado de
`src/filter.js`. Depois de alterar o filtro, rode `extensao-chrome/sincronizar.sh`.

## Testes

```bash
node ~/mm-notify/testes/filtro.test.mjs   # 18 testes do filtro
mm-verificar                              # cadeia ponta a ponta, com o servidor real
```

---

## Problemas comuns

Rode `mm-doutor`: ele investiga e diz a correção.

Para o guia completo — como ler o log, tarefas do dia a dia, e todos os
problemas já enfrentados com suas causas — veja **[MANUTENCAO.md](MANUTENCAO.md)**.
