# Popup sobreposto do mm-notify para Windows.
#
# Equivalente ao MMPopup.app (Swift) do macOS: le um JSON por linha no stdin e,
# para cada um, mostra uma janela flutuante no canto da tela e toca um som.
#
# Usa WinForms via PowerShell: nao exige instalar nada: .NET Framework e o
# PowerShell ja vem no Windows 10 e 11.
#
# TopMost mantem a janela acima das demais, inclusive de aplicativos em tela
# cheia sem exclusividade. Jogos em fullscreen exclusivo sao a excecao: nenhuma
# janela aparece por cima deles, em nenhum sistema.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$LARGURA         = 380
$MARGEM          = 20
$ESPACO          = 10
$MAX_SIMULTANEOS = 5

$CORES = @{
  dm     = [System.Drawing.Color]::FromArgb(31, 111, 235)
  mencao = [System.Drawing.Color]::FromArgb(217, 119, 6)
  canal  = [System.Drawing.Color]::FromArgb(107, 114, 128)
}
$ROTULOS = @{ dm = 'MENSAGEM DIRETA'; mencao = 'MENCAO'; canal = 'CANAL' }

$script:ativos = New-Object System.Collections.ArrayList

# ---------------------------------------------------------------------- som
function Tocar-Som($tipo, $som) {
  try {
    # Caminho para um .wav proprio tem prioridade sobre o som do sistema.
    if ($som -and ($som -match '[\\/]') -and (Test-Path $som)) {
      $player = New-Object System.Media.SoundPlayer $som
      $player.Play()
      return
    }
    switch ($tipo) {
      'mencao' { [System.Media.SystemSounds]::Exclamation.Play() }
      'canal'  { [System.Media.SystemSounds]::Beep.Play() }
      default  { [System.Media.SystemSounds]::Asterisk.Play() }
    }
  } catch {
    [Console]::Error.WriteLine("som falhou: $($_.Exception.Message)")
  }
}

function Abrir-Link($url) {
  if (-not $url) { return }
  try { Start-Process $url } catch {
    [Console]::Error.WriteLine("nao abriu o link: $($_.Exception.Message)")
  }
}

# ------------------------------------------------------------- posicionamento
function Reposicionar {
  $area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $topo = $area.Top + $MARGEM
  foreach ($f in @($script:ativos)) {
    if ($f.IsDisposed) { continue }
    $f.Location = New-Object System.Drawing.Point(
      ($area.Right - $LARGURA - $MARGEM), $topo)
    $topo += $f.Height + $ESPACO
  }
}

function Fechar-Popup($form) {
  if ($form.IsDisposed) { return }
  $script:ativos.Remove($form) | Out-Null
  try { $form.Close(); $form.Dispose() } catch { }
  Reposicionar
}

