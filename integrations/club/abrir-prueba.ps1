$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$demoUrl = 'http://127.0.0.1:4322'
try { $ready = (Invoke-WebRequest -UseBasicParsing "$demoUrl/__club_demo/state" -TimeoutSec 2).StatusCode -eq 200 } catch { $ready = $false }
if (-not $ready) {
  $nodeExe = (Get-Command node.exe).Source
  Start-Process -FilePath $nodeExe -ArgumentList 'node_modules/vite/bin/vite.js --config integrations/club/preview.config.local.mjs' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput "$PSScriptRoot/preview.log" -RedirectStandardError "$PSScriptRoot/preview-error.log"
  for ($attempt=0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 500
    try { $ready = (Invoke-WebRequest -UseBasicParsing "$demoUrl/__club_demo/state" -TimeoutSec 1).StatusCode -eq 200 } catch { $ready = $false }
    if ($ready) { break }
  }
}
if (-not $ready) { Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('No se pudo abrir la prueba local. El TPV de servicio no se ha modificado.','TPV de prueba'); exit 1 }
Start-Process $demoUrl
