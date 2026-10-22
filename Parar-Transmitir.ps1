$ErrorActionPreference = 'Continue'
$runtime = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '.runtime\launcher'

function Test-LegacyProcess($processId, $expectedName) {
  try { $details = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop } catch { return $false }
  if (-not $details -or -not $details.CommandLine) { return $false }
  if ($expectedName -eq 'cloudflared') {
    return $details.CommandLine -match '(?i)\btunnel\b.*--url\s+"?http://127\.0\.0\.1:3000"?(\s|$)'
  }
  if ($expectedName -eq 'node' -and $details.CommandLine -match '(?i)(?:^|\s)server[\\/]index\.js(?:\s|$)') {
    $listener = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq $processId } | Select-Object -First 1
    try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 2 } catch { return $false }
    return [bool]($listener -and $health.service -eq 'webshare')
  }
  return $false
}

$unverifiedLegacy = $false
foreach ($item in @(
  @{ File = 'tunnel.pid'; Name = 'cloudflared'; Label = 'túnel público' },
  @{ File = 'server.pid'; Name = 'node'; Label = 'servidor' }
)) {
  $pidFile = Join-Path $runtime $item.File
  if (-not (Test-Path -LiteralPath $pidFile)) { continue }
  $removePidFile = $true
  $identity = $null
  try { $identity = Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json } catch { }
  $legacy = -not ($identity.Id -and $identity.StartTimeUtcTicks)
  if ($legacy) {
    $legacyPid = 0
    if (-not [int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$legacyPid) -or $legacyPid -le 0) {
      Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
      continue
    }
  }
  $processId = if ($legacy) { $legacyPid } else { [int]$identity.Id }
  if ($processId) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -eq $item.Name) {
      $matchesIdentity = $false
      if ($legacy) { $matchesIdentity = Test-LegacyProcess $processId $item.Name }
      else {
        try { $matchesIdentity = $process.StartTime.ToUniversalTime().Ticks -eq [long]$identity.StartTimeUtcTicks } catch { }
      }
      if ($matchesIdentity) {
        try {
          Stop-Process -InputObject $process -Force
          Write-Host "Encerrado: $($item.Label)."
        } catch { }
      } elseif ($legacy) {
        $unverifiedLegacy = $true
        $removePidFile = $false
        Write-Host "O PID legado $processId ($($item.Label)) não pôde ser validado e não será encerrado automaticamente." -ForegroundColor Yellow
      }
    }
  }
  if ($removePidFile) { Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue }
}
Remove-Item -LiteralPath (Join-Path $runtime 'endereco-publico.txt') -Force -ErrorAction SilentlyContinue
if ($unverifiedLegacy) { Write-Host 'Confira o processo legado no Gerenciador de Tarefas antes de encerrar o app.' -ForegroundColor Yellow }
else { Write-Host 'Transmissão e túnel encerrados.' }
