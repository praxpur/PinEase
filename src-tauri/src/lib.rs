mod permissions;
#[cfg(target_os = "windows")]
mod windows_hooks;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::webview::NewWindowResponse;
use tauri::window::Color;
use tauri::{
    AppHandle, Emitter, Manager, RunEvent, State, Theme, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_notification::NotificationExt;

struct DesktopState {
    monitor_state: Mutex<String>,
    allow_quit: AtomicBool,
    quit_pending: AtomicBool,
    last_notification: Mutex<(String, Option<Instant>)>,
    tray: Mutex<Option<TrayIcon>>,
    pause_item: Mutex<Option<MenuItem<tauri::Wry>>>,
    resume_item: Mutex<Option<MenuItem<tauri::Wry>>>,
}

impl Default for DesktopState {
    fn default() -> Self {
        Self {
            monitor_state: Mutex::new("idle".into()),
            allow_quit: AtomicBool::new(false),
            quit_pending: AtomicBool::new(false),
            last_notification: Mutex::new((String::new(), None)),
            tray: Mutex::new(None),
            pause_item: Mutex::new(None),
            resume_item: Mutex::new(None),
        }
    }
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn update_tray(state: &DesktopState) {
    let current = state
        .monitor_state
        .lock()
        .map(|s| s.clone())
        .unwrap_or_else(|_| "idle".into());
    let running = current == "running";
    let paused = current == "paused";
    let status_label = if running {
        "正在监测"
    } else if paused {
        "监测已暂停"
    } else {
        "待机"
    };

    if let Ok(guard) = state.tray.lock() {
        if let Some(tray) = guard.as_ref() {
            let _ = tray.set_tooltip(Some(format!("PinEase · {status_label}")));
        }
    }
    if let Ok(guard) = state.pause_item.lock() {
        if let Some(item) = guard.as_ref() {
            let _ = item.set_enabled(running);
        }
    }
    if let Ok(guard) = state.resume_item.lock() {
        if let Some(item) = guard.as_ref() {
            let _ = item.set_enabled(paused);
        }
    }
}

fn request_quit_after_save(app: &AppHandle) {
    let state = app.state::<DesktopState>();
    if state.quit_pending.swap(true, Ordering::SeqCst) {
        return;
    }

    if app.get_webview_window("main").is_none() {
        state.allow_quit.store(true, Ordering::SeqCst);
        app.exit(0);
        return;
    }

    let _ = app.emit("desktop:command", "quit");
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(8));
        let st = handle.state::<DesktopState>();
        if !st.allow_quit.load(Ordering::SeqCst) {
            st.allow_quit.store(true, Ordering::SeqCst);
            handle.exit(0);
        }
    });
}

#[tauri::command]
fn desktop_set_state(state_name: String, desktop: State<'_, DesktopState>) {
    if matches!(state_name.as_str(), "idle" | "running" | "paused") {
        if let Ok(mut guard) = desktop.monitor_state.lock() {
            *guard = state_name;
        }
        update_tray(&desktop);
    }
}

#[tauri::command]
fn desktop_set_theme(window: WebviewWindow, theme: String) {
    let (win_theme, bg) = match theme.as_str() {
        "dark" => (Theme::Dark, Color(39, 50, 41, 255)),
        "light" => (Theme::Light, Color(248, 247, 242, 255)),
        _ => return,
    };
    let _ = window.set_theme(Some(win_theme));
    let _ = window.set_background_color(Some(bg));
}

#[tauri::command]
fn desktop_notify(
    app: AppHandle,
    desktop: State<'_, DesktopState>,
    title: String,
    body: String,
) -> bool {
    if !title.starts_with("PinEase · ") {
        return false;
    }
    if title.trim().is_empty()
        || body.trim().is_empty()
        || title.chars().count() > 80
        || body.chars().count() > 300
    {
        return false;
    }

    let key = format!("{title}\n{body}");
    let now = Instant::now();
    if let Ok(mut last) = desktop.last_notification.lock() {
        if last.0 == key {
            if let Some(prev) = last.1 {
                if now.duration_since(prev) < Duration::from_millis(1500) {
                    return true;
                }
            }
        }
        *last = (key, Some(now));
    }

    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .is_ok()
}

#[tauri::command]
fn desktop_notification_available() -> bool {
    true
}

