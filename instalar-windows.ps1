# Instalador do mm-notify no Windows.
# Popup sobreposto (WinForms), som e inicializacao automatica na conta.
#
# Rode no PowerShell, dentro da pasta do projeto:
#     powershell -ExecutionPolicy Bypass -File .\instalar-windows.ps1

$ErrorActionPreference = 'Stop'
$RAIZ = Split-Path -Parent $MyInvocation.MyCommand.Path

function Passo($t) { Write-Host ""; Write-Host "==> $t" }

Write-Host ""
Write-Host "  mm-notify - instalacao (Windows)"
Write-Host "  --------------------------------"

Passo "Conferindo pre-requisitos"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "  X Node.js nao encontrado. Instale a versao 22 ou maior: https://nodejs.org"
  exit 1
}
$versao = [int](& node -p "process.versions.node.split('.')[0]")
if ($versao -lt 22) {
  Write-Host "  X Node $(& node -v) e antigo; o daemon usa o WebSocket nativo do Node 22+."
  exit 1
}
Write-Host "  OK Node $(& node -v)"
Write-Host "  OK PowerShell $($PSVersionTable.PSVersion) (o popup usa WinForms)"

Passo "Preparando pastas"
New-Item -ItemType Directory -Force -Path (Join-Path $RAIZ 'logs') | Out-Null
Write-Host "  OK logs/"

Passo "Testando o popup"
Write-Host "  Um popup de teste deve aparecer no canto da tela."
$json = '{"tipo":"dm","remetente":"mm-notify","canal":"Instalacao","corpo":"Se voce esta vendo isto, o popup funciona neste sistema.","volume":0.8,"somAtivado":true,"linkWeb":""}'
$script = Join-Path $RAIZ 'mmpopup\popup-windows.ps1'
$proc = Start-Process powershell -PassThru -NoNewWindow -ArgumentList `
  '-NoProfile','-ExecutionPolicy','Bypass','-File',$script `
  -RedirectStandardInput (New-TemporaryFile | ForEach-Object {
     Set-Content $_ $json -Encoding utf8; $_.FullName })
Start-Sleep -Seconds 8
if (-not $proc.HasExited) { $proc.Kill() }
Write-Host "  OK popup executado"

Passo "Login no Mattermost"
& node (Join-Path $RAIZ 'bin\mm-login')
if ($LASTEXITCODE -ne 0) { Write-Host "  X login nao concluido"; exit 1 }

Passo "Configurando inicializacao automatica"
# Um .vbs na pasta Inicializar sobe o daemon sem piscar janela de console.
$inicializar = [Environment]::GetFolderPath('Startup')
$vbs = Join-Path $inicializar 'mm-notify.vbs'
$cmd = "`"$($node.Source)`" `"$(Join-Path $RAIZ 'src\index.js')`""
@"
' Sobe o mm-notify em segundo plano, sem janela visivel.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$RAIZ"
sh.Run "$($cmd -replace '"','""')", 0, False
"@ | Set-Content -Path $vbs -Encoding ASCII
Write-Host "  OK $vbs"

Passo "Iniciando agora"
Start-Process wscript.exe -ArgumentList "`"$vbs`"" -WindowStyle Hidden
Start-Sleep -Seconds 5
Write-Host "  OK daemon iniciado"

Passo "Verificando ponta a ponta"
& node (Join-Path $RAIZ 'bin\mm-verificar')

Write-Host ""
Write-Host "  Para parar:  encerre 'node' no Gerenciador de Tarefas"
Write-Host "  Para desligar de vez: apague $vbs"
Write-Host ""
