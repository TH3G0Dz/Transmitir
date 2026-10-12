$ErrorActionPreference = 'Continue'
$runtime = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '.runtime\launcher'
foreach ($item in @(
  @{ File = 'tunnel.pid'; Name = 'cloudflared'; Label = 'túnel público' },
  @{ File = 'server.pid'; Name = 'node'; Label = 'servidor' }
)) {
  $pidFile = Join-Path $runtime $item.File
  if (-not (Test-Path -LiteralPath $pidFile)) { continue }
  $processId = 0
  if ([int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$processId)) {
    $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -eq $item.Name) {
      Stop-Process -Id $processId -Force
      Write-Host "Encerrado: $($item.Label)."
    }
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath (Join-Path $runtime 'endereco-publico.txt') -Force -ErrorAction SilentlyContinue
Write-Host 'Transmissão e túnel encerrados.'
