import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
    proxy: {
      // Dashboard talks to the API through the dev server, so there is no CORS
      // surprise when a phone or a tunnel is in play.
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
