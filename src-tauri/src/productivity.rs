//! Productivity, settings, and safety helpers (Phase 2D).
//!
//! Pure logic for the frontend `src/features/productivity/**` panels, plus
//! the thin Tauri commands that expose it. This module is intentionally
//! dependency-free beyond `serde`/`serde_json`: no filesystem, no network,
//! no database. Persistence lives in the frontend (localStorage) until the
//! parent wires the commands below into `invoke_handler` (see
//! `INTEGRATION-productivity.md`); nothing here touches the disk or the
//! network, so the audit log can never leak by construction.
//!
//! Covered here:
//! - [`redact_text`] — secret / API-key redaction for outbound prompts.
//! - [`validate_backup_json`] — backup-file schema validation.
//! - [`normalize_shortcut`] / [`detect_shortcut_conflicts`] — shortcut
//!   conflict detection.
//! - [`validate_reminder`] / [`validate_focus_durations`] — input guards.
//! - [`audit_entry`] — local-only audit-log entry construction.

use serde::{Deserialize, Serialize};

// ─── Secret redaction ───────────────────────────────────────────────────────

/// One redacted secret family in a prompt, aggregated by kind.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RedactionHit {
    /// e.g. `"github_token"`, `"credential_assignment"`, `"private_key"`.
    pub kind: String,
    /// How many spans of this kind were redacted.
    pub count: usize,
}

/// The result of redacting one outbound prompt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RedactedPrompt {
    /// The prompt with secrets replaced by `[REDACTED]`.
    pub text: String,
    /// True when at least one secret was redacted.
    pub redacted: bool,
    /// Per-kind redaction counts (empty when nothing was redacted).
    pub hits: Vec<RedactionHit>,
}

/// A byte span in the original text to replace, with its secret family.
#[derive(Debug, Clone, Copy)]
struct Span {
    start: usize,
    end: usize,
    kind: &'static str,
}

fn is_token_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'~' | b'+' | b'/' | b'.' | b'=')
}

fn is_b64url_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-')
}

/// Finds `prefix + token` spans: the token is the maximal run of
/// [`is_token_char`] bytes after the prefix, and must be at least
/// `min_token` bytes long (so short lookalikes like `sk-x` do not redact).
fn prefix_spans(text: &str, prefix: &str, kind: &'static str, min_token: usize) -> Vec<Span> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    for (start, _) in text.match_indices(prefix) {
        let token_start = start + prefix.len();
        let mut end = token_start;
        while end < bytes.len() && is_token_char(bytes[end]) {
            end += 1;
        }
        if end - token_start >= min_token {
            out.push(Span { start, end, kind });
        }
    }
    out
}

/// Finds `eyJ...` JWT spans: three base64url segments separated by dots.
fn jwt_spans(text: &str) -> Vec<Span> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    for (start, _) in text.match_indices("eyJ") {
        let mut pos = start;
        let mut segments = 0;
        while segments < 3 {
            let seg_start = pos;
            let mut end = seg_start;
            while end < bytes.len() && is_b64url_char(bytes[end]) {
                end += 1;
            }
            if end - seg_start < 4 {
                break;
            }
            segments += 1;
            pos = end;
            if segments < 3 {
                if pos < bytes.len() && bytes[pos] == b'.' {
                    pos += 1;
                } else {
                    break;
                }
            }
        }
        if segments == 3 {
            out.push(Span {
                start,
                end: pos,
                kind: "jwt",
            });
        }
    }
    out
}

/// Finds `-----BEGIN ... PRIVATE KEY----- ... -----END ...-----` blocks.
fn private_key_spans(text: &str) -> Vec<Span> {
    let mut out = Vec::new();
    let mut search_from = 0;
    while let Some(rel) = text[search_from..].find("-----BEGIN ") {
        let start = search_from + rel;
        if let Some(end_rel) = text[start..].find("-----END ") {
            let after_end = start + end_rel;
            if let Some(close_rel) = text[after_end..].find("-----") {
                let end = after_end + close_rel + 5;
                // Only redact when the header actually names a private key;
                // any other PEM block (e.g. a certificate) is skipped and
                // scanning continues past it.
                if text[start..end].contains("PRIVATE KEY") {
                    out.push(Span {
                        start,
                        end,
                        kind: "private_key",
                    });
                    search_from = end;
                    continue;
                }
                search_from = start + "-----BEGIN ".len();
                continue;
            }
        }
        break;
    }
    out
}

