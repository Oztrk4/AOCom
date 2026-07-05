import path from "node:path";
import type { NextConfig } from "next";

/**
 * Tauri serves the frontend as static files, so Next.js must run in
 * full static-export mode. No Node server exists at runtime.
 */
const nextConfig: NextConfig = {
  output: "export",
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
