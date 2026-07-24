use image::imageops::FilterType;
use image::{Rgba, RgbaImage};
use opencv::core::{self, Mat, Point, Rect, Scalar, Size};
use opencv::imgproc;
use opencv::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::mem::size_of;
use std::path::PathBuf;
use std::slice;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use windows::core::BOOL;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetWindowDC, ReleaseDC,
    SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
};
use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowRect, GetWindowThreadProcessId, IsWindowVisible, PW_RENDERFULLCONTENT,
};

const CODEX_MATCH_INTERVAL_MS: u64 = 1000;
const CLI_MATCH_THRESHOLD: f64 = 0.88;
const CLI_APPROVAL_MATCH_THRESHOLD: f64 = 0.84;
const GUI_MATCH_THRESHOLD: f64 = 0.90;
const OPENCV_COARSE_SCALE: f64 = 0.25;
const OPENCV_COARSE_THRESHOLD: f64 = 0.48;
const OPENCV_REFINE_PADDING: i32 = 10;
const OPENCV_COARSE_CANDIDATES: usize = 6;
const CODEX_CONTEXT_PADDING: u32 = 12;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CodexDetectionKind {
    CliApproval,
    CliWorking,
    GuiWorking,
    CliReady,
}

impl CodexDetectionKind {
    fn template_name(self) -> &'static str {
        match self {
            Self::CliApproval => "codex-cli-approval.png",
            Self::CliWorking => "codex-cli-working.png",
            Self::GuiWorking => "codex-working-button.png",
            Self::CliReady => "codex-cli-ready.png",
        }
    }

    fn key(self) -> &'static str {
        match self {
            Self::CliApproval => "cli_approval",
            Self::CliWorking => "cli_working",
            Self::GuiWorking => "gui_working",
            Self::CliReady => "cli_ready",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::CliApproval => "CLI 等待审批",
            Self::CliWorking => "CLI 工作中",
            Self::GuiWorking => "桌面版工作中",
            Self::CliReady => "CLI 空闲",
        }
    }

    fn status(self) -> &'static str {
        match self {
            Self::CliApproval => "pending_approval",
            Self::CliWorking | Self::GuiWorking => "working",
            Self::CliReady => "idle",
        }
    }
}

struct CodexDetectionTemplate {
    kind: CodexDetectionKind,
    variants: Vec<CodexTemplateVariant>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexDetectorSettings {
    enabled: bool,
    template_width: u32,
    template_height: u32,
    template_scale_percent: u32,
    screen_width: u32,
    screen_height: u32,
    screen_scale_percent: u32,
    updated_at: String,
}

impl Default for CodexDetectorSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            template_width: 2560,
            template_height: 1440,
            template_scale_percent: 125,
            screen_width: 2560,
            screen_height: 1440,
            screen_scale_percent: 125,
            updated_at: chrono_timestamp(),
        }
    }
}

impl CodexDetectorSettings {
    fn sanitize(mut self) -> Self {
        let defaults = Self::default();
        if self.template_width == 0 {
            self.template_width = defaults.template_width;
        }
        if self.template_height == 0 {
            self.template_height = defaults.template_height;
        }
        if self.template_scale_percent == 0 {
            self.template_scale_percent = defaults.template_scale_percent;
        }
        if self.screen_width == 0 {
            self.screen_width = defaults.screen_width;
        }
        if self.screen_height == 0 {
            self.screen_height = defaults.screen_height;
        }
        if self.screen_scale_percent == 0 {
            self.screen_scale_percent = defaults.screen_scale_percent;
        }
        if self.updated_at.is_empty() {
            self.updated_at = chrono_timestamp();
        }
        self
    }

    fn template_match_scale(&self) -> f32 {
        let width_ratio = self.screen_width as f64 / self.template_width.max(1) as f64;
        let height_ratio = self.screen_height as f64 / self.template_height.max(1) as f64;
        let resolution_ratio = (width_ratio * height_ratio).sqrt();
        let dpi_ratio =
            self.screen_scale_percent.max(1) as f64 / self.template_scale_percent.max(1) as f64;

        (resolution_ratio * dpi_ratio).clamp(0.4, 2.5) as f32
    }
}

struct CodexTemplateVariant {
    image: RgbaImage,
    gray: Mat,
    coarse_gray: Mat,
    scale: f32,
}

#[derive(Clone, Debug)]
struct TemplateMatch {
    x: u32,
    y: u32,
    score: f64,
    confidence: f64,
    scale: f32,
}

#[derive(Clone)]
struct CodexDetectionMatch {
    kind: CodexDetectionKind,
    screen_index: usize,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    score: f64,
    confidence: f64,
    scale: f32,
    consecutive_frames: u32,
    image: RgbaImage,
}

#[derive(Default)]
struct CodexDetectionStabilizer {
    candidate_kind: Option<CodexDetectionKind>,
    candidate_frames: u32,
    missing_frames: u32,
    published: Option<CodexDetectionMatch>,
}

enum CodexStableUpdate {
    Hold,
    Detection(CodexDetectionMatch),
    Idle,
}

