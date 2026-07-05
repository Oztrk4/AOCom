"use client";

export function Avatar({
  nickname,
  avatarUrl,
  size = 36,
  className = "",
}: {
  nickname: string;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size, fontSize: size * 0.42 };
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={nickname}
        style={style}
        className={`shrink-0 rounded-full object-cover ${className}`}
        draggable={false}
      />
    );
  }
  return (
    <div
      style={{
        ...style,
        background: "linear-gradient(135deg, var(--accent), var(--accent-2))",
      }}
      className={`flex shrink-0 items-center justify-center rounded-full font-bold text-bg-0 ${className}`}
    >
      {nickname.slice(0, 1).toUpperCase()}
    </div>
  );
}
