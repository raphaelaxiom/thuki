/*!
 * System actions: real, validated OS side effects driven by structured
 * requests — never by model-generated shell strings.
 *
 * The frontend parses user text such as "open Calculator" into a
 * [`SystemActionRequest`] (see [`parse_system_action_text`], mirrored by
 * the TypeScript parser in `systemActions.ts`) and sends that structured
 * value over IPC. This module validates the request again and executes it
 * with [`std::process::Command`] — argument arrays, never a shell — so
 * no injected metacharacter (`;`, `&&`, `$(...)`, …) can ever turn an app
 * name or file name into a second command. An unknown app name is an
 * error that lists close candidates; it is never "executed anyway".
 *
 * Write scope: file creation is confined to `~/Desktop`, `~/Documents`,
 * and the app data dir. Notes always go to `~/Desktop/Veilura Notes/`.
 * URLs must be `http://` / `https://`. Reveal requires the path to exist.
 */

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Structured system-action request. Deserialised from IPC JSON with a
/// `kind` tag (e.g. `{"kind": "open_app", "app": "Calculator"}`), matching
/// the TypeScript `SystemActionRequest` union field-for-field.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SystemActionRequest {
    OpenApp {
        app: String,
    },
    CreateFile {
        filename: String,
        content: String,
        location: WriteLocation,
    },
    OpenUrl {
        url: String,
    },
    RevealInFinder {
        path: String,
    },
    CreateNote {
        title: String,
        content: String,
    },
}

/// Where a created file may land. Only these three roots are writable.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum WriteLocation {
    Desktop,
    Documents,
    AppData,
}