impl CodexDetectionStabilizer {
    fn update(&mut self, detection: Option<CodexDetectionMatch>) -> CodexStableUpdate {
        if let Some(mut detection) = detection {
            self.missing_frames = 0;
            if self.candidate_kind == Some(detection.kind) {
                self.candidate_frames += 1;
            } else {
                self.candidate_kind = Some(detection.kind);
                self.candidate_frames = 1;
            }

            let required_frames = if detection.kind == CodexDetectionKind::CliApproval {
                1
            } else {
                2
            };
            detection.consecutive_frames = self.candidate_frames;
            if self.candidate_frames < required_frames {
                return CodexStableUpdate::Hold;
            }

            self.published = Some(detection.clone());
            CodexStableUpdate::Detection(detection)
        } else {
            self.candidate_kind = None;
            self.candidate_frames = 0;
            self.missing_frames += 1;
            if self.missing_frames < 2 {
                return CodexStableUpdate::Hold;
            }

            self.published = None;
            CodexStableUpdate::Idle
        }
    }
}

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

fn workflow_return_alert_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(project_dir) = manifest_dir.parent() {
        if project_dir.exists() {
            return Ok(project_dir.join("workflow-return-alert.json"));
        }
    }

    app.path()
        .app_data_dir()
        .map(|dir| dir.join("workflow-return-alert.json"))
        .map_err(|error| format!("Unable to locate workflow alert file directory: {error}"))
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

fn codex_template_file(app: &tauri::AppHandle, file_name: &str) -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(project_dir) = project_dir() {
        candidates.push(project_dir.join("scripts").join(file_name));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("scripts").join(file_name));
        candidates.push(resource_dir.join(file_name));
    }

    candidates.into_iter().find(|path| path.exists())
}

fn codex_match_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(project_dir) = manifest_dir.parent() {
        if project_dir.exists() {
            return Ok(project_dir.join("codex-match.png"));
        }
    }

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to locate match image directory: {error}"))?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Unable to create match image directory: {error}"))?;
    Ok(dir.join("codex-match.png"))
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

fn write_codex_detection_path(path: &PathBuf, detection: &CodexDetectionMatch) {
    let payload = serde_json::json!({
        "status": detection.kind.status(),
        "message": format!(
            "{} · 显示器 {} · OpenCV 相似度 {:.0}%",
            detection.kind.label(),
            detection.screen_index + 1,
            detection.confidence * 100.0
        ),
        "updatedAt": chrono_timestamp(),
        "match": {
            "kind": detection.kind.key(),
            "label": detection.kind.label(),
            "screenIndex": detection.screen_index,
            "x": detection.x,
            "y": detection.y,
            "width": detection.width,
            "height": detection.height,
            "score": detection.score,
            "confidence": detection.confidence,
            "scale": detection.scale,
            "consecutiveFrames": detection.consecutive_frames
        }
    });

    if let Ok(text) = serde_json::to_string_pretty(&payload) {
        let _ = fs::write(path, text);
    }
}

fn read_codex_detector_settings(app: &tauri::AppHandle) -> CodexDetectorSettings {
    let Ok(path) = codex_detector_settings_file(app) else {
        return CodexDetectorSettings::default();
    };
    let Ok(text) = fs::read_to_string(path) else {
        return CodexDetectorSettings::default();
    };
    let Ok(data) = serde_json::from_str::<Value>(&text) else {
        return CodexDetectorSettings::default();
    };

    CodexDetectorSettings {
        enabled: data.get("enabled").and_then(Value::as_bool).unwrap_or(true),
        template_width: data
            .get("templateWidth")
            .and_then(Value::as_u64)
            .unwrap_or(2560) as u32,
        template_height: data
            .get("templateHeight")
            .and_then(Value::as_u64)
            .unwrap_or(1440) as u32,
        template_scale_percent: data
            .get("templateScalePercent")
            .and_then(Value::as_u64)
            .unwrap_or(125) as u32,
        screen_width: data.get("screenWidth").and_then(Value::as_u64).unwrap_or(2560) as u32,
        screen_height: data
            .get("screenHeight")
            .and_then(Value::as_u64)
            .unwrap_or(1440) as u32,
        screen_scale_percent: data
            .get("screenScalePercent")
            .and_then(Value::as_u64)
            .unwrap_or(125) as u32,
        updated_at: data
            .get("updatedAt")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
    }
    .sanitize()
}

fn read_codex_detector_enabled(app: &tauri::AppHandle) -> bool {
    read_codex_detector_settings(app).enabled
}

fn write_codex_detector_settings(
    app: &tauri::AppHandle,
    settings: CodexDetectorSettings,
) -> Result<CodexDetectorSettings, String> {
    let path = codex_detector_settings_file(app)?;
    let next_settings = CodexDetectorSettings {
        updated_at: chrono_timestamp(),
        ..settings.sanitize()
    };
    let text = serde_json::to_string_pretty(&next_settings)
        .map_err(|error| format!("Unable to serialize detector settings: {error}"))?;
    fs::write(path, text).map_err(|error| format!("Unable to write detector settings: {error}"))?;
    Ok(next_settings)
}

