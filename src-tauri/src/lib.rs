use image::imageops::FilterType;
use image::RgbaImage;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

const CODEX_MATCH_INTERVAL_MS: u64 = 500;
const CODEX_MATCH_STEP: u32 = 2;
const CODEX_MATCH_THRESHOLD: f64 = 34.0;
const CODEX_TEMPLATE_SCALES: [f32; 9] = [0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.4, 1.6, 1.8];

struct CodexDetectorState {
    stop_signal: Mutex<Option<Arc<AtomicBool>>>,
}

fn app_data_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录: {error}"))?;
    fs::create_dir_all(&dir).map_err(|error| format!("无法创建应用数据目录: {error}"))?;
    Ok(dir.join("app-data.json"))
}

fn codex_status_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(project_dir) = manifest_dir.parent() {
        if project_dir.exists() {
            return Ok(project_dir.join("codex-status.json"));
        }
    }

    app.path()
        .app_data_dir()
        .map(|dir| dir.join("codex-status.json"))
        .map_err(|error| format!("Unable to locate status file directory: {error}"))
}

fn codex_detector_settings_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(project_dir) = manifest_dir.parent() {
        if project_dir.exists() {
            return Ok(project_dir.join("codex-detector-settings.json"));
        }
    }

    app.path()
        .app_data_dir()
        .map(|dir| dir.join("codex-detector-settings.json"))
        .map_err(|error| format!("Unable to locate detector settings file directory: {error}"))
}

fn project_dir() -> Option<PathBuf> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(PathBuf::from)
}

fn codex_template_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(project_dir) = project_dir() {
        candidates.push(project_dir.join("scripts").join("codex-working-button.png"));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(
            resource_dir
                .join("scripts")
                .join("codex-working-button.png"),
        );
        candidates.push(resource_dir.join("codex-working-button.png"));
    }

    candidates.into_iter().find(|path| path.exists())
}

fn codex_status_payload(status: &str, message: &str) -> Value {
    serde_json::json!({
        "status": status,
        "message": message,
        "updatedAt": chrono_timestamp()
    })
}

fn chrono_timestamp() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn write_codex_status_path(path: &PathBuf, status: &str, message: &str) {
    if let Ok(text) = serde_json::to_string_pretty(&codex_status_payload(status, message)) {
        let _ = fs::write(path, text);
    }
}

fn read_codex_detector_enabled(app: &tauri::AppHandle) -> bool {
    let Ok(path) = codex_detector_settings_file(app) else {
        return true;
    };
    let Ok(text) = fs::read_to_string(path) else {
        return true;
    };
    let Ok(data) = serde_json::from_str::<Value>(&text) else {
        return true;
    };

    data.get("enabled").and_then(Value::as_bool).unwrap_or(true)
}

fn write_codex_detector_enabled(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let path = codex_detector_settings_file(app)?;
    let text = serde_json::to_string_pretty(&serde_json::json!({
        "enabled": enabled,
        "updatedAt": chrono_timestamp()
    }))
    .map_err(|error| format!("Unable to serialize detector settings: {error}"))?;
    fs::write(path, text).map_err(|error| format!("Unable to write detector settings: {error}"))
}

fn start_codex_screen_monitor(app: tauri::AppHandle, stop_signal: Arc<AtomicBool>) {
    thread::spawn(move || {
        let status_path = match codex_status_file(&app) {
            Ok(path) => path,
            Err(_) => return,
        };
        let template_path = match codex_template_file(&app) {
            Some(path) => path,
            None => {
                write_codex_status_path(
                    &status_path,
                    "pending_approval",
                    "Codex 工作按钮模板图不存在",
                );
                return;
            }
        };
        let template = match image::open(&template_path).map(|image| image.to_rgba8()) {
            Ok(image) => image,
            Err(error) => {
                write_codex_status_path(
                    &status_path,
                    "pending_approval",
                    &format!("无法读取 Codex 工作按钮模板图: {error}"),
                );
                return;
            }
        };
        let templates = scaled_codex_templates(&template);

        loop {
            if stop_signal.load(Ordering::Relaxed) {
                write_codex_status_path(&status_path, "idle", "Codex 状态检测已关闭");
                break;
            }

            match detect_codex_working(&templates) {
                Ok(true) => {
                    write_codex_status_path(&status_path, "working", "屏幕检测到 Codex 工作按钮")
                }
                Ok(false) => {
                    write_codex_status_path(&status_path, "idle", "未检测到 Codex 工作按钮")
                }
                Err(error) => write_codex_status_path(
                    &status_path,
                    "pending_approval",
                    &format!("屏幕检测失败: {error}"),
                ),
            }

            thread::sleep(Duration::from_millis(CODEX_MATCH_INTERVAL_MS));
        }
    });
}

