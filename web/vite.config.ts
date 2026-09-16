import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * One proxy definition, used by both the dev server and the preview server.
 *
 * The dashboard calls a relative "/api" (see src/api/client.ts) so it never
 * names a host, which is what lets it work from a phone, a teammate's laptop
 * or a tunnel. That only holds if whatever is serving the page also forwards
 * /api - so both servers need this, and duplicating it is how they drift.
 */
const API_PROXY = {
  "/api": {
    // 127.0.0.1, never "localhost". localhost resolves AAAA ::1 before A
    // 127.0.0.1 on this machine, and uvicorn binds 0.0.0.0 - IPv4 only - so
    // the proxy opens a connection to ::1:8000 that nothing answers and waits
    // for the OS timeout before retrying on IPv4. Measured: the first /api
    // call after a restart took 21 SECONDS and returned nothing; every call
    // after it took 5 ms, because the failure is cached. A 21-second hang on
    // the first sign-in of a demo is the whole cost of one word.
    //
    // The same trap already cost this project once - see the note above the
    // health check in start-demo.ps1.
    target: "http://127.0.0.1:8000",
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/api/, ""),
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Listen on every interface, not just loopback.
    //
    // Without this the dashboard is reachable only from the laptop running it.
    // At a venue the useful topology is the PHONE hosting a hotspot with the
    // laptop joined to it - the router at a college or conference almost
    // always isolates wireless clients from one another, which was measured
    // here: from the handset, ports 8000, 5173 and 445 on the laptop were all
    // closed and ICMP was 100% loss, while the laptop reached its own LAN
    // address fine. Nothing in the app can route around that; a different
    // network is the only fix.
    //
    // This is a demo dev server on a private hotspot. Do not expose it on an
    // untrusted network - it proxies straight to the API with no auth of its
    // own.
    host: true,
    // Vite refuses requests whose Host header it does not recognise, which is
    // an anti-DNS-rebinding guard, not a bug. A Cloudflare quick tunnel serves
    // the dashboard on a random *.trycloudflare.com name, so that suffix has
    // to be allowed or every request comes back 403 "Blocked request".
    // Scoped to the tunnel domain rather than `true`, which would accept any
    // Host header at all.
    allowedHosts: [".trycloudflare.com"],
    proxy: API_PROXY,
  },
  // What the tunnel serves. `npm run build && npm run preview`.
  //
  // The dev server above is for THIS laptop. Do not put it behind a tunnel:
  // it serves every dependency unbundled, about 9 MB of JavaScript in ~80
  // requests, and the largest of those - react-leaflet, recharts, lucide-react
  // at 4-5 MB each - get cancelled mid-transfer over a free quick tunnel.
  // cloudflared logs them as `stream canceled by remote`. One module that
  // never arrives means React never mounts, so a remote viewer sees a blank
  // page with NO error in the console, which is about the least debuggable
  // failure this stack can produce.
  //
  // The production build is code-split, minified and gzipped, and it is what
  // a teammate on another laptop should be pointed at.
  preview: {
    port: 4173,
    host: true,
    allowedHosts: [".trycloudflare.com"],
    // Same proxy as the dev server: the built app still calls /api, so the
    // thing serving it still has to forward /api. Without this the preview
    // server 404s every API call and sign-in fails exactly the way it did
    // when the client named localhost:8000 directly.
    proxy: API_PROXY,
  },
});