fn write_codex_detector_enabled(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let settings = CodexDetectorSettings {
        enabled,
        ..read_codex_detector_settings(app)
    };
    write_codex_detector_settings(app, settings).map(|_| ())
}

fn start_codex_screen_monitor(app: tauri::AppHandle, stop_signal: Arc<AtomicBool>) {
    thread::spawn(move || {
        let settings = read_codex_detector_settings(&app);
        let template_scale = settings.template_match_scale();
        let status_path = match codex_status_file(&app) {
            Ok(path) => path,
            Err(_) => return,
        };
        let match_path = match codex_match_file(&app) {
            Ok(path) => path,
            Err(error) => {
                write_codex_status_path(&status_path, "pending_approval", &error);
                return;
            }
        };
        let kinds = [
            CodexDetectionKind::CliApproval,
            CodexDetectionKind::CliWorking,
            CodexDetectionKind::GuiWorking,
            CodexDetectionKind::CliReady,
        ];
        let mut templates = Vec::new();
        for kind in kinds {
            let Some(template_path) = codex_template_file(&app, kind.template_name()) else {
                write_codex_status_path(
                    &status_path,
                    "pending_approval",
                    &format!("缺少状态检测模板: {}", kind.template_name()),
                );
                return;
            };
            let template = match image::open(&template_path).map(|image| image.to_rgba8()) {
                Ok(image) => image,
                Err(error) => {
                    write_codex_status_path(
                        &status_path,
                        "pending_approval",
                        &format!("无法读取状态检测模板 {}: {error}", kind.template_name()),
                    );
                    return;
                }
            };
            let variants = match scaled_codex_templates(&template, template_scale) {
                Ok(variants) => variants,
                Err(error) => {
                    write_codex_status_path(
                        &status_path,
                        "pending_approval",
                        &format!("OpenCV 无法加载模板 {}: {error}", kind.template_name()),
                    );
                    return;
                }
            };
            templates.push(CodexDetectionTemplate { kind, variants });
        }
        let mut stabilizer = CodexDetectionStabilizer::default();

        loop {
            if stop_signal.load(Ordering::Relaxed) {
                let _ = fs::remove_file(&match_path);
                write_codex_status_path(&status_path, "idle", "Codex 状态检测已关闭");
                break;
            }

            match detect_codex_status(&templates) {
                Ok(detection) => match stabilizer.update(detection) {
                    CodexStableUpdate::Detection(detection) => {
                        let _ = detection.image.save(&match_path);
                        write_codex_detection_path(&status_path, &detection);
                    }
                    CodexStableUpdate::Idle => {
                        let _ = fs::remove_file(&match_path);
                        write_codex_status_path(&status_path, "idle", "未检测到 Codex 状态标志");
                    }
                    CodexStableUpdate::Hold => {}
                },
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

fn enable_codex_screen_monitor_inner(app: tauri::AppHandle, state: &CodexDetectorState) {
    if let Ok(mut current_signal) = state.stop_signal.lock() {
        if current_signal.is_some() {
            return;
        }

        let stop_signal = Arc::new(AtomicBool::new(false));
        *current_signal = Some(stop_signal.clone());
        start_codex_screen_monitor(app, stop_signal);
    }
}

fn disable_codex_screen_monitor_inner(state: &CodexDetectorState) {
    if let Ok(mut current_signal) = state.stop_signal.lock() {
        if let Some(stop_signal) = current_signal.take() {
            stop_signal.store(true, Ordering::Relaxed);
        }
    }
}

fn enable_codex_screen_monitor(app: tauri::AppHandle, state: tauri::State<CodexDetectorState>) {
    enable_codex_screen_monitor_inner(app, &state);
}

fn disable_codex_screen_monitor(state: tauri::State<CodexDetectorState>) {
    disable_codex_screen_monitor_inner(&state);
}

struct TargetWindowContext<'a> {
    process_names: &'a HashMap<u32, String>,
    windows: Vec<HWND>,
}

fn running_process_names() -> Result<HashMap<u32, String>, String> {
    unsafe {
        let snapshot =
            CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).map_err(|error| error.to_string())?;
        let mut processes = HashMap::new();
        let mut entry = PROCESSENTRY32W {
            dwSize: size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let end = entry
                    .szExeFile
                    .iter()
                    .position(|character| *character == 0)
                    .unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..end]).to_lowercase();
                processes.insert(entry.th32ProcessID, name);
                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
        Ok(processes)
    }
}

fn is_target_window_process(name: &str, codex_running: bool) -> bool {
    name == "codex.exe"
        || (codex_running
            && matches!(
                name,
                "windowsterminal.exe"
                    | "code.exe"
                    | "pwsh.exe"
                    | "powershell.exe"
                    | "cmd.exe"
                    | "openconsole.exe"
                    | "conhost.exe"
                    | "applicationframehost.exe"
            ))
}

unsafe extern "system" fn collect_target_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let context = unsafe { &mut *(lparam.0 as *mut TargetWindowContext<'_>) };
    if !unsafe { IsWindowVisible(hwnd) }.as_bool() {
        return BOOL(1);
    }
    let mut process_id = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut process_id)) };
    let codex_running = context
        .process_names
        .values()
        .any(|name| name == "codex.exe");
    let Some(process_name) = context.process_names.get(&process_id) else {
        return BOOL(1);
    };
    if !is_target_window_process(process_name, codex_running) {
        return BOOL(1);
    }
    let mut rect = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok()
        && rect.right - rect.left >= 100
        && rect.bottom - rect.top >= 60
    {
        context.windows.push(hwnd);
    }
    BOOL(1)
}

