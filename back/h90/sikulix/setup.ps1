# Downloads/extracts SikuliX 2.0.5 + portable Temurin JRE 17 into this folder.
# Idempotent: skips artifacts that already exist. Already executed on this machine.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$base = "https://launchpad.net/sikuli/sikulix/2.0.5/+download"

$files = @{
    "sikulixide-2.0.5-win.jar" = "$base/sikulixide-2.0.5-win.jar"
    "sikulixapi-2.0.5-win.jar" = "$base/sikulixapi-2.0.5-win.jar"
}

foreach ($f in $files.Keys) {
    $p = Join-Path $root $f
    if (-not (Test-Path $p)) {
        Write-Host "downloading $f"
        curl.exe -L --fail --retry 3 -o $p $files[$f]
    } else {
        Write-Host "present: $f"
    }
}

$java = Join-Path $root "jre\bin\java.exe"
if (-not (Test-Path $java)) {
    $tmp = Join-Path $env:TEMP "sikulix-jre17.zip"
    $ex = Join-Path $env:TEMP "sikulix-jre17"
    Write-Host "downloading Temurin JRE 17 (Windows x64)"
    curl.exe -L --fail --retry 3 -o $tmp "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jre/hotspot/normal/eclipse"
    if (Test-Path $ex) { Remove-Item -Recurse -Force $ex }
    Expand-Archive -LiteralPath $tmp -DestinationPath $ex -Force
    New-Item -ItemType Directory -Force -Path (Join-Path $root "jre") | Out-Null
    Copy-Item -Recurse -Force (Join-Path $ex "*\*") (Join-Path $root "jre")
    Remove-Item -Recurse -Force $ex, $tmp
} else {
    Write-Host "present: jre"
}

Write-Host "JRE:"
& $java -version
Write-Host "setup complete"