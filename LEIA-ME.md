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

Baixe o `MM-Notify-vX.Y.Z.zip` da página de [Releases](https://github.com/cauarat/mattermost-notificacoes-macos/releases/latest) e descompacte. Você verá um `MM-Notify.app` junto com o resto do projeto.

```bash
# 1. Mover o .app para a pasta de Aplicações do seu usuário
mkdir -p ~/Applications
mv MM-Notify.app ~/Applications/

# 2. Duplo-clique no .app (ou abra do Finder).
#    Primeira vez: clique com botão direito → Abrir (Gatekeeper em apps
#    ad-hoc-signed). O Terminal vai abrir pedindo suas credenciais do Mattermost.
```

Após isso, o daemon sobe sozinho a cada login, e as versões novas chegam sozinhas (veja [Atualizações](#atualizações)).

> Se preferir a linha de comando, o caminho antigo continua funcionando:
>
> ```bash
> cd ~/mm-notify
> bash instalar.sh          # primeira vez
> mm-ctl atualizar          # para atualizar
> ```
>
> O instalador detecta automaticamente se é primeira instalação (pede login)
> ou atualização (pula o login, recompila o popup, reinstala o serviço).

## Atualizações

No macOS, um serviço à parte (`com.cauatoledo.mmnotify.atualizar`) verifica no login e a cada 6 horas se há release nova no GitHub. Quando encontra, baixa o zip, valida o SHA256 e re-roda o instalador em modo `--atualizar`, que pula o login e mantém seu `config.json` e seus `logs/` intactos. O registro fica em `logs/mm-atualizar.log`, e `mm-ctl status` mostra se a atualização automática está ligada.

Instalações feitas antes da v1.2.0 não têm esse serviço: atualize uma vez à mão (`mm-ctl atualizar --force`) e ele passa a existir. Para desligá-lo, ponha `"atualizacaoAutomatica": false` no `config.json`.

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