fn capture_codex_window_images() -> Result<Option<Vec<RgbaImage>>, String> {
    let processes = running_process_names()?;
    if !processes.values().any(|name| name == "codex.exe") {
        return Ok(None);
    }

    let mut context = TargetWindowContext {
        process_names: &processes,
        windows: Vec::new(),
    };
    unsafe {
        EnumWindows(
            Some(collect_target_window),
            LPARAM((&mut context as *mut TargetWindowContext<'_>) as isize),
        )
        .map_err(|error| error.to_string())?;
    }

    let images = context
        .windows
        .into_iter()
        .filter_map(|window| capture_window_image(window).ok())
        .collect();
    Ok(Some(images))
}

fn capture_window_image(hwnd: HWND) -> Result<RgbaImage, String> {
    unsafe {
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect).map_err(|error| error.to_string())?;
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width < 1 || height < 1 {
            return Err("目标窗口尺寸无效".to_string());
        }

        let window_dc = GetWindowDC(Some(hwnd));
        if window_dc.0.is_null() {
            return Err("无法获取目标窗口 DC".to_string());
        }
        let memory_dc = CreateCompatibleDC(Some(window_dc));
        if memory_dc.0.is_null() {
            ReleaseDC(Some(hwnd), window_dc);
            return Err("无法创建窗口截图 DC".to_string());
        }

        let mut bitmap_info = BITMAPINFO::default();
        bitmap_info.bmiHeader = BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };
        let mut bits = std::ptr::null_mut();
        let bitmap = match CreateDIBSection(
            Some(window_dc),
            &bitmap_info,
            DIB_RGB_COLORS,
            &mut bits,
            None,
            0,
        ) {
            Ok(bitmap) => bitmap,
            Err(error) => {
                let _ = DeleteDC(memory_dc);
                ReleaseDC(Some(hwnd), window_dc);
                return Err(error.to_string());
            }
        };
        let old_object = SelectObject(memory_dc, HGDIOBJ(bitmap.0));
        let printed =
            PrintWindow(hwnd, memory_dc, PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT)).as_bool();

        let image = if printed && !bits.is_null() {
            let bgra = slice::from_raw_parts(bits as *const u8, (width * height * 4) as usize);
            let mut rgba = Vec::with_capacity(bgra.len());
            for pixel in bgra.chunks_exact(4) {
                rgba.extend_from_slice(&[pixel[2], pixel[1], pixel[0], 255]);
            }
            RgbaImage::from_raw(width as u32, height as u32, rgba)
                .ok_or_else(|| "无法构造窗口截图".to_string())
        } else {
            Err("PrintWindow 无法捕获目标窗口".to_string())
        };

        SelectObject(memory_dc, old_object);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        let _ = DeleteDC(memory_dc);
        ReleaseDC(Some(hwnd), window_dc);
        image
    }
}

fn detect_codex_status(
    templates: &[CodexDetectionTemplate],
) -> Result<Option<CodexDetectionMatch>, String> {
    let mut capture_errors = Vec::new();
    let mut captures = Vec::new();
    let Some(window_images) = capture_codex_window_images()? else {
        return Ok(None);
    };
    for (window_index, image) in window_images.into_iter().enumerate() {
        let gray = rgba_to_gray_mat(&image).map_err(|error| error.to_string())?;
        let coarse_gray =
            resize_mat(&gray, OPENCV_COARSE_SCALE).map_err(|error| error.to_string())?;
        captures.push((window_index, image, gray, coarse_gray));
    }

    if captures.is_empty() {
        let screens = screenshots::Screen::all().map_err(|error| error.to_string())?;
        for (screen_index, screen) in screens.into_iter().enumerate() {
            let capture = match screen.capture() {
                Ok(capture) => capture,
                Err(error) => {
                    capture_errors.push(error.to_string());
                    continue;
                }
            };
            let image = RgbaImage::from_raw(capture.width(), capture.height(), capture.into_raw())
                .ok_or_else(|| "无法解析屏幕截图像素".to_string())?;
            let gray = rgba_to_gray_mat(&image).map_err(|error| error.to_string())?;
            let coarse_gray =
                resize_mat(&gray, OPENCV_COARSE_SCALE).map_err(|error| error.to_string())?;
            captures.push((screen_index, image, gray, coarse_gray));
        }
    }

    if captures.is_empty() {
        return Err(format!("所有显示器截屏失败: {}", capture_errors.join("; ")));
    }

    let mut best_detection: Option<CodexDetectionMatch> = None;
    for detection_template in templates {
        for (screen_index, image, source_gray, source_coarse_gray) in &captures {
            for variant in &detection_template.variants {
                if let Some(found) = find_opencv_template_match(
                    source_gray,
                    source_coarse_gray,
                    variant,
                    detection_template.kind,
                )? {
                    let detection = CodexDetectionMatch {
                        kind: detection_template.kind,
                        screen_index: *screen_index,
                        x: found.x,
                        y: found.y,
                        width: variant.image.width(),
                        height: variant.image.height(),
                        score: found.score,
                        confidence: found.confidence,
                        scale: found.scale,
                        consecutive_frames: 1,
                        image: annotated_match_image(
                            image,
                            found.x,
                            found.y,
                            variant.image.width(),
                            variant.image.height(),
                        ),
                    };
                    let replace = best_detection
                        .as_ref()
                        .is_none_or(|current| detection_is_preferred(&detection, current));
                    if replace {
                        best_detection = Some(detection);
                    }
                }
            }
        }
    }

    if !capture_errors.is_empty() {
        return Err(format!(
            "Some displays could not be captured: {}",
            capture_errors.join("; ")
        ));
    }

    Ok(best_detection)
}

