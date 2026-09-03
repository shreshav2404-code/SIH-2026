"""Watch the Android release build and report what happened.

Gradle cannot be driven from this shell (loopback failure, see
docs/ANDROID_BUILD.md), so a human presses Build in Android Studio. This
watches the filesystem and reports success or the first real error, so the
diagnosis does not depend on reading a screenshot.
"""
import glob, os, re, sys, time

ROOT = r"D:\anupalan\mobile"
APK = os.path.join(ROOT, r"android\app\build\outputs\apk\release\app-release.apk")
ASSET = os.path.join(ROOT, r"android\app\src\main\assets\gemma-4-E4B-it.litertlm")
DEADLINE = time.time() + 45 * 60
START = time.time()

def mb(p):
    try: return os.path.getsize(p) / 1048576
    except OSError: return 0

def fresh_errors():
    """Any *_stderr / error log written since we started watching."""
    out = []
    for pat in (r"node_modules\**\.cxx\**\*.txt",
                r"node_modules\**\build\**\logs\**\*.txt",
                r"android\app\.cxx\**\*.txt"):
        for f in glob.glob(os.path.join(ROOT, pat), recursive=True):
            try:
                if os.path.getmtime(f) < START: continue
                t = open(f, encoding="utf-8", errors="ignore").read()
            except OSError:
                continue
            for m in re.finditer(r"^.*(?:error|undefined symbol|FAILED).*$", t, re.I | re.M):
                line = m.group(0).strip()
                if line and line not in out:
                    out.append(line)
    return out[:12]

print(f"watching for the release APK (up to 45 min)\n  {APK}\n", flush=True)
last = ""
while time.time() < DEADLINE:
    a, s = mb(APK), mb(ASSET)
    line = f"asset={s:.0f}MB apk={a:.0f}MB"
    if line != last:
        print(f"  {time.strftime('%H:%M:%S')}  {line}", flush=True)
        last = line
    if a > 100:
        time.sleep(20)                      # let the write settle
        print(f"\nAPK BUILT: {mb(APK):.0f} MB", flush=True)
        sys.exit(0)
    errs = fresh_errors()
    if errs:
        print("\nBUILD ERRORS:", flush=True)
        for e in errs: print("   ", e[:200], flush=True)
        sys.exit(1)
    time.sleep(15)
print("\ntimed out", flush=True)
sys.exit(2)
