/**
 * App version, injected from package.json at build time via next.config.ts
 * (NEXT_PUBLIC_APP_VERSION). Falls back gracefully if unset.
 */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
