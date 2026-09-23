import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import type { Plugin } from "vite";

// Icons are the only remote content the renderer loads; everything else comes
// over IPC. 'unsafe-inline' stays in style-src because React writes inline
// style attributes (progress bars, stat widths) — never in script-src.
//
// 'self' is paired with file: throughout: the production renderer is loaded
// from disk via loadFile, and a file:// document's origin is opaque, so 'self'
// alone is not reliably a match for its own sibling bundles.
const BASE_CSP = [
  "default-src 'none'",
  "style-src 'self' file: 'unsafe-inline'",
  "img-src 'self' file: data: https://raw.communitydragon.org",
  "font-src 'self' file: data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  // No frame-ancestors: it is only honoured in an HTTP header and warns when
  // delivered via <meta>. Nothing is lost — it restricts who may embed this
  // page, and a top-level window loaded from disk has no embedder. Framing in
  // the other direction is already denied by default-src 'none'.
];

const PROD_CSP = [...BASE_CSP, "script-src 'self' file:", "connect-src 'self'"].join("; ");

// Vite's dev server injects an inline preamble for React Refresh and talks to
// the renderer over a websocket. Dev only — the packaged app gets PROD_CSP.
const DEV_CSP = [
  ...BASE_CSP,
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*",
].join("; ");

function cspPlugin(policy: string, apply: "serve" | "build"): Plugin {
  return {
    name: "inject-csp",
    apply,
    transformIndexHtml: {
      order: "pre",
      handler: (html) =>
        html.replace(
          "<head>",
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
        ),
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ["better-sqlite3"],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: resolve("src/renderer"),
    build: {
      rollupOptions: {
        input: resolve("src/renderer/index.html"),
      },
    },
    plugins: [react(), tailwindcss(), cspPlugin(DEV_CSP, "serve"), cspPlugin(PROD_CSP, "build")],
  },
});