fn detection_priority(kind: CodexDetectionKind) -> u8 {
    match kind {
        CodexDetectionKind::CliApproval => 3,
        CodexDetectionKind::CliWorking | CodexDetectionKind::GuiWorking => 2,
        CodexDetectionKind::CliReady => 1,
    }
}

fn detection_is_preferred(candidate: &CodexDetectionMatch, current: &CodexDetectionMatch) -> bool {
    detection_priority(candidate.kind) > detection_priority(current.kind)
        || (detection_priority(candidate.kind) == detection_priority(current.kind)
            && candidate.confidence > current.confidence)
}

fn scaled_codex_templates(
    template: &RgbaImage,
    template_scale: f32,
) -> opencv::Result<Vec<CodexTemplateVariant>> {
    let mut templates = Vec::new();
    for scale in [template_scale] {
        let width = ((template.width() as f32) * scale).round().max(1.0) as u32;
        let height = ((template.height() as f32) * scale).round().max(1.0) as u32;
        let image = if width == template.width() && height == template.height() {
            template.clone()
        } else {
            image::imageops::resize(template, width, height, FilterType::Triangle)
        };
        let gray = rgba_to_gray_mat(&image)?;
        let coarse_gray = resize_mat(&gray, OPENCV_COARSE_SCALE)?;
        templates.push(CodexTemplateVariant {
            image,
            gray,
            coarse_gray,
            scale,
        });
    }
    Ok(templates)
}

fn find_opencv_template_match(
    source: &Mat,
    coarse_source: &Mat,
    template: &CodexTemplateVariant,
    kind: CodexDetectionKind,
) -> Result<Option<TemplateMatch>, String> {
    if source.cols() < template.gray.cols() || source.rows() < template.gray.rows() {
        return Ok(None);
    }

    let threshold = match kind {
        CodexDetectionKind::CliApproval => CLI_APPROVAL_MATCH_THRESHOLD,
        CodexDetectionKind::GuiWorking => GUI_MATCH_THRESHOLD,
        CodexDetectionKind::CliWorking | CodexDetectionKind::CliReady => CLI_MATCH_THRESHOLD,
    };
    let coarse_matches = opencv_top_matches(
        coarse_source,
        &template.coarse_gray,
        OPENCV_COARSE_CANDIDATES,
        OPENCV_COARSE_THRESHOLD,
    )?;
    let mut best: Option<TemplateMatch> = None;
    for (_, coarse_location) in coarse_matches {
        let estimated_x = (coarse_location.x as f64 / OPENCV_COARSE_SCALE).round() as i32;
        let estimated_y = (coarse_location.y as f64 / OPENCV_COARSE_SCALE).round() as i32;
        let roi_x = (estimated_x - OPENCV_REFINE_PADDING).clamp(0, source.cols() - 1);
        let roi_y = (estimated_y - OPENCV_REFINE_PADDING).clamp(0, source.rows() - 1);
        let roi_right = (estimated_x + template.gray.cols() + OPENCV_REFINE_PADDING)
            .clamp(roi_x + template.gray.cols(), source.cols());
        let roi_bottom = (estimated_y + template.gray.rows() + OPENCV_REFINE_PADDING)
            .clamp(roi_y + template.gray.rows(), source.rows());
        let roi = source
            .roi(Rect::new(
                roi_x,
                roi_y,
                roi_right - roi_x,
                roi_bottom - roi_y,
            ))
            .map_err(|error| error.to_string())?;
        let (max_value, local_location) = opencv_max_match(&roi, &template.gray)?;
        if max_value < threshold {
            continue;
        }
        let max_location = Point::new(roi_x + local_location.x, roi_y + local_location.y);
        let candidate = TemplateMatch {
            x: max_location.x.max(0) as u32,
            y: max_location.y.max(0) as u32,
            score: (1.0 - max_value) * 100.0,
            confidence: max_value,
            scale: template.scale,
        };
        if best.as_ref().is_none_or(|current| {
            candidate.confidence > current.confidence + 0.001
                || ((candidate.confidence - current.confidence).abs() <= 0.001
                    && candidate.x < current.x)
        }) {
            best = Some(candidate);
        }
    }
    Ok(best)
}