/// Case-insensitive ASCII search for `key` in `text`; returns byte offsets.
fn find_key_positions(text: &str, key: &str) -> Vec<usize> {
    let hay = text.as_bytes();
    let needle = key.as_bytes();
    if needle.is_empty() || hay.len() < needle.len() {
        return Vec::new();
    }
    let mut out = Vec::new();
    for i in 0..=(hay.len() - needle.len()) {
        if hay[i..i + needle.len()]
            .iter()
            .zip(needle.iter())
            .all(|(a, b)| a.eq_ignore_ascii_case(b))
        {
            out.push(i);
        }
    }
    out
}

/// Finds credential-assignment values: `api_key = "…"`, `token: abc…`,
/// `password=…`. Only the *value* span is redacted, so the key name stays
/// visible in the preview. Requires an `=` or `:` after the key (prose
/// like "the token is…" is not redacted) and a value of at least 4 chars.
fn assignment_spans(text: &str) -> Vec<Span> {
    const KEYS: [&str; 8] = [
        "api_key",
        "apikey",
        "api-key",
        "secret",
        "token",
        "password",
        "passwd",
        "auth_token",
    ];
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    for key in KEYS {
        for pos in find_key_positions(text, key) {
            let mut i = pos + key.len();
            // Optional whitespace / quote between key and `=` / `:`.
            while i < bytes.len()
                && (bytes[i] == b' ' || bytes[i] == b'\t' || bytes[i] == b'"' || bytes[i] == b'\'')
            {
                i += 1;
            }
            if i >= bytes.len() || (bytes[i] != b'=' && bytes[i] != b':') {
                continue;
            }
            i += 1;
            while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') {
                i += 1;
            }
            // Optional opening quote.
            let quoted = i < bytes.len() && (bytes[i] == b'"' || bytes[i] == b'\'');
            let quote = if quoted { bytes[i] } else { 0 };
            if quoted {
                i += 1;
            }
            let value_start = i;
            let mut value_end = i;
            if quoted {
                while value_end < bytes.len() && bytes[value_end] != quote {
                    value_end += 1;
                }
                if value_end >= bytes.len() {
                    continue; // Unterminated quote: not a value.
                }
            } else {
                while value_end < bytes.len()
                    && !matches!(
                        bytes[value_end],
                        b' ' | b'\t'
                            | b'\n'
                            | b'\r'
                            | b','
                            | b';'
                            | b'}'
                            | b']'
                            | b')'
                            | b'"'
                            | b'\''
                    )
                {
                    value_end += 1;
                }
            }
            if value_end - value_start >= 4 {
                out.push(Span {
                    start: value_start,
                    end: value_end,
                    kind: "credential_assignment",
                });
            }
        }
    }
    out
}

/// Redacts secrets and API keys in `prompt` when `enabled`.
/// Disabled returns the prompt untouched with no hits. The replacement is
/// always the literal `[REDACTED]`; the original secret bytes are never
/// copied into the hit list, so the preview cannot leak them.
pub fn redact_text(prompt: &str, enabled: bool) -> RedactedPrompt {
    if !enabled {
        return RedactedPrompt {
            text: prompt.to_string(),
            redacted: false,
            hits: Vec::new(),
        };
    }
    let mut spans: Vec<Span> = Vec::new();
    // Token families: (prefix, kind, minimum token length after the prefix).
    for (prefix, kind, min_token) in [
        ("ghp_", "github_token", 20),
        ("github_pat_", "github_token", 20),
        ("gho_", "github_token", 20),
        ("xoxb-", "slack_token", 10),
        ("xoxp-", "slack_token", 10),
        ("xoxa-", "slack_token", 10),
        ("xoxr-", "slack_token", 10),
        ("AKIA", "aws_access_key", 16),
        // `sk-ant-` must precede `sk-`: both match an Anthropic key's
        // prefix, and the stable sort keeps the first-inserted span.
        ("sk-ant-", "anthropic_key", 16),
        ("sk-", "openai_key", 16),
        ("AIza", "google_api_key", 20),
        ("Bearer ", "bearer_token", 8),
    ] {
        spans.extend(prefix_spans(prompt, prefix, kind, min_token));
    }
    spans.extend(jwt_spans(prompt));
    spans.extend(private_key_spans(prompt));
    spans.extend(assignment_spans(prompt));

    // Sort by start, drop overlaps (keep the earliest; on a tie, longest).
    spans.sort_by(|a, b| a.start.cmp(&b.start).then(b.end.cmp(&a.end)));
    let mut kept: Vec<Span> = Vec::new();
    for span in spans {
        if kept.last().is_some_and(|last| span.start < last.end) {
            continue;
        }
        kept.push(span);
    }
    if kept.is_empty() {
        return RedactedPrompt {
            text: prompt.to_string(),
            redacted: false,
            hits: Vec::new(),
        };
    }
    let mut out = String::with_capacity(prompt.len());
    let mut cursor = 0;
    let mut hits: Vec<RedactionHit> = Vec::new();
    for span in &kept {
        out.push_str(&prompt[cursor..span.start]);
        out.push_str("[REDACTED]");
        cursor = span.end;
        if let Some(hit) = hits.iter_mut().find(|h| h.kind == span.kind) {
            hit.count += 1;
        } else {
            hits.push(RedactionHit {
                kind: span.kind.to_string(),
                count: 1,
            });
        }
    }
    out.push_str(&prompt[cursor..]);
    RedactedPrompt {
        text: out,
        redacted: true,
        hits,
    }
}