fn enable_codex_screen_monitor(app: tauri::AppHandle, state: tauri::State<CodexDetectorState>) {
    if let Ok(mut current_signal) = state.stop_signal.lock() {
        if current_signal.is_some() {
            return;
        }

        let stop_signal = Arc::new(AtomicBool::new(false));
        *current_signal = Some(stop_signal.clone());
        start_codex_screen_monitor(app, stop_signal);
    }
}

fn disable_codex_screen_monitor(state: tauri::State<CodexDetectorState>) {
    if let Ok(mut current_signal) = state.stop_signal.lock() {
        if let Some(stop_signal) = current_signal.take() {
            stop_signal.store(true, Ordering::Relaxed);
        }
    }
}

fn detect_codex_working(templates: &[RgbaImage]) -> Result<bool, String> {
    let screens = screenshots::Screen::all().map_err(|error| error.to_string())?;
    if screens.is_empty() {
        return Err("No capturable displays found".to_string());
    }

    let mut capture_errors = Vec::new();
    for screen in screens {
        let capture = match screen.capture() {
            Ok(capture) => capture,
            Err(error) => {
                capture_errors.push(error.to_string());
                continue;
            }
        };
        let image = RgbaImage::from_raw(capture.width(), capture.height(), capture.into_raw())
            .ok_or_else(|| "无法解析屏幕截图像素".to_string())?;

        for template in templates {
            if find_template_score(&image, template, CODEX_MATCH_STEP, CODEX_MATCH_THRESHOLD)
                <= CODEX_MATCH_THRESHOLD
            {
                return Ok(true);
            }
        }
    }

    if !capture_errors.is_empty() {
        return Err(format!(
            "Some displays could not be captured: {}",
            capture_errors.join("; ")
        ));
    }

    Ok(false)
}

fn scaled_codex_templates(template: &RgbaImage) -> Vec<RgbaImage> {
    let mut templates = Vec::new();
    for scale in CODEX_TEMPLATE_SCALES {
        let width = ((template.width() as f32) * scale).round().max(1.0) as u32;
        let height = ((template.height() as f32) * scale).round().max(1.0) as u32;

        if width == template.width() && height == template.height() {
            templates.push(template.clone());
        } else {
            templates.push(image::imageops::resize(
                template,
                width,
                height,
                FilterType::Triangle,
            ));
        }
    }
    templates
}

fn find_template_score(source: &RgbaImage, template: &RgbaImage, step: u32, threshold: f64) -> f64 {
    if source.width() < template.width() || source.height() < template.height() {
        return f64::MAX;
    }

    let scan_step = step.max(1) as usize;
    let mut best = f64::MAX;
    let sample_points = template_sample_points(template.width(), template.height(), 4);
    let sampled_limit = threshold * sample_points.len() as f64 * 3.0;
    let max_y = source.height() - template.height();
    let max_x = source.width() - template.width();

    for y in (0..=max_y).step_by(scan_step) {
        for x in (0..=max_x).step_by(scan_step) {
            let mut sample_diff = 0.0;
            for (tx, ty) in &sample_points {
                sample_diff += pixel_rgb_diff(source, template, x + *tx, y + *ty, *tx, *ty);
                if sample_diff > sampled_limit {
                    break;
                }
            }

            if sample_diff > sampled_limit {
                continue;
            }

            let mut diff = 0.0;
            let total_limit = threshold * template.width() as f64 * template.height() as f64 * 3.0;
            'rows: for ty in 0..template.height() {
                for tx in 0..template.width() {
                    diff += pixel_rgb_diff(source, template, x + tx, y + ty, tx, ty);
                }
                if diff > total_limit
                    && diff >= best * template.width() as f64 * template.height() as f64 * 3.0
                {
                    break 'rows;
                }
            }

            let score = diff / (template.width() as f64 * template.height() as f64 * 3.0);
            if score < best {
                best = score;
            }
            if best <= threshold {
                return best;
            }
        }
    }

    best
}

