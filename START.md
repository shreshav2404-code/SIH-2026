# Starting ANUPALAN for a demo

## The short version

Right-click **`start-demo.ps1`** and choose **Run with PowerShell**.

It starts the database, the API, the dashboard and the sensor simulator, sets
up the phone tunnel if a cable is attached, and prints one status block. Four
windows open so you can see each part running. Give it about a minute - the API
loads an embedding model on startup.

You do not need to type anything else, and you do not need Android Studio to
run a demo. Android Studio is only for building a new APK.

## What "ready" looks like

```
1. Database
  OK    Docker Desktop is running
  OK    Postgres healthy (anupalan-db)
2. API
  OK    started on :8000 (took 31s)
  OK    db=ok  postgis=3.4.3  pgvector=0.8.6
3. Dashboard
  OK    started on :5173
4. Sensor simulator
  OK    started - press m in that window to inject a methane spike
5. Handset
  OK    cable connected, tunnel set (adb reverse tcp:8000)
  OK    hotspot up, laptop is 192.168.137.1
```

Then open **http://localhost:5173** and sign in as `keshav / demo1234`.

## Connecting the phone

Both routes are verified working. The app picks one on its own and tells you
which on the sign-in screen.

### Cable

Plug the phone in. The script runs `adb reverse tcp:8000 tcp:8000` for you.
Verified with the phone's wifi turned off: the app showed

> Server: http://localhost:8000 - **over the cable**

The tunnel **drops silently** if the adb daemon restarts or the cable is
re-seated, and the app then says "Cannot reach the API". Re-run:

```
adb reverse tcp:8000 tcp:8000
```

### Wireless

The **laptop** hosts the hotspot, so the phone needs no SIM.

1. Laptop: Settings, Network and Internet, Mobile hotspot, on, sharing Ethernet.
   It is already configured as `LEGION 6811`.
2. Phone: join that network.
3. Open the app.

Verified with the cable tunnel removed: the app showed

> Server: http://192.168.1.101:8000 - **over wifi**

and signed in and loaded the duty list.

### If neither works

Sign-in screen, tap **change**, type `http://<laptop-ip>:8000`. Get the address
from `ipconfig | findstr IPv4`.

## Manual commands, if the script fails

Four terminals, in this order.

```
docker compose up -d db
cd api  && ..\.venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
cd web  && npm run dev
.\.venv\Scripts\python.exe tools\sensor_sim.py
adb reverse tcp:8000 tcp:8000
```

`--host 0.0.0.0` matters: without it the API listens only on the laptop and the
phone cannot reach it over wifi.

## Android Studio

Only needed to build a new APK, never to run a demo.

Open `mobile\android` in Android Studio and press Run. Gradle cannot be driven
from a terminal on this machine - `Selector.open()` fails, so its launcher never
reaches its daemon. See `docs/ANDROID_BUILD.md`.

If the change is JavaScript only, you do not need Android Studio at all; the
bundle can be swapped into the signed APK in about three minutes. See
`docs/SHIP_APK.md`.

## Sign-ins

| User | Password | Role |
|---|---|---|
| keshav | demo1234 | Mine Manager - can edit the register, sign returns, issue directives |
| prince | demo1234 | Safety Officer - can edit duties, cannot delete or sign |
| nisarga | demo1234 | Regulator - read only, writes are refused with 403 |

## Thirty seconds before you present

```
curl -s http://localhost:8000/health     # {"status":"ok", ...}
adb reverse --list                       # tunnel present, if using the cable
docker ps --filter name=anupalan-db      # database up
```

Then open the app once and check the sign-in screen names a server.

The model runs on the phone. If the network dies mid-demo you lose the ledger,
the dashboard and sync - you do not lose the assistant, and it will still answer
in airplane mode.