/// Outcome of an executed action. `ok: true` means the action really ran;
/// the message reports exactly what executed (app name / exact path).
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct SystemActionResult {
    pub ok: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

fn success(message: String, detail: Option<String>) -> SystemActionResult {
    SystemActionResult {
        ok: true,
        message,
        detail,
    }
}

/// Filesystem roots an action executes against. Injected so tests can
/// point execution at a temp dir instead of the real home directory.
pub struct ActionContext {
    pub home_dir: PathBuf,
    pub app_data_dir: PathBuf,
    pub applications_dir: PathBuf,
}

// ─── App allowlist ──────────────────────────────────────────────────────────
// Maps common spoken names (lowercase) to the canonical `.app` bundle stem
// used with `open -a`. Anything not in this map is resolved by scanning
// the Applications directory for an exact `<Name>.app` match, so any real
// installed app works — the map only covers names that differ from their
// bundle name or that users say in shorthand.

const APP_ALIASES: &[(&str, &str)] = &[
    ("chrome", "Google Chrome"),
    ("google chrome", "Google Chrome"),
    ("safari", "Safari"),
    ("firefox", "Firefox"),
    ("edge", "Microsoft Edge"),
    ("microsoft edge", "Microsoft Edge"),
    ("calculator", "Calculator"),
    ("notes", "Notes"),
    ("textedit", "TextEdit"),
    ("text edit", "TextEdit"),
    ("terminal", "Terminal"),
    ("finder", "Finder"),
    ("mail", "Mail"),
    ("calendar", "Calendar"),
    ("maps", "Maps"),
    ("music", "Music"),
    ("photos", "Photos"),
    ("preview", "Preview"),
    ("vs code", "Visual Studio Code"),
    ("vscode", "Visual Studio Code"),
    ("code", "Visual Studio Code"),
    ("visual studio code", "Visual Studio Code"),
    ("xcode", "Xcode"),
    ("slack", "Slack"),
    ("discord", "Discord"),
    ("spotify", "Spotify"),
    ("zoom", "Zoom"),
    ("teams", "Microsoft Teams"),
    ("word", "Microsoft Word"),
    ("microsoft word", "Microsoft Word"),
    ("excel", "Microsoft Excel"),
    ("microsoft excel", "Microsoft Excel"),
    ("powerpoint", "Microsoft PowerPoint"),
    ("microsoft powerpoint", "Microsoft PowerPoint"),
    ("keynote", "Keynote"),
    ("pages", "Pages"),
    ("numbers", "Numbers"),
    ("imovie", "iMovie"),
    ("garageband", "GarageBand"),
    ("app store", "App Store"),
    ("system settings", "System Settings"),
    ("system preferences", "System Settings"),
    ("activity monitor", "Activity Monitor"),
    ("facetime", "FaceTime"),
    ("messages", "Messages"),
    ("reminders", "Reminders"),
    ("contacts", "Contacts"),
    ("books", "Books"),
    ("podcasts", "Podcasts"),
    ("tv", "TV"),
    ("weather", "Weather"),
    ("clock", "Clock"),
    ("stocks", "Stocks"),
    ("news", "News"),
    ("home", "Home"),
    ("shortcuts", "Shortcuts"),
    ("automator", "Automator"),
    ("disk utility", "Disk Utility"),
    ("font book", "Font Book"),
    ("quicktime", "QuickTime Player"),
    ("quicktime player", "QuickTime Player"),
    ("vlc", "VLC"),
    ("notion", "Notion"),
    ("obsidian", "Obsidian"),
    ("figma", "Figma"),
];

/// Resolves a user-supplied app name to the canonical bundle stem for
/// `open -a`.
///
/// 1. Alias map (case-insensitive).
/// 2. Exact `<Name>.app` match in `applications_dir` (case-insensitive,
///    with or without a trailing `.app` in the request).
/// 3. Otherwise an error listing up to 10 substring candidates — never a
///    guess, never a launch.
///
/// Pure over the filesystem: tests pass a fake Applications directory.
pub fn resolve_app_name(requested: &str, applications_dir: &Path) -> Result<String, String> {
    let trimmed = requested.trim();
    if trimmed.is_empty() {
        return Err("App name is empty.".to_string());
    }
    if trimmed.len() > 100 {
        return Err("App name is too long.".to_string());
    }
    let lower = trimmed.to_lowercase();
    for (alias, canonical) in APP_ALIASES {
        if *alias == lower {
            return Ok((*canonical).to_string());
        }
    }
    let bare = trimmed
        .strip_suffix(".app")
        .or_else(|| trimmed.strip_suffix(".APP"))
        .unwrap_or(trimmed);
    let bare_lower = bare.to_lowercase();
    let mut candidates: Vec<String> = Vec::new();
    if let Ok(entries) = fs::read_dir(applications_dir) {
        for entry in entries.flatten() {
            let file_name = entry.file_name();
            let name = file_name.to_string_lossy();
            let Some(stem) = name
                .strip_suffix(".app")
                .or_else(|| name.strip_suffix(".APP"))
            else {
                continue;
            };
            if stem.eq_ignore_ascii_case(bare) {
                return Ok(stem.to_string());
            }
            if stem.to_lowercase().contains(&bare_lower) {
                candidates.push(stem.to_string());
            }
        }
    }
    candidates.sort();
    candidates.dedup();
    candidates.truncate(10);
    if candidates.is_empty() {
        Err(format!(
            "Unknown app \"{trimmed}\": no matching app in /Applications. Check the app name — nothing was opened."
        ))
    } else {
        Err(format!(
            "Unknown app \"{trimmed}\". Did you mean: {}? Nothing was opened.",
            candidates.join(", ")
        ))
    }
}

// ─── Filename / path validation ─────────────────────────────────────────────

/// Validates a bare file name: no directories, no `..`, no NUL, sane length.
/// Rejects anything that could escape the intended parent directory.
pub fn sanitize_file_name(raw: &str) -> Result<String, String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err("File name is empty.".to_string());
    }
    if name == "." || name == ".." || name.contains("..") {
        return Err("File name must not contain \"..\".".to_string());
    }
    if name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err("File name must be a plain file name (no folders).".to_string());
    }
    if name.len() > 255 {
        return Err("File name is too long (max 255 chars).".to_string());
    }
    Ok(name.to_string())
}

