# Manutenção do mm-notify

Guia para resolver problemas sozinho, sem precisar de ajuda externa.

Tudo aqui vem de falha que **aconteceu de verdade** neste projeto, com a causa
identificada e a correção testada. Não há caso hipotético.

---

## Comece por aqui

Qualquer problema, o primeiro comando é sempre este:

```bash
mm-doutor
```

Ele investiga o estado do sistema, aponta o que está errado e imprime **o
comando exato que resolve**. Se não achar nada, diz que está saudável.

Quando ele não acusar nada mas você ainda desconfiar, faça o teste ativo:

```bash
mm-verificar
```

Este envia uma mensagem **de verdade** pelo servidor Mattermost e acompanha se
ela percorre toda a cadeia até virar popup na sua tela.

| Comando | O que faz | Quando usar |
|---|---|---|
| `mm-doutor` | Investiga o estado, sugere correções | Algo parece errado |
| `mm-verificar` | Testa a cadeia com mensagem real | Confirmar que está tudo certo |

---

## Não estou recebendo notificações

Siga nesta ordem. A maioria dos casos para no passo 1.

### 1. Rode o diagnóstico

```bash
mm-doutor
```

Se ele apontar algo, faça o que ele mandar e pare por aqui.

### 2. Confirme que a conexão está viva

```bash
mm-ctl status
```

Você quer ver `daemon: rodando` e, nas últimas linhas do log,
`Conectado e autenticado no Mattermost.`

### 3. Teste com uma mensagem real

```bash
mm-verificar
```

Se as 5 etapas passarem mas **nada apareceu na tela**, o problema é da camada
visual, não da conexão. Teste ela isolada:

```bash
mm-test --todos
```

### 4. A mensagem deveria mesmo alertar?

O sistema só alerta em três situações:

1. Mensagem direta ou grupo privado
2. Alguém escreveu `@seu-usuario`
3. Canal que você listou em `canaisMonitorados`

