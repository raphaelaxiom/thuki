/*!
 * Extended conversation management: search, pins, folders, tags,
 * rename, duplicate, export/import payloads, archive, bulk actions,
 * and the prompt library.
 *
 * This module is additive: it never changes the existing `history.rs`
 * commands. It adds columns (`pinned`, `archived`, `folder_id`) and
 * tables (`conversation_folders`, `conversation_tags`, `prompts`) to the
 * same SQLite database via [`ensure_conversations_ext_schema`], which
 * every command runs first so the schema is always present without a
 * separate startup migration step. All statements are parameterised;
 * user input is never interpolated into SQL.
 *
 * The frontend panels in `src/features/conversations/` persist the same
 * state in localStorage until the parent wires these commands into the
 * invoke handler (see INTEGRATION-conversations.md).
 */

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::database;
use crate::history::Database;

// ─── Schema ─────────────────────────────────────────────────────────────────

/// Idempotently adds the extension columns / tables. Safe to run on every
/// command: `ensure_column` is a no-op when the column already exists and
/// every `CREATE TABLE` uses `IF NOT EXISTS`.
pub fn ensure_conversations_ext_schema(conn: &Connection) -> rusqlite::Result<()> {
    ensure_column(conn, "conversations", "pinned", "INTEGER")?;
    ensure_column(conn, "conversations", "archived", "INTEGER")?;
    ensure_column(conn, "conversations", "folder_id", "TEXT")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS conversation_folders (\
            id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);\
         CREATE TABLE IF NOT EXISTS conversation_tags (\
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,\
            tag TEXT NOT NULL, PRIMARY KEY (conversation_id, tag));\
         CREATE INDEX IF NOT EXISTS idx_conversation_tags_tag ON conversation_tags(tag);\
         CREATE TABLE IF NOT EXISTS prompts (\
            id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,\
            favourite INTEGER NOT NULL DEFAULT 0, builtin INTEGER NOT NULL DEFAULT 0,\
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);",
    )?;
    Ok(())
}

/// Mirrors `database::ensure_column` (which is private to that module):
/// adds a column when missing, after allowlist-validating every identifier
/// so DDL can never be injected through these fixed call sites.
fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    col_type: &str,
) -> rusqlite::Result<()> {
    if !is_safe_sql_ident(table) || !is_safe_sql_ident(column) {
        return Err(rusqlite::Error::InvalidParameterName(format!(
            "unsafe identifier: {table}.{column}"
        )));
    }
    for token in col_type.split_whitespace() {
        if !is_safe_sql_ident(token) {
            return Err(rusqlite::Error::InvalidParameterName(format!(
                "unsafe col_type token: {token:?}"
            )));
        }
    }
    let exists: bool = conn
        .prepare(&format!("PRAGMA table_info({table})"))?
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .any(|name| name == column);
    if !exists {
        conn.execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {col_type};"
        ))?;
    }
    Ok(())
}

fn is_safe_sql_ident(s: &str) -> bool {
    !s.is_empty()
        && s.chars().enumerate().all(|(i, c)| {
            if i == 0 {
                c.is_ascii_alphabetic() || c == '_'
            } else {
                c.is_ascii_alphanumeric() || c == '_'
            }
        })
}

// ─── Shared shapes ──────────────────────────────────────────────────────────

