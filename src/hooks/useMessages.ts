"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { isAppInBackground, notify } from "@/lib/tauri";
import { useAppStore } from "@/stores/app-store";
import type { Message } from "@/lib/types";

const PAGE_SIZE = 80;
const TYPING_TTL = 2000; // clear a typing badge 2s after the last keystroke
const TYPING_THROTTLE = 1500; // don't broadcast more than once per 1.5s

export function useMessages(channelId: string | null, myUserId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);

  const chanRef = useRef<RealtimeChannel | null>(null);
  const typingRef = useRef<Map<string, { nickname: string; at: number }>>(new Map());
  const lastTypingSent = useRef(0);

  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    setTypingUsers([]);
    typingRef.current.clear();

    supabase
      .from("messages")
      .select("*")
      .eq("channel_id", channelId)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE)
      .then(({ data }) => {
        if (!cancelled && data) setMessages(data.reverse() as Message[]);
        setLoading(false);
      });

    const sub = supabase
      .channel(`messages:${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `channel_id=eq.${channelId}`,
        },
        async (payload) => {
          const msg = payload.new as Message;
          setMessages((prev) =>
            prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]
          );
          // Sender is no longer "typing" once their message lands.
          typingRef.current.delete(msg.user_id);
          // Native OS toast when the app is minimized/blurred.
          if (msg.user_id !== myUserId && (await isAppInBackground())) {
            const state = useAppStore.getState();
            const nick = state.profiles[msg.user_id]?.nickname ?? "AOCom";
            const channelName =
              state.channels.find((c) => c.id === msg.channel_id)?.name ?? "AOCom";
            const snippet = msg.content
              ? msg.content.slice(0, 120)
              : msg.attachment_url
                ? "📎 Dosya"
                : "";
            notify(`# ${channelName}`, `${nick}: ${snippet}`);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages" },
        (payload) => {
          const oldId = (payload.old as { id?: number } | null)?.id;
          if (oldId != null)
            setMessages((prev) => prev.filter((m) => m.id !== oldId));
        }
      )
      // Ephemeral "is typing" — broadcast only, never touches the DB.
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const { userId, nickname } = payload as { userId: string; nickname: string };
        if (userId === myUserId) return;
        typingRef.current.set(userId, { nickname, at: Date.now() });
      })
      .subscribe();
    chanRef.current = sub;

    // Prune stale typing badges and publish the current set.
    const prune = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, v] of typingRef.current) {
        if (now - v.at > TYPING_TTL) {
          typingRef.current.delete(id);
          changed = true;
        }
      }
      const names = [...typingRef.current.values()].map((v) => v.nickname);
      setTypingUsers((prev) =>
        changed || prev.length !== names.length || prev.some((n, i) => n !== names[i])
          ? names
          : prev
      );
    }, 500);

    return () => {
      cancelled = true;
      clearInterval(prune);
      chanRef.current = null;
      supabase.removeChannel(sub);
    };
  }, [channelId, myUserId]);

  /** Broadcast a throttled "typing" ping (called on keystrokes). */
  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSent.current < TYPING_THROTTLE) return;
    lastTypingSent.current = now;
    const me = useAppStore.getState().profile;
    if (!me || !chanRef.current) return;
    chanRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: { userId: me.id, nickname: me.nickname },
    });
  }, []);

  const deleteMessage = useCallback(async (id: number) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    await supabase.from("messages").delete().eq("id", id);
  }, []);

  const sendMessage = useCallback(
    async (content: string, file?: File) => {
      if (!channelId || !myUserId || (!content.trim() && !file)) return;
      lastTypingSent.current = 0; // allow an immediate typing ping next time

      let attachment_url: string | null = null;
      if (file) {
        const path = `${myUserId}/${Date.now()}_${file.name.replace(/[^\w.\-]/g, "_")}`;
        const { error } = await supabase.storage
          .from("attachments")
          .upload(path, file, { contentType: file.type });
        if (!error) {
          attachment_url = supabase.storage
            .from("attachments")
            .getPublicUrl(path).data.publicUrl;
        }
      }

      await supabase.from("messages").insert({
        channel_id: channelId,
        user_id: myUserId,
        content: content.trim(),
        attachment_url,
      });
    },
    [channelId, myUserId]
  );

  return { messages, loading, typingUsers, notifyTyping, sendMessage, deleteMessage };
}
