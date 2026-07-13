"use client";
import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { emitCallResponse } from "@/lib/tauri";
import { PhoneIcon, PhoneOffIcon } from "@/components/ui/icons";

/**
 * Teams-style incoming-call popup. Rendered inside a small transparent,
 * frameless, always-on-top auxiliary Tauri window in the bottom-right.
 */
function CallPopup() {
  const params = useSearchParams();
  const nick = params.get("nick") ?? "Bilinmeyen";
  const avatar = params.get("avatar") || null;
  const channelId = params.get("channel") ?? "";
  const channelName = params.get("channelName") ?? "ses";

  useEffect(() => {
    document.body.dataset.transparent = "true";
  }, []);

  const respond = async (accepted: boolean) => {
    await emitCallResponse({ accepted, channelId });
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().destroy();
  };

  return (
    <div className="flex h-screen items-center p-2">
      <div className="flex w-full items-center gap-3 rounded-2xl border border-edge bg-bg-1/95 p-3 shadow-2xl backdrop-blur">
        <div className="relative">
          <div className="ripple absolute inset-0 rounded-full" />
          <Avatar nickname={nick} avatarUrl={avatar} size={52} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-text-0">{nick}</p>
          <p className="truncate text-xs text-text-1">
            seni arıyor · {channelName}
          </p>
        </div>
        <button
          onClick={() => respond(true)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-success text-bg-0 transition-transform hover:scale-110"
          aria-label="Kabul et"
        >
          <PhoneIcon />
        </button>
        <button
          onClick={() => respond(false)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-danger text-white transition-transform hover:scale-110"
          aria-label="Reddet"
        >
          <PhoneOffIcon />
        </button>
      </div>
    </div>
  );
}

export default function CallPage() {
  return (
    <Suspense fallback={null}>
      <CallPopup />
    </Suspense>
  );
}
