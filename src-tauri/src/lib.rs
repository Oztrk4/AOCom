#[cfg(windows)]
mod media_permissions {
    use std::collections::HashSet;
    use std::sync::{LazyLock, Mutex};

    /// Webview labels that already have the auto-allow handler attached,
    /// so an in-app reload doesn't stack duplicate handlers.
    pub static HOOKED: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));

    /// Attach a WebView2 PermissionRequested handler that resolves
    /// microphone/camera requests as ALLOWED at the native layer. This
    /// bypasses the webview's persisted "deny" state entirely — a friend
    /// who once clicked Deny is never permanently locked out. The only
    /// remaining gate is the OS-level Windows privacy toggle, which is
    /// the user's real consent switch.
    pub fn auto_allow(webview: &tauri::webview::PlatformWebview) {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_PERMISSION_KIND_CAMERA, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
            COREWEBVIEW2_PERMISSION_STATE_ALLOW,
        };
        use webview2_com::PermissionRequestedEventHandler;

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
                        let _ = args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW);
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
                 --disable-backgrounding-occluded-windows",
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
