//! Dev Deck: a tray window with the machine's development processes.

pub mod actions;
pub mod procs;
pub mod sessions;
pub mod describe;
pub mod locale;
pub mod tasks;

use std::sync::Mutex;
use sysinfo::System;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, WindowEvent};

/// The `System` stays alive between reads: CPU is the difference between two reads.
struct Sys(Mutex<System>);

fn sys<'a>(state: &'a State<Sys>) -> std::sync::MutexGuard<'a, System> {
    state.0.lock().unwrap_or_else(|e| e.into_inner())
}

#[tauri::command]
fn list(state: State<Sys>) -> Vec<procs::Group> {
    let mut sys = sys(&state);
    let all = procs::snapshot(&mut sys);
    let own = procs::own_tree(&all);
    let mut groups = procs::group(&all, &|p| p.exists(), &own);
    procs::tag_tasks(&mut groups, &all, &tasks::watched_engines());
    groups
}

#[tauri::command]
fn kill(state: State<Sys>, pids: Vec<u32>) -> Result<usize, String> {
    actions::kill(&mut sys(&state), &pids)
}

#[tauri::command]
fn restart(state: State<Sys>, pid: u32, title: String) -> Result<(), String> {
    actions::restart(&mut sys(&state), pid, &title)
}

#[tauri::command]
fn open_port(port: u16) -> Result<(), String> {
    actions::open_port(port)
}

#[tauri::command]
fn open_folder(path: String, editor: bool) -> Result<(), String> {
    actions::open_folder(&path, editor)
}

#[tauri::command]
fn shadow_read() -> Vec<serde_json::Value> {
    actions::shadow_read()
}

#[tauri::command]
fn shadow_append(record: serde_json::Value) -> Result<(), String> {
    actions::shadow_append(&record)
}

/// The Claude Code sessions, with the cached description (and whether it is still fresh).
#[tauri::command(async)]
fn sessions() -> Vec<serde_json::Value> {
    let mut sys = System::new();
    let all = procs::snapshot(&mut sys);
    let cache = describe::read_cache();
    sessions::list(&all, &sessions::projects_root())
        .into_iter()
        .map(|s| {
            let d = s.session_id.as_ref().and_then(|id| cache.get(id)).cloned();
            let fresh = d.as_ref().is_some_and(|d| Some(&d.fingerprint) == describe::fingerprint(&s).as_ref());
            serde_json::json!({ "session": s, "description": d, "description_fresh": fresh })
        })
        .collect()
}

/// "Describe": redo a session's description right now (claude -p, a few seconds).
#[tauri::command(async)]
fn describe_session(pid: u32) -> Result<describe::Description, String> {
    let mut sys = System::new();
    let all = procs::snapshot(&mut sys);
    let s = sessions::list(&all, &sessions::projects_root())
        .into_iter()
        .find(|s| s.pid == pid)
        .ok_or("the session is gone")?;
    describe::describe(&s, true)
}

/// Whether descriptions are on, and whether DEVDECK_DESCRIBE decides it (then the switch is locked).
#[tauri::command]
fn describe_settings() -> serde_json::Value {
    let (enabled, forced) = describe::settings();
    serde_json::json!({ "enabled": enabled, "forced": forced })
}

/// The Windows display language when the panel has it, English otherwise (locale.rs).
#[tauri::command]
fn app_language() -> &'static str {
    locale::app_language()
}

/// The scheduled tasks that run something in a project, grouped by project.
#[tauri::command(async)]
fn jobs() -> Result<Vec<tasks::JobGroup>, String> {
    tasks::jobs()
}

/// Run now, enable, disable a project task.
#[tauri::command(async)]
fn job_act(path: String, act: String) -> Result<(), String> {
    let act = match act.as_str() {
        "run" => tasks::Act::Run,
        "enable" => tasks::Act::Enable,
        "disable" => tasks::Act::Disable,
        other => return Err(format!("unknown task action: {other}")),
    };
    tasks::act(&path, act)
}

/// Deletes a project task, keeping a copy of its definition; returns where.
#[tauri::command(async)]
fn job_delete(path: String) -> Result<String, String> {
    tasks::delete(&path)
}

#[tauri::command]
fn set_describe(on: bool) -> Result<(), String> {
    describe::set_enabled(on)
}

/// Every 5 minutes, only while descriptions are on: the sessions whose transcript
/// changed and whose description is older than 30 minutes (or missing), one at a time.
/// Checked every 30 s, so turning them on starts the first round right away.
fn auto_describe() {
    std::thread::spawn(|| {
        let mut last: Option<std::time::Instant> = None;
        loop {
            if !describe::enabled() {
                last = None;
            } else if last.is_none_or(|t| t.elapsed() >= std::time::Duration::from_secs(5 * 60)) {
                last = Some(std::time::Instant::now());
                let mut sys = System::new();
                let all = procs::snapshot(&mut sys);
                let cache = describe::read_cache();
                for s in sessions::list(&all, &sessions::projects_root()) {
                    if describe::stale(&s, &cache, 30 * 60) {
                        let _ = describe::describe(&s, false);
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(30));
        }
    });
}

fn toggle(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(Sys(Mutex::new(System::new())))
        .invoke_handler(tauri::generate_handler![list, kill, restart, open_port, open_folder, shadow_read, shadow_append, sessions, describe_session, describe_settings, set_describe, app_language, jobs, job_act, job_delete])
        .setup(|app| {
            auto_describe();
            tasks::watch_engines();
            let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().cloned().expect("app icon"))
                .tooltip("Dev Deck")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => toggle(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        toggle(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        // Closing the window hides it: Dev Deck stays in the tray. Quit from the menu.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("Dev Deck failed to start");
}