/// Returns a non-overwriting path inside `dir`: `name` itself when free,
/// otherwise `stem (2).ext`, `stem (3).ext`, …
pub fn unique_path(dir: &Path, file_name: &str) -> PathBuf {
    let first = dir.join(file_name);
    if !first.exists() {
        return first;
    }
    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| file_name.to_string());
    let ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()));
    for n in 2..=1000 {
        let candidate = match &ext {
            Some(ext) => dir.join(format!("{stem} ({n}){ext}")),
            None => dir.join(format!("{stem} ({n})")),
        };
        if !candidate.exists() {
            return candidate;
        }
    }
    // Practically unreachable; fall back to a timestamped name rather
    // than ever overwriting an existing file.
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    match &ext {
        Some(ext) => dir.join(format!("{stem}-{millis}{ext}")),
        None => dir.join(format!("{stem}-{millis}")),
    }
}

/// Validates an open-URL request: parseable URL, http/https scheme, host.
pub fn validate_open_url(raw: &str) -> Result<String, String> {
    let url = raw.trim();
    let parsed = url::Url::parse(url).map_err(|_| "Invalid URL.".to_string())?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("Only http:// and https:// URLs can be opened.".to_string()),
    }
    if parsed.host_str().is_none_or(str::is_empty) {
        return Err("URL has no host.".to_string());
    }
    Ok(url.to_string())
}

/// Expands a leading `~/` against `home_dir`; other paths pass through.
fn expand_tilde(path: &str, home_dir: &Path) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        return home_dir.join(rest);
    }
    if path == "~" {
        return home_dir.to_path_buf();
    }
    PathBuf::from(path)
}

/// Runs `open …` (macOS) and verifies the child exited successfully.
/// A spawn failure or non-zero exit is an error — the caller never
/// reports success for a launch that did not happen.
#[cfg(target_os = "macos")]
fn run_open(args: &[&str]) -> Result<(), String> {
    let output = std::process::Command::new("open")
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run macOS 'open': {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err("macOS 'open' reported a failure; nothing was opened.".to_string())
    }
}

#[cfg(not(target_os = "macos"))]
fn run_open(_args: &[&str]) -> Result<(), String> {
    Err("System actions that open apps, URLs, or Finder are only supported on macOS.".to_string())
}

// ─── Free-text parser ───────────────────────────────────────────────────────
// Mirrors the TypeScript `parseSystemActionText` in `systemActions.ts`:
// same phrases, same precedence (open → reveal → note → file → visit).
// Returns `None` for ordinary chat — the caller must then treat the text
// as a normal message, not an action.

fn strip_quotes(value: &str) -> &str {
    let trimmed = value.trim();
    if trimmed.len() >= 2 {
        let first = trimmed.as_bytes()[0];
        let last = trimmed.as_bytes()[trimmed.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return &trimmed[1..trimmed.len() - 1];
        }
    }
    trimmed
}

fn looks_like_url(value: &str) -> bool {
    if value.contains(char::is_whitespace) {
        return false;
    }
    let lower = value.to_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return true;
    }
    lower.starts_with("www.") && lower[4..].contains('.')
}

fn normalize_url(value: &str) -> String {
    if value.to_lowercase().starts_with("www.") {
        format!("https://{value}")
    } else {
        value.to_string()
    }
}

/// Case-insensitive prefix match that is safe for non-ASCII input: the
/// returned remainder starts on a char boundary of the original string.
/// (Slicing `text[prefix.len()..]` directly would panic if a leading char
/// lowercases to a different byte length, e.g. `İ` → `i̇`.)
fn starts_with_word<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let prefix_len = prefix.chars().count();
    let head: String = text.chars().take(prefix_len).collect();
    if head.to_lowercase() != prefix {
        return None;
    }
    let byte_len: usize = text.chars().take(prefix_len).map(|c| c.len_utf8()).sum();
    Some(text[byte_len..].trim_start())
}

