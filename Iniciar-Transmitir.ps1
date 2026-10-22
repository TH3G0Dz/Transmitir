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
$startedTunnel = $false
$completed = $false

function Test-LegacyProcess($processId, $expectedName) {
  try { $details = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop } catch { return $false }
  if (-not $details -or -not $details.CommandLine) { return $false }
  if ($expectedName -eq 'cloudflared') {
    return $details.CommandLine -match '(?i)\btunnel\b.*--url\s+"?http://127\.0\.0\.1:3000"?(\s|$)'
  }
  if ($expectedName -eq 'node' -and $details.CommandLine -match '(?i)(?:^|\s)server[\\/]index\.js(?:\s|$)') {
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $processId } | Select-Object -First 1
    $health = Get-WebShareHealth
    return [bool]($listener -and $health -and $health.service -eq 'webshare')
  }
  return $false
}

function Get-TrackedProcess($path, $expectedName) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  $saved = Get-Content -LiteralPath $path -Raw
  try { $identity = $saved | ConvertFrom-Json -ErrorAction Stop } catch { $identity = $null }
  $legacy = -not ($identity.Id -and $identity.StartTimeUtcTicks)
  if ($legacy) {
    $processId = 0
    if (-not [int]::TryParse($saved.Trim(), [ref]$processId) -or $processId -le 0) { return $null }
  } else { $processId = [int]$identity.Id }
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if (-not $process -or $process.ProcessName -ne $expectedName) { return $null }
  if ($legacy) {
    if (-not (Test-LegacyProcess $processId $expectedName)) {
      throw "O PID legado $processId pertence a $expectedName, mas não pôde ser validado. Para evitar deixar um túnel duplicado, encerre esse processo pelo Gerenciador de Tarefas e tente novamente."
    }
    Save-TrackedProcess $path $processId
  } else {
    try { if ($process.StartTime.ToUniversalTime().Ticks -ne [long]$identity.StartTimeUtcTicks) { return $null } } catch { return $null }
  }
  return $process
}

function Save-TrackedProcess($path, $processId) {
  $process = Get-Process -Id $processId -ErrorAction Stop
  @{ Id = $process.Id; StartTimeUtcTicks = $process.StartTime.ToUniversalTime().Ticks } |
    ConvertTo-Json -Compress | Set-Content -LiteralPath $path -Encoding ascii
}

function Stop-ProcessSafely($tracked) {
  if (-not $tracked) { return }
  try { $startTicks = $tracked.StartTime.ToUniversalTime().Ticks } catch { return }
  $current = Get-Process -Id $tracked.Id -ErrorAction SilentlyContinue
  if (-not $current -or $current.ProcessName -ne $tracked.ProcessName) { return }
  try { if ($current.StartTime.ToUniversalTime().Ticks -eq $startTicks) { Stop-Process -InputObject $current -Force -ErrorAction SilentlyContinue } } catch { }
}

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
  if ($health -and $health.runtimeVersion -eq 5) {
    Write-Host 'Servidor de transmissão já está ativo.' -ForegroundColor Green
  } else {
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener -and $health -and $health.service -eq 'webshare') {
      $oldServer = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
      if (-not $oldServer -or $oldServer.ProcessName -ne 'node') { throw "O servidor antigo está ativo na porta $port, mas não consegui reiniciá-lo com segurança. Feche-o manualmente e execute o iniciador novamente." }
      Write-Host 'Reiniciando uma versão antiga do app para aplicar as correções...' -ForegroundColor Yellow
      Stop-ProcessSafely $oldServer
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
      if ($health -and $health.runtimeVersion -eq 5) { $ready = $true; break }
      if ($serverProcess.HasExited) { break }
    }
    if (-not $ready) { throw 'O servidor não iniciou. Consulte .runtime\launcher\server-error.log.' }
  }

  $serverListener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $serverListener) { throw 'O servidor não está mais escutando na porta configurada.' }
  $serverProcessId = $serverListener.OwningProcess
  Save-TrackedProcess $serverPidFile $serverProcessId

  $tunnelLog = Join-Path $runtime 'tunnel.log'
  $tunnelErrorLog = Join-Path $runtime 'tunnel-error.log'
  $publicUrl = $null
  $savedTunnel = Get-TrackedProcess $tunnelPidFile 'cloudflared'
  if ($savedTunnel -and (Test-Path -LiteralPath $publicUrlFile)) {
    $savedUrl = (Get-Content -LiteralPath $publicUrlFile -Raw).Trim()
    if ($savedUrl -match '^https://[a-z0-9-]+\.trycloudflare\.com$') {
      try {
        $health = Invoke-RestMethod -Uri "$savedUrl/api/health" -TimeoutSec 4
        if ($health.status -eq 'ok' -and $health.service -eq 'webshare' -and $health.runtimeVersion -eq 5) {
          $publicUrl = $savedUrl
          $tunnelProcess = $savedTunnel
          Write-Host 'Túnel público existente reutilizado.' -ForegroundColor Green
        }
      } catch { }
    }
  }
  if (-not $publicUrl) {
    if ($savedTunnel) { Stop-ProcessSafely $savedTunnel }
    Remove-Item -LiteralPath $tunnelLog, $tunnelErrorLog -Force -ErrorAction SilentlyContinue
    Write-Host 'Abrindo um endereço público seguro...' -ForegroundColor Cyan
    $tunnelProcess = Start-Process -FilePath $cloudflaredPath -ArgumentList @('tunnel', '--no-autoupdate', '--url', $localUrl) -WorkingDirectory $project -PassThru -WindowStyle Hidden -RedirectStandardOutput $tunnelLog -RedirectStandardError $tunnelErrorLog
    $startedTunnel = $true
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
      if ($health.status -eq 'ok' -and $health.service -eq 'webshare' -and $health.runtimeVersion -eq 5) { $publicReady = $true; break }
      $lastProbeError = 'o servidor respondeu com uma versão diferente'
    } catch { $lastProbeError = $_.Exception.Message }
    if ($tunnelProcess.HasExited) { throw 'O túnel parou antes de o endereço ficar acessível.' }
    if (($i + 1) % 10 -eq 0) { Write-Host "Ainda aguardando... ($($i + 1)s)" }
    Start-Sleep -Seconds 1
  }
  if (-not $publicReady) { throw "O túnel foi criado, mas o site não respondeu após 120 segundos. Última resposta: $lastProbeError. Confira .runtime\launcher\tunnel-error.log." }

  Set-Content -LiteralPath $publicUrlFile -Value $publicUrl -Encoding ascii
  Save-TrackedProcess $tunnelPidFile $tunnelProcess.Id
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
    if ($startedTunnel) { Stop-ProcessSafely $tunnelProcess }
    if ($startedServer) { Stop-ProcessSafely $serverProcess }
  }
}

