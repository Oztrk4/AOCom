"use client";
import { useCallback, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import {
  closeCallPopup,
  isAppInBackground,
  focusMainWindow,
  onCallResponse,
  openCallPopup,
} from "@/lib/tauri";
import { startIncomingRing, startOutgoingRing } from "@/lib/sounds";
import { useAppStore } from "@/stores/app-store";
import type { RingPayload } from "@/lib/types";

const RING_TIMEOUT_MS = 30_000;

/** Fire one broadcast event at a user's personal ring channel. */
async function broadcastTo(targetUserId: string, event: string, payload: unknown) {
  const ch = supabase.channel(`ring:${targetUserId}`, {
    config: { private: true },
  });
  await new Promise<void>((resolve) => {
    ch.subscribe((status) => status === "SUBSCRIBED" && resolve());
  });
  await ch.send({ type: "broadcast", event, payload });
  // Keep the channel briefly so the message flushes, then clean up.
  setTimeout(() => void supabase.removeChannel(ch), 1500);
}

/**
 * Direct-call state machine with Discord-style chimes.
 *
 * Caller:  sendRing → joins the room, loops the outgoing ringback until
 *          the callee accepts/declines or 30s elapse.
 * Callee:  incoming ring loops (banner in-app, popup when minimized)
 *          until accept / decline / timeout, then responds to the caller
 *          so their ringback stops instantly too.
 */
export function useRing(
  userId: string | null,
  acceptCall: (channelId: string) => void
) {
  const setIncomingRing = useAppStore((s) => s.setIncomingRing);

  const incomingStopRef = useRef<(() => void) | null>(null);
  const incomingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outgoingStopRef = useRef<(() => void) | null>(null);
  const outgoingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopIncomingRing = useCallback(() => {
    incomingStopRef.current?.();
    incomingStopRef.current = null;
    if (incomingTimerRef.current) clearTimeout(incomingTimerRef.current);
    incomingTimerRef.current = null;
  }, []);

  const stopOutgoingRing = useCallback(() => {
    outgoingStopRef.current?.();
    outgoingStopRef.current = null;
    if (outgoingTimerRef.current) clearTimeout(outgoingTimerRef.current);
    outgoingTimerRef.current = null;
  }, []);

  /** Callee answers (or dismisses) the active incoming ring. */
  const respondToRing = useCallback(
    async (accepted: boolean) => {
      const ring = useAppStore.getState().incomingRing;
      stopIncomingRing();
      setIncomingRing(null);
      await closeCallPopup();
      if (!ring) return;
      await broadcastTo(ring.from, accepted ? "ring-accept" : "ring-decline", {
        from: userId,
      });
      if (accepted) {
        await focusMainWindow();
        acceptCall(ring.channelId);
      }
    },
    [userId, acceptCall, stopIncomingRing, setIncomingRing]
  );

  useEffect(() => {
    if (!userId) return;

    const ringChannel = supabase
      .channel(`ring:${userId}`, { config: { private: true } })
      .on("broadcast", { event: "ring" }, async ({ payload }) => {
        const ring = payload as RingPayload;
        setIncomingRing(ring);
        stopIncomingRing();
        incomingStopRef.current = startIncomingRing();
        // Unanswered call times out silently.
        incomingTimerRef.current = setTimeout(async () => {
          stopIncomingRing();
          setIncomingRing(null);
          await closeCallPopup();
        }, RING_TIMEOUT_MS);
        if (await isAppInBackground()) {
          await openCallPopup(ring);
        }
      })
      .on("broadcast", { event: "ring-cancel" }, async () => {
        stopIncomingRing();
        setIncomingRing(null);
        await closeCallPopup();
      })
      // Callee answered somewhere — kill the caller's ringback instantly.
      .on("broadcast", { event: "ring-accept" }, () => stopOutgoingRing())
      .on("broadcast", { event: "ring-decline" }, () => stopOutgoingRing())
      .subscribe();

    // The Teams-style popup window replies via a Tauri cross-window event.
    let unlisten: (() => void) | undefined;
    onCallResponse((res) => void respondToRing(res.accepted)).then(
      (fn) => (unlisten = fn)
    );

    return () => {
      supabase.removeChannel(ringChannel);
      unlisten?.();
      stopIncomingRing();
      stopOutgoingRing();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  /** Ring a friend into a voice channel; caller hops in while it rings. */
  const sendRing = useCallback(
    async (targetUserId: string, channelId: string, channelName: string) => {
      const me = useAppStore.getState().profile;
      if (!me) return;

      // Caller joins the room immediately so the callee lands with them.
      acceptCall(channelId);

      stopOutgoingRing();
      outgoingStopRef.current = startOutgoingRing();
      outgoingTimerRef.current = setTimeout(stopOutgoingRing, RING_TIMEOUT_MS);

      await broadcastTo(targetUserId, "ring", {
        from: me.id,
        fromNick: me.nickname,
        avatarUrl: me.avatar_url,
        channelId,
        channelName,
      } satisfies RingPayload);
    },
    [acceptCall, stopOutgoingRing]
  );

  return { sendRing, respondToRing };
}
