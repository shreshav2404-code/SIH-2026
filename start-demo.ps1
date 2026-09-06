# ANUPALAN - start everything for a demo.
#
#   Right-click this file -> "Run with PowerShell"
#   or:  powershell -ExecutionPolicy Bypass -File start-demo.ps1
#
# Brings up the database, the API, the dashboard and the sensor simulator, each
# in its own window so you can see it working, then prints one status block.
#
# ASCII only, deliberately. A .ps1 with an em-dash in it fails to parse on a
# machine whose console is not UTF-8, and it fails as a wall of red parser
# errors rather than anything that looks like an encoding problem. Not worth
# debugging in front of judges.
#
# Nothing here is clever on purpose. You want to read a list and see green.

param([switch]$NoPause)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Say($msg, $colour = 'Gray') { Write-Host $msg -ForegroundColor $colour }
function Ok($msg)   { Write-Host "  OK    $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "  WARN  $msg" -ForegroundColor Yellow }
function Bad($msg)  { Write-Host "  FAIL  $msg" -ForegroundColor Red }

Say ""
Say "ANUPALAN - starting the demo stack" Cyan
Say "=================================="

# ---------------------------------------------------------------- 1. Docker
Say ""
Say "1. Database"
# Docker Desktop is started BY HAND before this script runs, and so is the
# database container. That is deliberate:
#
#   - Docker costs about 1.5 GB of RAM sitting idle (measured: 797 MB for the
#     WSL VM alone) on a 16 GB laptop that also plays games, so its autostart
#     entry was removed. You pay for it only when you want the project.
#   - An earlier version of this script launched Docker itself. Do not put that
#     back. Scripted start/stop of Docker Desktop left orphaned socket files in
#     %LOCALAPPDATA%\Docker
un that Windows would not delete, and Docker then
#     refused to start with "The file cannot be accessed by the system" until a
#     reboot. Letting a person start it from the Start menu avoids that whole
#     class of problem.
docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Bad "The Docker engine is not responding."
  Bad ""
  Bad "  1. Start Docker Desktop from the Start menu"
  Bad "  2. Wait for the whale icon in the tray to stop animating"
  Bad "  3. Run this script again"
  Bad ""
  Bad "If Docker itself reports an error about a socket file it cannot access,"
  Bad "reboot. Do NOT use 'Reset to factory defaults' - that deletes the"
  Bad "Postgres volume, and with it the ledger and the evidence chain."
  if (-not $NoPause) { Read-Host "Press Enter to close" }
  exit 1
}
Ok "Docker engine responding"

docker compose up -d db 2>&1 | Out-Null
# Postgres accepts connections a moment after the container reports started,
# so wait for the health check rather than racing it.
$ready = $false
foreach ($i in 1..30) {
  $state = (docker inspect -f '{{.State.Health.Status}}' anupalan-db 2>$null)
  if ($state -eq 'healthy') { $ready = $true; break }
  Start-Sleep -Seconds 1
}
if ($ready) { Ok "Postgres healthy (anupalan-db)" } else { Bad "Postgres not healthy after 30s" }

# ------------------------------------------------------------------ 2. API
Say ""
Say "2. API"
$apiUp = $false
try {
  $r = Invoke-RestMethod -Uri 'http://localhost:8000/health' -TimeoutSec 3
  if ($r.status -eq 'ok') { $apiUp = $true; Ok "already running" }
} catch { }

if (-not $apiUp) {
  # --host 0.0.0.0 so the handset can reach it over wifi, not only the cable.
  $apiCmd = "Set-Location '$root\api'; " +
            "`$host.UI.RawUI.WindowTitle = 'ANUPALAN API'; " +
            "& '$root\.venv\Scripts\python.exe' -m uvicorn main:app --host 0.0.0.0 --port 8000"
  Start-Process powershell -ArgumentList '-NoExit', '-Command', $apiCmd
  # Ninety seconds, not twenty-five. The API imports sentence-transformers at
  # module load to embed the clause corpus, and that pulls in torch - measured
  # at just over 25s on this laptop, which made an earlier version report FAIL
  # on an API that was starting perfectly well.
  Say "     loading the embedding model, this takes up to a minute..."
  foreach ($i in 1..90) {
    Start-Sleep -Seconds 1
    try {
      $r = Invoke-RestMethod -Uri 'http://localhost:8000/health' -TimeoutSec 2
      if ($r.status -eq 'ok') { $apiUp = $true; break }
    } catch { }
  }
  if ($apiUp) { Ok "started on :8000 (took ${i}s)" } else { Bad "did not come up in 90s - check the API window" }
}
if ($apiUp) {
  $h = Invoke-RestMethod -Uri 'http://localhost:8000/health' -TimeoutSec 3
  Ok ("db=" + $h.db + "  postgis=" + $h.postgis + "  pgvector=" + $h.pgvector)
}