/// Case-insensitive suffix strip, char-boundary safe like
/// [`starts_with_word`]. Returns the text without the suffix, or `None`.
fn strip_suffix_ci<'a>(text: &'a str, suffix: &str) -> Option<&'a str> {
    let suffix_len = suffix.chars().count();
    let tail: String = text
        .chars()
        .rev()
        .take(suffix_len)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    if tail.to_lowercase() != suffix {
        return None;
    }
    let byte_len: usize = text
        .chars()
        .rev()
        .take(suffix_len)
        .map(|c| c.len_utf8())
        .sum();
    Some(&text[..text.len() - byte_len])
}

/// Case-insensitive substring search returning the byte index in the
/// original string, or `None`. Char-boundary safe (no slicing at an index
/// computed from a lowercased copy).
fn find_case_insensitive(haystack: &str, needle: &str) -> Option<usize> {
    let needle_lower = needle.to_lowercase();
    let needle_len = needle.chars().count();
    for (idx, _) in haystack.char_indices() {
        let window: String = haystack[idx..].chars().take(needle_len).collect();
        if window.to_lowercase() == needle_lower {
            return Some(idx);
        }
    }
    None
}

/// Parses free text into a structured action, or `None` when the text is
/// not a recognised system-action request.
pub fn parse_system_action_text(raw_text: &str) -> Option<SystemActionRequest> {
    let text: String = raw_text.split_whitespace().collect::<Vec<_>>().join(" ");
    let text = text.trim();
    if text.is_empty() {
        return None;
    }

    // open / launch / start <target> — app or URL or Finder path.
    for prefix in ["open ", "launch ", "start "] {
        if let Some(rest) = starts_with_word(text, prefix) {
            let mut target = rest.to_string();
            for suffix in [" in the browser", " in browser"] {
                if let Some(stripped) = strip_suffix_ci(&target, suffix) {
                    target = stripped.to_string();
                    break;
                }
            }
            if let Some(stripped) = strip_suffix_ci(&target, " in finder") {
                target = stripped.to_string();
            }
            let target = strip_quotes(target.trim()).to_string();
            if target.is_empty() {
                return None;
            }
            if looks_like_url(&target) {
                return Some(SystemActionRequest::OpenUrl {
                    url: normalize_url(&target),
                });
            }
            if target.starts_with('/') || target.starts_with("~/") {
                return Some(SystemActionRequest::RevealInFinder { path: target });
            }
            return Some(SystemActionRequest::OpenApp { app: target });
        }
    }

    // reveal / show <path> in Finder.
    for prefix in ["reveal ", "show "] {
        if let Some(rest) = starts_with_word(text, prefix) {
            for suffix in [" in the finder", " in finder"] {
                if let Some(path_part) = strip_suffix_ci(rest, suffix) {
                    let path = strip_quotes(path_part.trim());
                    if !path.is_empty() {
                        return Some(SystemActionRequest::RevealInFinder {
                            path: path.to_string(),
                        });
                    }
                    return None;
                }
            }
        }
    }

    // create note <title> [: content | with content]
    if let Some(rest) =
        starts_with_word(text, "create note ").or_else(|| starts_with_word(text, "create a note "))
    {
        let rest = rest.trim();
        if rest.is_empty() {
            return None;
        }
        if let Some(idx) = find_case_insensitive(rest, " with ") {
            let (title, _) = rest.split_at(idx);
            return Some(SystemActionRequest::CreateNote {
                title: strip_quotes(title.trim()).to_string(),
                content: rest[idx + " with ".len()..].trim().to_string(),
            });
        }
        if let Some(idx) = rest.find(':') {
            let (title, content) = rest.split_at(idx);
            return Some(SystemActionRequest::CreateNote {
                title: strip_quotes(title.trim()).to_string(),
                content: content[1..].trim().to_string(),
            });
        }
        return Some(SystemActionRequest::CreateNote {
            title: strip_quotes(rest).to_string(),
            content: String::new(),
        });
    }

    // create [a] file <name> [on Desktop|Documents] [with content ...]
    if let Some(rest) =
        starts_with_word(text, "create file ").or_else(|| starts_with_word(text, "create a file "))
    {
        return parse_create_file(rest);
    }

    // create <name.ext> on Desktop|Documents [with content ...]
    if let Some(rest) = starts_with_word(text, "create ") {
        let mut parts = rest.splitn(2, char::is_whitespace);
        let first = parts.next().unwrap_or("");
        let after = parts.next().unwrap_or("").trim();
        if first.contains('.') && !first.starts_with('.') {
            if let Some(after_on) = starts_with_word(after, "on ") {
                let mut loc_parts = after_on.splitn(2, char::is_whitespace);
                let loc_token = loc_parts.next().unwrap_or("").to_lowercase();
                let remainder = loc_parts.next().unwrap_or("").trim();
                let location = match loc_token.as_str() {
                    "desktop" => Some(WriteLocation::Desktop),
                    "documents" => Some(WriteLocation::Documents),
                    _ => None,
                };
                if let Some(location) = location {
                    let content = parse_with_content(remainder)?;
                    return Some(SystemActionRequest::CreateFile {
                        filename: strip_quotes(first).to_string(),
                        content,
                        location,
                    });
                }
                return None;
            }
        }
    }

    // go to / visit / browse to <url>
    for prefix in ["go to ", "visit ", "browse to "] {
        if let Some(rest) = starts_with_word(text, prefix) {
            let target = rest.trim();
            if looks_like_url(target) {
                return Some(SystemActionRequest::OpenUrl {
                    url: normalize_url(target),
                });
            }
            return None;
        }
    }

    None
}