Mensagem em canal comum, sem menção e fora da sua lista, **não gera alerta** —
isso é o comportamento correto, não uma falha. Para incluir um canal, veja
[Monitorar um canal](#monitorar-um-canal-espec%C3%ADfico).

---

## Como ler o log

```bash
mm-ctl logs
```

Sai com `Ctrl-C`. O que cada linha significa:

| Linha | Significado |
|---|---|
| `Conectado e autenticado no Mattermost.` | **Tudo certo.** É esta que você quer ver por último |
| `Alerta [dm] de Fulano` | Um alerta foi disparado agora |
| `Conexão perdida (código 1006).` + `Nova tentativa em Ns.` | Normal. Caiu e está se recuperando sozinho |
| `Conectando em wss://…` **e nada depois por mais de 1 minuto** | ⚠️ Travou. Rode `mm-ctl restart` |
| `Servidor aceitou a conexão mas recusou a autenticação` | Sua senha do Mattermost mudou. Rode `mm-login` |
| `Sem conexão há N min. Encerrando para o launchd reiniciar.` | O vigia agiu. É o comportamento desejado, não um erro |
| `Popup encerrou (código N)` | Normal. Sobe de novo no próximo alerta |
| `Ficamos N min fora; conferindo mensagens não lidas…` | Recuperando o que chegou durante uma queda longa |
| `Servidor inalcançável` | Sem internet, ou VPN caiu |

### A linha mais importante de todas

```
Conectando em wss://team.actuar.group/api/v4/websocket …
```

Se esta for a **última** linha do log há vários minutos, o daemon está travado
e você não está recebendo nada — mesmo com `mm-ctl status` dizendo "rodando".

Foi assim que duas mensagens se perderam em 04/09/2026: 28 minutos em silêncio.
O código hoje tem prazo de 20 segundos e um vigia que reinicia após 5 minutos
sem conexão, então isso não deveria mais acontecer. Se acontecer, é caso novo:

```bash
mm-ctl restart
```

---

## Problemas conhecidos

### "command not found: mm-ctl"

A pasta dos comandos não está no seu `PATH`. Solução permanente:

```bash
for c in mm-ctl mm-login mm-test mm-verificar mm-doutor; do
  ln -sf ~/mm-notify/bin/$c ~/.local/bin/$c
done
```

Se `~/.local/bin` também não estiver no PATH, adicione ao `~/.zshrc`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Enquanto isso, use o caminho completo: `~/mm-notify/bin/mm-ctl status`

### "Bootstrap failed: 5: Input/output error"

O serviço **já estava instalado**. O `bootout` derrubou o daemon e o
`bootstrap` seguinte falhou — resultado: você fica sem alertas sem perceber.

```bash
mm-ctl restart
```

### Aparece uma caixa pedindo a senha do Mac

Ela pede a senha de **login do seu Mac**, não a do Mattermost — por isso a do
Mattermost não funciona ali.

Isso significa que a permissão do Keychain está errada. Regravar corrige:

```bash
mm-login
```

Para confirmar que resolveu, `mm-doutor` deve mostrar a leitura do cofre em
menos de 100 ms. Demora de segundos significa que o sistema está abrindo caixa.

### Mudei algo em `src/` e nada aconteceu

O Node carrega os módulos na inicialização e não vê alterações sem reiniciar:

```bash
mm-ctl restart
```

### O popup não aparece, mas o som toca

O programa de popup não está rodando ou não foi compilado.

```bash
bash mmpopup/build.sh   # macOS
mm-ctl restart
```

No Linux, verifique o tkinter: `python3 -c "import tkinter"`.
Se faltar: `sudo apt install python3-tk`

### A compilação falha com erro de SDK

O Command Line Tools está corrompido — costuma ser atualização pela metade
(executáveis numa versão, SDK em outra). Sintoma: até `import Foundation` falha.

```bash
bash bin/consertar-clt.sh      # pede sudo, baixa ~1 GB
bash bin/verificar-compilador.sh
```

### O banner do macOS não aparece (só o popup)

**Esperado.** O macOS 26 recusa notificações de aplicativos com assinatura
ad-hoc, e assinar exigiria conta paga da Apple. O banner sai pelo `osascript`,
que já tem permissão.

O popup e o som são independentes disso — e são justamente a parte que o
Foco/Não Perturbe não consegue silenciar.

### Trocou a senha do Mattermost

```bash
mm-login
```

Não precisa reiniciar nada: o daemon percebe e se reconecta sozinho.

### Recebendo alertas em dobro

Você está com o daemon **e** a extensão do Chrome ativos na mesma máquina.
Escolha um: desmarque "Extensão ligada" nas opções da extensão, ou rode
`mm-ctl desinstalar`.

---

### `mm-ctl atualizar` falha com "HTTP 404"

O repositório é privado. Sem token, o GitHub responde 404 como se ele não
existisse. Rode `mm-ctl token`, cole um token de leitura (o LEIA-ME explica
como criar) e depois `mm-ctl atualizar --force`.

Se `mm-ctl token` responder "comando desconhecido", a instalação é anterior à
v1.2.1 e o atualizador dela não sabe usar token. Instale a versão nova à mão,
uma única vez:

1. Com a sua conta do GitHub aberta no navegador, baixe o
   `MM-Notify-vX.Y.Z.zip` da release mais recente.
2. No Terminal (troque o nome do arquivo pelo que você baixou):

```bash
cd ~/Downloads && rm -rf mm-novo && mkdir mm-novo \
  && unzip -q MM-Notify-vX.Y.Z.zip -d mm-novo \
  && rsync -a --exclude=config.json --exclude=logs/ mm-novo/ ~/mm-notify/ \
  && cd ~/mm-notify && bash instalar.sh --atualizar \
  && mm-ctl token
```

O Safari descompacta o zip sozinho e cria uma pasta `MM-Notify-vX.Y.Z`. Nesse
caso, troque as três primeiras linhas por
`cd ~/Downloads && rsync -a --exclude=config.json --exclude=logs/ MM-Notify-vX.Y.Z/ ~/mm-notify/ \`.

A partir daí as versões novas chegam sozinhas.

## Tarefas do dia a dia

Depois de editar `config.json`, **sempre** rode `mm-ctl restart`.

### Monitorar um canal específico

Edite `config.json`:

```json
"canaisMonitorados": ["financeiro", "Avisos Gerais"]
```

Aceita o nome interno (`financeiro`) ou o exibido (`Financeiro`).

### Trocar os sons

```json
"som": { "porTipo": { "dm": "Submarine", "mencao": "Glass", "canal": "Tink" } }
```

Disponíveis no macOS: `Basso`, `Blow`, `Bottle`, `Frog`, `Funk`, `Glass`,
`Hero`, `Morse`, `Ping`, `Pop`, `Purr`, `Sosumi`, `Submarine`, `Tink`.
Também aceita caminho para um arquivo próprio.

### Silenciar sem desinstalar

```json
"som": { "ativado": false }
```

Os popups continuam aparecendo, mudos.

### Popup mais discreto

```json
"som": { "volume": 0.4 }
```

O popup não tem duração: fica até você clicar nele (abre a conversa) ou no X
(só fecha). Um `duracaoPopupSegundos` que tenha sobrado num `config.json`
antigo é ignorado.

### Insistir quando você sai da frente

```json
"som": { "insistir": { "ativado": true, "intervaloSegundos": 4, "maximo": 3 } }
```

Repete o som enquanto o popup estiver na tela.

### Desligar temporariamente

```bash
mm-ctl stop      # o launchd relança em seguida
```

Para desligar de vez, sem voltar no próximo login:

```bash
mm-ctl desinstalar
```

Para religar: `mm-ctl instalar`

---

## Depois de atualizar o código

```bash
cd ~/mm-notify
git pull
bash mmpopup/build.sh    # só no macOS, se mmpopup/ mudou
mm-ctl restart
mm-verificar
```

---

## Quando nada disso resolver

Junte estas três coisas antes de pedir ajuda — elas respondem quase toda
pergunta que alguém faria:

```bash
mm-doutor > /tmp/diagnostico.txt 2>&1
mm-ctl status >> /tmp/diagnostico.txt 2>&1
tail -40 ~/mm-notify/logs/mm-notify.log >> /tmp/diagnostico.txt
```

O arquivo `/tmp/diagnostico.txt` terá o quadro completo.

⚠️ O arquivo contém o endereço do servidor, seu nome de usuário e seu ID no
Mattermost. **Não contém senha nem token** — verifiquei: essas ficam no cofre
do sistema e nunca são impressas.

---

## Onde está cada coisa

```
~/mm-notify/
├── config.json          o que você edita no dia a dia
├── logs/                mm-notify.log e mm-notify.err
├── bin/                 os comandos (mm-ctl, mm-doutor, …)
├── src/                 o daemon
└── mmpopup/             o programa que desenha o popup
```

Credenciais **não** ficam em arquivo: vão para o Keychain (macOS), DPAPI
(Windows) ou libsecret (Linux).

## Referência rápida

```bash
mm-doutor            # algo está errado? o que faço?
mm-verificar         # teste real, ponta a ponta
mm-ctl status        # estado resumido
mm-ctl logs          # acompanhar ao vivo (Ctrl-C sai)
mm-ctl restart       # aplicar mudanças / destravar
mm-login             # senha mudou, ou caixa pedindo senha do Mac
mm-test --todos      # só o visual e o som
mm-ctl token         # token do GitHub para a atualização automática
```
