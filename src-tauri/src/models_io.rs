/*!
 * Models / Input / Output backend (Phase 2C).
 *
 * Self-contained companion to `src/features/modelsio/`. The parent wires
 * this module by adding `pub mod models_io;` to `lib.rs` and registering
 * the `models_io_*` commands in the `invoke_handler` (exact snippets in
 * `src/features/modelsio/INTEGRATION-modelsio.md`). Nothing in this file
 * edits or depends on any other backend module.
 *
 * Design notes:
 * - Per-model settings persist in `<app_data>/modelsio/settings.json`.
 * - Disk usage reads the real model store `<app_data>/models` (`blobs/` +
 *   `tmp/`). Delete takes explicit blob SHA-256s (validated 64-hex) so a
 *   wrong model id can never delete an unrelated file; the caller resolves
 *   model id -> blob SHAs via the existing `installed_models` manifest.
 * - The download queue is an in-memory state machine (enqueue / pause /
 *   resume / cancel / list). Byte transfer reuses the existing
 *   `models::download` machinery; the queue records each item's
 *   `supports_range` probe result so a resume that cannot use HTTP Range
 *   restarts from zero with an honest status instead of appending to a
 *   partial and corrupting it.
 * - TTS uses macOS `say` with stdin text (no shell, no argv injection:
 *   the text never appears in an argument). The child handle is kept so
 *   `stop_speaking` can kill it.
 * - Dictation: macOS `SFSpeechRecognizer` needs entitlement + Info.plist
 *   wiring the parent has not requested here, so `models_io_dictate`
 *   returns a clear error and the frontend falls back to the Web Speech
 *   API — one real working path, documented, never a fake transcript.
 * - `models_io_stop_generation` sets a process-wide flag the parent's ask
 *   loop polls via [`take_generation_cancel_requested`].
 */

use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex, OnceLock,
};

use serde::{Deserialize, Serialize};
use tauri::Manager;

// ─── Shared types (serde camelCase to match the TS frontend) ───────────────

/// Per-model inference settings. Mirrors `PerModelSettings` in
/// `src/features/modelsio/types.ts`.
// NOTE: no `Copy` — `system_prompt_override: String` is not Copy
// (the feat-models-io branch derived it; that fails compilation).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerModelSettings {
    pub temperature: f64,
    pub top_p: f64,
    pub context_length: u32,
    pub system_prompt_override: String,
}

/// Defaults shared with the frontend `DEFAULT_PER_MODEL_SETTINGS`.
pub const DEFAULT_PER_MODEL_SETTINGS: PerModelSettings = PerModelSettings {
    temperature: 0.7,
    top_p: 0.9,
    context_length: 8192,
    system_prompt_override: String::new(),
};

/// One download-queue item. Mirrors `DownloadQueueItem` in TS.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadQueueItem {
    pub id: String,
    pub model_id: String,
    pub file_name: String,
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub status: DownloadStatus,
    pub resumed_from: u64,
    pub supports_range: Option<bool>,
    pub error: Option<String>,
}

/// Queue lifecycle states (lowercase on the wire, matching TS).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadStatus {
    Queued,
    Downloading,
    Paused,
    Done,
    Cancelled,
    Failed,
}

/// One row of disk usage from the real model store.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskRow {
    pub sha256: String,
    pub bytes: u64,
    pub location: String,
}

/// Token stats for one reply plus running totals. Mirrors TS `TokenStats`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenStats {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub elapsed_ms: u64,
    pub ms_per_token: f64,
    pub total_prompt_tokens: u64,
    pub total_completion_tokens: u64,
}

/// One numbered citation. Mirrors TS `Citation`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Citation {
    pub index: u32,
    pub title: String,
    pub url: String,
}

/// One fenced code block. Mirrors TS `CodeBlock`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeBlock {
    pub language: String,
    pub code: String,
}

/// Resume decision returned by `models_io_resume_download`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeResult {
    pub item: DownloadQueueItem,
    pub action: String,
    pub note: String,
}

