#[cfg(windows)]
mod media_permissions {
    use std::collections::HashSet;
    use std::sync::{LazyLock, Mutex};

    /// Webview labels that already have the auto-allow handler attached,
    /// so an in-app reload doesn't stack duplicate handlers.
    pub static HOOKED: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));

    /// The app is served from these hosts (Tauri custom protocol in prod,
    /// the Next dev server in `tauri dev`). Mic/camera are auto-decided
    /// only for these origins.
    fn is_own_origin(uri: &str) -> bool {
        match url::Url::parse(uri).ok().and_then(|u| u.host_str().map(str::to_owned)) {
            Some(host) => host == "tauri.localhost" || host == "localhost",
            None => false,
        }
    }

    /// Attach a WebView2 PermissionRequested handler for microphone/camera.
    /// For our OWN origin it auto-allows (so a prior "Deny" never locks a
    /// friend out — the OS privacy toggle stays the real consent switch).
    /// For ANY other origin it explicitly DENIES, so an off-origin page
    /// (e.g. after an unexpected navigation) can never silently capture
    /// mic/camera. (Fixes audit M2.)
    pub fn auto_allow(webview: &tauri::webview::PlatformWebview) {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_PERMISSION_KIND_CAMERA, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
            COREWEBVIEW2_PERMISSION_STATE_ALLOW, COREWEBVIEW2_PERMISSION_STATE_DENY,
        };
        use webview2_com::PermissionRequestedEventHandler;
        use windows::Win32::System::Com::CoTaskMemFree;

        unsafe {
            let Ok(core) = webview.controller().CoreWebView2() else {
                return;
            };
            let handler = PermissionRequestedEventHandler::create(Box::new(|_sender, args| {
                if let Some(args) = args {
                    let mut kind = Default::default();
                    if args.PermissionKind(&mut kind).is_ok()
                        && (kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE
                            || kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA)
                    {
                        // Resolve the requesting origin and gate on it.
                        let mut uri = windows::core::PWSTR::null();
                        let origin_ok = if args.Uri(&mut uri).is_ok() && !uri.is_null() {
                            let s = uri.to_string().unwrap_or_default();
                            CoTaskMemFree(Some(uri.0 as *const core::ffi::c_void));
                            is_own_origin(&s)
                        } else {
                            false
                        };
                        let _ = args.SetState(if origin_ok {
                            COREWEBVIEW2_PERMISSION_STATE_ALLOW
                        } else {
                            COREWEBVIEW2_PERMISSION_STATE_DENY
                        });
                    }
                }
                Ok(())
            }));
            let mut token = Default::default();
            let _ = core.add_PermissionRequested(&handler, &mut token);
        }
    }
}

/// Gaming-session performance guarantees (Windows):
/// 1. Opt the process OUT of EcoQoS ("Efficiency Mode") so Windows 11
///    never parks AOCom on efficiency cores while a game hogs the CPU.
/// 2. Raise the process priority class so the audio pipeline keeps its
///    scheduling slice under 100% CPU/GPU load.
#[cfg(windows)]
fn assert_realtime_process_priority() {
    use windows::Win32::System::Threading::{
        GetCurrentProcess, ProcessPowerThrottling, SetPriorityClass, SetProcessInformation,
        ABOVE_NORMAL_PRIORITY_CLASS, PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        PROCESS_POWER_THROTTLING_EXECUTION_SPEED, PROCESS_POWER_THROTTLING_STATE,
    };
    unsafe {
        let process = GetCurrentProcess();
        // ControlMask set + StateMask zero = "never throttle this process".
        let state = PROCESS_POWER_THROTTLING_STATE {
            Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
            ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
            StateMask: 0,
        };
        let _ = SetProcessInformation(
            process,
            ProcessPowerThrottling,
            &state as *const _ as *const core::ffi::c_void,
            std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
        );
        let _ = SetPriorityClass(process, ABOVE_NORMAL_PRIORITY_CLASS);
    }
}