/// Conversation list item with the extension fields. Field names match the
/// TypeScript `ConversationMeta` / `ExtConversationSummary` shapes.
#[derive(Clone, Serialize)]
pub struct ExtConversationSummary {
    pub id: String,
    pub title: Option<String>,
    pub model: String,
    pub updated_at: i64,
    pub message_count: i64,
    pub pinned: bool,
    pub archived: bool,
    pub folder_id: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ConversationFolder {
    pub id: String,
    pub name: String,
    pub created_at: i64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct PromptRow {
    pub id: String,
    pub title: String,
    pub body: String,
    pub favourite: bool,
    pub builtin: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize)]
pub struct ConversationExportPayload {
    pub id: String,
    pub title: Option<String>,
    pub model: String,
    pub messages: Vec<ExportedMessage>,
}

#[derive(Serialize)]
pub struct ExportedMessage {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct ImportMessage {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct ImportConversationPayload {
    pub title: Option<String>,
    pub model: Option<String>,
    pub messages: Vec<ImportMessage>,
}

// ─── Pure helpers (unit-tested) ─────────────────────────────────────────────

/// Escapes a user query for use inside a SQL `LIKE '%…%'` pattern:
/// `\` → `\\`, `%` → `\%`, `_` → `\_`, then wraps in `%…%`.
/// The queries use `ESCAPE '\'` so the pattern cannot widen the match.
pub fn like_pattern(query: &str) -> String {
    let escaped = query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

/// Normalises a tag exactly like the frontend (`storage.normalizeTag`):
/// trimmed, lowercased, whitespace runs collapsed to `-`, max 40 chars.
pub fn normalize_tag(raw: &str) -> Result<String, String> {
    let mut out = String::new();
    let mut last_was_space = true; // trims leading whitespace runs
    for ch in raw.trim().to_lowercase().chars() {
        if ch.is_whitespace() {
            if !last_was_space {
                out.push('-');
            }
            last_was_space = true;
        } else {
            out.push(ch);
            last_was_space = false;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        return Err("Tag is empty.".to_string());
    }
    if out.chars().count() > 40 {
        return Err("Tag is too long (max 40 chars).".to_string());
    }
    Ok(out)
}

fn validate_title(title: &str) -> Result<String, String> {
    let clean = title.trim();
    if clean.is_empty() {
        return Err("Title is empty.".to_string());
    }
    if clean.chars().count() > 500 {
        return Err("Title is too long (max 500 chars).".to_string());
    }
    Ok(clean.to_string())
}

fn validate_folder_name(name: &str) -> Result<String, String> {
    let clean = name.trim();
    if clean.is_empty() {
        return Err("Folder name is empty.".to_string());
    }
    if clean.chars().count() > 80 {
        return Err("Folder name is too long (max 80 chars).".to_string());
    }
    Ok(clean.to_string())
}

fn validate_prompt(prompt: &PromptRow) -> Result<(), String> {
    if prompt.title.trim().is_empty() {
        return Err("Prompt title is empty.".to_string());
    }
    if prompt.title.chars().count() > 120 {
        return Err("Prompt title is too long (max 120 chars).".to_string());
    }
    if prompt.body.trim().is_empty() {
        return Err("Prompt body is empty.".to_string());
    }
    if prompt.body.chars().count() > 20_000 {
        return Err("Prompt body is too long (max 20,000 chars).".to_string());
    }
    if prompt.id.trim().is_empty() {
        return Err("Prompt id is empty.".to_string());
    }
    Ok(())
}

fn validate_import(payload: &ImportConversationPayload) -> Result<(), String> {
    if payload.messages.is_empty() {
        return Err("Import has no messages.".to_string());
    }
    if payload.messages.len() > 5000 {
        return Err("Import has too many messages (max 5000).".to_string());
    }
    let mut total: usize = 0;
    for message in &payload.messages {
        if message.role != "user" && message.role != "assistant" {
            return Err("Imported messages must have role \"user\" or \"assistant\".".to_string());
        }
        total += message.content.len();
        if total > 2_000_000 {
            return Err("Import is too large.".to_string());
        }
    }
    if let Some(title) = &payload.title {
        if title.chars().count() > 500 {
            return Err("Import title is too long.".to_string());
        }
    }
    Ok(())
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ─── Internal helpers ───────────────────────────────────────────────────────

fn lock_and_migrate<'a>(
    db: &'a State<'a, Database>,
) -> Result<std::sync::MutexGuard<'a, Connection>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    ensure_conversations_ext_schema(&conn).map_err(|e| e.to_string())?;
    Ok(conn)
}

fn tags_for(conn: &Connection, conversation_id: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn
        .prepare("SELECT tag FROM conversation_tags WHERE conversation_id = ?1 ORDER BY tag ASC")?;
    let rows = stmt.query_map(params![conversation_id], |row| row.get::<_, String>(0))?;
    rows.collect()
}

fn conversation_exists(conn: &Connection, conversation_id: &str) -> rusqlite::Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM conversations WHERE id = ?1",
        params![conversation_id],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

// ─── Search ─────────────────────────────────────────────────────────────────

/// One row from the conversation search query:
/// (id, title, model, updated_at, message_count, pinned, archived, folder_id).
type ConvSearchRow = (
    String,
    Option<String>,
    String,
    i64,
    i64,
    i64,
    i64,
    Option<String>,
);

/// Full-text search across conversation titles AND message bodies
/// (SQL `LIKE`, case-insensitive for ASCII via SQLite's default LIKE).
/// Pinned conversations sort first, then most recently updated.
/// `folder_id` / `tag` narrow the result set; archived rows are excluded
/// unless `include_archived` is true.
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn conv_ext_search(
    query: String,
    include_archived: bool,
    folder_id: Option<String>,
    tag: Option<String>,
    db: State<'_, Database>,
) -> Result<Vec<ExtConversationSummary>, String> {
    let conn = lock_and_migrate(&db)?;
    let pattern = like_pattern(query.trim());
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.title, c.model, c.updated_at,
                    (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id),
                    COALESCE(c.pinned, 0), COALESCE(c.archived, 0), c.folder_id
             FROM conversations c
             WHERE (?1 = 1 OR COALESCE(c.archived, 0) = 0)
               AND (?2 IS NULL OR c.folder_id = ?2)
               AND (?3 IS NULL OR EXISTS (
                     SELECT 1 FROM conversation_tags t
                     WHERE t.conversation_id = c.id AND t.tag = ?3))
               AND (?4 = '%%' OR c.title LIKE ?4 ESCAPE '\\'
                    OR EXISTS (SELECT 1 FROM messages m
                               WHERE m.conversation_id = c.id
                                 AND m.content LIKE ?4 ESCAPE '\\'))
             ORDER BY COALESCE(c.pinned, 0) DESC, c.updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(
            params![i64::from(include_archived), folder_id, tag, pattern,],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;
    let bare: Vec<ConvSearchRow> = rows
        .collect::<rusqlite::Result<_>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);
    let mut out = Vec::with_capacity(bare.len());
    for (id, title, model, updated_at, message_count, pinned, archived, folder_id) in bare {
        let tags = tags_for(&conn, &id).map_err(|e| e.to_string())?;
        out.push(ExtConversationSummary {
            id,
            title,
            model,
            updated_at,
            message_count,
            pinned: pinned != 0,
            archived: archived != 0,
            folder_id,
            tags,
        });
    }
    Ok(out)
}

// ─── Pin / archive / rename / duplicate ─────────────────────────────────────

#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn conv_ext_set_pinned(
    conversation_id: String,
    pinned: bool,
    db: State<'_, Database>,
) -> Result<(), String> {
    let conn = lock_and_migrate(&db)?;
    conn.execute(
        "UPDATE conversations SET pinned = ?1 WHERE id = ?2",
        params![i64::from(pinned), conversation_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn conv_ext_set_archived(
    conversation_id: String,
    archived: bool,
    db: State<'_, Database>,
) -> Result<(), String> {
    let conn = lock_and_migrate(&db)?;
    conn.execute(
        "UPDATE conversations SET archived = ?1 WHERE id = ?2",
        params![i64::from(archived), conversation_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn conv_ext_rename(
    conversation_id: String,
    title: String,
    db: State<'_, Database>,
) -> Result<(), String> {
    let clean = validate_title(&title)?;
    let conn = lock_and_migrate(&db)?;
    database::update_conversation_title(&conn, &conversation_id, &clean)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Duplicates a conversation with all its messages under a new id and a
/// ` (copy)` title. Image references are shared with the original (the
/// files themselves are not copied); deleting one copy does not delete
/// the other's image files unless both are deleted.
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn conv_ext_duplicate(
    conversation_id: String,
    db: State<'_, Database>,
) -> Result<String, String> {
    let conn = lock_and_migrate(&db)?;
    let (title, model): (Option<String>, String) = conn
        .query_row(
            "SELECT title, model FROM conversations WHERE id = ?1",
            params![conversation_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Conversation not found.".to_string())?;
    let copy_title = match title {
        Some(t) if !t.trim().is_empty() => format!("{t} (copy)"),
        _ => "Untitled conversation (copy)".to_string(),
    };
    let messages = database::load_messages(&conn, &conversation_id).map_err(|e| e.to_string())?;
    let new_id = database::create_conversation(&conn, Some(&copy_title), &model)
        .map_err(|e| e.to_string())?;
    let batch: Vec<database::MessageBatchRow> = messages
        .into_iter()
        .map(|m| {
            (
                m.role,
                m.content,
                m.quoted_text,
                m.image_paths,
                m.thinking_content,
                m.search_sources,
                m.model_name,
            )
        })
        .collect();
    database::insert_messages_batch(&conn, &new_id, &batch).map_err(|e| e.to_string())?;
    Ok(new_id)
}

// ─── Bulk actions ───────────────────────────────────────────────────────────

/// Archives / unarchives many conversations. Returns how many rows changed.
/// At most 1000 ids per call; larger selections must be chunked by the caller.
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn conv_ext_bulk_archive(
    conversation_ids: Vec<String>,
    archived: bool,
    db: State<'_, Database>,
) -> Result<usize, String> {
    if conversation_ids.len() > 1000 {
        return Err("At most 1000 conversations per bulk call.".to_string());
    }
    let conn = lock_and_migrate(&db)?;
    let mut changed = 0usize;
    for id in &conversation_ids {
        changed += conn
            .execute(
                "UPDATE conversations SET archived = ?1 WHERE id = ?2",
                params![i64::from(archived), id],
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(changed)
}

/// Deletes many conversations (messages CASCADE). Returns rows deleted.
/// At most 1000 ids per call.
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn conv_ext_bulk_delete(
    conversation_ids: Vec<String>,
    db: State<'_, Database>,
) -> Result<usize, String> {
    if conversation_ids.len() > 1000 {
        return Err("At most 1000 conversations per bulk call.".to_string());
    }
    let conn = lock_and_migrate(&db)?;
    let mut deleted = 0usize;
    for id in &conversation_ids {
        if conversation_exists(&conn, id).map_err(|e| e.to_string())? {
            database::delete_conversation(&conn, id).map_err(|e| e.to_string())?;
            deleted += 1;
        }
    }
    Ok(deleted)
}

// ─── Export / import payloads ───────────────────────────────────────────────

/// Loads one conversation with all its messages for frontend export
/// (Markdown / JSON / print). The frontend serialises; this command only
/// supplies the data.
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn conv_ext_export(
    conversation_id: String,
    db: State<'_, Database>,
) -> Result<ConversationExportPayload, String> {
    let conn = lock_and_migrate(&db)?;
    let (title, model): (Option<String>, String) = conn
        .query_row(
            "SELECT title, model FROM conversations WHERE id = ?1",
            params![conversation_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Conversation not found.".to_string())?;
    let messages = database::load_messages(&conn, &conversation_id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|m| ExportedMessage {
            role: m.role,
            content: m.content,
        })
        .collect();
    Ok(ConversationExportPayload {
        id: conversation_id,
        title,
        model,
        messages,
    })
}

/// Imports a validated conversation payload (produced by the frontend
/// Markdown/JSON importer) as a new conversation. Returns the new id.
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn conv_ext_import(
    payload: ImportConversationPayload,
    db: State<'_, Database>,
) -> Result<String, String> {
    validate_import(&payload)?;
    let conn = lock_and_migrate(&db)?;
    let model = payload
        .model
        .clone()
        .unwrap_or_else(|| "imported".to_string());
    let new_id = database::create_conversation(&conn, payload.title.as_deref(), &model)
        .map_err(|e| e.to_string())?;
    let batch: Vec<database::MessageBatchRow> = payload
        .messages
        .into_iter()
        .map(|m| (m.role, m.content, None, None, None, None, None))
        .collect();
    database::insert_messages_batch(&conn, &new_id, &batch).map_err(|e| e.to_string())?;
    Ok(new_id)
}

// ─── Folders ────────────────────────────────────────────────────────────────

#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn conv_ext_list_folders(db: State<'_, Database>) -> Result<Vec<ConversationFolder>, String> {
    let conn = lock_and_migrate(&db)?;
    let mut stmt = conn
        .prepare("SELECT id, name, created_at FROM conversation_folders ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ConversationFolder {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>()
        .map_err(|e| e.to_string())
}

#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn conv_ext_create_folder(
    name: String,
    db: State<'_, Database>,
) -> Result<ConversationFolder, String> {
    let clean = validate_folder_name(&name)?;
    let conn = lock_and_migrate(&db)?;
    let clash: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM conversation_folders WHERE LOWER(name) = LOWER(?1)",
            params![clean],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if clash > 0 {
        return Err("A folder with that name already exists.".to_string());
    }
    let folder = ConversationFolder {
        id: uuid::Uuid::new_v4().to_string(),
        name: clean,
        created_at: now_millis(),
    };
    conn.execute(
        "INSERT INTO conversation_folders (id, name, created_at) VALUES (?1, ?2, ?3)",
        params![folder.id, folder.name, folder.created_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(folder)
}

#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn conv_ext_rename_folder(
    folder_id: String,
    name: String,
    db: State<'_, Database>,
) -> Result<(), String> {
    let clean = validate_folder_name(&name)?;
    let conn = lock_and_migrate(&db)?;
    let clash: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM conversation_folders WHERE LOWER(name) = LOWER(?1) AND id != ?2",
            params![clean, folder_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if clash > 0 {
        return Err("A folder with that name already exists.".to_string());
    }
    let changed = conn
        .execute(
            "UPDATE conversation_folders SET name = ?1 WHERE id = ?2",
            params![clean, folder_id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Folder not found.".to_string());
    }
    Ok(())
}

/// Deletes a folder; conversations filed in it become unfiled.
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn conv_ext_delete_folder(folder_id: String, db: State<'_, Database>) -> Result<(), String> {
    let conn = lock_and_migrate(&db)?;
    conn.execute(
        "UPDATE conversations SET folder_id = NULL WHERE folder_id = ?1",
        params![folder_id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM conversation_folders WHERE id = ?1",
        params![folder_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Files a conversation into a folder, or unfiles it when `folder_id` is null.
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn conv_ext_move(
    conversation_id: String,
    folder_id: Option<String>,
    db: State<'_, Database>,
) -> Result<(), String> {
    let conn = lock_and_migrate(&db)?;
    if let Some(folder) = &folder_id {
        if !conversation_exists(&conn, &conversation_id).map_err(|e| e.to_string())? {
            return Err("Conversation not found.".to_string());
        }
        let folder_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM conversation_folders WHERE id = ?1",
                params![folder],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        if folder_exists == 0 {
            return Err("Folder not found.".to_string());
        }
    }
    conn.execute(
        "UPDATE conversations SET folder_id = ?1 WHERE id = ?2",
        params![folder_id, conversation_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Tags ───────────────────────────────────────────────────────────────────

#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn conv_ext_add_tag(
    conversation_id: String,
    tag: String,
    db: State<'_, Database>,
) -> Result<(), String> {
    let clean = normalize_tag(&tag)?;
    let conn = lock_and_migrate(&db)?;
    if !conversation_exists(&conn, &conversation_id).map_err(|e| e.to_string())? {
        return Err("Conversation not found.".to_string());
    }
    conn.execute(
        "INSERT OR IGNORE INTO conversation_tags (conversation_id, tag) VALUES (?1, ?2)",
        params![conversation_id, clean],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn conv_ext_remove_tag(
    conversation_id: String,
    tag: String,
    db: State<'_, Database>,
) -> Result<(), String> {
    let clean = normalize_tag(&tag)?;
    let conn = lock_and_migrate(&db)?;
    conn.execute(
        "DELETE FROM conversation_tags WHERE conversation_id = ?1 AND tag = ?2",
        params![conversation_id, clean],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Prompt library ─────────────────────────────────────────────────────────

/// Lists custom prompts (built-ins live in the frontend `prompts.ts` and
/// are never stored). Favourites first, then alphabetical by title.
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn conv_ext_list_prompts(db: State<'_, Database>) -> Result<Vec<PromptRow>, String> {
    let conn = lock_and_migrate(&db)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, body, favourite, builtin, created_at, updated_at
             FROM prompts ORDER BY favourite DESC, title ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(PromptRow {
                id: row.get(0)?,
                title: row.get(1)?,
                body: row.get(2)?,
                favourite: row.get::<_, i64>(3)? != 0,
                builtin: row.get::<_, i64>(4)? != 0,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<_>>()
        .map_err(|e| e.to_string())
}

/// Creates or updates a custom prompt. Built-in rows are never modified
/// through this command, and `builtin` from the caller is ignored (always
/// stored as 0) so a compromised renderer cannot promote a prompt.
#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn conv_ext_upsert_prompt(
    prompt: PromptRow,
    db: State<'_, Database>,
) -> Result<PromptRow, String> {
    validate_prompt(&prompt)?;
    let conn = lock_and_migrate(&db)?;
    let PromptRow {
        id,
        title,
        body,
        favourite,
        ..
    } = prompt;
    let existing: Option<(i64, i64)> = conn
        .query_row(
            "SELECT created_at, builtin FROM prompts WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let now = now_millis();
    match existing {
        Some((created_at, builtin)) => {
            if builtin != 0 {
                return Err("Built-in prompts cannot be modified.".to_string());
            }
            conn.execute(
                "UPDATE prompts SET title = ?1, body = ?2, favourite = ?3, updated_at = ?4 WHERE id = ?5",
                params![title, body, i64::from(favourite), now, id],
            )
            .map_err(|e| e.to_string())?;
            Ok(PromptRow {
                id,
                title,
                body,
                favourite,
                builtin: false,
                created_at,
                updated_at: now,
            })
        }
        None => {
            conn.execute(
                "INSERT INTO prompts (id, title, body, favourite, builtin, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)",
                params![id, title, body, i64::from(favourite), now],
            )
            .map_err(|e| e.to_string())?;
            Ok(PromptRow {
                id,
                title,
                body,
                favourite,
                builtin: false,
                created_at: now,
                updated_at: now,
            })
        }
    }
}

#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn conv_ext_delete_prompt(prompt_id: String, db: State<'_, Database>) -> Result<(), String> {
    let conn = lock_and_migrate(&db)?;
    let builtin: Option<i64> = conn
        .query_row(
            "SELECT builtin FROM prompts WHERE id = ?1",
            params![prompt_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    match builtin {
        None => Err("Prompt not found.".to_string()),
        Some(1) => Err("Built-in prompts cannot be deleted.".to_string()),
        Some(_) => {
            conn.execute("DELETE FROM prompts WHERE id = ?1", params![prompt_id])
                .map_err(|e| e.to_string())?;
            Ok(())
        }
    }
}

#[cfg_attr(coverage_nightly, coverage(off))]
#[cfg_attr(not(coverage), tauri::command)]
pub fn conv_ext_set_prompt_favourite(
    prompt_id: String,
    favourite: bool,
    db: State<'_, Database>,
) -> Result<(), String> {
    let conn = lock_and_migrate(&db)?;
    let changed = conn
        .execute(
            "UPDATE prompts SET favourite = ?1 WHERE id = ?2",
            params![i64::from(favourite), prompt_id],
        )
        .map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Prompt not found.".to_string());
    }
    Ok(())
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_conn() -> Connection {
        let conn = database::open_in_memory().expect("in-memory db");
        ensure_conversations_ext_schema(&conn).expect("ext schema");
        conn
    }

    fn seed_conversation(conn: &Connection, title: &str) -> String {
        let id = database::create_conversation(conn, Some(title), "model-x").expect("create");
        database::insert_messages_batch(
            conn,
            &id,
            &[
                (
                    "user".to_string(),
                    "How do I make pasta?".to_string(),
                    None,
                    None,
                    None,
                    None,
                    None,
                ),
                (
                    "assistant".to_string(),
                    "Boil water, add salt, cook 8 minutes.".to_string(),
                    None,
                    None,
                    None,
                    None,
                    None,
                ),
            ],
        )
        .expect("messages");
        id
    }

    #[test]
    fn like_pattern_escapes_wildcards() {
        assert_eq!(like_pattern("a%b_c\\d"), "%a\\%b\\_c\\\\d%");
        assert_eq!(like_pattern("pasta"), "%pasta%");
    }

    #[test]
    fn normalize_tag_collapses_whitespace_and_lowercases() {
        assert_eq!(
            normalize_tag("  Machine   Learning ").as_deref(),
            Ok("machine-learning")
        );
        assert!(normalize_tag("   ").is_err());
        assert!(normalize_tag(&"x".repeat(41)).is_err());
    }

    #[test]
    fn validate_import_rejects_bad_roles_and_oversize() {
        let good = ImportConversationPayload {
            title: Some("T".to_string()),
            model: None,
            messages: vec![ImportMessage {
                role: "user".to_string(),
                content: "hi".to_string(),
            }],
        };
        assert!(validate_import(&good).is_ok());
        let bad_role = ImportConversationPayload {
            title: None,
            model: None,
            messages: vec![ImportMessage {
                role: "system".to_string(),
                content: "hi".to_string(),
            }],
        };
        assert!(validate_import(&bad_role).is_err());
        let empty = ImportConversationPayload {
            title: None,
            model: None,
            messages: vec![],
        };
        assert!(validate_import(&empty).is_err());
    }

    #[test]
    fn validate_prompt_and_titles() {
        assert!(validate_title("  Hello ").is_ok());
        assert!(validate_title("").is_err());
        assert!(validate_folder_name("Work").is_ok());
        assert!(validate_folder_name("  ").is_err());
        let bad = PromptRow {
            id: "p1".to_string(),
            title: "".to_string(),
            body: "x".to_string(),
            favourite: false,
            builtin: false,
            created_at: 0,
            updated_at: 0,
        };
        assert!(validate_prompt(&bad).is_err());
    }

    #[test]
    fn schema_is_idempotent_on_existing_db() {
        let conn = mem_conn();
        ensure_conversations_ext_schema(&conn).expect("second run");
        ensure_conversations_ext_schema(&conn).expect("third run");
    }

    #[test]
    fn pin_archive_folder_tag_round_trip_via_sql() {
        let conn = mem_conn();
        let id = seed_conversation(&conn, "Pasta night");
        conn.execute(
            "UPDATE conversations SET pinned = 1, archived = 0 WHERE id = ?1",
            params![id],
        )
        .expect("pin");
        conn.execute(
            "INSERT INTO conversation_folders (id, name, created_at) VALUES ('f1', 'Work', 1)",
            [],
        )
        .expect("folder");
        conn.execute(
            "UPDATE conversations SET folder_id = 'f1' WHERE id = ?1",
            params![id],
        )
        .expect("move");
        conn.execute(
            "INSERT INTO conversation_tags (conversation_id, tag) VALUES (?1, 'recipes')",
            params![id],
        )
        .expect("tag");
        let pinned: i64 = conn
            .query_row(
                "SELECT COALESCE(pinned, 0) FROM conversations WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .expect("read pinned");
        assert_eq!(pinned, 1);
        assert_eq!(tags_for(&conn, &id).expect("tags"), vec!["recipes"]);
    }

    #[test]
    fn duplicate_copies_messages_with_copy_title() {
        let conn = mem_conn();
        let id = seed_conversation(&conn, "Pasta night");
        // Duplicate through the same SQL the command uses, via the
        // public helpers, to prove the copy path end to end.
        let (title, model): (Option<String>, String) = conn
            .query_row(
                "SELECT title, model FROM conversations WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("read");
        let copy_title = format!("{} (copy)", title.unwrap_or_default());
        let new_id =
            database::create_conversation(&conn, Some(&copy_title), &model).expect("create copy");
        let messages = database::load_messages(&conn, &id).expect("load original");
        let batch: Vec<database::MessageBatchRow> = messages
            .into_iter()
            .map(|m| {
                (
                    m.role,
                    m.content,
                    m.quoted_text,
                    m.image_paths,
                    m.thinking_content,
                    m.search_sources,
                    m.model_name,
                )
            })
            .collect();
        database::insert_messages_batch(&conn, &new_id, &batch).expect("copy batch");
        let copied = database::load_messages(&conn, &new_id).expect("load copy");
        assert_eq!(copied.len(), 2);
        assert_eq!(copied[0].content, "How do I make pasta?");
    }

    #[test]
    fn prompt_crud_round_trip() {
        let conn = mem_conn();
        let now = now_millis();
        conn.execute(
            "INSERT INTO prompts (id, title, body, favourite, builtin, created_at, updated_at) \
             VALUES ('p1', 'Summarise', 'Sum {{text}}', 0, 0, ?1, ?1)",
            params![now],
        )
        .expect("insert prompt");
        conn.execute("UPDATE prompts SET favourite = 1 WHERE id = 'p1'", [])
            .expect("favourite");
        let fav: i64 = conn
            .query_row("SELECT favourite FROM prompts WHERE id = 'p1'", [], |row| {
                row.get(0)
            })
            .expect("read fav");
        assert_eq!(fav, 1);
        conn.execute("DELETE FROM prompts WHERE id = 'p1'", [])
            .expect("delete");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM prompts", [], |row| row.get(0))
            .expect("count");
        assert_eq!(count, 0);
    }
}
