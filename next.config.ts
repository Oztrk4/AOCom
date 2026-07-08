import path from "node:path";
import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

// Read the app version from package.json at build time so the UI can show
// it without any runtime file access (the static export has no Node).
const { version } = JSON.parse(
  readFileSync(path.join(__dirname, "package.json"), "utf8")
) as { version: string };

/**
 * Tauri serves the frontend as static files, so Next.js must run in
 * full static-export mode. No Node server exists at runtime.
 */
const nextConfig: NextConfig = {
  output: "export",
  env: { NEXT_PUBLIC_APP_VERSION: version },
  // Emit routes as folder/index.html so Tauri's static protocol
  // resolves "/call/" correctly in production bundles.
  trailingSlash: true,
  outputFileTracingRoot: path.join(__dirname),
  images: { unoptimized: true },
  devIndicators: false,
  // Tauri's dev server proxies localhost:3000; keep asset paths relative.
  assetPrefix: process.env.NODE_ENV === "production" ? undefined : undefined,
};

export default nextConfig;
