# ANUPALAN — Machine Setup Checklist

Team NeuraForge · SIH26024 · Windows 11 · i7-14650HX · 16 GB RAM · **Galaxy S25+**

**Rule:** Apps + their data go to **C:**. Your work (repo, model, Android SDK) goes to **D:**.

---

## STATUS — 2026-09-02

**DONE:** WSL 2.7.12 (no distro) · Node 24.19 · Python 3.11.9 · VS Code 1.135 ·
Docker Desktop 4.88.1 · Android Studio 2026.1 · scrcpy 4.1 · DBeaver 26.1.5 ·
Bruno 4.1 · cloudflared 2026.8.3 · OBS 32.2.1 · Git 2.55 · Chrome 152
Android SDK installing to `D:\Android\Sdk` — nothing on C:

**Docker verified:** `hello-world` ran. Engine 29.7.2. WSL2 VM capped at **5.8 GB / 6 CPUs**
via `C:\Users\KESHAV JHA\.wslconfig` (delete that file at teardown).

**REMAINING:** project folder `D:\anupalan` (Step 8) — then the build starts.

**Note:** phone is an **S25+** (Snapdragon 8 Elite), better than the S24+ the plan
assumed — exposes OpenCL, so the 710 MB GPU path at ~22 tok/s is available.

---

## STEP 1 — Install WSL2 (Docker needs it)

Open **PowerShell as Administrator** (right-click Start → Terminal (Admin)):

```
wsl --install
```

**Then REBOOT your laptop.** Nothing else works until this is done.

- [ ] Done, rebooted

---

## STEP 2 — Kill the fake Python

Windows ships a stub that hijacks the `python` command.

Settings → Apps → **Advanced app settings** → **App execution aliases**
→ turn **OFF** both `python.exe` and `python3.exe`

- [ ] Done

---

## STEP 3 — Install everything

Open **PowerShell as Administrator** again and paste this whole line:

```
winget install --id OpenJS.NodeJS.LTS -e ; winget install --id Python.Python.3.11 -e ; winget install --id Microsoft.VisualStudioCode -e ; winget install --id Docker.DockerDesktop -e ; winget install --id Google.AndroidStudio -e ; winget install --id Genymobile.scrcpy -e ; winget install --id DBeaver.DBeaver.Community -e ; winget install --id Bruno.Bruno -e ; winget install --id Cloudflare.cloudflared -e ; winget install --id OBSProject.OBSStudio -e
```

Versions this installs (checked 2026-09-02):
Node 24.19 LTS · **Python 3.11.9 (pinned on purpose — NOT latest)** · VS Code 1.135
Docker 4.88.1 · Android Studio 2026.1.3.7 · scrcpy 4.1 · DBeaver 26.1.5
Bruno 4.1 · cloudflared 2026.8.3 · OBS 32.2.1

~10 GB of downloads. Let it run — it takes a while.
Say **Yes** to any UAC prompt. If one package fails, re-run just that line.

- [ ] Done

---

## STEP 4 — Point the Android SDK at D:

Your username has a space in it (`KESHAV JHA`), which can break Android builds.
Set this in PowerShell:

```
setx ANDROID_SDK_ROOT "D:\Android\Sdk"
```

- [ ] Done

---

## STEP 5 — Verify

**Close PowerShell, open a NEW one** (so the changes load), then:

```
node -v; npm -v; python --version; git --version; docker --version
```

Expected:
- node → v20.x
- npm → 10.x
- python → **3.11.x** (must be 3.11, not 3.13)
- git → 2.55.0
- docker → 28.x or similar

- [ ] All five print a version

---

## STEP 6 — Android Studio first launch

Open Android Studio. The setup wizard runs:

1. Choose **Custom** (not Standard)
2. **Android SDK Location** → set to `D:\Android\Sdk`
3. Tick: **Android SDK**, **Android SDK Platform**, **Android Virtual Device**
4. Let it download (~6 GB)

Then add `adb` to your PATH:

```
setx PATH "$env:PATH;D:\Android\Sdk\platform-tools"
```

Verify in a new PowerShell: `adb version`

- [ ] Done, `adb version` works

---

## STEP 7 — Docker Desktop first launch

1. Open Docker Desktop, accept the terms
2. It may ask to enable WSL2 → **Yes**
3. **Settings → Resources → Memory** → set to **6 GB** (you have 16 GB total; leave room for Android Studio)
4. Wait for the whale icon to go green

Verify:

```
docker run hello-world
```

- [ ] Done, hello-world ran

---

## STEP 8 — Project folder

We build in a **new folder without spaces** (Gradle dislikes spaces):

```
D:\anupalan
```

The SIH documents stay in `D:\chodu sih`. Claude will set this up.

- [ ] Done

---

## Later (not now)

- Three model files (984 MB total) -> save to `D:\anupalan\models\`:
  `granite-4.0-h-350m_int8_gpu.litertlm` (481,218,880 bytes),
  `SmolLM2_360M_instruct.litertlm` (373,719,040),
  `LFM2.5-230M_int4.litertlm` (176,756,720)
- Google AI Edge Gallery on the S24+ (Play Store) — validate the model in airplane mode
- arm64-v8a emulator image (only if you want to dev without the phone)

---

## If something breaks

| Problem | Fix |
|---|---|
| `wsl --install` fails | Enable virtualization in BIOS |
| Docker won't start | Reboot, make sure WSL2 finished installing |
| `python` still not found | You missed Step 2 (the app execution alias) |
| winget "no package found" | Run `winget search <name>` for the right ID |