/// Parses the remainder of a `create file …` request after the keyword.
/// Returns `None` when the shape is not recognised.
fn parse_create_file(rest: &str) -> Option<SystemActionRequest> {
    let mut parts = rest.splitn(2, char::is_whitespace);
    let filename = parts.next().unwrap_or("");
    if filename.is_empty() {
        return None;
    }
    let mut remainder = parts.next().unwrap_or("").trim();
    let mut location = WriteLocation::Desktop;
    if let Some(after_on) = starts_with_word(remainder, "on ") {
        let mut loc_parts = after_on.splitn(2, char::is_whitespace);
        let loc_token = loc_parts.next().unwrap_or("").to_lowercase();
        remainder = loc_parts.next().unwrap_or("").trim();
        location = match loc_token.as_str() {
            "desktop" => WriteLocation::Desktop,
            "documents" => WriteLocation::Documents,
            _ => return None,
        };
    }
    let content = parse_with_content(remainder)?;
    Some(SystemActionRequest::CreateFile {
        filename: strip_quotes(filename).to_string(),
        content,
        location,
    })
}

/// Parses an optional trailing `with content <text>` clause. Returns
/// `Some("")` for an empty remainder, `None` for unrecognised trailing text.
fn parse_with_content(remainder: &str) -> Option<String> {
    let remainder = remainder.trim();
    if remainder.is_empty() {
        return Some(String::new());
    }
    if let Some(after) = starts_with_word(remainder, "with content ") {
        return Some(after.to_string());
    }
    None
}

// ─── Execution ──────────────────────────────────────────────────────────────