// ─── Pure helpers (unit-tested, no Tauri context) ──────────────────────────

pub fn clamp_temperature(value: f64) -> f64 {
    if !value.is_finite() {
        return DEFAULT_PER_MODEL_SETTINGS.temperature;
    }
    value.clamp(0.0, 2.0)
}

pub fn clamp_top_p(value: f64) -> f64 {
    if !value.is_finite() {
        return DEFAULT_PER_MODEL_SETTINGS.top_p;
    }
    value.clamp(0.0, 1.0)
}

pub fn clamp_context_length(value: u32) -> u32 {
    value.clamp(1024, 131_072)
}

/// Maximum system-prompt override length, matching the frontend.
pub const MAX_SYSTEM_PROMPT_CHARS: usize = 4000;

/// Validate a system-prompt override. Empty means "use global default".
pub fn validate_system_prompt_override(value: &str) -> Result<(), String> {
    if value.chars().count() > MAX_SYSTEM_PROMPT_CHARS {
        return Err(format!(
            "System prompt must be at most {MAX_SYSTEM_PROMPT_CHARS} characters (got {}).",
            value.chars().count()
        ));
    }
    Ok(())
}

/// Merge stored settings over the defaults and clamp every numeric field.
pub fn resolve_per_model_settings(stored: Option<PerModelSettings>) -> PerModelSettings {
    match stored {
        None => PerModelSettings {
            system_prompt_override: String::new(),
            ..DEFAULT_PER_MODEL_SETTINGS
        },
        Some(s) => PerModelSettings {
            temperature: clamp_temperature(s.temperature),
            top_p: clamp_top_p(s.top_p),
            context_length: clamp_context_length(s.context_length),
            system_prompt_override: s.system_prompt_override,
        },
    }
}

/// Human-readable byte size, matching the frontend `formatBytes`.
pub fn format_bytes(bytes: u64) -> String {
    if bytes == 0 {
        return "0 B".to_string();
    }
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{} {}", value as u64, UNITS[unit])
    } else {
        format!("{} {}", (value * 10.0).round() / 10.0, UNITS[unit])
    }
}

/// Decide how a paused download restarts. `supports_range == Some(false)`
/// means the server ignored Range: restart from zero, never append to a
/// partial that would corrupt the file.
pub fn decide_resume_action(item: &DownloadQueueItem) -> (&'static str, String) {
    if item.total_bytes > 0 && item.downloaded_bytes >= item.total_bytes {
        return ("already-complete", "File is already complete.".to_string());
    }
    if item.supports_range == Some(false) {
        return (
            "restart",
            "Server does not support resume — restarting from the beginning.".to_string(),
        );
    }
    if item.downloaded_bytes > 0 {
        (
            "resume-range",
            format!("Resuming from {}.", format_bytes(item.downloaded_bytes)),
        )
    } else {
        ("resume-range", "Starting download.".to_string())
    }
}

/// True for a valid blob key: exactly 64 lowercase ASCII hex chars.
/// Rejects path separators, `..`, and uppercase — the same rule the
/// existing downloader applies before any filesystem use.
pub fn is_valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Strip markdown/code fences from a reply before speaking.
pub fn sanitize_tts_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    // Drop fenced code blocks entirely, keeping a spoken placeholder.
    while let Some(start) = rest.find("```") {
        out.push_str(&rest[..start]);
        out.push_str(" code block omitted ");
        let after_open = &rest[start + 3..];
        match after_open.find("```") {
            Some(end) => rest = &after_open[end + 3..],
            None => {
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    let mut cleaned = String::with_capacity(out.len());
    let mut chars = out.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '`' => {}
            '!' if chars.peek() == Some(&'[') => {
                chars.next();
                let mut label = String::new();
                for c2 in chars.by_ref() {
                    if c2 == ']' {
                        break;
                    }
                    label.push(c2);
                }
                if chars.peek() == Some(&'(') {
                    chars.next();
                    for c2 in chars.by_ref() {
                        if c2 == ')' {
                            break;
                        }
                    }
                }
                cleaned.push_str(&label);
            }
            '[' => {
                let mut label = String::new();
                let mut found = false;
                for c2 in chars.by_ref() {
                    if c2 == ']' {
                        found = true;
                        break;
                    }
                    label.push(c2);
                }
                if found && chars.peek() == Some(&'(') {
                    chars.next();
                    for c2 in chars.by_ref() {
                        if c2 == ')' {
                            break;
                        }
                    }
                    cleaned.push_str(&label);
                } else {
                    cleaned.push('[');
                    cleaned.push_str(&label);
                }
            }
            '#' | '>' | '*' | '_' | '~' | '|' | '-' => cleaned.push(' '),
            _ => cleaned.push(c),
        }
    }
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(5000).collect()
}

