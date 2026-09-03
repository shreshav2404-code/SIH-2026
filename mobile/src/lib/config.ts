/**
 * Where the app finds the API. `localhost` means the device itself, so neither
 * an emulator nor a phone can use it.
 *
 *   EMULATOR  10.0.2.2      — the emulator's alias for the host laptop.
 *                             Not a real address; it only works inside the AVD.
 *   PHONE     192.168.1.36  — the laptop's Wi-Fi IP, same network required.
 *   TUNNEL    cloudflared tunnel --url http://localhost:8000
 *                             when venue wifi blocks device-to-device.
 *
 * Any tunnel carries DATA ONLY. The model runs on-device and never touches
 * the network, so airplane mode breaks nothing that matters.
 */
export const EMULATOR_HOST = "http://10.0.2.2:8000";
export const LAN_HOST = "http://192.168.1.36:8000";

/**
 * Reached over the USB cable via `adb reverse tcp:8000 tcp:8000`, which makes
 * localhost:8000 ON THE DEVICE resolve to the laptop. Works identically on a
 * phone and on the emulator, and sidesteps wifi, LAN addressing and the
 * firewall entirely - which is exactly what you want at a venue.
 *
 * Run once per device after connecting:
 *   adb reverse tcp:8000 tcp:8000
 *   adb reverse tcp:8081 tcp:8081   # Metro, debug builds only
 *
 * Switch to LAN_HOST for a release APK running without a cable.
 */
export const USB_HOST = "http://localhost:8000";

export const API_BASE = USB_HOST;

/** Cap on queued captures held before we warn the officer. */
export const QUEUE_WARN_AT = 25;

/** Photo compression — evidence must upload over a bad connection. */
export const PHOTO_MAX_WIDTH = 1280;
export const PHOTO_QUALITY = 0.7;