/// Executes one validated structured action. Every branch either performs
/// the effect and returns `ok: true` with the exact outcome, or returns
/// an `Err` — success is never claimed for an effect that did not happen.
pub fn execute_system_action(
    action: &SystemActionRequest,
    ctx: &ActionContext,
) -> Result<SystemActionResult, String> {
    match action {
        SystemActionRequest::OpenApp { app } => {
            let name = resolve_app_name(app, &ctx.applications_dir)?;
            run_open(&["-a", &name])?;
            Ok(success(format!("Opened {name}."), Some(name)))
        }
        SystemActionRequest::CreateFile {
            filename,
            content,
            location,
        } => {
            let base = match location {
                WriteLocation::Desktop => ctx.home_dir.join("Desktop"),
                WriteLocation::Documents => ctx.home_dir.join("Documents"),
                WriteLocation::AppData => ctx.app_data_dir.clone(),
            };
            let clean = sanitize_file_name(filename)?;
            fs::create_dir_all(&base)
                .map_err(|e| format!("Could not create the destination folder: {e}"))?;
            let path = unique_path(&base, &clean);
            fs::write(&path, content).map_err(|e| format!("Could not write the file: {e}"))?;
            Ok(success(
                format!("Created file at {}.", path.display()),
                Some(path.display().to_string()),
            ))
        }
        SystemActionRequest::OpenUrl { url } => {
            let clean = validate_open_url(url)?;
            run_open(&[&clean])?;
            Ok(success(
                format!("Opened {clean} in the default browser."),
                Some(clean),
            ))
        }
        SystemActionRequest::RevealInFinder { path } => {
            let expanded = expand_tilde(path, &ctx.home_dir);
            if fs::metadata(&expanded).is_err() {
                return Err(format!("Path does not exist: {path}"));
            }
            let shown = expanded.display().to_string();
            run_open(&["-R", &shown])?;
            Ok(success(format!("Revealed {shown} in Finder."), Some(shown)))
        }
        SystemActionRequest::CreateNote { title, content } => {
            let dir = ctx.home_dir.join("Desktop").join("Veilura Notes");
            let clean_title = sanitize_file_name(title)?;
            let file_name = if clean_title.to_lowercase().ends_with(".md") {
                clean_title.clone()
            } else {
                format!("{clean_title}.md")
            };
            fs::create_dir_all(&dir)
                .map_err(|e| format!("Could not create the notes folder: {e}"))?;
            let path = unique_path(&dir, &file_name);
            let body = format!("# {title}\n\n{content}");
            fs::write(&path, body).map_err(|e| format!("Could not write the note: {e}"))?;
            Ok(success(
                format!("Created note at {}.", path.display()),
                Some(path.display().to_string()),
            ))
        }
    }
}

// ─── Tauri commands ──────────────────────────────────────────────────────────

/// Executes one structured system action. The IPC argument is the
/// structured request — never a shell string. The home / app-data /
/// Applications roots are resolved server-side, never from the renderer.
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn system_execute_action(
    action: SystemActionRequest,
    app: AppHandle,
) -> Result<SystemActionResult, String> {
    let home_dir =
        dirs::home_dir().ok_or_else(|| "Could not determine the home directory.".to_string())?;
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve the app data directory: {e}"))?;
    let ctx = ActionContext {
        home_dir,
        app_data_dir,
        applications_dir: PathBuf::from("/Applications"),
    };
    execute_system_action(&action, &ctx)
}

