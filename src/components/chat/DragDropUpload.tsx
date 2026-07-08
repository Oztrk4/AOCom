"use client";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/app-store";
import { nativeDialog } from "@/lib/tauri";

/**
 * App-wide drag & drop upload. A file dragged anywhere over the window
 * shows a full-screen overlay; dropping it uploads to the Supabase
 * `attachments` bucket under the user's own folder (`<uid>/…`, satisfying
 * the M4 storage RLS) and posts the public URL as a message in the active
 * text channel.
 *
 * Requires `dragDropEnabled: false` on the Tauri window so the webview
 * doesn't swallow HTML5 drop events at the OS layer.
 */
export function DragDropUpload({ userId }: { userId: string }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const depth = useRef(0);

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const state = useAppStore.getState();
    // Chat ban also blocks file drops (the message insert is refused
    // server-side anyway — surface it cleanly instead of a silent fail).
    if (state.profile?.has_chat_ban) {
      await nativeDialog(
        "Sohbet banı",
        "Sohbet banı sebebiyle şu an mesaj gönderemezsiniz.",
        "warning"
      );
      return;
    }
    const channel = state.activeTextChannel;
    if (!channel) {
      await nativeDialog(
        "Kanal seçili değil",
        "Dosya yüklemek için önce bir metin kanalı seç.",
        "warning"
      );
      return;
    }

    setUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const safeName = file.name.replace(/[^\w.\-]/g, "_");
        // Same own-folder scheme as chat uploads → passes storage RLS.
        const path = `${userId}/${Date.now()}_${i}_${safeName}`;
        const { error: upErr } = await supabase.storage
          .from("attachments")
          .upload(path, file, { contentType: file.type || undefined });
        if (upErr) {
          await nativeDialog(
            "Yükleme başarısız",
            `“${file.name}” yüklenemedi. Dosya türü desteklenmiyor olabilir.`,
            "error"
          );
          continue;
        }
        const url = supabase.storage.from("attachments").getPublicUrl(path)
          .data.publicUrl;
        await supabase.from("messages").insert({
          channel_id: channel.id,
          user_id: userId,
          content: "",
          attachment_url: url,
        });
      }
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault(); // required to allow the drop
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current -= 1;
      if (depth.current <= 0) {
        depth.current = 0;
        setDragging(false);
      }
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length) void handleFiles(files);
    };

    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!dragging && !uploading) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[70] flex items-center justify-center bg-bg-0/85 p-6 backdrop-blur-sm">
      <div className="flex h-full w-full flex-col items-center justify-center rounded-3xl border-2 border-dashed border-accent/70">
        {uploading ? (
          <>
            <div className="mb-4 h-10 w-10 animate-spin rounded-full border-2 border-edge border-t-accent" />
            <p className="text-lg font-bold text-text-0">Yükleniyor…</p>
          </>
        ) : (
          <>
            <div className="mb-3 text-5xl">📎</div>
            <p className="text-2xl font-black tracking-tight text-text-0">
              Yüklemek için dosyayı buraya bırakın
            </p>
            <p className="mt-2 text-sm text-text-1">
              Dosya aktif metin kanalına gönderilecek
            </p>
          </>
        )}
      </div>
    </div>
  );
}
