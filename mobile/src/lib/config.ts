/**
 * The phone must reach the laptop by LAN IP — `localhost` on a phone means the
 * phone. If venue wifi blocks device-to-device, run:
 *
 *     cloudflared tunnel --url http://localhost:8000
 *
 * and paste the https URL here. That tunnel carries DATA ONLY; the model runs
 * on-device and never touches the network.
 */
export const API_BASE = "http://192.168.1.36:8000";

/** Cap on queued captures held before we warn the officer. */
export const QUEUE_WARN_AT = 25;

/** Photo compression — evidence must upload over a bad connection. */
export const PHOTO_MAX_WIDTH = 1280;
export const PHOTO_QUALITY = 0.7;
