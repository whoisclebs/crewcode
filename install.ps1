# CrewCode installer for Windows.
#
#   irm https://github.com/whoisclebs/crewcode/releases/latest/download/install.ps1 | iex
#   & ([scriptblock]::Create((irm <url>/install.ps1))) -Version 0.1.0 -ModifyPath
#
# Environment (all optional): CREWCODE_REPO, CREWCODE_VERSION, CREWCODE_INSTALL_DIR,
# CREWCODE_BASE_URL (flat directory with crewcode-windows-x64.zip and .sha256),
# CREWCODE_MODIFY_PATH=1 (same as -ModifyPath, handy with `irm | iex`).

param(
  [string]$Version = $env:CREWCODE_VERSION,
  [switch]$ModifyPath
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repo = if ($env:CREWCODE_REPO) { $env:CREWCODE_REPO } else { 'whoisclebs/crewcode' }
$InstallDir = if ($env:CREWCODE_INSTALL_DIR) { $env:CREWCODE_INSTALL_DIR } else { Join-Path $env:USERPROFILE '.crewcode\bin' }
$Version = $Version -replace '^v', ''
if ($env:CREWCODE_MODIFY_PATH -eq '1') { $ModifyPath = $true }

# Only x64 is published; Windows on ARM runs it through emulation.
$arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
if ($arch -ne 'X64' -and $arch -ne 'Arm64') { throw "Unsupported architecture: $arch" }

$file = 'crewcode-windows-x64.zip'
if ($env:CREWCODE_BASE_URL) {
  $url = $env:CREWCODE_BASE_URL.TrimEnd('/')
} elseif ($Version) {
  $url = "https://github.com/$Repo/releases/download/v$Version"
} else {
  $url = "https://github.com/$Repo/releases/latest/download"
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("crewcode-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null

try {
  Write-Host "Installing CrewCode $(if ($Version) { $Version } else { 'latest' }) for windows-x64"
  Invoke-WebRequest -Uri "$url/$file" -OutFile (Join-Path $tmp $file) -UseBasicParsing
  Invoke-WebRequest -Uri "$url/$file.sha256" -OutFile (Join-Path $tmp "$file.sha256") -UseBasicParsing

  $expected = ((Get-Content (Join-Path $tmp "$file.sha256") -Raw).Trim() -split '\s+')[0]
  $actual = (Get-FileHash -Algorithm SHA256 -Path (Join-Path $tmp $file)).Hash
  if ($expected -ne $actual) { throw "Checksum mismatch for $file (expected $expected, got $actual)" }

  Expand-Archive -Path (Join-Path $tmp $file) -DestinationPath $tmp -Force
  $binary = Join-Path $tmp 'crewcode.exe'
  if (-not (Test-Path $binary)) { throw 'The archive does not contain crewcode.exe' }

  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  $target = Join-Path $InstallDir 'crewcode.exe'
  # A running executable cannot be overwritten on Windows but it can be renamed.
  if (Test-Path $target) {
    Remove-Item "$target.old" -Force -ErrorAction SilentlyContinue
    Move-Item $target "$target.old" -Force
  }
  Copy-Item $binary $target -Force
  Remove-Item "$target.old" -Force -ErrorAction SilentlyContinue
  Write-Host "Installed $target"
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$onPath = ($userPath -split ';') -contains $InstallDir
if ($onPath) {
  Write-Host 'Run: crewcode'
} elseif ($ModifyPath) {
  [Environment]::SetEnvironmentVariable('Path', "$InstallDir;$userPath", 'User')
  Write-Host "Added $InstallDir to your user PATH; open a new terminal to use crewcode."
} else {
  Write-Host 'Add it to your PATH (current session):'
  Write-Host "  `$env:Path = `"$InstallDir;`$env:Path`""
  Write-Host 'or re-run the installer with -ModifyPath (or CREWCODE_MODIFY_PATH=1).'
}