// ─── Backup validation ──────────────────────────────────────────────────────

/// Item counts inside a validated backup file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BackupCounts {
    pub reminders: usize,
    pub focus_sessions: usize,
    pub shortcuts: usize,
    pub audit_entries: usize,
}

/// The result of validating a backup file's JSON.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BackupValidation {
    /// True when the file is a well-formed Veilura productivity backup.
    pub valid: bool,
    /// Human-readable problems (empty when valid).
    pub errors: Vec<String>,
    /// The backup `version` field when it parsed as an integer.
    pub version: Option<u32>,
    /// Item counts (zero when the file is invalid).
    pub counts: BackupCounts,
}

fn invalid(errors: Vec<String>, version: Option<u32>) -> BackupValidation {
    BackupValidation {
        valid: false,
        errors,
        version,
        counts: BackupCounts {
            reminders: 0,
            focus_sessions: 0,
            shortcuts: 0,
            audit_entries: 0,
        },
    }
}

/// Validates a backup file's JSON text. Never panics on malformed input:
/// every failure is reported in `errors` with `valid == false`.
pub fn validate_backup_json(json: &str) -> BackupValidation {
    let value: serde_json::Value = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(e) => {
            return invalid(vec![format!("not valid JSON: {e}")], None);
        }
    };
    let obj = match value.as_object() {
        Some(o) => o,
        None => return invalid(vec!["backup must be a JSON object".to_string()], None),
    };
    let mut errors: Vec<String> = Vec::new();
    let version = obj
        .get("version")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);
    match version {
        Some(1) => {}
        Some(other) => errors.push(format!("unsupported backup version: {other} (expected 1)")),
        None => errors.push("missing or non-integer backup `version`".to_string()),
    }
    match obj.get("app").and_then(|v| v.as_str()) {
        Some("veilura") => {}
        Some(other) => errors.push(format!(
            "wrong backup `app`: {other} (expected \"veilura\")"
        )),
        None => errors.push("missing backup `app` field".to_string()),
    }
    if obj.get("exported_at").and_then(|v| v.as_str()).is_none() {
        errors.push("missing backup `exported_at` timestamp".to_string());
    }
    let data = match obj.get("data").and_then(|v| v.as_object()) {
        Some(d) => d,
        None => {
            errors.push("missing backup `data` object".to_string());
            return invalid(errors, version);
        }
    };
    let count_array = |key: &str, errors: &mut Vec<String>| -> usize {
        match data.get(key) {
            None => 0,
            Some(v) => match v.as_array() {
                Some(arr) => arr.len(),
                None => {
                    errors.push(format!("backup `data.{key}` must be an array"));
                    0
                }
            },
        }
    };
    let reminders = count_array("reminders", &mut errors);
    let focus_sessions = count_array("focus_sessions", &mut errors);
    let shortcuts = count_array("shortcuts", &mut errors);
    let audit_entries = count_array("audit_log", &mut errors);
    if let Some(settings) = data.get("settings") {
        if !settings.is_object() {
            errors.push("backup `data.settings` must be an object".to_string());
        }
    }
    // Spot-check reminder shape when present: each reminder needs an id and
    // a title so restore can rebuild the list.
    if let Some(arr) = data.get("reminders").and_then(|v| v.as_array()) {
        for (i, item) in arr.iter().enumerate() {
            let ok = item.get("id").and_then(|v| v.as_str()).is_some()
                && item.get("title").and_then(|v| v.as_str()).is_some();
            if !ok {
                errors.push(format!("backup reminder #{i} is missing `id` or `title`"));
                break;
            }
        }
    }
    if !errors.is_empty() {
        return invalid(errors, version);
    }
    BackupValidation {
        valid: true,
        errors: Vec::new(),
        version,
        counts: BackupCounts {
            reminders,
            focus_sessions,
            shortcuts,
            audit_entries,
        },
    }
}

