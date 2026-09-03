/**
 * The handset's own sensors, as compliance telemetry.
 *
 * Until now every reading on the dashboard came from tools/sensor_sim.py. These
 * are real, measured on the phone in the officer's hand, which is the whole
 * point: a field inspection app that can also *measure* is a different claim
 * from one that only records what someone typed.
 *
 * WHAT EACH READING CAN HONESTLY CLAIM
 *
 *   vibration     Maps onto an existing sensor type with a real clause behind
 *                 it (CMR 2017 Reg. 106, 8.0 mm/s). See the unit note below -
 *                 this is a proxy, not a calibrated PPV instrument, and the
 *                 dashboard says so.
 *   noise         Real measurement, but the 52-clause corpus contains NO noise
 *                 clause, so it carries no clause_ref. Monitoring only. Add the
 *                 DGMS reference from the domain research and it becomes a
 *                 compliance signal.
 *   illumination  Same: real lux, no lighting clause in the corpus yet.
 *   patrol        Location, already permitted and already used for evidence.
 *                 Needs no threshold - it answers "was the officer there?"
 *
 * Nothing here is invented. Where a statutory hook is missing it is left null
 * rather than guessed, because a fabricated regulation number is the failure
 * this whole system exists to prevent.
 */

import { Accelerometer, LightSensor } from "expo-sensors";

import { api } from "./api";

/** Sampling cadence. Fast enough to look live, slow enough not to cook the battery. */
const SAMPLE_MS = 200;
/** How often a batch is posted. The simulator uses 2s; matching it keeps the chart even. */
const POST_MS = 2000;

export type PhoneSensor = "vibration" | "noise" | "illumination";

export interface SensorSample {
  sensor_type: string;
  value: number;
  unit: string;
  recorded_at: string;
}

/** Standard gravity, for removing the constant 1g the accelerometer always reads. */
const G = 9.80665;

interface Window {
  accel: number[];
  lux: number[];
  db: number[];
}

let win: Window = { accel: [], lux: [], db: [] };
let subs: { remove: () => void }[] = [];
let poster: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Latest values, for the app to show without waiting for a round trip. */
export let live = { vibration: 0, illumination: 0, noise: 0 };

function rms(xs: number[]): number {
  if (!xs.length) return 0;
  return Math.sqrt(xs.reduce((a, x) => a + x * x, 0) / xs.length);
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0;
}

/**
 * Accelerometer magnitude to a vibration velocity in mm/s.
 *
 * HONEST LIMITATION. A real ground-vibration reading is peak particle velocity
 * from a calibrated geophone bolted to rock. This is a phone in a hand, and the
 * conversion below is an approximation: RMS acceleration over the window,
 * divided by the angular frequency of an assumed dominant 10 Hz component,
 * which is typical for blasting but is an ASSUMPTION not a measurement.
 *
 * It is genuinely responsive - the number moves when the phone does, and the
 * threshold logic is the same deterministic arithmetic used for every other
 * reading. It is not a legal instrument, and nothing in the UI says it is.
 */
const ASSUMED_HZ = 10;

function accelToMmPerSec(rmsG: number): number {
  const a = rmsG * G; // m/s^2
  const v = a / (2 * Math.PI * ASSUMED_HZ); // m/s
  return v * 1000; // mm/s
}

/**
 * Begin sampling and posting. Safe to call twice; the second call is a no-op.
 *
 * `mineId` scopes the readings, exactly as the simulator does, so the dashboard
 * and the hazard window treat phone data and simulated data identically - the
 * detection path does not care where a number came from.
 */
export function startSensors(mineId: number, onError?: (e: unknown) => void) {
  if (running) return;
  running = true;
  win = { accel: [], lux: [], db: [] };

  Accelerometer.setUpdateInterval(SAMPLE_MS);
  subs.push(
    Accelerometer.addListener(({ x, y, z }) => {
      // Remove the constant 1g so a phone lying still reads ~0 rather than 1.
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      win.accel.push(Math.abs(magnitude - 1));
    }),
  );

  // Android-only, and absent on some devices. Missing hardware must not take
  // the other sensors down with it.
  try {
    LightSensor.setUpdateInterval(SAMPLE_MS);
    subs.push(LightSensor.addListener(({ illuminance }) => win.lux.push(illuminance)));
  } catch {
    /* no ambient light sensor on this device */
  }

  poster = setInterval(() => {
    void flush(mineId).catch((e) => onError?.(e));
  }, POST_MS);
}

export function stopSensors() {
  running = false;
  subs.forEach((s) => {
    try {
      s.remove();
    } catch {
      /* already gone */
    }
  });
  subs = [];
  if (poster) clearInterval(poster);
  poster = null;
}

export function isRunning() {
  return running;
}

/** Feed a measured decibel level in from the recorder. */
export function pushNoise(db: number) {
  win.db.push(db);
}

/** Post one batch and clear the window. */
async function flush(mineId: number): Promise<void> {
  const now = new Date().toISOString();
  const readings: (SensorSample & { mine_id: number })[] = [];

  if (win.accel.length) {
    const v = accelToMmPerSec(rms(win.accel));
    live.vibration = v;
    readings.push({
      mine_id: mineId,
      sensor_type: "vibration",
      value: Number(v.toFixed(3)),
      unit: "mm/s",
      recorded_at: now,
    });
  }

  if (win.lux.length) {
    const l = mean(win.lux);
    live.illumination = l;
    readings.push({
      mine_id: mineId,
      sensor_type: "illumination",
      value: Number(l.toFixed(1)),
      unit: "lux",
      recorded_at: now,
    });
  }

  if (win.db.length) {
    const d = mean(win.db);
    live.noise = d;
    readings.push({
      mine_id: mineId,
      sensor_type: "noise",
      value: Number(d.toFixed(1)),
      unit: "dB",
      recorded_at: now,
    });
  }

  win = { accel: [], lux: [], db: [] };
  if (!readings.length) return;

  // Fire and forget. A dropped batch is not worth surfacing - the next one is
  // two seconds away, and evidence (which must never be lost) goes through the
  // SQLite queue instead.
  await api.post("/sensors/readings", { readings });
}