# ------------------------------------------------------------ 3. Dashboard
Say ""
Say "3. Dashboard"
$webUp = $false
try {
  $null = Invoke-WebRequest -Uri 'http://localhost:5173' -TimeoutSec 3 -UseBasicParsing
  $webUp = $true; Ok "already running"
} catch { }

if (-not $webUp) {
  $webCmd = "Set-Location '$root\web'; " +
            "`$host.UI.RawUI.WindowTitle = 'ANUPALAN dashboard'; " +
            "npm run dev"
  Start-Process powershell -ArgumentList '-NoExit', '-Command', $webCmd
  foreach ($i in 1..30) {
    Start-Sleep -Seconds 1
    try {
      $null = Invoke-WebRequest -Uri 'http://localhost:5173' -TimeoutSec 2 -UseBasicParsing
      $webUp = $true; break
    } catch { }
  }
  if ($webUp) { Ok "started on :5173" } else { Warn "not up yet - check the dashboard window" }
}

# --------------------------------------------------------- 4. Sensor feed
Say ""
Say "4. Sensor simulator"
$q = "select count(*) from sensor_reading where recorded_at > now() - interval '30 seconds';"
$recent = docker exec anupalan-db psql -U anupalan -d anupalan -t -A -c $q 2>$null
$recentN = 0
if ($recent) { [int]::TryParse(($recent -replace '\s', ''), [ref]$recentN) | Out-Null }

if ($recentN -gt 0) {
  Ok "already posting readings"
} else {
  $simCmd = "Set-Location '$root'; " +
            "`$host.UI.RawUI.WindowTitle = 'ANUPALAN sensors'; " +
            "& '$root\.venv\Scripts\python.exe' tools\sensor_sim.py"
  Start-Process powershell -ArgumentList '-NoExit', '-Command', $simCmd
  Start-Sleep -Seconds 6
  Ok "started - press m in that window to inject a methane spike"
}

# ------------------------------------------------------------- 5. Handset
Say ""
Say "5. Handset"
$devices = @()
try { $devices = (adb devices) -split "`n" | Where-Object { $_ -match "device$" } } catch { }
if ($devices.Count -gt 0) {
  adb reverse tcp:8000 tcp:8000 2>&1 | Out-Null
  Ok "cable connected, tunnel set (adb reverse tcp:8000)"
} else {
  Warn "no phone on the cable - fine, the app finds the API over wifi"
}

$hotspot = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -like '192.168.137.*' } | Select-Object -First 1).IPAddress
if ($hotspot) {
  Ok "hotspot up, laptop is $hotspot"
} elseif ($devices.Count -gt 0) {
  # The cable is doing the job, so the hotspot is not needed. Say so rather
  # than warning about something that is deliberately off.
  Say "  ----  hotspot off, not needed - the cable is connected"
} else {
  Warn "no cable and no hotspot. Turn the hotspot on:"
  Warn "  Settings, Network and Internet, Mobile hotspot, share Ethernet"
}

$lan = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.InterfaceAlias -eq 'Ethernet' } | Select-Object -First 1).IPAddress

# ------------------------------------------------------------------ done
Say ""
Say "==================================" Cyan
Say "Ready." Cyan
Say ""
Say "  Dashboard   http://localhost:5173"
if ($lan)     { Say "  From phone  http://${lan}:8000   (the app finds this itself)" }
if ($hotspot) { Say "  Hotspot     http://${hotspot}:8000" }
Say ""
Say "  keshav / demo1234    Mine Manager"
Say "  prince / demo1234    Safety Officer"
Say "  nisarga / demo1234   Regulator, read only"
Say ""
Say "  To stop: close the API, dashboard and sensor windows."
Say ""
if (-not $NoPause) { Read-Host "Press Enter to close this window" }
