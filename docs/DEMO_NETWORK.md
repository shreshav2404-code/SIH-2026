# Getting the phone and the laptop talking

Verified end to end on 2026-09-06 with the USB cable unplugged: the app found
the API by itself and signed in. Wireless works. The cable is a fallback, not a
requirement.

## What was measured

| Test | Result |
|---|---|
| API listening | `0.0.0.0:8000` |
| Firewall rule `ANUPALAN API 8000` | Enabled, Allow, any profile, any interface |
| Laptop hotspot `LEGION 6811` | On, sharing Ethernet, laptop at `192.168.137.1` |
| Phone joined | `192.168.137.96`, 5 GHz, 433 Mbps |
| App discovery, no cable | found `http://192.168.1.101:8000`, "over wifi" |
| Sign-in and duty list | worked, and the API log shows the phone's requests |

### A probe that lied, recorded so nobody repeats it

An earlier pass concluded the router was isolating clients. That was wrong. It
came from `adb shell nc -z <host> <port>`, which reported "closed" for
**every** port on every host — including `8.8.8.8:53` and `1.1.1.1:443`, which
are certainly open, while `ping 8.8.8.8` from the same phone had 0% loss.
Android's toybox `nc` does not support `-z` the way the test assumed, so every
result was a false negative.

`ping` to the laptop also fails, and that means nothing either: Windows blocks
inbound ICMP by default while still accepting TCP on an allowed port.

**Do not diagnose this with `nc` or `ping` from the phone.** The only probe that
tells the truth is the app itself — its sign-in screen names the address it
found and how it got there.

## 1. Wireless — laptop hosts the hotspot

The phone needs no SIM for this. The **laptop** is the access point.

1. **Laptop:** Settings → Network & Internet → **Mobile hotspot** → on.
   Share the **Ethernet** connection. The current network is `LEGION 6811`.
2. **Phone:** join that network from wifi settings.
3. **App:** open it. Discovery runs on its own and the sign-in screen shows the
   address and route, e.g. "Server: http://192.168.1.101:8000 · over wifi".

The laptop keeps Ethernet at the same time, so it does not lose internet, and
the phone gets internet through it.

Check the laptop is actually hosting:

```bash
ipconfig | findstr /C:"IPv4"
```

You want a `192.168.137.x` alongside the wired address.

## 2. USB cable — the fallback

```bash
adb reverse tcp:8000 tcp:8000
```

`localhost:8000` on the phone becomes the laptop. It sidesteps wifi and
addressing entirely.

**It drops silently** when the adb daemon restarts or the cable is re-seated,
and the app then reports "Cannot reach the API". Re-run the command. Check with
`adb reverse --list`.

## 3. Type the address by hand

Sign-in screen → **change** → `http://<laptop-ip>:8000`.

## Untested

**Both devices on the same ordinary router wifi.** An earlier attempt failed,
but the API happened to be stopped at that moment, so the failure proves
nothing. Venue wifi that isolates clients is a real phenomenon and would break
it — which is why the laptop-hosted hotspot above is the recommended path. Test
it on the venue's network before relying on it.

## What does NOT need changing

- **Postgres** runs in Docker on the laptop and is reached only by the API on
  the same machine. It is never exposed to the phone.
- **The dashboard** runs on the laptop. It now binds every interface, so
  `http://<laptop-ip>:5173` works from a second device on the hotspot.

## Before you present

```bash
adb reverse --list                      # cable tunnel, if you want it
curl -s http://localhost:8000/health    # API up, db ok
docker ps --filter name=anupalan-db     # database up
ipconfig | findstr /C:"IPv4"            # hotspot address present
```

The model runs on the phone. Losing the network costs the ledger, the dashboard
and sync. It does not cost the assistant.
