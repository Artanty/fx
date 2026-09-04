# Capture the Source Audio L.A. Lady USB HID traffic while the Neuro desktop
# app performs a preset save, then decode host->device HID reports.
#
# Prereqs (once, after a reboot so USBPcap's class filter binds to root hubs):
#   - Wireshark/tshark installed  (winget install WiresharkFoundation.Wireshark)
#   - USBPcap installed + driver running
#   - Source Audio Neuro Desktop 3 installed and able to save a preset
#   - L.A. Lady pedal connected (VID 0x29a4 / PID 0x0300)
#
# Usage:
#   capture-lalady.ps1            # capture a single Neuro save (timed window)
#   capture-lalady.ps1 -Hub 0     # capture from a specific USBPcap hub
#   capture-lalady.ps1 -ListHubs  # list USBPcap hubs that carry the pedal
#
# It writes <pedal-app>/runtime-actions/usbpcap-<timestamp>.pcap and prints the
# tshark + decodeCapture commands/captured reports.
#
# Workflow in Neuro (do this while the capture is running):
#   Save / import a preset into a KNOWN slot, note which slot + preset name.
#   The host->device HID reports logged below are what we decode for the
#   real erase/commit command sequence.

param(
  [int]$Minutes = 2,
  [string]$Hub,
  [switch]$ListHubs
)

$ErrorActionPreference = "Stop"
$root   = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "runtime-actions"
$tshark = "C:\Program Files\Wireshark\tshark.exe"
$usbcmd = "C:\Program Files\USBPcap\USBPcapCMD.exe"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
if (-not (Test-Path $tshark)) { throw "tshark not found at $tshark" }
if (-not (Test-Path $usbcmd)) { throw "USBPcapCMD not found at $usbcmd" }

function Get-UsbcapHubs {
  $hubs = @()
  for ($i = 0; $i -lt 10; $i++) {
    $dev = "\\.\USBPcap$i"
    $out = & $usbcmd -d $dev -o "$env:TEMP\usbcap_hubtest_$i.pcap" 2>&1
    if ($OUT.Length -gt 0 -and ($OUT -match "Empty capture|capture from all devices|Selected")) {
      $hubs += $i
    }
  }
  return $hubs
}

function Test-HubHasPedal($hub) {
  # short capture w/ descriptors on this hub, then ask tshark if the pedal is there
  $p = Join-Path $env:TEMP "hub_$hub.pcap"
  $proc = Start-Process -FilePath $usbcmd -ArgumentList "-d","\\.\USBPcap$hub","-o",$p,"-A","--inject-descriptors" -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 1
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  if (-not (Test-Path $p)) { return $false }
  $hits = & $tshark -r $p -Y "usb.idVendor == 0x29a4 && usb.idProduct == 0x0300" 2>&1
  return ($hits.Count -gt 0 -and $hits | Where-Object { $_ -match "0x29a4" })
}

if ($ListHubs) {
  Write-Host "Scanning USBPcap hubs for the L.A. Lady..."
  foreach ($h in (Get-UsbcapHubs)) {
    $has = Test-HubHasPedal $h
    Write-Host ("USBPcap{0}: pedal present = {1}" -f $h, $has)
  }
  exit 0
}

# Determine the hub(s) to capture
$hubs = @()
if ($Hub) { $hubs = @([int]$Hub) }
else {
  Write-Host "Scanning hubs for the pedal (this adds ~1s per hub)..."
  foreach ($h in (Get-UsbcapHubs)) { if (Test-HubHasPedal $h) { $hubs += $h } }
  if ($hubs.Count -eq 0) {
    Write-Warning "No USBPcap hub detected the pedal. Reboot required? Capturing all hubs instead."
    $hubs = Get-UsbcapHubs
  }
  Write-Host ("Capturing hubs: " + ($hubs -join ","))
}

$stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()
$outFile = Join-Path $outDir "usbpcap-$stamp.pcap"
$proc2 = Start-Process -FilePath $usbcmd -ArgumentList "-d","\\.\USBPcap$($hubs[0])","-o",$outFile,"-A","--inject-descriptors","-b","67108864" -PassThru -WindowStyle Hidden
Write-Host ""
Write-Host "===== CAPTURE STARTED on hub $($hubs[0]) -> $outFile ====="
Write-Host "NOW: In Neuro, save/import a preset to a KNOWN slot and note the slot+name."
Write-Host "Capture window = $Minutes minute(s). Press Ctrl+C to stop early."
Write-Host ""

# stop after $Minutes minutes or Ctrl+C
try {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalMinutes -lt $Minutes) { Start-Sleep -Seconds 1 }
} finally {
  Stop-Process -Id $proc2.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 800
}

Write-Host ""
Write-Host "===== CAPTURE ENDED ====="
Write-Host "File: $outFile ($(((Get-Item $outFile).Length)) bytes)"
Write-Host ""
Write-Host "Extract host->device HID reports:"
Write-Host "  & `"$tshark`" -r `"$outFile`" -T fields -e usb.endpoint_address.direction -e usb.setup.bRequestType -e usb.setup.bRequest -e usb.capdata > capture.txt"
Write-Host "Decode:"
Write-Host "  node scripts/decodeCapture.js capture.txt"
