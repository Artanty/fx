# SikuliX for the native H90 Control app

Tooling for driving the Windows **H90 Control.exe** GUI (v1.9.13, JUCE) with
image recognition: click the on-screen knobs and presets for real, live
MIDI/HID traffic (parallel RE path to the raw-frame replay approach).

## Layout

```
back/h90/sikulix/
  sikulixide-2.0.5-win.jar   IDE (interactive capture/run)     [downloaded, gitignored]
  sikulixapi-2.0.5-win.jar   API (standalone scripts)          [downloaded, gitignored]
  jre/                       portable Temurin JRE 17 x64       [extracted, gitignored]
  sikulix-ide.cmd            launch the IDE
  sikulix-run.cmd            run a .sikuli project from CLI
  setup.ps1                  idempotent download+extract (re-run to repair)
  projects/
    h90-smoke.sikuli/        first sanity script (screen size + window + screenshot)
```

## Versions / requirements

- SikuliX **2.0.5** (built with Java 17, OpenCV 4.5.1) from Launchpad.
- Java 11+ (bundled Temurin JRE 17.0.20.1 x64 is used by the launchers).
- Windows: VC++ 2015+ x64 redistributable (already installed, v14.42).

## One-time setup (already done on this machine)

1. `setup.ps1` downloaded+extracted the two jars and the JRE into this folder.
2. First IDE run (`sikulix-ide.cmd`) shows a Setup screen — click through the
   install buttons (IDE + Jython), it downloads Jython into `~/.sikulix` and
   quits. Relaunch. That GUI step cannot be scripted.

## Daily use

- Capture: `sikulix-ide.cmd`, open `projects\h90-smoke.sikuli`. Use the capture
  tool (Ctrl+Shift+drag a rectangle) on an H90 Control knob/preset, the PNG
  lands in the project folder; reference it as `click("knob-mix.png")` etc.
- Smokes: `sikulix-run.cmd projects\h90-smoke.sikuli`
- Runs need the **visible desktop**: do not lock the screen or minimize H90
  Control; set a fixed Windows display scale (image matches are scale-
  sensitive; re-take PNGs at the DPI you will run at).

## Pointers for the H90 session

- The H90 window region + a screen capture fall back cleanly in the smoke
  script; extend it with `find()`/`click()` once real PNGs exist.
- `Settings.MIN_SIMILARITY` and `Pattern("x.png").similar(0.9)` tune false
  positives on the dark JUCE UI.
- Clicking TURN-KNOB style controls = repeated `click()` or a `dragDrop` small
  vertical drag on the knob's pattern image.