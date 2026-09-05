import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";

import { API_BASE } from "./config";
import { discover, type Discovered } from "./discovery";

export const api = axios.create({ baseURL: API_BASE, timeout: 15000 });

const TOKEN_KEY = "anupalan.token";
const SERVER_KEY = "anupalan.server";

/**
 * The API host is stored on the device, not compiled in.
 *
 * A release APK is handed to a teammate whose laptop has a different IP, and
 * at a venue it may have to go through a tunnel URL instead. Baking the host
 * into the binary makes changing one string cost a full rebuild that
 * repackages roughly a gigabyte of model, so the compiled value in config.ts is only the
 * default - whatever is saved here wins.
 */
/** How the API was reached last time discovery ran. Null until it has. */
export let transport: Discovered["via"] | null = null;

/**
 * Work out where the API is, and prefer not to ask the user.
 *
 * The saved address is tried first because it is usually still right. If it is
 * dead - cable pulled, laptop moved network, DHCP reshuffled - every transport
 * is probed in parallel and the first that answers wins. The same build then
 * works cabled, on the phone hotspot, or on shared wifi, with nothing typed
 * and nothing rebuilt.
 */
export async function loadServerUrl(): Promise<string> {
  const saved = (await AsyncStorage.getItem(SERVER_KEY))?.trim() || null;

  const found = await discover(saved);
  if (found) {
    api.defaults.baseURL = found.url;
    transport = found.via;
    if (found.url !== saved) await AsyncStorage.setItem(SERVER_KEY, found.url);
    return found.url;
  }

  // Nothing answered. Keep the saved value so the Server field shows what was
  // last tried, rather than resetting to a compiled default that is no better.
  const fallback = saved || API_BASE;
  api.defaults.baseURL = fallback;
  transport = null;
  return fallback;
}

/**
 * Re-run discovery after a request failed for want of a connection.
 *
 * So unplugging the cable mid-demo fails over to the hotspot on the next
 * request instead of stranding the app.
 */
export async function rediscover(): Promise<string | null> {
  const found = await discover(null);
  if (!found) return null;
  api.defaults.baseURL = found.url;
  transport = found.via;
  await AsyncStorage.setItem(SERVER_KEY, found.url);
  return found.url;
}

export async function saveServerUrl(url: string): Promise<string> {
  const clean = url.trim().replace(/\/+$/, "") || API_BASE;
  api.defaults.baseURL = clean;
  await AsyncStorage.setItem(SERVER_KEY, clean);
  return clean;
}

/** Where requests are actually going right now. */
export function currentServerUrl(): string {
  return api.defaults.baseURL ?? API_BASE;
}
let cachedToken: string | null = null;

export async function loadToken() {
  cachedToken = await AsyncStorage.getItem(TOKEN_KEY);
  return cachedToken;
}

export async function saveToken(token: string | null) {
  cachedToken = token;
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

api.interceptors.request.use((config) => {
  if (cachedToken) config.headers.Authorization = `Bearer ${cachedToken}`;
  return config;
});

/**
 * A request that failed for want of a connection gets ONE more try, through a
 * fresh discovery pass.
 *
 * This is what makes the cable optional in practice rather than in theory:
 * pull it mid-demo and the next request finds the hotspot instead of the app
 * simply going dead. `_retried` guards it - without the flag, a laptop that is
 * genuinely off would have every request retrying discovery forever.
 *
 * Only connection failures qualify. A 401 or a 500 means we reached the right
 * server and must not go looking for a different one.
 */
api.interceptors.response.use(
  (r) => r,
  async (error) => {
    const cfg = error?.config as (typeof error.config & { _retried?: boolean }) | undefined;
    const noResponse = !error?.response;
    if (!cfg || cfg._retried || !noResponse) throw error;

    cfg._retried = true;
    const found = await rediscover();
    if (!found) throw error;

    cfg.baseURL = found;
    return api.request(cfg);
  },
);

export interface User {
  id: number;
  username: string;
  full_name: string;
  role: string;
  mine_id: number | null;
}

export interface Duty {
  id: number;
  mine_id: number;
  title: string;
  clause_ref: string;
  act: string;
  owner_role: string;
  frequency: string;
  evidence_type: string;
  due_date: string | null;
  status: string;
  risk_score: number | null;
  evidence_count: number;
}

export async function login(username: string, password: string) {
  const { data } = await api.post<{ access_token: string; user: User }>(
    "/auth/login",
    { username, password },
  );
  await saveToken(data.access_token);
  return data.user;
}

export async function me() {
  const { data } = await api.get<User>("/auth/me");
  return data;
}

export async function fetchDuties() {
  const { data } = await api.get<{ items: Duty[]; total: number }>(
    "/obligations",
    { params: { sort: "risk", limit: 100 } },
  );
  return data;
}

/** Boundary check at the moment of capture. This is how a photo gets its
 *  inside_lease flag — PostGIS ST_Contains, not a guess on the device. */
export async function checkInsideLease(mine_id: number, lat: number, lon: number) {
  const { data } = await api.post<{
    inside_lease: boolean;
    distance_to_boundary_m: number | null;
  }>("/geo/contains", { mine_id, lat, lon });
  return data;
}

export async function ping(): Promise<boolean> {
  try {
    await axios.get(`${currentServerUrl()}/health`, { timeout: 3500 });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- sensors

/**
 * A statutory monitoring point.
 *
 * Regulation names places, not mines: the methane limit applies in the general
 * body of return air of a district. A reading without one of these is not
 * actionable, so the console makes the officer pick before it will send.
 */
export interface SensorPoint {
  key: string;
  label: string;
  sensor_types: string[];
  method: "underground" | "opencast" | "both";
  why: string;
}

export async function fetchSensorPoints(): Promise<SensorPoint[]> {
  const { data } = await api.get<SensorPoint[]>("/sensors/locations");
  return data;
}

export interface FiredAlert {
  id: number;
  severity: string;
  clause_ref: string | null;
  location: string | null;
}

/** Post one reading. Returns any alerts the backend's arithmetic fired. */
export async function pushReading(input: {
  mine_id: number;
  sensor_type: string;
  value: number;
  unit: string;
  location: string;
}): Promise<FiredAlert[]> {
  const { data } = await api.post<{ alerts_fired: FiredAlert[] }>(
    "/sensors/readings",
    {
      readings: [{ ...input, recorded_at: new Date().toISOString() }],
    },
  );
  return data.alerts_fired ?? [];
}

// ------------------------------------------------------------- directives

/** An instruction from the control room that this handset must acknowledge. */
export interface Directive {
  id: number;
  mine_id: number;
  alert_id: number | null;
  severity: string;
  location: string | null;
  location_label: string | null;
  message: string;
  action: string | null;
  created_at: string;
  issued_by_name: string | null;
  acknowledged_at: string | null;
  acknowledged_by_name: string | null;
}

export async function fetchOpenDirectives(): Promise<Directive[]> {
  const { data } = await api.get<Directive[]>("/directives", {
    params: { open_only: true },
  });
  return data;
}

export async function ackDirective(id: number): Promise<Directive> {
  const { data } = await api.post<Directive>(`/directives/${id}/ack`);
  return data;
}
