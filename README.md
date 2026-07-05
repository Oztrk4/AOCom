# AOCom

Lightweight desktop voice / video / text app for the squad.
**Tauri v2 + Next.js (static export) + Tailwind v4 + Supabase (free tier) + pure P2P WebRTC.**
Zero server costs: Supabase free tier handles auth/chat/signaling, media flows peer-to-peer.

## 1. Prerequisites (Windows)

```powershell
# Rust toolchain (MSVC)
winget install --id Rustlang.Rustup -e
rustup default stable-msvc

# Node.js 20+ (skip if installed)
winget install --id OpenJS.NodeJS.LTS -e

# Visual Studio C++ Build Tools (required by Tauri)
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

WebView2 is preinstalled on Windows 11. macOS builds need Xcode CLT (`xcode-select --install`).

## 2. Supabase setup (one-time, ~3 minutes)

1. Create a free project at https://supabase.com/dashboard.
2. **SQL Editor** → paste the whole of `supabase/schema.sql` → Run.
3. **Authentication → Providers → Email**: turn **off** "Confirm email"
   (it's a private friend group — instant logins).
4. **Project Settings → API**: copy the URL and `anon` key.

```powershell
cd aocom
copy .env.example .env.local   # then paste your URL + anon key into it
```

## 3. Install & run

```powershell
npm install
npm run icon        # generates placeholder icons (swap app-icon.png later)
npm run tauri dev   # launches the native dev app
```

## 4. Ship the .exe / .dmg

```powershell
npm run tauri build
# → src-tauri/target/release/bundle/nsis/AOCom_0.1.0_x64-setup.exe  (Windows)
# → src-tauri/target/release/bundle/dmg/AOCom_0.1.0_x64.dmg         (on macOS)
```

Send the installer to the squad — everyone points at the same Supabase project via the baked-in `.env.local`, registers, and appears in the friends list.

## Global keybinds (work inside fullscreen games)

| Shortcut | Action |
| --- | --- |
| `Ctrl+Shift+M` | Toggle mute |
| `Ctrl+Shift+D` | Toggle deafen |

## Architecture notes

- **Media is 100% P2P** (full mesh, STUN only). Perfect for a friend group up
  to ~6-8 people in one voice room; upload scales O(n) per participant.
- **Signaling** (SDP/ICE) rides Supabase Realtime broadcast — tiny messages,
  comfortably inside the free tier.
- **Caveat:** with no TURN relay, two peers who are *both* behind symmetric
  NAT / strict CGNAT can fail to connect. Rare on home fiber; if it bites,
  add any free-tier TURN (e.g. Cloudflare Calls) to `RTC_CONFIG` in
  `src/hooks/useWebRTC.ts`.
- **Sessions** persist via `tauri-plugin-store` → auto-login on launch.
- **Themes**: `data-theme` attribute + CSS variables; live-switchable in
  Settings (Midnight / Cyberpunk / Vampire / Emerald).
- **Incoming calls**: transparent always-on-top popup window (`/call` route)
  spawned bottom-right when the app is minimized; in-app banner otherwise.