// ─── Shortcut conflicts ─────────────────────────────────────────────────────

/// One user-configured shortcut binding.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShortcutBinding {
    /// Stable action id, e.g. `"summon"` or `"quick_action_summarise"`.
    pub id: String,
    /// Human keys, e.g. `"CmdOrCtrl+Shift+K"`. Case/whitespace tolerant.
    pub keys: String,
}

/// One detected conflict: two or more actions on the same keys.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ShortcutConflict {
    /// Normalised keys all the listed actions share.
    pub keys: String,
    /// Action ids bound to those keys.
    pub ids: Vec<String>,
}

/// Canonical modifier order for normalisation.
fn modifier_rank(part: &str) -> Option<usize> {
    match part {
        "CmdOrCtrl" => Some(0),
        "Ctrl" => Some(1),
        "Cmd" => Some(2),
        "Meta" => Some(3),
        "Alt" => Some(4),
        "Shift" => Some(5),
        _ => None,
    }
}

/// Normalises a shortcut string so `"shift+cmd+k"`, `"Cmd+Shift+K"` and
/// `"Cmd + Shift + K"` all compare equal. Returns `""` for an empty input.
pub fn normalize_shortcut(keys: &str) -> String {
    let mut modifiers: Vec<String> = Vec::new();
    let mut key_parts: Vec<String> = Vec::new();
    for raw in keys.split('+') {
        let part = raw.trim();
        if part.is_empty() {
            continue;
        }
        let canonical = match part.to_ascii_lowercase().as_str() {
            "cmdorctrl" | "ctrlcmd" | "cmdctrl" => "CmdOrCtrl",
            "ctrl" | "control" => "Ctrl",
            "cmd" | "command" | "meta" | "super" | "win" => {
                // `meta`/`super`/`win` collapse to `Cmd` on macOS, where
                // the Command key is the Meta key.
                "Cmd"
            }
            "alt" | "option" => "Alt",
            "shift" => "Shift",
            _ => "",
        };
        if canonical.is_empty() {
            // The non-modifier key: single characters uppercase, named keys
            // keep their spelling with a capitalised first letter.
            let mut chars = part.chars();
            let key = match chars.next() {
                None => String::new(),
                Some(first) => {
                    let mut k = first.to_ascii_uppercase().to_string();
                    k.push_str(chars.as_str());
                    k
                }
            };
            if !key_parts.contains(&key) {
                key_parts.push(key);
            }
        } else if !modifiers.iter().any(|m| m == canonical) {
            modifiers.push(canonical.to_string());
        }
    }
    modifiers.sort_by_key(|m| modifier_rank(m).unwrap_or(99));
    let mut parts = modifiers;
    parts.extend(key_parts);
    parts.join("+")
}

/// Groups bindings by normalised keys; every group with 2+ distinct action
/// ids is a conflict. Empty-key bindings are ignored (unbound actions).
pub fn detect_shortcut_conflicts(bindings: &[ShortcutBinding]) -> Vec<ShortcutConflict> {
    let mut groups: Vec<(String, Vec<String>)> = Vec::new();
    for binding in bindings {
        let keys = normalize_shortcut(&binding.keys);
        if keys.is_empty() {
            continue;
        }
        if let Some((_, ids)) = groups.iter_mut().find(|(k, _)| *k == keys) {
            if !ids.iter().any(|id| id == &binding.id) {
                ids.push(binding.id.clone());
            }
        } else {
            groups.push((keys, vec![binding.id.clone()]));
        }
    }
    groups
        .into_iter()
        .filter(|(_, ids)| ids.len() > 1)
        .map(|(keys, mut ids)| {
            ids.sort();
            ShortcutConflict { keys, ids }
        })
        .collect()
}