// ── H3: SSRF-safe link-preview fetcher ──────────────────────────────
//
// Link previews used to fetch arbitrary user-posted URLs through the
// permissive HTTP plugin, letting a chat message make every recipient's
// client hit internal/LAN/metadata endpoints. This command resolves the
// host, rejects the request if ANY resolved address is in a private /
// loopback / link-local / metadata / CGNAT range (blocks DNS-rebinding),
// pins the connection to the validated IP (TOCTOU-safe), disables
// redirects, and caps the body — so it can only ever reach public hosts.
mod ssrf {
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};

    fn v4_blocked(ip: Ipv4Addr) -> bool {
        let o = ip.octets();
        ip.is_private()
            || ip.is_loopback()
            || ip.is_link_local()   // 169.254/16 incl. 169.254.169.254 metadata
            || ip.is_broadcast()
            || ip.is_documentation()
            || ip.is_unspecified()
            || ip.is_multicast()
            || o[0] == 0                                   // 0.0.0.0/8
            || (o[0] == 100 && (o[1] & 0xC0) == 64)        // CGNAT 100.64/10
            || (o[0] == 198 && (o[1] == 18 || o[1] == 19)) // benchmarking 198.18/15
            || (o[0] == 192 && o[1] == 0 && o[2] == 0)     // IETF protocol 192.0.0/24
    }

    fn v6_blocked(ip: Ipv6Addr) -> bool {
        if let Some(v4) = ip.to_ipv4_mapped() {
            return v4_blocked(v4);
        }
        if let Some(v4) = ip.to_ipv4() {
            return v4_blocked(v4);
        }
        let seg = ip.segments();
        ip.is_loopback()
            || ip.is_unspecified()
            || ip.is_multicast()
            || (seg[0] & 0xfe00) == 0xfc00 // ULA fc00::/7
            || (seg[0] & 0xffc0) == 0xfe80 // link-local fe80::/10
    }

    fn addr_blocked(ip: IpAddr) -> bool {
        match ip {
            IpAddr::V4(v4) => v4_blocked(v4),
            IpAddr::V6(v6) => v6_blocked(v6),
        }
    }

    /// Resolve + validate the host; return the pinned SocketAddr to dial.
    pub fn resolve_public(host: &str, port: u16) -> Result<std::net::SocketAddr, String> {
        let addrs: Vec<_> = (host, port)
            .to_socket_addrs()
            .map_err(|_| "dns resolution failed".to_string())?
            .collect();
        if addrs.is_empty() {
            return Err("no address".into());
        }
        // Reject if ANY record is internal (defeats rebinding round-robin).
        for a in &addrs {
            if addr_blocked(a.ip()) {
                return Err("blocked non-public address".into());
            }
        }
        Ok(addrs[0])
    }
}

#[tauri::command]
async fn fetch_link_preview(url: String) -> Result<String, String> {
    let parsed = url::Url::parse(&url).map_err(|_| "invalid url".to_string())?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("unsupported scheme".into()),
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "no host".to_string())?
        .to_string();
    let port = parsed.port_or_known_default().unwrap_or(80);

    // DNS resolution can block — run it off the async runtime.
    let host_for_resolve = host.clone();
    let pinned = tauri::async_runtime::spawn_blocking(move || {
        ssrf::resolve_public(&host_for_resolve, port)
    })
    .await
    .map_err(|_| "resolver task failed".to_string())??;

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none()) // redirects could rebind to internal
        .timeout(std::time::Duration::from_secs(5))
        .user_agent("Mozilla/5.0 AOCom")
        .resolve(&host, pinned) // pin to the validated IP → TOCTOU-safe
        .build()
        .map_err(|e| e.to_string())?;

    let mut resp = client
        .get(parsed.as_str())
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("http {}", resp.status().as_u16()));
    }

    // Cap the body at 3 MiB — enough for OpenGraph <head> metadata and for
    // the ytInitialData block on a YouTube search results page.
    let mut body: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        body.extend_from_slice(&chunk);
        if body.len() > 3 * 1024 * 1024 {
            break;
        }
    }
    Ok(String::from_utf8_lossy(&body).into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    {
        assert_realtime_process_priority();
        // Chromium-level guarantee: the renderer that runs the WebRTC/
        // Web Audio pipeline is never timer-throttled or backgrounded
        // when the window is minimized/occluded during gameplay.
        // (Set before the first webview is created.)
        if std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_none() {
            std::env::set_var(
                "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                "--disable-background-timer-throttling \
                 --disable-renderer-backgrounding \
                 --disable-backgrounding-occluded-windows \
                 --autoplay-policy=no-user-gesture-required",
            );
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![fetch_link_preview])
        .on_page_load(|webview, payload| {
            #[cfg(windows)]
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let label = webview.label().to_string();
                if media_permissions::HOOKED.lock().unwrap().insert(label) {
                    let _ = webview.with_webview(|wv| media_permissions::auto_allow(&wv));
                }
            }
            #[cfg(not(windows))]
            {
                let _ = (webview, payload);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running AOCom");
}
