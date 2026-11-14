use std::ffi::c_void;
use tauri::{AppHandle, Emitter, WebviewWindow};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2PermissionRequestedEventArgs, COREWEBVIEW2_PERMISSION_KIND,
    COREWEBVIEW2_PERMISSION_KIND_CAMERA, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
    COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    COREWEBVIEW2_PERMISSION_STATE_DENY,
};
use webview2_com::{take_pwstr, PermissionRequestedEventHandler};
use windows::core::{w, PWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::RemoteDesktop::{
    WTSRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION,
};
use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, GetWindowLongPtrW,
    RegisterClassW, SetWindowLongPtrW, TranslateMessage, CREATESTRUCTW, CW_USEDEFAULT,
    GWLP_USERDATA, MSG, PBT_APMSUSPEND, WM_NCCREATE, WM_POWERBROADCAST, WM_WTSSESSION_CHANGE,
    WNDCLASSW, WS_OVERLAPPED, WTS_SESSION_LOCK,
};

pub fn set_app_user_model_id() {
    unsafe {
        let _ = SetCurrentProcessExplicitAppUserModelID(w!("cn.pinease.desktop"));
    }
}

pub fn configure_webview_permissions(window: &WebviewWindow, dev_url: Option<String>) {
    let _ = window.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };
        let dev_origin = dev_url.clone();
        let handler = PermissionRequestedEventHandler::create(Box::new(
            move |_sender, args: Option<ICoreWebView2PermissionRequestedEventArgs>| {
                let Some(args) = args else {
                    return Ok(());
                };
                let mut uri_raw = PWSTR::null();
                args.Uri(&mut uri_raw)?;
                let uri = take_pwstr(uri_raw);

                let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                args.PermissionKind(&mut kind)?;
                let kind_name = if kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA {
                    "camera"
                } else if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                    "microphone"
                } else if kind == COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS {
                    "notifications"
                } else {
                    "other"
                };

                let allowed = crate::permissions::can_grant_webview_permission(
                    &uri,
                    kind_name,
                    dev_origin.as_deref(),
                );
                let state = if allowed {
                    COREWEBVIEW2_PERMISSION_STATE_ALLOW
                } else {
                    COREWEBVIEW2_PERMISSION_STATE_DENY
                };
                args.SetState(state)?;
                Ok(())
            },
        ));
        let mut token = 0i64;
        let _ = core.add_PermissionRequested(&handler, &mut token);
    });
}

pub fn spawn_power_monitor(app: AppHandle) {
    std::thread::Builder::new()
        .name("pinease-power-monitor".into())
        .spawn(move || unsafe {
            let hinstance = GetModuleHandleW(None).unwrap_or_default();
            let class_name = w!("PinEasePowerMonitorWindow");
            let wc = WNDCLASSW {
                lpfnWndProc: Some(window_proc),
                hInstance: hinstance.into(),
                lpszClassName: class_name,
                ..Default::default()
            };
            RegisterClassW(&wc);

            let boxed = Box::into_raw(Box::new(app)) as *const c_void;
            // Must be a regular top-level hidden window (not HWND_MESSAGE) to receive WM_POWERBROADCAST.
            let Ok(hwnd) = CreateWindowExW(
                Default::default(),
                class_name,
                w!("PinEasePowerMonitor"),
                WS_OVERLAPPED,
                CW_USEDEFAULT,
                CW_USEDEFAULT,
                0,
                0,
                None,
                None,
                Some(hinstance.into()),
                Some(boxed),
            ) else {
                drop(Box::from_raw(boxed as *mut AppHandle));
                return;
            };

            let _ = WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION);

            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        })
        .ok();
}

unsafe extern "system" fn window_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if msg == WM_NCCREATE {
        let cs = &*(lparam.0 as *const CREATESTRUCTW);
        if !cs.lpCreateParams.is_null() {
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, cs.lpCreateParams as isize);
        }
        return DefWindowProcW(hwnd, msg, wparam, lparam);
    }

    let ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *const AppHandle;
    if !ptr.is_null() {
        let app = &*ptr;
        if msg == WM_POWERBROADCAST && wparam.0 == PBT_APMSUSPEND as usize {
            let _ = app.emit("desktop:command", "pause");
        } else if msg == WM_WTSSESSION_CHANGE && wparam.0 == WTS_SESSION_LOCK as usize {
            let _ = app.emit("desktop:command", "pause");
        }
    }

    DefWindowProcW(hwnd, msg, wparam, lparam)
}