// ─── Input guards ───────────────────────────────────────────────────────────

/// Validates a reminder before it is stored.
pub fn validate_reminder(title: &str, due_at_ms: i64) -> Result<(), String> {
    if title.trim().is_empty() {
        return Err("reminder title must not be empty".to_string());
    }
    if title.chars().count() > 500 {
        return Err("reminder title must be at most 500 characters".to_string());
    }
    if due_at_ms <= 0 {
        return Err("reminder due time must be a positive Unix timestamp".to_string());
    }
    Ok(())
}

/// Validates Pomodoro durations (minutes) before they are stored.
pub fn validate_focus_durations(
    focus_min: u32,
    short_break_min: u32,
    long_break_min: u32,
) -> Result<(), String> {
    if !(1..=180).contains(&focus_min) {
        return Err("focus duration must be 1–180 minutes".to_string());
    }
    if !(1..=60).contains(&short_break_min) {
        return Err("short break must be 1–60 minutes".to_string());
    }
    if !(1..=90).contains(&long_break_min) {
        return Err("long break must be 1–90 minutes".to_string());
    }
    Ok(())
}

// ─── Audit log ──────────────────────────────────────────────────────────────

/// Kinds of locally-logged events. The log never leaves the device.
pub const AUDIT_KINDS: [&str; 7] = [
    "outbound_request",
    "system_action",
    "setting_change",
    "data_delete",
    "backup",
    "restore",
    "engine_restart",
];

/// True when `kind` is a known audit-log kind.
pub fn audit_kind_is_valid(kind: &str) -> bool {
    AUDIT_KINDS.contains(&kind)
}

/// One local-only audit-log entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AuditEntry {
    /// Stable id: `audit-<seq>-<timestamp_ms>`.
    pub id: String,
    /// Unix timestamp (ms) the event was recorded.
    pub ts_ms: i64,
    /// One of [`AUDIT_KINDS`].
    pub kind: String,
    /// Human-readable detail. Must never contain secret values: callers
    /// pass redacted text (see [`redact_text`]).
    pub detail: String,
}

/// Builds one audit entry. Returns `Err` for an unknown `kind` so callers
/// cannot silently log miscategorised events.
pub fn audit_entry(seq: u64, kind: &str, detail: &str, ts_ms: i64) -> Result<AuditEntry, String> {
    if !audit_kind_is_valid(kind) {
        return Err(format!("unknown audit kind: {kind}"));
    }
    Ok(AuditEntry {
        id: format!("audit-{seq}-{ts_ms}"),
        ts_ms,
        kind: kind.to_string(),
        detail: detail.to_string(),
    })
}

// ─── Tauri commands (thin wrappers; wired by the parent) ────────────────────

/// Redacts secrets in one outbound prompt. `enabled == false` returns the
/// prompt untouched.
#[cfg_attr(not(coverage), tauri::command)]
pub fn productivity_redact_prompt(prompt: String, enabled: bool) -> RedactedPrompt {
    redact_text(&prompt, enabled)
}

/// Validates a backup file's JSON text, reporting every problem found.
#[cfg_attr(not(coverage), tauri::command)]
pub fn productivity_validate_backup(json: String) -> BackupValidation {
    validate_backup_json(&json)
}

