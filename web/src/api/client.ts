import axios from "axios";

/**
 * Relative by default, so the dashboard talks to the API through the dev
 * server's /api proxy (see vite.config.ts) rather than naming a host.
 *
 * It used to default to the absolute "http://localhost:8000". That works only
 * when the browser IS the machine running the API. Opened from anyone else -
 * a teammate on the LAN, a phone, or a Cloudflare tunnel - "localhost" means
 * THEIR machine, which has no API, and every request fails at sign-in with
 * "Cannot reach the API at http://localhost:8000". The proxy existed for
 * precisely this case; the client simply was not using it.
 *
 * VITE_API_BASE still overrides, for pointing a build at a deployed API.
 */
export const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

export const api = axios.create({ baseURL: API_BASE });

const TOKEN_KEY = "anupalan.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private window — session-only is fine */
  }
}

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error?.response?.status === 401) {
      setToken(null);
      if (!location.pathname.startsWith("/login")) location.href = "/login";
    }
    return Promise.reject(error);
  },
);

/**
 * Open a server-rendered HTML report.
 *
 * A plain <a href> cannot be used: these endpoints require a bearer token and
 * the browser sends none on a top-level navigation, so the tab would show a
 * 401. The viewer fetches it through this client, which attaches the token.
 */
export const REPORT_EVENT = "anupalan:report";

export async function openReport(path: string): Promise<void> {
  // Shown in an in-page viewer (lib/ReportViewer), which listens for this
  // event. A new tab opened after the authenticated fetch was silently
  // dropped by popup blockers, which made every report button look dead.
  window.dispatchEvent(new CustomEvent<string>(REPORT_EVENT, { detail: path }));
}

/**
 * The API's own sentence, when it sent one. Axios' default message never is:
 * "Request failed with status code 409" tells an officer nothing, while the
 * API's "a signed return already exists for this period" tells them what to do.
 */
export function apiError(e: unknown): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((d) => (d as { msg?: string }).msg ?? JSON.stringify(d)).join("; ");
  return e instanceof Error ? e.message : String(e);
}
