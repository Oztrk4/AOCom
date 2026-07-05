"use client";
import { useEffect, useRef } from "react";
import { isTauri } from "@/lib/tauri";
import { useAppStore } from "@/stores/app-store";
import {
  PTT_HANG_MS,
  codeToAccelerator,
  isMouseKey,
  mouseKeyToButton,
} from "@/lib/keybinds";

/**
 * Push-to-talk engine.
 *
 * Keyboard keys register through Tauri's global-shortcut plugin, whose
 * handler reports Pressed AND Released states — so hold-to-talk works at
 * the OS level while a fullscreen game has focus or AOCom is minimized.
 * Mouse4/Mouse5 can't be OS-registered (RegisterHotKey is keyboard-only),
 * so they fall back to window-level listeners (app-focused only).
 *
 * Release applies a PTT_HANG_MS (100ms) hang time so trailing words are
 * never clipped. `pttActive` drives the actual track gating in Dashboard
 * via isMicLive() — when the key is up, the outgoing track is hard-
 * disabled: zero audio packets, dead-silent peripherals.
 */
export function usePushToTalk() {
  const inputMode = useAppStore((s) => s.inputMode);
  const pttKey = useAppStore((s) => s.pttKey);
  const hangRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const setPttActive = useAppStore.getState().setPttActive;
    if (inputMode !== "ptt" || !pttKey) {
      setPttActive(false);
      return;
    }

    let disposed = false;
    let cleanupLocal = () => {};
    let globalRegistered = false;

    const down = () => {
      if (hangRef.current) clearTimeout(hangRef.current);
      hangRef.current = null;
      setPttActive(true);
    };
    const up = () => {
      if (hangRef.current) clearTimeout(hangRef.current);
      hangRef.current = setTimeout(() => setPttActive(false), PTT_HANG_MS);
    };

    const attachLocalListeners = () => {
      if (isMouseKey(pttKey)) {
        const btn = mouseKeyToButton(pttKey);
        const md = (e: MouseEvent) => {
          if (e.button === btn) {
            e.preventDefault();
            down();
          }
        };
        const mu = (e: MouseEvent) => {
          if (e.button === btn) up();
        };
        window.addEventListener("mousedown", md, true);
        window.addEventListener("mouseup", mu, true);
        cleanupLocal = () => {
          window.removeEventListener("mousedown", md, true);
          window.removeEventListener("mouseup", mu, true);
        };
      } else {
        const kd = (e: KeyboardEvent) => {
          if (!e.repeat && codeToAccelerator(e.code) === pttKey) down();
        };
        const ku = (e: KeyboardEvent) => {
          if (codeToAccelerator(e.code) === pttKey) up();
        };
        window.addEventListener("keydown", kd, true);
        window.addEventListener("keyup", ku, true);
        cleanupLocal = () => {
          window.removeEventListener("keydown", kd, true);
          window.removeEventListener("keyup", ku, true);
        };
      }
    };

    if (!isMouseKey(pttKey) && isTauri()) {
      void (async () => {
        try {
          const { register, unregister } = await import(
            "@tauri-apps/plugin-global-shortcut"
          );
          await unregister(pttKey).catch(() => {});
          if (disposed) return;
          await register(pttKey, (event) => {
            if (event.state === "Pressed") down();
            else if (event.state === "Released") up();
          });
          globalRegistered = true;
        } catch (err) {
          console.warn("global PTT key unavailable, using in-app listener", err);
          if (!disposed) attachLocalListeners();
        }
      })();
    } else {
      attachLocalListeners();
    }

    return () => {
      disposed = true;
      cleanupLocal();
      if (hangRef.current) clearTimeout(hangRef.current);
      hangRef.current = null;
      setPttActive(false);
      if (globalRegistered) {
        void import("@tauri-apps/plugin-global-shortcut").then(
          ({ unregister }) => void unregister(pttKey).catch(() => {})
        );
      }
    };
  }, [inputMode, pttKey]);
}