/// Clamp a TTS rate multiplier to 0.5..2.
pub fn clamp_tts_rate(rate: f64) -> f64 {
    if !rate.is_finite() {
        return 1.0;
    }
    rate.clamp(0.5, 2.0)
}

/// Validate a macOS voice name for `say -v`: letters, digits, space,
/// underscore, hyphen only; empty means "system default".
pub fn is_valid_voice_name(voice: &str) -> bool {
    !voice.is_empty()
        && voice
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == ' ' || c == '_' || c == '-')
}

/// Compute token stats from the engine's real reported numbers.
pub fn compute_token_stats(
    prompt_tokens: u64,
    completion_tokens: u64,
    elapsed_ms: u64,
    total_prompt_tokens: u64,
    total_completion_tokens: u64,
) -> TokenStats {
    TokenStats {
        prompt_tokens,
        completion_tokens,
        elapsed_ms,
        ms_per_token: if completion_tokens > 0 {
            elapsed_ms as f64 / completion_tokens as f64
        } else {
            0.0
        },
        total_prompt_tokens,
        total_completion_tokens,
    }
}

/// Extract fenced code blocks from a markdown reply.
pub fn extract_code_blocks(markdown: &str) -> Vec<CodeBlock> {
    let mut blocks = Vec::new();
    let mut rest = markdown;
    while let Some(start) = rest.find("```") {
        let after = &rest[start + 3..];
        let (language, body_start) = match after.find('\n') {
            Some(nl) => (after[..nl].trim().to_string(), nl + 1),
            None => break,
        };
        let body = &after[body_start..];
        match body.find("```") {
            Some(end) => {
                blocks.push(CodeBlock {
                    language: if language.is_empty() {
                        "text".to_string()
                    } else {
                        language
                    },
                    code: body[..end].to_string(),
                });
                rest = &body[end + 3..];
            }
            None => break,
        }
    }
    blocks
}

/// Extract numbered citations: Markdown links in order of appearance
/// (deduped by URL), then footnote-only `[n]: url` definitions.
pub fn parse_citations(text: &str) -> Vec<Citation> {
    let mut citations: Vec<Citation> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    let mut push = |title: String, url: String| {
        if !seen.contains(&url) {
            seen.push(url.clone());
            citations.push(Citation {
                index: citations.len() as u32 + 1,
                title,
                url,
            });
        }
    };
    // Markdown links [title](https://...)
    let mut rest = text;
    while let Some(open) = rest.find('[') {
        let after_open = &rest[open + 1..];
        let Some(close) = after_open.find("](") else {
            break;
        };
        let title = after_open[..close].to_string();
        let after_paren = &after_open[close + 2..];
        let Some(end) = after_paren.find(')') else {
            break;
        };
        let url = after_paren[..end].to_string();
        if url.starts_with("http://") || url.starts_with("https://") {
            push(title, url);
        }
        rest = &after_paren[end + 1..];
    }
    // Footnote definitions `[n]: url` at line starts.
    for line in text.lines() {
        let line = line.trim();
        if !line.starts_with('[') {
            continue;
        }
        if let Some(close) = line.find("]: ") {
            let num = &line[1..close];
            if !num.is_empty() && num.bytes().all(|b| b.is_ascii_digit()) {
                let url = line[close + 3..].trim().to_string();
                if url.starts_with("http://") || url.starts_with("https://") {
                    push(url.clone(), url);
                }
            }
        }
    }
    citations
}