/// Detects shortcut conflicts among the given bindings.
#[cfg_attr(not(coverage), tauri::command)]
pub fn productivity_check_shortcut_conflicts(
    bindings: Vec<ShortcutBinding>,
) -> Vec<ShortcutConflict> {
    detect_shortcut_conflicts(&bindings)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Redaction ───────────────────────────────────────────────────────

    #[test]
    fn redact_disabled_returns_prompt_untouched() {
        let out = redact_text("key is ghp_abcdefghij1234567890abcdefghij1234", false);
        assert!(!out.redacted);
        assert!(out.hits.is_empty());
        assert!(out.text.contains("ghp_"));
    }

    #[test]
    fn redact_github_token() {
        let token = "ghp_abcdefghij1234567890abcdefghij1234";
        let out = redact_text(&format!("token {token} here"), true);
        assert!(out.redacted);
        assert!(!out.text.contains("ghp_"));
        assert!(out.text.contains("[REDACTED]"));
        assert_eq!(
            out.hits,
            vec![RedactionHit {
                kind: "github_token".to_string(),
                count: 1,
            }]
        );
    }

    #[test]
    fn redact_aws_key() {
        let out = redact_text("key AKIAIOSFODNN7EXAMPLE", true);
        assert!(out.redacted);
        assert!(!out.text.contains("AKIA"));
        assert!(out.hits.iter().any(|h| h.kind == "aws_access_key"));
    }

    #[test]
    fn redact_openai_and_bearer_and_slack() {
        let out = redact_text(
            "use sk-abcdefghij1234567890abcdefghij1234 and Bearer abcdefgh12345678 and xoxb-123456789012-abcdefghij",
            true,
        );
        assert!(out.redacted);
        assert!(!out.text.contains("sk-"));
        assert!(!out.text.contains("Bearer abc"));
        assert!(!out.text.contains("xoxb-"));
        assert_eq!(out.hits.len(), 3);
    }

    #[test]
    fn redact_credential_assignment_keeps_key_name() {
        let out = redact_text("api_key = \"supersecretvalue\"", true);
        assert!(out.redacted);
        assert!(out.text.contains("api_key"));
        assert!(!out.text.contains("supersecretvalue"));
        assert!(out.text.contains("[REDACTED]"));
    }

    #[test]
    fn redact_assignment_requires_separator_and_min_length() {
        // Prose without `=`/`:` is not redacted; tiny values are not either.
        let out = redact_text("the token is abc", true);
        assert!(!out.redacted);
        let out = redact_text("token: ab", true);
        assert!(!out.redacted);
    }

    #[test]
    fn redact_private_key_block() {
        let block =
            "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK\n-----END RSA PRIVATE KEY-----";
        let out = redact_text(&format!("key:\n{block}\ndone"), true);
        assert!(out.redacted);
        assert!(!out.text.contains("MIIBOgIBAAJBAK"));
        assert!(out.hits.iter().any(|h| h.kind == "private_key"));
    }

    #[test]
    fn redact_skips_certificate_blocks_but_redacts_later_private_key() {
        let cert = "-----BEGIN CERTIFICATE-----\nCERTDATA\n-----END CERTIFICATE-----";
        let key = "-----BEGIN RSA PRIVATE KEY-----\nKEYDATA\n-----END RSA PRIVATE KEY-----";
        let out = redact_text(&format!("{cert}\n{key}"), true);
        assert!(out.redacted);
        // The certificate is not a secret: it survives.
        assert!(out.text.contains("CERTDATA"));
        assert!(!out.text.contains("KEYDATA"));
    }

    #[test]
    fn redact_jwt() {
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
        let out = redact_text(&format!("auth {jwt}"), true);
        assert!(out.redacted);
        assert!(!out.text.contains("eyJ"));
    }

    #[test]
    fn redact_clean_text_is_untouched() {
        let out = redact_text("Hello, please summarise this paragraph.", true);
        assert!(!out.redacted);
        assert_eq!(out.text, "Hello, please summarise this paragraph.");
    }

    #[test]
    fn redact_short_lookalike_tokens_are_not_redacted() {
        // `sk-x` is too short to be a real key.
        let out = redact_text("model sk-x", true);
        assert!(!out.redacted);
    }

    // ── Backup validation ───────────────────────────────────────────────

    fn valid_backup_json() -> String {
        serde_json::json!({
            "version": 1,
            "app": "veilura",
            "exported_at": "2026-10-16T00:00:00Z",
            "data": {
                "reminders": [{ "id": "r1", "title": "Call back" }],
                "focus_sessions": [],
                "shortcuts": [],
                "audit_log": [],
                "settings": {}
            }
        })
        .to_string()
    }

    #[test]
    fn validate_backup_accepts_well_formed_file() {
        let v = validate_backup_json(&valid_backup_json());
        assert!(v.valid);
        assert!(v.errors.is_empty());
        assert_eq!(v.version, Some(1));
        assert_eq!(v.counts.reminders, 1);
    }

    #[test]
    fn validate_backup_rejects_malformed_json() {
        let v = validate_backup_json("{not json");
        assert!(!v.valid);
        assert!(v.errors.iter().any(|e| e.contains("not valid JSON")));
    }

    #[test]
    fn validate_backup_rejects_wrong_version_and_app() {
        let json = serde_json::json!({
            "version": 2, "app": "other", "exported_at": "x", "data": {}
        })
        .to_string();
        let v = validate_backup_json(&json);
        assert!(!v.valid);
        assert!(v.errors.iter().any(|e| e.contains("version")));
        assert!(v.errors.iter().any(|e| e.contains("app")));
    }

    #[test]
    fn validate_backup_rejects_missing_data_and_bad_reminder() {
        let v = validate_backup_json(r#"{"version":1,"app":"veilura","exported_at":"x"}"#);
        assert!(!v.valid);
        assert!(v.errors.iter().any(|e| e.contains("data")));
        let json = serde_json::json!({
            "version": 1, "app": "veilura", "exported_at": "x",
            "data": { "reminders": [{ "id": "r1" }] }
        })
        .to_string();
        let v = validate_backup_json(&json);
        assert!(!v.valid);
        assert!(v.errors.iter().any(|e| e.contains("reminder")));
    }

    // ── Shortcuts ───────────────────────────────────────────────────────

    #[test]
    fn normalize_shortcut_canonicalises_order_case_and_spacing() {
        assert_eq!(normalize_shortcut("shift+cmd+k"), "Cmd+Shift+K");
        assert_eq!(normalize_shortcut("Cmd + Shift + K"), "Cmd+Shift+K");
        assert_eq!(normalize_shortcut("cmdorctrl+shift+k"), "CmdOrCtrl+Shift+K");
        assert_eq!(normalize_shortcut(""), "");
        assert_eq!(normalize_shortcut("F5"), "F5");
    }

    #[test]
    fn detect_shortcut_conflicts_finds_shared_keys() {
        let bindings = vec![
            ShortcutBinding {
                id: "summon".into(),
                keys: "Cmd+Shift+K".into(),
            },
            ShortcutBinding {
                id: "quick_summarise".into(),
                keys: "shift+cmd+k".into(),
            },
            ShortcutBinding {
                id: "other".into(),
                keys: "Cmd+Shift+J".into(),
            },
        ];
        let conflicts = detect_shortcut_conflicts(&bindings);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].keys, "Cmd+Shift+K");
        assert_eq!(conflicts[0].ids, vec!["quick_summarise", "summon"]);
    }

    #[test]
    fn detect_shortcut_conflicts_ignores_unbound_and_unique() {
        let bindings = vec![
            ShortcutBinding {
                id: "a".into(),
                keys: "".into(),
            },
            ShortcutBinding {
                id: "b".into(),
                keys: "Cmd+K".into(),
            },
        ];
        assert!(detect_shortcut_conflicts(&bindings).is_empty());
    }

    // ── Input guards ────────────────────────────────────────────────────

    #[test]
    fn validate_reminder_rejects_empty_title_and_bad_time() {
        assert!(validate_reminder("Call", 1_000).is_ok());
        assert!(validate_reminder("   ", 1_000).is_err());
        assert!(validate_reminder("Call", 0).is_err());
        assert!(validate_reminder("Call", -5).is_err());
        assert!(validate_reminder(&"x".repeat(501), 1_000).is_err());
    }

    #[test]
    fn validate_focus_durations_enforces_ranges() {
        assert!(validate_focus_durations(25, 5, 15).is_ok());
        assert!(validate_focus_durations(0, 5, 15).is_err());
        assert!(validate_focus_durations(25, 0, 15).is_err());
        assert!(validate_focus_durations(25, 5, 0).is_err());
        assert!(validate_focus_durations(181, 5, 15).is_err());
    }

    // ── Audit log ───────────────────────────────────────────────────────

    #[test]
    fn audit_entry_builds_and_rejects_unknown_kind() {
        let entry = audit_entry(7, "backup", "exported 12 items", 1_000).unwrap();
        assert_eq!(entry.id, "audit-7-1000");
        assert_eq!(entry.kind, "backup");
        assert!(audit_entry(1, "nope", "x", 1).is_err());
        assert!(audit_kind_is_valid("outbound_request"));
        assert!(!audit_kind_is_valid("telemetry"));
    }
}