/// Parses free text into a structured action on the Rust side, so the
/// assistant path can use the same parser as the input box. Returns
/// `None` for text that is not a system-action request.
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn system_parse_action(text: String) -> Option<SystemActionRequest> {
    parse_system_action_text(&text)
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn test_ctx(dir: &Path) -> ActionContext {
        ActionContext {
            home_dir: dir.to_path_buf(),
            app_data_dir: dir.join("app-data"),
            applications_dir: dir.join("Applications"),
        }
    }

    fn fake_applications(dir: &Path) -> PathBuf {
        let apps = dir.join("Applications");
        for name in ["Calculator.app", "Google Chrome.app", "Notes.app"] {
            let _ = fs::create_dir_all(apps.join(name));
        }
        apps
    }

    #[test]
    fn parser_opens_apps_and_urls() {
        assert!(matches!(
            parse_system_action_text("open Calculator"),
            Some(SystemActionRequest::OpenApp { app }) if app == "Calculator"
        ));
        assert!(matches!(
            parse_system_action_text("launch Safari"),
            Some(SystemActionRequest::OpenApp { app }) if app == "Safari"
        ));
        assert!(matches!(
            parse_system_action_text("open https://example.com/x"),
            Some(SystemActionRequest::OpenUrl { url }) if url == "https://example.com/x"
        ));
        assert!(matches!(
            parse_system_action_text("open www.example.com"),
            Some(SystemActionRequest::OpenUrl { url }) if url == "https://www.example.com"
        ));
        assert!(matches!(
            parse_system_action_text("go to https://example.com"),
            Some(SystemActionRequest::OpenUrl { url }) if url == "https://example.com"
        ));
    }

    #[test]
    fn parser_creates_files_and_notes() {
        assert!(matches!(
            parse_system_action_text("create file notes.txt on Desktop with content Hello"),
            Some(SystemActionRequest::CreateFile { filename, content, location })
                if filename == "notes.txt" && content == "Hello" && matches!(location, WriteLocation::Desktop)
        ));
        assert!(matches!(
            parse_system_action_text("create notes.txt on Documents"),
            Some(SystemActionRequest::CreateFile { filename, location, .. })
                if filename == "notes.txt" && matches!(location, WriteLocation::Documents)
        ));
        assert!(matches!(
            parse_system_action_text("create note Shopping list: milk, eggs"),
            Some(SystemActionRequest::CreateNote { title, content })
                if title == "Shopping list" && content == "milk, eggs"
        ));
        assert!(matches!(
            parse_system_action_text("create note Idea with brainstorm later"),
            Some(SystemActionRequest::CreateNote { title, content })
                if title == "Idea" && content == "brainstorm later"
        ));
    }

    #[test]
    fn parser_reveals_paths() {
        assert!(matches!(
            parse_system_action_text("reveal ~/Desktop/report.pdf in Finder"),
            Some(SystemActionRequest::RevealInFinder { path }) if path == "~/Desktop/report.pdf"
        ));
        assert!(matches!(
            parse_system_action_text("open ~/Desktop/report.pdf in Finder"),
            Some(SystemActionRequest::RevealInFinder { path }) if path == "~/Desktop/report.pdf"
        ));
    }

    #[test]
    fn parser_returns_none_for_ordinary_chat() {
        for text in ["", "what is the weather?", "open", "tell me a joke"] {
            assert_eq!(parse_system_action_text(text), None, "{text}");
        }
    }

    #[test]
    fn parser_never_produces_a_shell_string() {
        // Injection text stays one opaque app name; resolution rejects it
        // (see `resolve_rejects_injection_text`) and nothing executes.
        assert!(matches!(
            parse_system_action_text("open Calculator; rm -rf /"),
            Some(SystemActionRequest::OpenApp { app }) if app == "Calculator; rm -rf /"
        ));
        assert!(matches!(
            parse_system_action_text("open Calculator && open Safari"),
            Some(SystemActionRequest::OpenApp { app }) if app == "Calculator && open Safari"
        ));
    }

    #[test]
    fn resolve_uses_aliases_and_scans_fake_applications() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let apps = fake_applications(tmp.path());
        assert_eq!(
            resolve_app_name("chrome", &apps).as_deref(),
            Ok("Google Chrome")
        );
        assert_eq!(
            resolve_app_name("Calculator", &apps).as_deref(),
            Ok("Calculator")
        );
        assert_eq!(
            resolve_app_name("calculator.app", &apps).as_deref(),
            Ok("Calculator")
        );
        assert_eq!(resolve_app_name("notes", &apps).as_deref(), Ok("Notes"));
    }

    #[test]
    fn resolve_rejects_unknown_apps_with_candidates() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let apps = fake_applications(tmp.path());
        let err = resolve_app_name("Calc", &apps).unwrap_err();
        assert!(err.contains("Calculator"), "{err}");
        assert!(err.contains("Nothing was opened"), "{err}");
        let err = resolve_app_name("NoSuchAppXyz", &apps).unwrap_err();
        assert!(err.contains("Unknown app"), "{err}");
    }

    #[test]
    fn resolve_rejects_injection_text() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let apps = fake_applications(tmp.path());
        assert!(resolve_app_name("Calculator; rm -rf /", &apps).is_err());
        assert!(resolve_app_name("", &apps).is_err());
    }

    #[test]
    fn sanitize_rejects_traversal_and_separators() {
        assert_eq!(sanitize_file_name("notes.txt").as_deref(), Ok("notes.txt"));
        for bad in [
            "",
            ".",
            "..",
            "../evil.txt",
            "a/b.txt",
            "a\\b.txt",
            "a..b.txt",
        ] {
            assert!(sanitize_file_name(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn unique_path_suffixes_instead_of_overwriting() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let dir = tmp.path();
        fs::write(dir.join("notes.txt"), "original").expect("write");
        assert_eq!(unique_path(dir, "notes.txt"), dir.join("notes (2).txt"));
        fs::write(dir.join("notes (2).txt"), "second").expect("write");
        assert_eq!(unique_path(dir, "notes.txt"), dir.join("notes (3).txt"));
    }

    #[test]
    fn validate_open_url_accepts_only_http_https() {
        assert!(validate_open_url("https://example.com").is_ok());
        assert!(validate_open_url("http://example.com/x").is_ok());
        for bad in [
            "javascript:alert(1)",
            "ftp://example.com",
            "https://",
            "not a url",
        ] {
            assert!(validate_open_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn execute_create_file_writes_into_temp_desktop() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let ctx = test_ctx(tmp.path());
        let result = execute_system_action(
            &SystemActionRequest::CreateFile {
                filename: "notes.txt".to_string(),
                content: "hello".to_string(),
                location: WriteLocation::Desktop,
            },
            &ctx,
        )
        .expect("create file");
        assert!(result.ok);
        let path = tmp.path().join("Desktop").join("notes.txt");
        assert_eq!(fs::read_to_string(&path).expect("read"), "hello");
        assert!(result.detail.as_deref() == Some(path.display().to_string().as_str()));

        // Second create with the same name suffixes instead of overwriting.
        execute_system_action(
            &SystemActionRequest::CreateFile {
                filename: "notes.txt".to_string(),
                content: "second".to_string(),
                location: WriteLocation::Desktop,
            },
            &ctx,
        )
        .expect("create file again");
        assert_eq!(
            fs::read_to_string(tmp.path().join("Desktop").join("notes (2).txt")).expect("read"),
            "second"
        );
        assert_eq!(fs::read_to_string(&path).expect("read"), "hello");
    }

    #[test]
    fn execute_create_file_rejects_traversal() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let ctx = test_ctx(tmp.path());
        let err = execute_system_action(
            &SystemActionRequest::CreateFile {
                filename: "../evil.txt".to_string(),
                content: "x".to_string(),
                location: WriteLocation::Desktop,
            },
            &ctx,
        )
        .unwrap_err();
        assert!(err.contains(".."), "{err}");
        assert!(!tmp.path().join("evil.txt").exists());
    }

    #[test]
    fn execute_create_note_writes_markdown_under_veilura_notes() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let ctx = test_ctx(tmp.path());
        let result = execute_system_action(
            &SystemActionRequest::CreateNote {
                title: "Shopping list".to_string(),
                content: "milk, eggs".to_string(),
            },
            &ctx,
        )
        .expect("create note");
        assert!(result.ok);
        let path = tmp
            .path()
            .join("Desktop")
            .join("Veilura Notes")
            .join("Shopping list.md");
        let body = fs::read_to_string(&path).expect("read");
        assert!(body.contains("# Shopping list"));
        assert!(body.contains("milk, eggs"));
    }

    #[test]
    fn execute_reveal_rejects_missing_paths() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let ctx = test_ctx(tmp.path());
        let err = execute_system_action(
            &SystemActionRequest::RevealInFinder {
                path: "~/Desktop/nope.pdf".to_string(),
            },
            &ctx,
        )
        .unwrap_err();
        assert!(err.contains("does not exist"), "{err}");
    }

    #[test]
    fn execute_open_url_rejects_non_http() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let ctx = test_ctx(tmp.path());
        let err = execute_system_action(
            &SystemActionRequest::OpenUrl {
                url: "javascript:alert(1)".to_string(),
            },
            &ctx,
        )
        .unwrap_err();
        assert!(err.contains("http"), "{err}");
    }
}