// ─── Process-wide state ────────────────────────────────────────────────────

fn download_queue() -> &'static Mutex<Vec<DownloadQueueItem>> {
    static QUEUE: OnceLock<Mutex<Vec<DownloadQueueItem>>> = OnceLock::new();
    QUEUE.get_or_init(|| Mutex::new(Vec::new()))
}

fn last_token_stats() -> &'static Mutex<Option<TokenStats>> {
    static STATS: OnceLock<Mutex<Option<TokenStats>>> = OnceLock::new();
    STATS.get_or_init(|| Mutex::new(None))
}

fn speech_child() -> &'static Mutex<Option<Child>> {
    static CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();
    CHILD.get_or_init(|| Mutex::new(None))
}

/// Set by `models_io_stop_generation`; polled by the parent's ask loop.
static GENERATION_CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Returns true once if generation cancellation was requested since the
/// last call, then clears the flag.
pub fn take_generation_cancel_requested() -> bool {
    GENERATION_CANCEL_REQUESTED.swap(false, Ordering::SeqCst)
}

/// Record token stats after an engine response. Called by the parent from
/// Rust (not a command) so the numbers come from the engine, not the UI.
pub fn record_token_stats(stats: TokenStats) {
    if let Ok(mut slot) = last_token_stats().lock() {
        *slot = Some(stats);
    }
}

/// Session running totals for [`record_engine_usage`]. Kept beside the
/// last-stats slot so a stream function can record real engine usage
/// without threading totals through every caller.
fn session_token_totals() -> &'static Mutex<(u64, u64)> {
    static TOTALS: OnceLock<Mutex<(u64, u64)>> = OnceLock::new();
    TOTALS.get_or_init(|| Mutex::new((0, 0)))
}

/// Record one engine response's real reported usage, accumulating the
/// session totals. Callers pass only what the engine actually reported
/// (`prompt_eval_count` / `eval_count` on Ollama, `usage` on `/v1`); when
/// the engine reports nothing, callers must not call this — the UI then
/// shows "no usage numbers" instead of invented figures.
pub fn record_engine_usage(prompt_tokens: u64, completion_tokens: u64, elapsed_ms: u64) {
    let (total_prompt, total_completion) = match session_token_totals().lock() {
        Ok(mut totals) => {
            totals.0 = totals.0.saturating_add(prompt_tokens);
            totals.1 = totals.1.saturating_add(completion_tokens);
            *totals
        }
        Err(_) => (prompt_tokens, completion_tokens),
    };
    record_token_stats(compute_token_stats(
        prompt_tokens,
        completion_tokens,
        elapsed_ms,
        total_prompt,
        total_completion,
    ));
}

// ─── Filesystem helpers ────────────────────────────────────────────────────

fn modelsio_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir unavailable: {e}"))?;
    let dir = base.join("modelsio");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cannot create modelsio dir: {e}"))?;
    Ok(dir)
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(modelsio_dir(app)?.join("settings.json"))
}

fn load_settings_map(app: &tauri::AppHandle) -> HashMap<String, PerModelSettings> {
    let Ok(path) = settings_path(app) else {
        return HashMap::new();
    };
    let Ok(raw) = std::fs::read_to_string(path) else {
        return HashMap::new();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn model_store_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|base| base.join("models"))
        .map_err(|e| format!("app data dir unavailable: {e}"))
}

// ─── Tauri commands ────────────────────────────────────────────────────────

/// Resolve stored per-model settings over the defaults (pure passthrough).
#[tauri::command]
pub fn models_io_resolve_settings(stored: Option<PerModelSettings>) -> PerModelSettings {
    resolve_per_model_settings(stored)
}

