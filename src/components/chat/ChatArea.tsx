"use client";
import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { useMessages } from "@/hooks/useMessages";
import { Avatar } from "@/components/ui/Avatar";
import { renderMarkdown } from "@/lib/markdown";
import { openExternal } from "@/lib/tauri";
import { LinkPreview } from "./LinkPreview";
import { EmojiPicker } from "./EmojiPicker";
import {
  HashIcon,
  PaperclipIcon,
  SendIcon,
  TrashIcon,
  XIcon,
} from "@/components/ui/icons";
import type { Message } from "@/lib/types";

const URL_RE = /(https?:\/\/[^\s<>"')\]]+)/;
const IMG_RE = /\.(png|jpe?g|gif|webp|avif)(\?.*)?$/i;

function firstUrl(text: string): string | null {
  return text.match(URL_RE)?.[0] ?? null;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ChatArea({
  userId,
  isAdmin = false,
}: {
  userId: string;
  isAdmin?: boolean;
}) {
  const activeTextChannel = useAppStore((s) => s.activeTextChannel);
  const profiles = useAppStore((s) => s.profiles);
  const chatBanned = useAppStore((s) => s.profile?.has_chat_ban ?? false);
  const { messages, loading, typingUsers, notifyTyping, sendMessage, deleteMessage } =
    useMessages(activeTextChannel?.id ?? null, userId);

  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);

  /** Inject the emoji at the current text cursor, keep the caret after it. */
  const insertEmoji = (emoji: string) => {
    const el = textInputRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? start;
    setDraft(draft.slice(0, start) + emoji + draft.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [messages.length, activeTextChannel?.id]);

  const submit = async () => {
    if (chatBanned || sending || (!draft.trim() && !file)) return;
    setSending(true);
    await sendMessage(draft, file ?? undefined);
    setDraft("");
    setFile(null);
    setSending(false);
  };

  const isGrouped = (m: Message, i: number) => {
    if (i === 0) return false;
    const prev = messages[i - 1];
    return (
      prev.user_id === m.user_id &&
      new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() <
        5 * 60_000
    );
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-bg-0">
      {/* Channel header */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-4">
        <HashIcon width={16} height={16} className="text-text-1" />
        <span className="text-sm font-bold">{activeTextChannel?.name ?? "…"}</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading && (
          <p className="py-8 text-center text-xs text-text-1">Yükleniyor…</p>
        )}
        {!loading && messages.length === 0 && (
          <p className="py-8 text-center text-xs text-text-1">
            #{activeTextChannel?.name} kanalının başlangıcı. Efsanevi bir şeyler yaz.
          </p>
        )}
        {messages.map((m, i) => {
          const author = profiles[m.user_id];
          const grouped = isGrouped(m, i);
          const url = firstUrl(m.content);
          return (
            <div
              key={m.id}
              className={`group flex gap-3 rounded px-2 hover:bg-bg-1/60 ${
                grouped ? "py-0.5" : "mt-3 py-1"
              }`}
            >
              <div className="w-9 shrink-0">
                {!grouped && (
                  <Avatar
                    nickname={author?.nickname ?? "?"}
                    avatarUrl={author?.avatar_url}
                    size={36}
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                {!grouped && (
                  <p className="flex items-baseline gap-2">
                    <span className="text-sm font-bold text-accent">
                      {author?.nickname ?? "Bilinmeyen"}
                    </span>
                    <span className="text-[10px] text-text-1">
                      {fmtTime(m.created_at)}
                    </span>
                  </p>
                )}
                {m.content && (
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text-0/90 select-text">
                    {renderMarkdown(m.content)}
                  </p>
                )}
                {m.attachment_url &&
                  (IMG_RE.test(m.attachment_url) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.attachment_url}
                      alt="ek"
                      className="mt-1.5 max-h-72 max-w-sm rounded-lg border border-edge object-contain"
                      draggable={false}
                    />
                  ) : (
                    <button
                      onClick={() => openExternal(m.attachment_url!)}
                      className="mt-1.5 inline-flex items-center gap-2 rounded-lg border border-edge bg-bg-2 px-3 py-2 text-xs text-accent transition-colors hover:border-accent"
                      title="Aç / indir"
                    >
                      <PaperclipIcon width={13} height={13} />
                      {decodeURIComponent(
                        m.attachment_url.split("/").pop() ?? "file"
                      ).replace(/^\d+_\d*_?/, "")}
                    </button>
                  ))}
                {url && <LinkPreview url={url} />}
              </div>
              {/* Author can delete own; admin can delete ANY message. */}
              {(m.user_id === userId || isAdmin) && (
                <button
                  onClick={() => deleteMessage(m.id)}
                  className="mt-0.5 h-fit shrink-0 rounded p-1 text-text-1 opacity-0 transition-opacity hover:bg-danger/15 hover:text-danger group-hover:opacity-100"
                  aria-label="Sil"
                  title={m.user_id === userId ? "Sil" : "Sil (admin)"}
                >
                  <TrashIcon width={13} height={13} />
                </button>
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="shrink-0 px-4 pb-4">
        {/* Ephemeral "is typing" indicator */}
        <div className="h-4 px-1 text-[11px] italic text-text-1">
          {typingUsers.length > 0 &&
            (typingUsers.length === 1
              ? `${typingUsers[0]} yazıyor…`
              : typingUsers.length === 2
                ? `${typingUsers[0]} ve ${typingUsers[1]} yazıyor…`
                : `${typingUsers.length} kişi yazıyor…`)}
        </div>
        {file && (
          <div className="mb-1 flex items-center gap-2 rounded-t-lg border border-b-0 border-edge bg-bg-2 px-3 py-2 text-xs text-text-1">
            <PaperclipIcon width={12} height={12} />
            <span className="truncate">{file.name}</span>
            <button
              onClick={() => setFile(null)}
              className="ml-auto text-text-1 hover:text-danger"
              aria-label="Eki kaldır"
            >
              <XIcon width={12} height={12} />
            </button>
          </div>
        )}
        <div
          className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 ${
            chatBanned
              ? "border-danger/40 bg-bg-2/60"
              : "border-edge bg-bg-2 focus-within:border-accent"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={chatBanned}
            className="rounded p-1.5 text-text-1 transition-colors hover:text-accent disabled:opacity-40 disabled:hover:text-text-1"
            aria-label="Dosya ekle"
          >
            <PaperclipIcon />
          </button>
          <input
            ref={textInputRef}
            value={chatBanned ? "" : draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (!chatBanned && e.target.value) notifyTyping();
            }}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && submit()}
            disabled={chatBanned}
            placeholder={
              chatBanned
                ? "Sohbet banı sebebiyle şu an mesaj gönderemezsiniz."
                : `#${activeTextChannel?.name ?? ""} kanalına yaz…`
            }
            className={`flex-1 bg-transparent py-1.5 text-sm outline-none placeholder-text-1 select-text ${
              chatBanned ? "cursor-not-allowed placeholder-danger/70" : ""
            }`}
            maxLength={2000}
          />
          {!chatBanned && <EmojiPicker onPick={insertEmoji} />}
          <button
            onClick={submit}
            disabled={chatBanned || sending || (!draft.trim() && !file)}
            className="rounded p-1.5 text-accent transition-opacity disabled:opacity-30"
            aria-label="Gönder"
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </main>
  );
}
