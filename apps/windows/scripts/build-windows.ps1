#Requires -Version 5.1
<#
.SYNOPSIS
  Build the OmSuite Windows installer (NSIS) on a Windows machine.
.DESCRIPTION
  Run from apps/windows on a Windows 10/11 x64 machine with Node.js 20+:
    powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1
  Steps: npm install -> electron-builder (pinned 26.18.0, downloaded on demand)
  -> dist/OmSuite-Setup-0.1.0.exe (NSIS, per-user, no admin required).
  The build is UNSIGNED unless you configure signing (see README.md).
  Do NOT run this script on Linux/macOS expecting a Windows installer:
  NSIS packaging for Windows from Linux requires Wine, which is not part
  of this workflow. Use a Windows machine or a Windows CI runner instead.
#>
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot\..

if ($env:OS -notmatch 'Windows') {
  Write-Warning 'This script builds a Windows installer and must run on Windows. On Linux/macOS it will not produce a Windows installer.'
}
node --version
npm --version
npm install
npx --yes electron-builder@26.18.0 --win nsis --x64
Write-Host ''
Write-Host 'Done. Installer (if the build succeeded) is in dist\'
Get-ChildItem dist -ErrorAction SilentlyContinue | Select-Object Name, Length