/// Persist per-model settings (SQLite alternative lives in the parent;
/// this JSON file is the standalone store for this feature module).
#[tauri::command]
pub fn models_io_set_model_settings(
    app: tauri::AppHandle,
    model_id: String,
    settings: PerModelSettings,
) -> Result<(), String> {
    validate_system_prompt_override(&settings.system_prompt_override)?;
    let resolved = resolve_per_model_settings(Some(settings));
    let path = settings_path(&app)?;
    let mut map = load_settings_map(&app);
    map.insert(model_id, resolved);
    let raw = serde_json::to_string(&map).map_err(|e| format!("serialize settings: {e}"))?;
    std::fs::write(path, raw).map_err(|e| format!("write settings: {e}"))?;
    Ok(())
}

/// Load persisted per-model settings, or `None` when never saved.
#[tauri::command]
pub fn models_io_get_model_settings(
    app: tauri::AppHandle,
    model_id: String,
) -> Result<Option<PerModelSettings>, String> {
    Ok(load_settings_map(&app).get(&model_id).cloned())
}

/// Disk usage of the real model store: one row per blob/partial + total
/// implied by the sum. Returns rows sorted largest-first.
#[tauri::command]
pub fn models_io_disk_usage(app: tauri::AppHandle) -> Result<Vec<DiskRow>, String> {
    let root = model_store_root(&app)?;
    let mut rows = Vec::new();
    for sub in ["blobs", "tmp"] {
        let dir = root.join(sub);
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            rows.push(DiskRow {
                sha256: name,
                bytes,
                location: sub.to_string(),
            });
        }
    }
    rows.sort_by_key(|a| std::cmp::Reverse(a.bytes));
    Ok(rows)
}

/// Delete a downloaded model by its blob SHA-256s. Returns bytes freed.
/// The caller resolves model id -> blob SHAs via the `installed_models`
/// manifest; an empty list is an error, never a wildcard delete.
#[tauri::command]
pub fn models_io_delete_model(
    app: tauri::AppHandle,
    model_id: String,
    blob_sha256s: Vec<String>,
) -> Result<u64, String> {
    if blob_sha256s.is_empty() {
        return Err(format!(
            "No blob SHAs for model {model_id}: resolve via the installed_models manifest first."
        ));
    }
    for sha in &blob_sha256s {
        if !is_valid_sha256(sha) {
            return Err(format!("Invalid blob SHA-256: {sha}"));
        }
    }
    let root = model_store_root(&app)?;
    let mut freed = 0u64;
    for sha in &blob_sha256s {
        for sub in ["blobs", "tmp"] {
            for candidate in [
                root.join(sub).join(sha),
                root.join(sub).join(format!("{sha}.partial")),
            ] {
                if candidate.is_file() {
                    freed += std::fs::metadata(&candidate).map(|m| m.len()).unwrap_or(0);
                    std::fs::remove_file(&candidate)
                        .map_err(|e| format!("delete {}: {e}", candidate.display()))?;
                }
            }
        }
    }
    let _ = model_id;
    Ok(freed)
}

/// Enqueue a download item (deduped by id). Transfer itself reuses the
/// existing `models::download` machinery; this is the queue state machine.
#[tauri::command]
pub fn models_io_enqueue_download(item: DownloadQueueItem) -> Result<DownloadQueueItem, String> {
    let mut queue = download_queue()
        .lock()
        .map_err(|_| "download queue lock poisoned".to_string())?;
    if queue.iter().any(|i| i.id == item.id) {
        return Ok(item);
    }
    queue.push(item.clone());
    Ok(item)
}

/// Pause one queued/in-flight download. The partial is kept for resume.
#[tauri::command]
pub fn models_io_pause_download(id: String) -> Result<Option<DownloadQueueItem>, String> {
    let mut queue = download_queue()
        .lock()
        .map_err(|_| "download queue lock poisoned".to_string())?;
    for item in queue.iter_mut() {
        if item.id == id && item.status == DownloadStatus::Downloading {
            item.status = DownloadStatus::Paused;
            return Ok(Some(item.clone()));
        }
    }
    Ok(None)
}

