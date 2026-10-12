$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtime = Join-Path $project '.runtime\launcher'
$serverPidFile = Join-Path $runtime 'server.pid'
$tunnelPidFile = Join-Path $runtime 'tunnel.pid'
$publicUrlFile = Join-Path $runtime 'endereco-publico.txt'
$port = 3000
$localUrl = "http://127.0.0.1:$port"
$nodePath = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
$cloudflaredCommand = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
$cloudflaredPath = if ($cloudflaredCommand) { $cloudflaredCommand.Source } else { 'C:\Program Files (x86)\cloudflared\cloudflared.exe' }
$serverProcess = $null
$tunnelProcess = $null
$startedServer = $false
$completed = $false

function Get-WebShareHealth {
  try {
    $health = Invoke-RestMethod -Uri "$localUrl/api/health" -TimeoutSec 2
    if ($health.status -eq 'ok' -and $health.service -eq 'webshare') { return $health }
  } catch { }
  return $null
}

try {
  if (-not $nodePath) { throw 'Node.js não foi encontrado. Instale o Node.js 20.6 ou posterior e tente novamente.' }
  if (-not (Test-Path -LiteralPath $cloudflaredPath)) {
    throw 'O cloudflared não foi encontrado. Instale o Cloudflare Tunnel e execute este iniciador novamente.'
  }
  if (-not (Test-Path -LiteralPath (Join-Path $project '.env'))) {
    throw 'O arquivo .env não existe. Configure o app antes de iniciar.'
  }
  New-Item -ItemType Directory -Path $runtime -Force | Out-Null

  $health = Get-WebShareHealth
  if ($health -and $health.runtimeVersion -eq 3) {
    Write-Host 'Servidor de transmissão já está ativo.' -ForegroundColor Green
  } else {
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener -and $health -and $health.service -eq 'webshare') {
      $oldServer = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
      if (-not $oldServer -or $oldServer.ProcessName -ne 'node') { throw "O servidor antigo está ativo na porta $port, mas não consegui reiniciá-lo com segurança. Feche-o manualmente e execute o iniciador novamente." }
      Write-Host 'Reiniciando uma versão antiga do app para aplicar as correções...' -ForegroundColor Yellow
      Stop-Process -Id $oldServer.Id -Force
      Start-Sleep -Seconds 2
      $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    }
    if ($listener) { throw "A porta $port já está ocupada por outro programa. Feche esse programa e tente novamente." }
    Write-Host 'Iniciando o servidor...' -ForegroundColor Cyan
    $serverProcess = Start-Process -FilePath $nodePath -ArgumentList @('--env-file-if-exists=.env', 'server/index.js') -WorkingDirectory $project -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'server.log') -RedirectStandardError (Join-Path $runtime 'server-error.log')
    $startedServer = $true
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep -Seconds 1
      $health = Get-WebShareHealth
      if ($health -and $health.runtimeVersion -eq 3) { $ready = $true; break }
      if ($serverProcess.HasExited) { break }
    }
    if (-not $ready) { throw 'O servidor não iniciou. Consulte .runtime\launcher\server-error.log.' }
  }

  $serverListener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $serverListener) { throw 'O servidor não está mais escutando na porta configurada.' }
  $serverProcessId = $serverListener.OwningProcess
  Set-Content -LiteralPath $serverPidFile -Value $serverProcessId -Encoding ascii

  $tunnelLog = Join-Path $runtime 'tunnel.log'
  $tunnelErrorLog = Join-Path $runtime 'tunnel-error.log'
  $publicUrl = $null
  $savedTunnelPid = 0
  if (Test-Path -LiteralPath $tunnelPidFile) { [void][int]::TryParse((Get-Content -LiteralPath $tunnelPidFile -Raw).Trim(), [ref]$savedTunnelPid) }
  $savedTunnel = if ($savedTunnelPid -gt 0) { Get-Process -Id $savedTunnelPid -ErrorAction SilentlyContinue } else { $null }
  if ($savedTunnel -and $savedTunnel.ProcessName -eq 'cloudflared' -and (Test-Path -LiteralPath $publicUrlFile)) {
    $savedUrl = (Get-Content -LiteralPath $publicUrlFile -Raw).Trim()
    if ($savedUrl -match '^https://[a-z0-9-]+\.trycloudflare\.com$') {
      try {
        $health = Invoke-RestMethod -Uri "$savedUrl/api/health" -TimeoutSec 4
        if ($health.status -eq 'ok' -and $health.service -eq 'webshare' -and $health.runtimeVersion -eq 3) {
          $publicUrl = $savedUrl
          $tunnelProcess = $savedTunnel
          Write-Host 'Túnel público existente reutilizado.' -ForegroundColor Green
        }
      } catch { }
    }
  }
  if (-not $publicUrl) {
    if ($savedTunnel -and $savedTunnel.ProcessName -eq 'cloudflared') { Stop-Process -Id $savedTunnel.Id -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $tunnelLog, $tunnelErrorLog -Force -ErrorAction SilentlyContinue
    Write-Host 'Abrindo um endereço público seguro...' -ForegroundColor Cyan
    $tunnelProcess = Start-Process -FilePath $cloudflaredPath -ArgumentList @('tunnel', '--no-autoupdate', '--url', $localUrl) -WorkingDirectory $project -PassThru -WindowStyle Hidden -RedirectStandardOutput $tunnelLog -RedirectStandardError $tunnelErrorLog
    $publicUrl = $null
    for ($i = 0; $i -lt 60; $i++) {
      Start-Sleep -Seconds 1
      $logs = @()
      foreach ($file in @($tunnelLog, $tunnelErrorLog)) {
        if (Test-Path -LiteralPath $file) { $logs += Get-Content -LiteralPath $file -ErrorAction SilentlyContinue }
      }
      foreach ($line in $logs) {
        if ($line -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $publicUrl = $Matches[0]; break }
      }
      if ($publicUrl) { break }
      if ($tunnelProcess.HasExited) { throw 'O Cloudflare Tunnel encerrou antes de criar o endereço. Consulte .runtime\launcher\tunnel-error.log.' }
    }
    if (-not $publicUrl) { throw 'Não apareceu um endereço público em 60 segundos. Confira sua conexão e .runtime\launcher\tunnel-error.log.' }
  }

  Write-Host "Aguardando o endereço público responder: $publicUrl" -ForegroundColor Cyan
  $publicReady = $false
  $lastProbeError = 'sem resposta ainda'
  for ($i = 0; $i -lt 120; $i++) {
    try {
      $health = Invoke-RestMethod -Uri "$publicUrl/api/health" -TimeoutSec 2
      if ($health.status -eq 'ok' -and $health.service -eq 'webshare' -and $health.runtimeVersion -eq 3) { $publicReady = $true; break }
      $lastProbeError = 'o servidor respondeu com uma versão diferente'
    } catch { $lastProbeError = $_.Exception.Message }
    if ($tunnelProcess.HasExited) { throw 'O túnel parou antes de o endereço ficar acessível.' }
    if (($i + 1) % 10 -eq 0) { Write-Host "Ainda aguardando... ($($i + 1)s)" }
    Start-Sleep -Seconds 1
  }
  if (-not $publicReady) { throw "O túnel foi criado, mas o site não respondeu após 120 segundos. Última resposta: $lastProbeError. Confira .runtime\launcher\tunnel-error.log." }

  Set-Content -LiteralPath $publicUrlFile -Value $publicUrl -Encoding ascii
  Set-Content -LiteralPath $tunnelPidFile -Value $tunnelProcess.Id -Encoding ascii
  Write-Host ''
  Write-Host 'Transmissão pronta.' -ForegroundColor Green
  Write-Host "Página do transmissor e endereço público: $publicUrl" -ForegroundColor Yellow
  Write-Host 'Inicie a transmissão na página. O app mostrará o link completo para os espectadores.'
  Start-Process $publicUrl
  Write-Host 'Servidor e túnel continuam em segundo plano. Use Parar-Transmitir.cmd para encerrar.'
  $completed = $true
} catch {
  Write-Host "`n$($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  if (-not $completed) {
    if ($tunnelProcess -and -not $tunnelProcess.HasExited) { Stop-Process -Id $tunnelProcess.Id -Force -ErrorAction SilentlyContinue }
    if ($startedServer -and $serverProcess -and -not $serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue }
  }
}

