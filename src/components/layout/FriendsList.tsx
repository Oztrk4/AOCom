"use client";
import { useAppStore } from "@/stores/app-store";
import { Avatar } from "@/components/ui/Avatar";
import { PhoneIcon, SpeakerIcon } from "@/components/ui/icons";

export function FriendsList({
  userId,
  sendRing,
}: {
  userId: string;
  sendRing: (targetId: string, channelId: string, channelName: string) => Promise<void>;
}) {
  const { profiles, onlineIds, statuses, channels } = useAppStore();

  const friends = Object.values(profiles)
    .filter((p) => p.id !== userId)
    .sort((a, b) => {
      const ao = onlineIds.has(a.id) ? 0 : 1;
      const bo = onlineIds.has(b.id) ? 0 : 1;
      return ao - bo || a.nickname.localeCompare(b.nickname);
    });

  const defaultVoice = channels.find((c) => c.type === "voice");

  const ring = (targetId: string) => {
    const state = useAppStore.getState();
    const ch = state.voiceChannel ?? defaultVoice;
    if (ch) void sendRing(targetId, ch.id, ch.name);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center border-b border-edge px-4">
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-text-1">
          Friends — {friends.filter((f) => onlineIds.has(f.id)).length} online
        </h3>
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {friends.map((f) => {
          const online = onlineIds.has(f.id);
          const inVoice = statuses[f.id]?.current_voice_channel;
          const voiceName = channels.find((c) => c.id === inVoice)?.name;
          return (
            <li
              key={f.id}
              className="group flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-bg-2"
            >
              <div className="relative">
                <Avatar
                  nickname={f.nickname}
                  avatarUrl={f.avatar_url}
                  size={34}
                  className={online ? "" : "opacity-40 grayscale"}
                />
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg-1 ${
                    online ? "bg-success" : "bg-text-1/40"
                  }`}
                />
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate text-sm font-medium ${
                    online ? "text-text-0" : "text-text-1"
                  }`}
                >
                  {f.nickname}
                </p>
                <p className="flex items-center gap-1 truncate text-[11px] text-text-1">
                  {voiceName ? (
                    <>
                      <SpeakerIcon width={10} height={10} className="text-accent" />
                      <span className="text-accent">{voiceName}</span>
                    </>
                  ) : online ? (
                    "Online"
                  ) : (
                    "Offline"
                  )}
                </p>
              </div>
              {online && (
                <button
                  onClick={() => ring(f.id)}
                  className="hidden rounded-full bg-accent-soft p-2 text-accent transition-transform hover:scale-110 group-hover:block"
                  aria-label={`Call ${f.nickname}`}
                  title="Invite to voice"
                >
                  <PhoneIcon width={14} height={14} />
                </button>
              )}
            </li>
          );
        })}
        {friends.length === 0 && (
          <p className="p-4 text-center text-xs text-text-1">
            No squad members yet. Tell them to register!
          </p>
        )}
      </ul>
    </div>
  );
}