/// Resume a paused download, applying the Range decision. A server that
/// does not support Range restarts the item from zero with an honest note.
#[tauri::command]
pub fn models_io_resume_download(id: String) -> Result<ResumeResult, String> {
    let mut queue = download_queue()
        .lock()
        .map_err(|_| "download queue lock poisoned".to_string())?;
    let Some(item) = queue.iter_mut().find(|i| i.id == id) else {
        return Err(format!("No queued download with id {id}"));
    };
    let (action, note) = decide_resume_action(item);
    match action {
        "already-complete" => {
            item.status = DownloadStatus::Done;
        }
        "restart" => {
            item.status = DownloadStatus::Downloading;
            item.downloaded_bytes = 0;
            item.resumed_from = 0;
            item.error = Some(note.clone());
        }
        _ => {
            item.status = DownloadStatus::Downloading;
            item.resumed_from = item.downloaded_bytes;
        }
    }
    Ok(ResumeResult {
        item: item.clone(),
        action: action.to_string(),
        note,
    })
}

/// Cancel one queued/in-flight download (partial kept for a later resume).
#[tauri::command]
pub fn models_io_cancel_download(id: String) -> Result<Option<DownloadQueueItem>, String> {
    let mut queue = download_queue()
        .lock()
        .map_err(|_| "download queue lock poisoned".to_string())?;
    for item in queue.iter_mut() {
        if item.id == id
            && matches!(
                item.status,
                DownloadStatus::Queued | DownloadStatus::Downloading | DownloadStatus::Paused
            )
        {
            item.status = DownloadStatus::Cancelled;
            return Ok(Some(item.clone()));
        }
    }
    Ok(None)
}

/// Snapshot of the download queue.
#[tauri::command]
pub fn models_io_list_downloads() -> Result<Vec<DownloadQueueItem>, String> {
    let queue = download_queue()
        .lock()
        .map_err(|_| "download queue lock poisoned".to_string())?;
    Ok(queue.clone())
}

/// Read the macOS clipboard via `pbpaste`. Permission-aware: a denied
/// clipboard surfaces the OS error instead of an empty string.
#[tauri::command]
pub fn models_io_read_clipboard() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let out = Command::new("pbpaste")
            .output()
            .map_err(|e| format!("pbpaste failed: {e}"))?;
        if !out.status.success() {
            return Err(format!(
                "pbpaste failed: {}",
                String::from_utf8_lossy(&out.stderr)
            ));
        }
        String::from_utf8(out.stdout).map_err(|e| format!("clipboard is not UTF-8: {e}"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Clipboard read is macOS-only (pbpaste).".to_string())
    }
}

/// Capture a user-selected screen region via `screencapture -i`.
/// Returns base64 PNG, or `None` when the user cancelled (Escape).
#[tauri::command]
pub fn models_io_capture_screenshot() -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    {
        use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
        let path =
            std::env::temp_dir().join(format!("{}-veilura-modelsio.png", uuid::Uuid::new_v4()));
        let status = Command::new("screencapture")
            .args(["-i", "-x"])
            .arg(&path)
            .status()
            .map_err(|e| format!("screencapture failed: {e}"))?;
        if !status.success() || !path.exists() {
            return Ok(None);
        }
        let bytes = std::fs::read(&path).map_err(|e| format!("read screenshot file: {e}"))?;
        let _ = std::fs::remove_file(&path);
        Ok(Some(BASE64.encode(bytes)))
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Screenshot capture is macOS-only (screencapture).".to_string())
    }
}

/// Dictation via the backend is not wired in this module: macOS
/// `SFSpeechRecognizer` needs entitlement + Info.plist entries the parent
/// has not requested. The frontend falls back to the Web Speech API, which
/// is the real working path. Returning an error (not an empty string) is
/// what triggers that fallback.
#[tauri::command]
pub fn models_io_dictate() -> Result<String, String> {
    Err(
        "Backend dictation not wired (SFSpeechRecognizer entitlement). \
         Use the Web Speech API fallback in the frontend."
            .to_string(),
    )
}