# -------------------------------------------------------------------- popup
function Mostrar-Popup($alerta) {
  # Popups demais viram uma parede ilegivel: o mais antigo sai.
  $tentativas = 0
  while ($script:ativos.Count -ge $MAX_SIMULTANEOS -and $tentativas -lt 20) {
    Fechar-Popup $script:ativos[0]
    $tentativas++
  }

  $tipo = if ($alerta.tipo) { $alerta.tipo } else { 'dm' }
  $cor  = if ($CORES.ContainsKey($tipo)) { $CORES[$tipo] } else { $CORES['dm'] }

  $form = New-Object System.Windows.Forms.Form
  $form.FormBorderStyle = 'None'
  $form.TopMost         = $true
  $form.ShowInTaskbar   = $false
  $form.StartPosition   = 'Manual'
  $form.BackColor       = [System.Drawing.Color]::FromArgb(208, 212, 218)  # borda
  $form.Width           = $LARGURA
  $form.Padding         = New-Object System.Windows.Forms.Padding(1)

  $fundo = New-Object System.Windows.Forms.Panel
  $fundo.Dock      = 'Fill'
  $fundo.BackColor = [System.Drawing.Color]::White
  $form.Controls.Add($fundo)

  $barra = New-Object System.Windows.Forms.Panel
  $barra.Dock      = 'Left'
  $barra.Width     = 4
  $barra.BackColor = $cor
  $fundo.Controls.Add($barra)

  $fonteRotulo = New-Object System.Drawing.Font('Segoe UI', 7,  [System.Drawing.FontStyle]::Bold)
  $fonteNome   = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
  $fonteCanal  = New-Object System.Drawing.Font('Segoe UI', 8)
  $fonteCorpo  = New-Object System.Drawing.Font('Segoe UI', 9.5)

  $x = 18
  $larguraTexto = $LARGURA - $x - 18

  $rotulo = New-Object System.Windows.Forms.Label
  $rotulo.Text      = $ROTULOS[$tipo]
  $rotulo.ForeColor = $cor
  $rotulo.Font      = $fonteRotulo
  $rotulo.AutoSize  = $true
  $rotulo.Location  = New-Object System.Drawing.Point($x, 12)
  $fundo.Controls.Add($rotulo)

  $contagem = New-Object System.Windows.Forms.Label
  $restante = if ($alerta.duracao) { [int]$alerta.duracao } else { 12 }
  $contagem.Text      = "${restante}s"
  $contagem.ForeColor = [System.Drawing.Color]::FromArgb(154, 164, 178)
  $contagem.Font      = $fonteRotulo
  $contagem.AutoSize  = $false
  $contagem.TextAlign = 'MiddleRight'
  $contagem.Width     = 40
  $contagem.Height    = 12
  $contagem.Location  = New-Object System.Drawing.Point(($LARGURA - 58), 12)
  $fundo.Controls.Add($contagem)

  $nome = New-Object System.Windows.Forms.Label
  $nome.Text      = if ($alerta.remetente) { $alerta.remetente } else { 'alguem' }
  $nome.ForeColor = [System.Drawing.Color]::FromArgb(20, 23, 28)
  $nome.Font      = $fonteNome
  $nome.AutoSize  = $false
  $nome.Width     = $larguraTexto
  $nome.Height    = 20
  $nome.Location  = New-Object System.Drawing.Point($x, 30)
  $fundo.Controls.Add($nome)

  $y = 52
  if ($alerta.canal) {
    $canal = New-Object System.Windows.Forms.Label
    $canal.Text      = $alerta.canal
    $canal.ForeColor = [System.Drawing.Color]::FromArgb(102, 112, 133)
    $canal.Font      = $fonteCanal
    $canal.AutoSize  = $false
    $canal.Width     = $larguraTexto
    $canal.Height    = 15
    $canal.Location  = New-Object System.Drawing.Point($x, $y)
    $fundo.Controls.Add($canal)
    $y += 20
  }

  $corpo = New-Object System.Windows.Forms.Label
  $corpo.Text      = if ($alerta.corpo) { $alerta.corpo } else { '' }
  $corpo.ForeColor = [System.Drawing.Color]::FromArgb(20, 23, 28)
  $corpo.Font      = $fonteCorpo
  $corpo.AutoSize  = $false
  $corpo.Width     = $larguraTexto
  $corpo.Location  = New-Object System.Drawing.Point($x, $y)
  # Mede o texto para a janela crescer conforme a mensagem, sem cortar.
  $g = $corpo.CreateGraphics()
  $medida = $g.MeasureString($corpo.Text, $fonteCorpo, $larguraTexto)
  $g.Dispose()
  $corpo.Height = [Math]::Min([Math]::Max([int]$medida.Height + 4, 18), 90)
  $fundo.Controls.Add($corpo)

  $form.Height = $corpo.Bottom + 16

  # Clique em qualquer lugar abre a conversa
  $aoClicar = {
    Abrir-Link $(if ($alerta.link) { $alerta.link } else { $alerta.linkWeb })
    Fechar-Popup $form
  }.GetNewClosure()
  $form.Add_Click($aoClicar)
  foreach ($c in @($fundo) + @($fundo.Controls)) { $c.Add_Click($aoClicar) }

  # Contagem regressiva e fechamento automatico.
  #
  # O estado vive em $form.Tag, nao numa variavel de escopo script: com varios
  # popups na tela ao mesmo tempo, uma variavel compartilhada faria todos
  # dividirem o mesmo contador e sumirem juntos.
  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 1000
  $form.Tag = @{ restante = $restante; contagem = $contagem; timer = $timer }

  $timer.Add_Tick({
    $f = $form
    if ($f.IsDisposed) { $timer.Stop(); $timer.Dispose(); return }
    $estado = $f.Tag
    $estado.restante--
    if ($estado.restante -le 0) {
      $estado.timer.Stop(); $estado.timer.Dispose()
      Fechar-Popup $f
    } elseif (-not $estado.contagem.IsDisposed) {
      $estado.contagem.Text = "$($estado.restante)s"
    }
  }.GetNewClosure())

  $script:ativos.Add($form) | Out-Null
  $form.Show()
  Reposicionar
  $timer.Start()

  if ($alerta.somAtivado -ne $false) { Tocar-Som $tipo $alerta.som }
}

# ------------------------------------------------------------------- entrada
# O stdin e lido numa runspace separada: se fosse na thread da interface, a
# leitura bloqueante congelaria a janela.
$fila = [System.Collections.Queue]::Synchronized((New-Object System.Collections.Queue))

$runspace = [runspacefactory]::CreateRunspace()
$runspace.Open()
$runspace.SessionStateProxy.SetVariable('fila', $fila)
$leitor = [powershell]::Create()
$leitor.Runspace = $runspace
$leitor.AddScript({
  while ($null -ne ($linha = [Console]::In.ReadLine())) {
    if ($linha.Trim()) { $fila.Enqueue($linha) }
  }
  $fila.Enqueue('__FIM__')   # stdin fechou: o daemon encerrou
}) | Out-Null
$leitor.BeginInvoke() | Out-Null

$oculta = New-Object System.Windows.Forms.Form
$oculta.WindowState   = 'Minimized'
$oculta.ShowInTaskbar = $false
$oculta.Opacity       = 0

$drenar = New-Object System.Windows.Forms.Timer
$drenar.Interval = 120
$drenar.Add_Tick({
  while ($fila.Count -gt 0) {
    $linha = $fila.Dequeue()
    if ($linha -eq '__FIM__') {
      $drenar.Stop()
      [System.Windows.Forms.Application]::Exit()
      return
    }
    try {
      Mostrar-Popup ($linha | ConvertFrom-Json)
    } catch {
      [Console]::Error.WriteLine("JSON invalido: $($_.Exception.Message)")
    }
  }
})
$drenar.Start()

[System.Windows.Forms.Application]::Run($oculta)
