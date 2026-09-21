# Cross-compile c4hid (bridge) to static ARMv7 for monome norns via zig.
# Requires a portable zig for Windows somewhere on PATH or ZIG env var.
#   ZIG=C:\path\to\zig.exe .\build.ps1
$ErrorActionPreference = 'Stop'
$zig = if ($env:ZIG) { $env:ZIG } else { 'zig.exe' }
$src = Join-Path $PSScriptRoot 'c4hid.c'
$out = Join-Path $PSScriptRoot 'c4hid'
& $zig cc -target arm-linux-musleabihf -static -O2 -std=c99 -Wall -Wextra $src -o $out
if ($LASTEXITCODE -ne 0) { throw 'zig cc failed' }
Write-Output "built: $out"
& $zig cc -target x86_64-linux-musl -static -O2 -std=c99 $src -o (Join-Path $PSScriptRoot 'c4hid-linux-x64')
if ($LASTEXITCODE -ne 0) { throw 'zig cc (x64) failed' }
Write-Output 'built: c4hid-linux-x64 (for quick VM testing)'