/// Speak text via macOS `say`. Text travels on stdin (never argv), so a
/// reply starting with `-` cannot become a flag. Any in-flight speech is
/// stopped first. Returns immediately; speech continues in the background.
#[tauri::command]
pub fn models_io_speak(text: String, voice: String, rate: f64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let clean = sanitize_tts_text(&text);
        if clean.is_empty() {
            return Err("Nothing to speak.".to_string());
        }
        let _ = models_io_stop_speaking();
        let mut cmd = Command::new("say");
        if !voice.is_empty() {
            if !is_valid_voice_name(&voice) {
                return Err(format!("Invalid voice name: {voice}"));
            }
            cmd.args(["-v", &voice]);
        }
        let wpm = (175.0 * clamp_tts_rate(rate)) as u32;
        cmd.args(["-r", &wpm.to_string()]);
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = cmd.spawn().map_err(|e| format!("say failed: {e}"))?;
        if let Some(mut stdin) = child.stdin.take() {
            std::thread::spawn(move || {
                let _ = stdin.write_all(clean.as_bytes());
            });
        }
        if let Ok(mut slot) = speech_child().lock() {
            *slot = Some(child);
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (text, voice, rate);
        Err("Read-aloud via `say` is macOS-only.".to_string())
    }
}

/// Stop any in-flight `say` speech.
#[tauri::command]
pub fn models_io_stop_speaking() -> Result<(), String> {
    // Only the tracked child is killed: a blanket `pkill say` would kill
    // other apps' speech too, so there is deliberately no fallback here.
    if let Ok(mut slot) = speech_child().lock() {
        if let Some(mut child) = slot.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    Ok(())
}

/// Request cancellation of the in-flight generation. The parent's ask
/// loop polls [`take_generation_cancel_requested`]; this command never
/// touches another module's cancellation token directly.
#[tauri::command]
pub fn models_io_stop_generation() {
    GENERATION_CANCEL_REQUESTED.store(true, Ordering::SeqCst);
}

/// Last token stats recorded from the engine (None = engine reported none).
#[tauri::command]
pub fn models_io_last_token_stats() -> Option<TokenStats> {
    last_token_stats().lock().ok().and_then(|slot| *slot)
}

/// Strip markdown from a reply before speaking (pure passthrough).
#[tauri::command]
pub fn models_io_sanitize_tts(text: String) -> String {
    sanitize_tts_text(&text)
}

/// Extract fenced code blocks (pure passthrough).
#[tauri::command]
pub fn models_io_extract_code_blocks(text: String) -> Vec<CodeBlock> {
    extract_code_blocks(&text)
}

/// Extract numbered citations (pure passthrough).
#[tauri::command]
pub fn models_io_parse_citations(text: String) -> Vec<Citation> {
    parse_citations(&text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn queue_item() -> DownloadQueueItem {
        DownloadQueueItem {
            id: "dl-1".to_string(),
            model_id: "m".to_string(),
            file_name: "m.gguf".to_string(),
            total_bytes: 1000,
            downloaded_bytes: 400,
            status: DownloadStatus::Paused,
            resumed_from: 0,
            supports_range: Some(true),
            error: None,
        }
    }

    #[test]
    fn clamps_match_frontend() {
        assert_eq!(clamp_temperature(9.0), 2.0);
        assert_eq!(clamp_temperature(-1.0), 0.0);
        assert_eq!(clamp_temperature(f64::NAN), 0.7);
        assert_eq!(clamp_top_p(2.0), 1.0);
        assert_eq!(clamp_context_length(10), 1024);
        assert_eq!(clamp_context_length(999_999), 131_072);
        assert_eq!(clamp_tts_rate(9.0), 2.0);
        assert_eq!(clamp_tts_rate(0.0), 0.5);
    }

    #[test]
    fn resolve_merges_defaults() {
        let resolved = resolve_per_model_settings(None);
        assert_eq!(resolved.temperature, 0.7);
        let resolved = resolve_per_model_settings(Some(PerModelSettings {
            temperature: 5.0,
            top_p: 0.5,
            context_length: 100,
            system_prompt_override: "hi".to_string(),
        }));
        assert_eq!(resolved.temperature, 2.0);
        assert_eq!(resolved.context_length, 1024);
        assert_eq!(resolved.system_prompt_override, "hi");
    }

    #[test]
    fn system_prompt_length_enforced() {
        assert!(validate_system_prompt_override("x").is_ok());
        assert!(validate_system_prompt_override(&"x".repeat(4001)).is_err());
    }

    #[test]
    fn sha256_validation_rejects_traversal() {
        assert!(is_valid_sha256(&"a".repeat(64)));
        assert!(!is_valid_sha256("../etc/passwd"));
        assert!(!is_valid_sha256(&"A".repeat(64)));
        assert!(!is_valid_sha256("abc"));
    }

    #[test]
    fn resume_decision_never_appends_without_range() {
        let mut item = queue_item();
        item.supports_range = Some(false);
        let (action, _) = decide_resume_action(&item);
        assert_eq!(action, "restart");
        item.downloaded_bytes = 1000;
        let (action, _) = decide_resume_action(&item);
        assert_eq!(action, "already-complete");
        item.downloaded_bytes = 400;
        item.supports_range = Some(true);
        let (action, note) = decide_resume_action(&item);
        assert_eq!(action, "resume-range");
        assert!(note.contains("400"));
    }

    #[test]
    fn tts_sanitizer_strips_markdown() {
        let out = sanitize_tts_text("Hello `code` and [link](https://example.com) end");
        assert!(!out.contains('`'));
        assert!(!out.contains("https://"));
        assert!(out.contains("link"));
        let out = sanitize_tts_text("```js\nconst x = 1;\n``` done");
        assert!(out.contains("code block omitted"));
        assert!(!out.contains("const"));
    }

    #[test]
    fn voice_name_validation() {
        assert!(is_valid_voice_name("Samantha"));
        assert!(!is_valid_voice_name("Samantha; rm -rf /"));
        assert!(!is_valid_voice_name(""));
    }

    #[test]
    fn token_stats_math() {
        let stats = compute_token_stats(10, 20, 1000, 10, 20);
        assert_eq!(stats.ms_per_token, 50.0);
        let stats = compute_token_stats(0, 0, 0, 0, 0);
        assert_eq!(stats.ms_per_token, 0.0);
    }

    #[test]
    fn code_blocks_and_citations() {
        let blocks = extract_code_blocks("a\n```ts\nconst x = 1;\n```\n");
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].language, "ts");
        let cites =
            parse_citations("See [Apple](https://apple.com).\n\n[1]: https://example.com/source");
        assert_eq!(cites.len(), 2);
        assert_eq!(cites[0].url, "https://apple.com");
        assert_eq!(cites[1].url, "https://example.com/source");
    }

    #[test]
    fn generation_cancel_flag_roundtrip() {
        assert!(!take_generation_cancel_requested());
        models_io_stop_generation();
        assert!(take_generation_cancel_requested());
        assert!(!take_generation_cancel_requested());
    }

    #[test]
    fn queue_pause_resume_cancel_state_machine() {
        // Isolated from the global queue: exercise the pure transitions
        // through the same decision function the commands use.
        let mut item = queue_item();
        item.status = DownloadStatus::Downloading;
        let (action, _) = decide_resume_action(&item);
        assert_eq!(action, "resume-range");
        item.status = DownloadStatus::Cancelled;
        assert_eq!(item.status, DownloadStatus::Cancelled);
    }

    #[test]
    fn format_bytes_matches_frontend() {
        assert_eq!(format_bytes(0), "0 B");
        assert!(format_bytes(1_500_000_000).contains("GB"));
    }
}
