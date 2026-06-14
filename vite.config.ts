import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // `sharedcorelib` is consumed via a `file:../` symlink and declares React (and
    // the other context-singleton libs) as peerDependencies — but it ALSO carries
    // its own copies in devDependencies for its own build/test. When Rolldown bundles
    // myFinance and follows imports into the symlinked sharedCoreLib source, a bare
    // `import ... from "react"` there would otherwise resolve to sharedCoreLib's OWN
    // node_modules copy, producing a SECOND React instance in the bundle. Two React
    // instances share no internals, so the cross-module React binding resolves to
    // null at render time → `Cannot read properties of null (reading 'useCallback')`
    // → the whole tree fails to mount → white screen (production-only; the dev server
    // pre-bundles/dedupes so it never surfaced in `npm run dev`). Force every shared
    // singleton to myFinance's single copy. Order with React first.
    dedupe: ["react", "react-dom", "scheduler", "react-router", "react-router-dom"],
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // WebView2 on Windows is Chromium; everything else (iOS/macOS WKWebView,
    // Android Chromium WebView, Linux WebKitGTK) is covered by the Safari floor.
    // Must be >= safari15: esbuild refuses to *emit* down-leveled destructuring
    // for safari13/14 (a transpiler limitation, not a runtime one — the prebuilt
    // @tauri-apps/plugin-http uses for-of destructuring), so the older target
    // hard-fails the build. safari15-level output still runs on older WebViews.
    target:
      process.env.TAURI_ENV_PLATFORM === "windows"
        ? "chrome105"
        : "safari15",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return;
          if (
            /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(
              id,
            )
          ) {
            return "vendor-react";
          }
          if (
            /[\\/]node_modules[\\/](recharts|d3-[^\\/]+|lodash|decimal\.js-light)[\\/]/.test(
              id,
            )
          ) {
            return "vendor-charts";
          }
          if (/[\\/]node_modules[\\/]xlsx[\\/]/.test(id) || id.includes("xlsx-0.20.3")) {
            return "vendor-xlsx";
          }
          if (
            /[\\/]node_modules[\\/](@radix-ui|@floating-ui)[\\/]/.test(id)
          ) {
            return "vendor-radix";
          }
          return "vendor";
        },
      },
    },
  },
});
