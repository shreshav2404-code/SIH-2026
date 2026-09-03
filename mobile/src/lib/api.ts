import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";

import { API_BASE } from "./config";

export const api = axios.create({ baseURL: API_BASE, timeout: 15000 });

const TOKEN_KEY = "anupalan.token";
const SERVER_KEY = "anupalan.server";

/**
 * The API host is stored on the device, not compiled in.
 *
 * A release APK is handed to a teammate whose laptop has a different IP, and
 * at a venue it may have to go through a tunnel URL instead. Baking the host
 * into the binary makes changing one string cost a full rebuild that
 * repackages 3.66 GB of model, so the compiled value in config.ts is only the
 * default - whatever is saved here wins.
 */
export async function loadServerUrl(): Promise<string> {
  const saved = await AsyncStorage.getItem(SERVER_KEY);
  const url = saved?.trim() || API_BASE;
  api.defaults.baseURL = url;
  return url;
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
