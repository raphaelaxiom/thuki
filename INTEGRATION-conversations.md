# INTEGRATION — Conversations / Prompts / System Actions (Phase 2B)

Branch: `feat-conversations`. Parent wires everything below. **Do not let
any other phase edit the files listed here** — these are the single source
of truth for this feature set.

## What this phase ships

| Area | Files |
|---|---|
| Frontend (new, self-contained) | `src/features/conversations/**` |
| Backend — conversations/prompts | `src-tauri/src/conversations_ext.rs` |
| Backend — system actions | `src-tauri/src/system_actions.rs` |

Nothing else was touched: no edits to `App.tsx`, `lib.rs`, `commands.rs`,
`tauri.conf.json`, capabilities, `package.json`, or any existing component.

## 1. Register the Rust modules — `src-tauri/src/lib.rs`

```rust
// Near the other `pub mod` declarations (e.g. after `pub mod updater;`):
pub mod conversations_ext;
pub mod system_actions;
```

## 2. Invoke handler — `src-tauri/src/lib.rs`, inside `generate_handler![…]`

Add all of these (same `#[cfg(not(coverage))]` pattern as the neighbouring
entries):

```rust
#[cfg(not(coverage))]
conversations_ext::conv_ext_search,
#[cfg(not(coverage))]
conversations_ext::conv_ext_set_pinned,
#[cfg(not(coverage))]
conversations_ext::conv_ext_set_archived,
#[cfg(not(coverage))]
conversations_ext::conv_ext_rename,
#[cfg(not(coverage))]
conversations_ext::conv_ext_duplicate,
#[cfg(not(coverage))]
conversations_ext::conv_ext_bulk_archive,
#[cfg(not(coverage))]
conversations_ext::conv_ext_bulk_delete,
#[cfg(not(coverage))]
conversations_ext::conv_ext_export,
#[cfg(not(coverage))]
conversations_ext::conv_ext_import,
#[cfg(not(coverage))]
conversations_ext::conv_ext_list_folders,
#[cfg(not(coverage))]
conversations_ext::conv_ext_create_folder,
#[cfg(not(coverage))]
conversations_ext::conv_ext_rename_folder,
#[cfg(not(coverage))]
conversations_ext::conv_ext_delete_folder,
#[cfg(not(coverage))]
conversations_ext::conv_ext_move,
#[cfg(not(coverage))]
conversations_ext::conv_ext_add_tag,
#[cfg(not(coverage))]
conversations_ext::conv_ext_remove_tag,
#[cfg(not(coverage))]
conversations_ext::conv_ext_list_prompts,
#[cfg(not(coverage))]
conversations_ext::conv_ext_upsert_prompt,
#[cfg(not(coverage))]
conversations_ext::conv_ext_delete_prompt,
#[cfg(not(coverage))]
conversations_ext::conv_ext_set_prompt_favourite,
#[cfg(not(coverage))]
system_actions::system_execute_action,
#[cfg(not(coverage))]
system_actions::system_parse_action,
```

Command names are the function names verbatim (`conv_ext_search`,
`system_execute_action`, …). Argument names are the Rust parameter names
(see §4 for the exact shapes). The typed wrappers in
`src/features/conversations/api.ts` already use these names.

## 3. Startup — no migration call needed

Each `conversations_ext::*` command runs `ensure_conversations_ext_schema`
first, so the `pinned` / `archived` / `folder_id` columns and the
`conversation_folders` / `conversation_tags` / `prompts` tables are created
lazily on first use. **No startup init call is required.** (If a future
phase prefers eager migration, call
`conversations_ext::ensure_conversations_ext_schema(&conn)` once at
startup — it is idempotent.)

## 4. IPC shapes (serde)

### `system_execute_action` — request

```jsonc
// ONE of these structured objects. Never a shell string.
{ "kind": "open_app", "app": "Calculator" }
{ "kind": "create_file", "filename": "notes.txt", "content": "hello", "location": "desktop" }
// location: "desktop" | "documents" | "app_data"
{ "kind": "open_url", "url": "https://example.com" }
{ "kind": "reveal_in_finder", "path": "~/Desktop/report.pdf" }
{ "kind": "create_note", "title": "Shopping list", "content": "milk, eggs" }
```

Response — `{ "ok": true, "message": "Opened Calculator.", "detail": "Calculator" }`.
`ok: true` means the effect really happened; failures are `Err(String)`
(`system_execute_action` returns `Result<SystemActionResult, String>`).

### `system_parse_action` — request / response

Request: `{ "text": "open Calculator" }` → response: the structured action
above, or `null` for ordinary chat text.

### `conv_ext_*` — key shapes

- `conv_ext_search({ query, includeArchived, folderId, tag })` →
  `ExtConversationSummary[]`:
  `{ id, title, model, updated_at, message_count, pinned, archived,
  folder_id, tags }`. Pinned first, then most-recently-updated.
