"use client";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { isAppInBackground, notify } from "@/lib/tauri";
import { useAppStore } from "@/stores/app-store";
import type { Message } from "@/lib/types";

const PAGE_SIZE = 80;

export function useMessages(channelId: string | null, myUserId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!channelId) return;
    let cancelled = false;
    setLoading(true);
    setMessages([]);

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
          // Teams-style: native OS toast when the app is minimized/unfocused.
          if (msg.user_id !== myUserId && (await isAppInBackground())) {
            const nick =
              useAppStore.getState().profiles[msg.user_id]?.nickname ?? "AOCom";
            notify(
              nick,
              msg.content || (msg.attachment_url ? "📎 Attachment" : "")
            );
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages" },
        (payload) => {
          // DELETE payloads carry only the primary key — enough to drop it.
          const oldId = (payload.old as { id?: number } | null)?.id;
          if (oldId != null)
            setMessages((prev) => prev.filter((m) => m.id !== oldId));
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(sub);
    };
  }, [channelId, myUserId]);

  /** Delete own message (optimistic; RLS restricts to the author anyway). */
  const deleteMessage = useCallback(async (id: number) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
    await supabase.from("messages").delete().eq("id", id);
  }, []);

  const sendMessage = useCallback(
    async (content: string, file?: File) => {
      if (!channelId || !myUserId || (!content.trim() && !file)) return;

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

  return { messages, loading, sendMessage, deleteMessage };
}