fn opencv_top_matches(
    source: &impl opencv::core::ToInputArray,
    template: &Mat,
    limit: usize,
    threshold: f64,
) -> Result<Vec<(f64, Point)>, String> {
    let mut result = Mat::default();
    imgproc::match_template(
        source,
        template,
        &mut result,
        imgproc::TM_CCOEFF_NORMED,
        &core::no_array(),
    )
    .map_err(|error| error.to_string())?;
    let mut matches = Vec::new();
    for _ in 0..limit {
        let mut max_value = 0.0;
        let mut max_location = Point::default();
        core::min_max_loc(
            &result,
            None,
            Some(&mut max_value),
            None,
            Some(&mut max_location),
            &core::no_array(),
        )
        .map_err(|error| error.to_string())?;
        if max_value < threshold {
            break;
        }
        matches.push((max_value, max_location));
        let left = (max_location.x - template.cols() / 2).max(0);
        let top = (max_location.y - template.rows() / 2).max(0);
        let right = (max_location.x + template.cols() / 2 + 1).min(result.cols());
        let bottom = (max_location.y + template.rows() / 2 + 1).min(result.rows());
        imgproc::rectangle(
            &mut result,
            Rect::new(left, top, right - left, bottom - top),
            Scalar::all(-1.0),
            imgproc::FILLED,
            imgproc::LINE_8,
            0,
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(matches)
}

fn opencv_max_match(
    source: &impl opencv::core::ToInputArray,
    template: &impl opencv::core::ToInputArray,
) -> Result<(f64, Point), String> {
    let mut result = Mat::default();
    imgproc::match_template(
        source,
        template,
        &mut result,
        imgproc::TM_CCOEFF_NORMED,
        &core::no_array(),
    )
    .map_err(|error| error.to_string())?;
    let mut max_value = 0.0;
    let mut max_location = Point::default();
    core::min_max_loc(
        &result,
        None,
        Some(&mut max_value),
        None,
        Some(&mut max_location),
        &core::no_array(),
    )
    .map_err(|error| error.to_string())?;
    Ok((max_value, max_location))
}

fn resize_mat(source: &Mat, scale: f64) -> opencv::Result<Mat> {
    let mut resized = Mat::default();
    imgproc::resize(
        source,
        &mut resized,
        Size::new(0, 0),
        scale,
        scale,
        imgproc::INTER_AREA,
    )?;
    Ok(resized)
}

fn rgba_to_gray_mat(image: &RgbaImage) -> opencv::Result<Mat> {
    let rgba = Mat::from_slice(image.as_raw())?;
    let rgba = rgba.reshape(4, image.height() as i32)?;
    let mut gray = Mat::default();
    imgproc::cvt_color(
        &rgba,
        &mut gray,
        imgproc::COLOR_RGBA2GRAY,
        0,
        core::AlgorithmHint::ALGO_HINT_DEFAULT,
    )?;
    Ok(gray)
}

fn annotated_match_image(source: &RgbaImage, x: u32, y: u32, width: u32, height: u32) -> RgbaImage {
    let crop_x = x.saturating_sub(CODEX_CONTEXT_PADDING);
    let crop_y = y.saturating_sub(CODEX_CONTEXT_PADDING);
    let crop_right = (x + width + CODEX_CONTEXT_PADDING).min(source.width());
    let crop_bottom = (y + height + CODEX_CONTEXT_PADDING).min(source.height());
    let mut image = image::imageops::crop_imm(
        source,
        crop_x,
        crop_y,
        crop_right - crop_x,
        crop_bottom - crop_y,
    )
    .to_image();
    let left = x - crop_x;
    let top = y - crop_y;
    let right = (left + width - 1).min(image.width() - 1);
    let bottom = (top + height - 1).min(image.height() - 1);
    let border = Rgba([45, 212, 191, 255]);
    for px in left..=right {
        image.put_pixel(px, top, border);
        image.put_pixel(px, bottom, border);
    }
    for py in top..=bottom {
        image.put_pixel(left, py, border);
        image.put_pixel(right, py, border);
    }
    image
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
fn load_workflow_return_alert(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    let path = workflow_return_alert_file(&app)?;
    if !path.exists() {
        return Ok(None);
    }

    let text = fs::read_to_string(&path)
        .map_err(|error| format!("Unable to read workflow alert file: {error}"))?;
    let data = serde_json::from_str(&text)
        .map_err(|error| format!("Invalid workflow alert JSON: {error}"))?;
    Ok(Some(data))
}

#[tauri::command]
fn save_workflow_return_alert(app: tauri::AppHandle, data: Value) -> Result<(), String> {
    let path = workflow_return_alert_file(&app)?;
    let text = serde_json::to_string_pretty(&data)
        .map_err(|error| format!("Unable to serialize workflow alert: {error}"))?;
    fs::write(&path, text).map_err(|error| format!("Unable to write workflow alert file: {error}"))
}

#[tauri::command]
fn acknowledge_workflow_return_alert(app: tauri::AppHandle) -> Result<(), String> {
    let path = workflow_return_alert_file(&app)?;
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("Unable to remove workflow alert file: {error}"))?;
    }
    Ok(())
}

#[tauri::command]
fn load_codex_match_image(app: tauri::AppHandle) -> Result<Option<Vec<u8>>, String> {
    let path = codex_match_file(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read(path)
        .map(Some)
        .map_err(|error| format!("Unable to read match image: {error}"))
}

#[tauri::command]
fn load_codex_detector_enabled(app: tauri::AppHandle) -> bool {
    read_codex_detector_enabled(&app)
}

#[tauri::command]
fn load_codex_detector_settings(app: tauri::AppHandle) -> CodexDetectorSettings {
    read_codex_detector_settings(&app)
}

fn set_codex_status_window_visible(app: &tauri::AppHandle, visible: bool) {
    if let Some(window) = app.get_webview_window("codex-status") {
        if visible {
            let _ = window.show();
        } else {
            let _ = window.hide();
        }
    }
}

#[tauri::command]
fn set_codex_detector_enabled(
    app: tauri::AppHandle,
    state: tauri::State<CodexDetectorState>,
    enabled: bool,
) -> Result<bool, String> {
    write_codex_detector_enabled(&app, enabled)?;
    if enabled {
        enable_codex_screen_monitor(app.clone(), state);
    } else {
        disable_codex_screen_monitor(state);
    }
    set_codex_status_window_visible(&app, enabled);
    Ok(enabled)
}

#[tauri::command]
fn set_codex_detector_settings(
    app: tauri::AppHandle,
    state: tauri::State<CodexDetectorState>,
    settings: CodexDetectorSettings,
) -> Result<CodexDetectorSettings, String> {
    let next_settings = write_codex_detector_settings(&app, settings)?;
    disable_codex_screen_monitor_inner(&state);
    if next_settings.enabled {
        enable_codex_screen_monitor_inner(app.clone(), &state);
    }
    set_codex_status_window_visible(&app, next_settings.enabled);
    Ok(next_settings)
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

            let codex_status_window = WebviewWindowBuilder::new(
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

            let detector_enabled = read_codex_detector_enabled(&app.handle());
            if detector_enabled {
                let state = app.state::<CodexDetectorState>();
                enable_codex_screen_monitor(app.handle().clone(), state);
            } else {
                let _ = codex_status_window.hide();
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
            load_workflow_return_alert,
            save_workflow_return_alert,
            acknowledge_workflow_return_alert,
            load_codex_match_image,
            load_codex_detector_settings,
            load_codex_detector_enabled,
            set_codex_detector_enabled,
            set_codex_detector_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn load_test_template(file_name: &str) -> RgbaImage {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("scripts")
            .join(file_name);
        image::open(path).unwrap().to_rgba8()
    }

    fn test_variant(image: RgbaImage, scale: f32) -> CodexTemplateVariant {
        let gray = rgba_to_gray_mat(&image).unwrap();
        let coarse_gray = resize_mat(&gray, OPENCV_COARSE_SCALE).unwrap();
        CodexTemplateVariant {
            image,
            gray,
            coarse_gray,
            scale,
        }
    }

    fn test_match(
        source: &RgbaImage,
        variant: &CodexTemplateVariant,
        kind: CodexDetectionKind,
    ) -> Option<TemplateMatch> {
        let source = rgba_to_gray_mat(source).unwrap();
        let coarse_source = resize_mat(&source, OPENCV_COARSE_SCALE).unwrap();
        find_opencv_template_match(&source, &coarse_source, variant, kind).unwrap()
    }

    #[test]
    fn codex_templates_match_themselves() {
        for kind in [
            CodexDetectionKind::CliApproval,
            CodexDetectionKind::CliWorking,
            CodexDetectionKind::GuiWorking,
            CodexDetectionKind::CliReady,
        ] {
            let template = load_test_template(kind.template_name());
            let variant = test_variant(template.clone(), 1.0);
            let found = test_match(&template, &variant, kind);
            assert!(found.is_some(), "template {} did not match", kind.key());
        }
    }

    #[test]
    fn cli_templates_do_not_match_blank_terminal_background() {
        for kind in [
            CodexDetectionKind::CliApproval,
            CodexDetectionKind::CliWorking,
            CodexDetectionKind::CliReady,
        ] {
            let template = load_test_template(kind.template_name());
            let blank = RgbaImage::from_pixel(
                template.width(),
                template.height(),
                image::Rgba([0, 0, 0, 255]),
            );
            let variant = test_variant(template, 1.0);
            let found = test_match(&blank, &variant, kind);
            assert!(found.is_none(), "blank screen matched {}", kind.key());
        }
    }

    #[test]
    fn one_to_one_template_is_located_at_its_screen_position() {
        let kind = CodexDetectionKind::CliWorking;
        let template = load_test_template(kind.template_name());
        let variant = test_variant(template.clone(), 1.0);
        let mut screen = RgbaImage::from_pixel(
            template.width() + 90,
            template.height() + 100,
            image::Rgba([0, 0, 0, 255]),
        );
        image::imageops::overlay(&mut screen, &template, 41, 53);
        let found = test_match(&screen, &variant, kind).unwrap();
        assert_eq!((found.x, found.y), (41, 53));
    }

    #[test]
    fn ready_template_matches_at_left_window_edge() {
        let kind = CodexDetectionKind::CliReady;
        let template = load_test_template(kind.template_name());
        let variant = test_variant(template.clone(), 1.0);
        let mut screen = RgbaImage::from_pixel(640, 240, Rgba([0, 0, 0, 255]));
        image::imageops::overlay(&mut screen, &template, 0, 84);
        let found = test_match(&screen, &variant, kind).expect("left-edge Ready was not found");
        assert_eq!(found.x, 0);
        assert!(found.y.abs_diff(84) <= 2);
    }

    #[test]
    fn equally_good_ready_matches_prefer_the_left_candidate() {
        let kind = CodexDetectionKind::CliReady;
        let template = load_test_template(kind.template_name());
        let variant = test_variant(template.clone(), 1.0);
        let mut screen = RgbaImage::from_pixel(640, 240, Rgba([0, 0, 0, 255]));
        image::imageops::overlay(&mut screen, &template, 0, 84);
        image::imageops::overlay(&mut screen, &template, 420, 84);
        let found = test_match(&screen, &variant, kind).expect("Ready candidates were not found");
        assert_eq!(found.x, 0);
    }

    #[test]
    fn cli_templates_reject_color_blocks_and_partial_text() {
        let kind = CodexDetectionKind::CliWorking;
        let template = load_test_template(kind.template_name());
        let variant = test_variant(template.clone(), 1.0);
        let mut color_block =
            RgbaImage::from_pixel(template.width(), template.height(), Rgba([0, 0, 0, 255]));
        for y in 5..template.height().saturating_sub(5) {
            for x in 5..template.width() / 2 {
                color_block.put_pixel(x, y, Rgba([190, 120, 255, 255]));
            }
        }
        assert!(test_match(&color_block, &variant, kind).is_none());

        let mut partial = template.clone();
        for y in 0..partial.height() {
            for x in partial.width() / 2..partial.width() {
                partial.put_pixel(x, y, Rgba([0, 0, 0, 255]));
            }
        }
        assert!(test_match(&partial, &variant, kind).is_none());
    }

    fn dummy_detection(kind: CodexDetectionKind) -> CodexDetectionMatch {
        CodexDetectionMatch {
            kind,
            screen_index: 0,
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            score: 0.0,
            confidence: 1.0,
            scale: 1.0,
            consecutive_frames: 1,
            image: RgbaImage::new(1, 1),
        }
    }

    #[test]
    fn stabilizer_uses_balanced_frame_rules() {
        let mut stabilizer = CodexDetectionStabilizer::default();
        assert!(matches!(
            stabilizer.update(Some(dummy_detection(CodexDetectionKind::CliWorking))),
            CodexStableUpdate::Hold
        ));
        assert!(matches!(
            stabilizer.update(Some(dummy_detection(CodexDetectionKind::CliWorking))),
            CodexStableUpdate::Detection(_)
        ));
        assert!(matches!(stabilizer.update(None), CodexStableUpdate::Hold));
        assert!(matches!(stabilizer.update(None), CodexStableUpdate::Idle));

        assert!(matches!(
            stabilizer.update(Some(dummy_detection(CodexDetectionKind::CliApproval))),
            CodexStableUpdate::Detection(_)
        ));
    }

    #[test]
    fn detection_priority_beats_confidence() {
        let mut ready = dummy_detection(CodexDetectionKind::CliReady);
        ready.confidence = 0.99;
        let mut working = dummy_detection(CodexDetectionKind::CliWorking);
        working.confidence = 0.90;
        let mut approval = dummy_detection(CodexDetectionKind::CliApproval);
        approval.confidence = 0.87;

        assert!(detection_is_preferred(&working, &ready));
        assert!(detection_is_preferred(&approval, &working));
        assert!(!detection_is_preferred(&ready, &approval));
    }

    #[test]
    fn target_process_filter_covers_codex_and_terminal_hosts() {
        assert!(is_target_window_process("codex.exe", false));
        assert!(is_target_window_process("windowsterminal.exe", true));
        assert!(is_target_window_process("code.exe", true));
        assert!(is_target_window_process("applicationframehost.exe", true));
        assert!(!is_target_window_process("windowsterminal.exe", false));
        assert!(!is_target_window_process("explorer.exe", true));
    }

    #[test]
    #[ignore = "requires access to the current desktop"]
    fn benchmark_live_opencv_detection_cycle() {
        let templates = [
            CodexDetectionKind::CliApproval,
            CodexDetectionKind::CliWorking,
            CodexDetectionKind::GuiWorking,
            CodexDetectionKind::CliReady,
        ]
        .into_iter()
        .map(|kind| {
            let image = load_test_template(kind.template_name());
            CodexDetectionTemplate {
                kind,
                variants: scaled_codex_templates(&image, 1.0).unwrap(),
            }
        })
        .collect::<Vec<_>>();
        let started = std::time::Instant::now();
        match detect_codex_status(&templates) {
            Ok(_) => println!("OpenCV detection cycle: {:?}", started.elapsed()),
            Err(error) => println!(
                "OpenCV detection cycle skipped after {:?}: {error}",
                started.elapsed()
            ),
        }
    }
}