- `conv_ext_duplicate({ conversationId })` → new conversation id (string).
- `conv_ext_bulk_archive({ conversationIds, archived })` → rows changed.
- `conv_ext_bulk_delete({ conversationIds })` → rows deleted. (Max 1000 ids
  per call for both bulk commands.)
- `conv_ext_export({ conversationId })` →
  `{ id, title, model, messages: [{ role, content }] }`.
- `conv_ext_import({ payload: { title, model, messages: [{ role, content }] } })`
  → new conversation id. Roles must be `user` / `assistant`; max 5000
  messages, 2 MB total content.
- Folders: `conv_ext_list_folders()` → `{ id, name, created_at }[]`;
  `conv_ext_create_folder({ name })`; `conv_ext_rename_folder({ folderId, name })`;
  `conv_ext_delete_folder({ folderId })` (conversations become unfiled);
  `conv_ext_move({ conversationId, folderId })` (`folderId: null` = unfile).
- Tags: `conv_ext_add_tag({ conversationId, tag })` (normalised:
  lowercase, whitespace → `-`); `conv_ext_remove_tag({ conversationId, tag })`.
- Prompts: `conv_ext_list_prompts()` → `PromptRow[]`
  `{ id, title, body, favourite, builtin, created_at, updated_at }`;
  `conv_ext_upsert_prompt({ prompt })` (caller `builtin` ignored, always
  stored `false`; built-in rows can never be modified/deleted through it);
  `conv_ext_delete_prompt({ promptId })`;
  `conv_ext_set_prompt_favourite({ promptId, favourite })`.

## 5. Frontend mounting — pick ONE

No router exists in the app, so mounting is explicit.

### Option A — tabbed panel (recommended for the overlay)

```tsx
import { ConversationsFeature } from './features/conversations';

<ConversationsFeature
  conversations={summaries}          // ConversationMeta[] from list_conversations
  loadMessages={loadMessagesFor}     // (id) => Promise<ChatMessageLike[]>
  onOpenConversation={(id) => void loadConversation(id)}
  onConversationsChanged={(next) => setSummaries(next)}
  onImportConversation={(meta, messages) => void persistImported(meta, messages)}
  onInsertPrompt={(filledText) => void insertIntoAskBar(filledText)}
  onResult={(result) => void logSystemAction(result)}
/>
```

`ConversationMeta` is `{ id, title, model, updated_at, message_count,
pinned?, archived?, folder_id?, tags? }` — the existing
`ConversationSummary` plus the optional extension fields.

### Option B — route table

```tsx
import { ConversationsRoutes } from './features/conversations/routes';
// Render the element whose `path` matches:
//   /conversations | /prompts | /system-actions
// Route elements use empty/default props; pass real props via
// ConversationsFeature (Option A) when the parent owns conversation state.
```

### Wiring notes for the parent

- `loadMessages`: map the existing `load_conversation` command's
  `PersistedMessage[]` to `{ role, content }`. Search / export /
  duplicate / bulk-export are disabled with an explanatory tooltip until
  this is passed — that is intentional, not a bug.
- `onImportConversation`: persist imported/duplicated conversations
  (e.g. via `conv_ext_import`) — the panel only holds them in memory.
- `onConversationsChanged`: the panel owns its list after mount; deletions
  / renames / duplicates arrive here. For deletions, also call the
  existing `delete_conversation` (or `conv_ext_bulk_delete`) so SQLite
  stays in sync; for renames, `conv_ext_rename`.
- `onInsertPrompt`: insert `filledText` into the ask-bar input (or the
  clipboard — parent's choice).
- Assistant system-action path: when the assistant decides to run a
  system action, it must send the **structured** action from
  `parseSystemActionText` / `system_parse_action` to
  `system_execute_action`, and report the backend's `message` verbatim.
  It must never claim an action "will happen" or "is done" without a
  successful backend result.

## 6. Capabilities / entitlements — nothing new needed

All new commands are plain Tauri commands (`core:default` covers invoke).
System actions use `std::process::Command` with `open` (macOS system
binary) — no new Tauri plugin, no new capability entries, no new
entitlements. `tauri.conf.json` and `capabilities/default.json` need no
changes. (System actions other than file writes return an error on
non-macOS by design.)

## 7. Persistence migration (optional, one-time)

Until the backend is wired, the panels persist folders / pins / archive /
tags / custom prompts in localStorage under `veilura.conversations.ext.v1`
(see `storage.ts` — shape mirrors the SQLite tables). Once wired, the
parent may migrate that blob into SQLite with the `conv_ext_*` commands
and then stop reading localStorage. Do **not** keep both stores live —
pick one source of truth per install.

## 8. Verification (run by this phase)

- Frontend: `bun run typecheck` ✅, `bun run test` — see FEATURES doc
  (59 new tests in `src/features/conversations/*.test.*`, full suite run).
- Backend: `cargo fmt --check` ✅ on both new files; `cargo check` +
  `cargo test` ✅ via the standalone harness described in
  FEATURES-conversations.md (24/24 Rust tests pass). The parent should
  still run the real `cargo test` on macOS CI after applying §1–§2.
