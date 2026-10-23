#Requires -RunAsAdministrator
<#
  GradAI platform - Windows native installer (no Docker required)

  Layout expected:
    <ROOT>\site\deploy\windows\install.ps1
    <ROOT>\site\backend\main.py
  It will create:
    <ROOT>\venv     Python virtual environment
    <ROOT>\data     database + uploaded files
    <ROOT>\logs     server.log

  Usage (PowerShell as Administrator):
    powershell -ExecutionPolicy Bypass -File .\install.ps1
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -Port 8080
#>
param(
    [int]$Port = 80,
    [string]$TaskName = "GradAI-Platform"
)

$ErrorActionPreference = "Stop"

function Info($m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[ OK ] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail($m) { Write-Host "[FAIL] $m" -ForegroundColor Red; exit 1 }

$Root    = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$Site    = Join-Path $Root "site"
$Backend = Join-Path $Site "backend"
$Venv    = Join-Path $Root "venv"
$Data    = Join-Path $Root "data"
$Logs    = Join-Path $Root "logs"
$Bat     = Join-Path $Site "deploy\windows\start.bat"

Write-Host ""
Write-Host "==== GradAI Windows installer ====" -ForegroundColor White
Info "ROOT    = $Root"
Info "BACKEND = $Backend"
Info "PORT    = $Port"
Write-Host ""

if (-not (Test-Path (Join-Path $Backend "main.py"))) {
    Fail "backend\main.py not found. Keep the original folder layout (<ROOT>\site\backend)."
}

# ---------- 1. Python ----------
$pyCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pyCmd) {
    Fail "Python not found in PATH. Install Python 3.12 (check 'Add python.exe to PATH'), open a NEW PowerShell, then re-run."
}
$pyVer = (& python --version 2>&1) -join " "
Ok "Python detected: $pyVer"

# ---------- 2. directories ----------
New-Item -ItemType Directory -Force -Path $Data, $Logs | Out-Null
Ok "data / logs directories ready"

# ---------- 3. virtual environment ----------
$vpy = Join-Path $Venv "Scripts\python.exe"
if (-not (Test-Path $vpy)) {
    Info "Creating virtual environment ..."
    & python -m venv $Venv
    if ($LASTEXITCODE -ne 0) { Fail "python -m venv failed." }
}
Ok "venv ready: $vpy"

# ---------- 4. dependencies ----------
Info "Installing dependencies (first run: 2-5 minutes) ..."
& $vpy -m pip install --upgrade pip --quiet
& $vpy -m pip install -r (Join-Path $Backend "requirements.txt") --quiet
if ($LASTEXITCODE -ne 0) {
    Fail "pip install failed. Check network, or try: $vpy -m pip install -r $Backend\requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple"
}
Ok "dependencies installed"

# ---------- 5. .env ----------
$envFile = Join-Path $Backend ".env"
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $Site "deploy\windows\.env.windows.example") $envFile
    Warn "backend\.env was created from template."
    Warn "Edit it now, then re-run this script:"
    Warn "    $envFile"
    Warn "Fill in: OPENMAIC_ACCESS_CODE, JWT_SECRET, SQLITE_PATH, DATA_DIR"
    exit 1
}
$envText = Get-Content $envFile -Raw -Encoding UTF8
if ($envText -match "PUT_YOUR_CODE_HERE") {
    Warn "OPENMAIC_ACCESS_CODE is still a placeholder in: $envFile"
    Warn "Copy the real value from your laptop's site\backend\.env, then re-run."
    exit 1
}
if ($envText -match "PUT_A_RANDOM_64_HEX_HERE") {
    $newSecret = & $vpy -c "import secrets;print(secrets.token_hex(32))"
    $envText = $envText -replace "PUT_A_RANDOM_64_HEX_HERE", $newSecret
    [System.IO.File]::WriteAllText($envFile, $envText, (New-Object System.Text.UTF8Encoding($false)))
    Ok "JWT_SECRET generated automatically"
}
Ok "backend\.env is ready"

# ---------- 6. database seed (idempotent) ----------
Info "Initializing database and demo data (idempotent) ..."
Push-Location $Backend
try {
    & $vpy seed_courses.py
    if ($LASTEXITCODE -ne 0) { Fail "seed_courses.py failed." }
} finally {
    Pop-Location
}
Ok "database ready (demo accounts: teacher01 / student01, password 123456)"

# ---------- 7. firewall ----------
$ruleName = "GradAI HTTP $Port"
$rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if (-not $rule) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port | Out-Null
    Ok "firewall rule created: TCP $Port"
} else {
    Ok "firewall rule already exists: TCP $Port"
}

# ---------- 8. scheduled task (auto start, survives RDP logoff) ----------
Info "Registering scheduled task '$TaskName' (run as SYSTEM at startup) ..."
schtasks /query /tn $TaskName 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
    schtasks /end /tn $TaskName 2>$null | Out-Null
    schtasks /delete /tn $TaskName /f 2>$null | Out-Null
}
$tr = '"' + $Bat + '" ' + $Port
schtasks /create /tn $TaskName /tr $tr /sc onstart /ru SYSTEM /rl HIGHEST /f | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "schtasks /create failed." }
schtasks /run /tn $TaskName | Out-Null
Ok "scheduled task created and started"

Start-Sleep -Seconds 6

# ---------- 9. local verification ----------
try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 10
    Ok ("local HTTP check: " + $r.StatusCode)
} catch {
    Warn "local HTTP check failed. Last log lines:"
    if (Test-Path (Join-Path $Logs "server.log")) {
        Get-Content (Join-Path $Logs "server.log") -Tail 20 | ForEach-Object { Write-Host "    $_" }
    }
    Warn "Common causes: port $Port already in use, or .env path error."
}

# ---------- 10. access URLs ----------
Write-Host ""
Write-Host "Access URLs (pick the one reachable by your campus users):" -ForegroundColor White
Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike "127.*" } |
    ForEach-Object { Write-Host ("    http://" + $_.IPAddress + ":$Port/") -ForegroundColor Yellow }
Write-Host ""
Ok "Installation finished."
Write-Host "  Start : schtasks /run /tn $TaskName"
Write-Host "  Stop  : schtasks /end /tn $TaskName   (then taskkill /F /IM python.exe if needed)"
Write-Host "  Log   : $Logs\server.log"
Write-Host "  Data  : $Data"
Write-Host ""