#[tauri::command]
fn desktop_set_rest_overlay(app: AppHandle, active: bool) -> bool {
    let Some(window) = app.get_webview_window("main") else {
        return false;
    };
    if active {
        show_window(&app);
        let _ = window.set_always_on_top(true);
        let _ = window.set_fullscreen(true);
    } else {
        let _ = window.set_fullscreen(false);
        let _ = window.set_always_on_top(false);
    }
    true
}

#[tauri::command]
fn desktop_ready_to_quit(app: AppHandle, desktop: State<'_, DesktopState>) {
    if desktop.quit_pending.load(Ordering::SeqCst) {
        desktop.allow_quit.store(true, Ordering::SeqCst);
        app.exit(0);
    }
}

#[tauri::command]
fn desktop_window_action(window: WebviewWindow, action: String) -> bool {
    match action.as_str() {
        "minimize" => window.minimize().is_ok(),
        "toggle_maximize" => match window.is_maximized() {
            Ok(true) => window.unmaximize().is_ok(),
            Ok(false) => window.maximize().is_ok(),
            Err(_) => false,
        },
        "hide" => window.hide().is_ok(),
        _ => false,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    windows_hooks::set_app_user_model_id();

    let app = tauri::Builder::default()
        .manage(DesktopState::default())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_window(app);
        }))
        .invoke_handler(tauri::generate_handler![
            desktop_set_state,
            desktop_set_theme,
            desktop_notify,
            desktop_notification_available,
            desktop_set_rest_overlay,
            desktop_ready_to_quit,
            desktop_window_action,
        ])
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let pause_item = MenuItem::with_id(app, "pause", "暂停监测", false, None::<&str>)?;
            let resume_item = MenuItem::with_id(app, "resume", "继续监测", false, None::<&str>)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 PinEase", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&show_item, &sep1, &pause_item, &resume_item, &sep2, &quit_item],
            )?;

            let tray_icon = app
                .default_window_icon()
                .cloned()
                .or_else(|| Image::from_bytes(include_bytes!("../icons/32x32.png")).ok())
                .ok_or("Missing tray icon")?;

            let tray = TrayIconBuilder::with_id("main-tray")
                .icon(tray_icon)
                .menu(&menu)
                .tooltip("PinEase · 待机")
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_window(app),
                    "pause" => {
                        let _ = app.emit("desktop:command", "pause");
                    }
                    "resume" => {
                        let _ = app.emit("desktop:command", "resume");
                    }
                    "quit" => request_quit_after_save(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_window(tray.app_handle());
                    }
                })
                .build(app)?;

            let desktop = app.state::<DesktopState>();
            if let Ok(mut guard) = desktop.tray.lock() {
                *guard = Some(tray);
            }
            if let Ok(mut guard) = desktop.pause_item.lock() {
                *guard = Some(pause_item);
            }
            if let Ok(mut guard) = desktop.resume_item.lock() {
                *guard = Some(resume_item);
            }

            let dev_url = if cfg!(debug_assertions) {
                app.config().build.dev_url.as_ref().map(|u| u.to_string())
            } else {
                None
            };
            let nav_dev_url = dev_url.clone();

            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("PinEase · 青松坐姿")
                .inner_size(1280.0, 900.0)
                .min_inner_size(900.0, 680.0)
                .decorations(false)
                .shadow(true)
                .background_color(Color(248, 247, 242, 255))
                .additional_browser_args(
                    "--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows",
                )
                .on_navigation(move |url| {
                    permissions::is_trusted_url(url.as_str(), nav_dev_url.as_deref())
                })
                .on_new_window(|_url, _features| NewWindowResponse::Deny);

            let window = builder.build()?;
            let close_handle = app.handle().clone();
            let hide_target = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    let st = close_handle.state::<DesktopState>();
                    if !st.allow_quit.load(Ordering::SeqCst) {
                        api.prevent_close();
                        let _ = hide_target.hide();
                    }
                }
            });

            #[cfg(target_os = "windows")]
            {
                windows_hooks::configure_webview_permissions(&window, dev_url);
                windows_hooks::spawn_power_monitor(app.handle().clone());
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building PinEase Tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::ExitRequested { api, .. } = event {
            let st = app_handle.state::<DesktopState>();
            if !st.allow_quit.load(Ordering::SeqCst) {
                api.prevent_exit();
                request_quit_after_save(app_handle);
            }
        }
    });
}
