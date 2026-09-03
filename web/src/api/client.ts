import axios from "axios";

export const API_BASE =
  import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

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
 * Open a server-rendered HTML report in a new tab.
 *
 * A plain <a href> cannot be used: these endpoints require a bearer token and
 * the browser sends none on a top-level navigation, so the tab would show a
 * 401. Fetch it through this client, which does attach the token, and hand the
 * new tab a blob URL instead.
 */
export async function openReport(path: string): Promise<void> {
  const res = await api.get(path, { responseType: "blob" });
  const url = URL.createObjectURL(res.data as Blob);
  window.open(url, "_blank", "noopener");
  // The new tab has already loaded the blob by the time this fires; revoking
  // sooner would race it, and never revoking leaks the document.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
