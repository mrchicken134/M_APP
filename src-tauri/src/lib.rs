use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WindowEvent};

fn app_data_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录: {error}"))?;
    fs::create_dir_all(&dir).map_err(|error| format!("无法创建应用数据目录: {error}"))?;
    Ok(dir.join("app-data.json"))
}

#[tauri::command]
fn load_app_data(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let path = app_data_file(&app)?;
    if !path.exists() {
        return Ok(None);
    }

    let text = fs::read_to_string(&path).map_err(|error| format!("无法读取数据文件: {error}"))?;
    let data = serde_json::from_str(&text).map_err(|error| format!("数据文件格式错误: {error}"))?;
    Ok(Some(data))
}

#[tauri::command]
fn save_app_data(app: tauri::AppHandle, data: Value) -> Result<(), String> {
    let path = app_data_file(&app)?;
    let text = serde_json::to_string_pretty(&data)
        .map_err(|error| format!("无法序列化数据: {error}"))?;
    fs::write(&path, text).map_err(|error| format!("无法写入数据文件: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "打开", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;

            let mut tray = TrayIconBuilder::new().tooltip("M App").menu(&menu);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }

            tray.on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![load_app_data, save_app_data])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
