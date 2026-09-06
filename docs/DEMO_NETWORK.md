# Getting the phone and the laptop talking

The app needs to reach the API. There are three ways, and they are listed in
the order you should try them at a venue.

## Why the obvious way fails

Both devices on the same wifi is the obvious answer and it does not work here.
Measured from the handset on 2026-09-06, with laptop and phone on the same
`192.168.1.0/24`:

| Test | Result |
|---|---|
| API listening | `0.0.0.0:8000` |
| Laptop -> its own LAN IP | HTTP 200 |
| Firewall rule `ANUPALAN API 8000` | Enabled, Allow, all profiles |
| Phone -> laptop `:8000` | closed |
| Phone -> laptop `:5173` | closed |
| Phone -> laptop `:445` | closed |
| Phone -> laptop ICMP | 100% loss |

Every port was unreachable, not just ours, so this is not a firewall rule and
not an app bug. The router has **client isolation** turned on: wireless clients
cannot talk to other devices. College and conference wifi almost always does
this. No change to the app can route around it.

## 1. USB cable — most reliable, use it for the demo

```bash
adb reverse tcp:8000 tcp:8000
```

`localhost:8000` on the phone now resolves to the laptop. It sidesteps wifi,
addressing and the firewall completely.

**It drops silently.** If the adb daemon restarts, the cable is re-seated, or
the phone reboots, the tunnel is gone and the app shows "Cannot reach the API".
Re-run the command; nothing else is needed. Check it with:

```bash
adb reverse --list
```

## 2. Phone's hotspot — the wireless fallback

The phone becomes the router, so there is no other router to isolate anything.

1. **Phone:** Settings → Connections → Mobile Hotspot and Tethering → turn on
   **Mobile Hotspot**. Mobile data is not required — the hotspot still forms a
   local network without it, which is all the demo needs.
2. **Laptop:** join that hotspot from the wifi menu. Windows will ask whether
   the network is public or private; either works, because the firewall rule
   covers all profiles.
3. **Laptop:** leave the Ethernet cable plugged in if you want internet. Windows
   holds both, and the API listens on every interface.
4. **App:** sign out and back in, or press **change** on the sign-in screen and
   then rediscover. It sweeps `192.168.43.1-12` and `192.168.137.1-12`
   automatically and shows "over the phone's hotspot" when it lands.

Confirm the laptop actually picked up a hotspot address:

```bash
ipconfig | findstr /C:"IPv4"
```

You want a `192.168.43.x` (or `192.168.137.x`) alongside the wired address.

## 3. Type the address by hand — last resort

On the sign-in screen tap **change** and enter `http://<laptop-ip>:8000`. Get
the address from the `ipconfig` above. Use this when discovery is slow or the
laptop landed outside the swept range.

## What does NOT need changing

- **Postgres** runs in Docker on the laptop and is only ever reached by the API
  on the same machine. It is not exposed to the phone and does not need to be.
- **The dashboard** runs on the laptop and is normally viewed there. It now
  binds every interface, so if you want it on a second device during the demo,
  open `http://<laptop-ip>:5173`.

## Before you present

```bash
adb reverse --list                                   # cable tunnel present
curl -s http://localhost:8000/health                 # API up, db ok
docker ps --filter name=anupalan-db                  # database up
```

The model runs on the phone, so none of this affects whether ANUPALAN can
answer a question. Losing the network costs you the ledger, the dashboard and
sync. It does not cost you the assistant.
