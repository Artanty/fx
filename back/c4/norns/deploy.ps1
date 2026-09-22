# Deploy the norns C4 synth (c4synth) to the LAN norns.
#
# Pushes the whole c4synth script dir over scp (the norns reaches the C4 at
# /home/we/dust/code/c4synth/ - see docs/norns-port.md "Deploy"). No key is
# installed on the norns, so we use the SSH_ASKPASS mechanism to feed the
# documented LAN password non-interactively (OpenSSH >= 8.4 honours
# SSH_ASKPASS_REQUIRE=force even with a console; askpass must be a running
# program, not the default value - OpenSSH 9.5 kills a direct arg).

param(
  [string]$Host_ = 'we@192.168.1.70',
  [string]$Password = $env:C4NORNS_PW,
  [switch]$SkipRelaunch
)

$ErrorActionPreference = 'Stop'

if (-not $Password) { $Password = 'sleep' }   # documented LAN password

$root      = Split-Path -Parent $PSScriptRoot          # ...\c4
$local     = Join-Path $root 'norns\synths\c4synth'
$remoteDir = '/home/we/dust/code/c4synth'

if (-not (Test-Path -LiteralPath $local)) { throw "script dir not found: $local" }

$tmp = Join-Path $env:TEMP 'c4-deploy'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

# askpass helper: a tiny .cmd that echoes the password. OpenSSH runs this via
# CreateProcess with stdin closed and reads our stdout as the password.
$ask = Join-Path $tmp 'ask.cmd'
Set-Content -LiteralPath $ask -Value "@echo $Password" -Encoding Ascii

$env:SSH_ASKPASS        = $ask
$env:SSH_ASKPASS_REQUIRE = 'force'
$env:GIT_ASKPASS        = $ask
$env:DISPLAY            = 'localhost:0'   # randseed for askpass; force overrides

$common = @(
  '-o', 'ConnectTimeout=10',
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'NumberOfPasswordPrompts=1'
)

Write-Output ("Pushing {0} -> {1}" -f $local, $remoteDir)
& scp @common -r $local ${Host_}:$remoteDir 2>$null
if ($LASTEXITCODE -ne 0) { throw 'scp failed' }
Write-Output 'push ok'

if (-not $SkipRelaunch) {
  Write-Output 'NOTE: relaunch c4synth twice on the norns (script menu -> open'
  Write-Output 'twice). lib/ modules are require-cached until the 2nd relaunch;'
  Write-Output 'the randomizer metro is globally-guarded so a leaked metro after'
  Write-Output 'the 1st reload is stopped automatically.'
}
Write-Output 'done.'