fn template_sample_points(width: u32, height: u32, stride: u32) -> Vec<(u32, u32)> {
    let mut points = Vec::new();
    let step = stride.max(1) as usize;
    for y in (0..height).step_by(step) {
        for x in (0..width).step_by(step) {
            points.push((x, y));
        }
    }
    points
}

fn pixel_rgb_diff(
    source: &RgbaImage,
    template: &RgbaImage,
    source_x: u32,
    source_y: u32,
    template_x: u32,
    template_y: u32,
) -> f64 {
    let source_pixel = source.get_pixel(source_x, source_y).0;
    let template_pixel = template.get_pixel(template_x, template_y).0;
    (source_pixel[0] as f64 - template_pixel[0] as f64).abs()
        + (source_pixel[1] as f64 - template_pixel[1] as f64).abs()
        + (source_pixel[2] as f64 - template_pixel[2] as f64).abs()
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
    let text =
        serde_json::to_string_pretty(&data).map_err(|error| format!("无法序列化数据: {error}"))?;
    fs::write(&path, text).map_err(|error| format!("无法写入数据文件: {error}"))
}

#[tauri::command]
fn load_codex_status(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let path = codex_status_file(&app)?;
    if !path.exists() {
        return Ok(None);
    }

    let text = fs::read_to_string(&path)
        .map_err(|error| format!("Unable to read status file: {error}"))?;
    let data = serde_json::from_str(&text)
        .map_err(|error| format!("Invalid status file JSON: {error}"))?;
    Ok(Some(data))
}

#[tauri::command]
fn save_codex_status(app: tauri::AppHandle, data: Value) -> Result<(), String> {
    let path = codex_status_file(&app)?;
    let text = serde_json::to_string_pretty(&data)
        .map_err(|error| format!("Unable to serialize status data: {error}"))?;
    fs::write(&path, text).map_err(|error| format!("Unable to write status file: {error}"))
}

#[tauri::command]
fn load_codex_detector_enabled(app: tauri::AppHandle) -> bool {
    read_codex_detector_enabled(&app)
}

#[tauri::command]
fn set_codex_detector_enabled(
    app: tauri::AppHandle,
    state: tauri::State<CodexDetectorState>,
    enabled: bool,
) -> Result<bool, String> {
    write_codex_detector_enabled(&app, enabled)?;
    if enabled {
        enable_codex_screen_monitor(app, state);
    } else {
        disable_codex_screen_monitor(state);
    }
    Ok(enabled)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(CodexDetectorState {
            stop_signal: Mutex::new(None),
        })
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

            WebviewWindowBuilder::new(
                app,
                "codex-status",
                WebviewUrl::App("index.html?panel=codex-status".into()),
            )
            .title("Codex Status")
            .inner_size(420.0, 75.0)
            .min_inner_size(420.0, 75.0)
            .max_inner_size(420.0, 75.0)
            .position(32.0, 32.0)
            .decorations(false)
            .resizable(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(false)
            .focusable(false)
            .build()?;

            if read_codex_detector_enabled(&app.handle()) {
                let state = app.state::<CodexDetectorState>();
                enable_codex_screen_monitor(app.handle().clone(), state);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_app_data,
            save_app_data,
            load_codex_status,
            save_codex_status,
            load_codex_detector_enabled,
            set_codex_detector_enabled
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
