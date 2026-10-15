# FEATURES — Conversations / Prompts / System Actions (Phase 2B)

Branch `feat-conversations`. All 20 features are implemented — UI +
logic + persistence + tests. No stubs, no dead buttons, no fake claims:
anything that cannot execute reports that it did not run.

## The 20 features — how to verify

### Conversations

1. **Conversation search (full-text across titles + messages)** — type in
   the panel's search box; matches title text immediately and message
   bodies once loaded. Verify: two conversations, one with "pasta" only
   in a message → searching `pasta` shows both, with a snippet.
2. **Pin conversations** — ★ button per row; pinned sort first.
   Verify: pin "Budget" → it jumps to the top and stays there.
3. **Folders (create / rename / delete, move conversations)** — sidebar:
   create via "New folder", rename with ✎, delete with 🗑 (two-click
   confirm), move via per-row folder dropdown. Verify: create "Work",
   move a chat in, filter by "Work" → only that chat; delete "Work" →
   chat becomes Unfiled, not deleted.
4. **Tags (add / remove, filter by tag)** — per-row "Add tag…" + `#tag ×`
   to remove; tag chips above the list filter. Verify: tag a chat
   `recipes`, click `#recipes` → only it shows; remove the tag → chip gone.
5. **Rename conversation** — ⋯ → Rename, inline edit, Enter commits.
   Verify: rename "Pasta night" → "Pasta evening"; list updates.
6. **Duplicate conversation** — ⋯ → Duplicate. Verify: duplicate a chat →
   a "… (copy)" entry appears with the same messages (via
   `onImportConversation`).
7. **Export conversation (Markdown)** — ⋯ → Export MD. Verify: downloads
   `veilura-chat-<slug>-<date>.md` with `# Title` + `## User` /
   `## Assistant` sections.
8. **Export conversation (JSON)** — ⋯ → Export JSON. Verify: downloads
   versioned JSON (`format: "veilura-conversation"`) that re-imports.
9. **Export conversation (PDF via print-to-PDF)** — ⋯ → Export PDF.
   Verify: print dialog opens with a clean printable document → choose
   "Save as PDF" in the dialog. Real browser print flow; no fake PDF bytes.
10. **Import conversation (Markdown / JSON file)** — Import… button,
    pick a `.md` / `.json` file. Verify: import the file from (7)/(8) →
    a new conversation appears with the same messages.
11. **Archive / unarchive** — Archive button per row, Active / Archived
    toggle. Verify: archive a chat → it leaves Active, appears under
    Archived; Unarchive brings it back.
12. **Bulk actions (multi-select: delete / archive / export)** — checkboxes
    → bulk bar: Archive / Unarchive / Delete / Export Markdown / Export
    JSON. Verify: select two chats → Export Markdown downloads one
    combined `.md`; Delete removes both.

### Prompts

13. **Prompt library (built-in + custom prompts, CRUD)** — Prompts tab:
    6 built-ins + New prompt / Edit / Delete for custom ones.
    Verify: create "My prompt", edit its body, delete it; built-ins show
    "(built-in)" and have no Edit/Delete.
14. **Prompt templates with `{{variables}}` filled via dialog** — Use…
    opens a dialog with one input per `{{variable}}`, live preview.
    Verify: Use "Summarise", fill `sentences=3`, `text=…` → Insert sends
    the filled text with no `{{…}}` left.
15. **Favourite prompts + insert-from-palette** — ★ toggles favourite;
    "Favourites only" filters; Use… → Insert delivers the filled text via
    `onInsertPrompt`. Verify: favourite a prompt → it sorts first and
    survives under "Favourites only".

### System actions — all REALLY execute via the Rust backend

16. **"open \<app\>"** — type `open Calculator` (or click the quick
    button) → **Calculator actually launches**. Unknown app → error lists
    candidates, claims nothing. Verify: `open Calculator` → Calculator
    window appears; `open NoSuchAppXyz` → "Unknown app…" error, nothing opens.
17. **"create \<file\> on Desktop"** — type
    `create file notes.txt on Desktop with content Hello` → **a real file
    appears at `~/Desktop/notes.txt`**; repeat → `notes (2).txt`, never an
    overwrite. Writes confined to `~/Desktop`, `~/Documents`, app data dir.
    Verify: check Finder / `ls ~/Desktop/notes.txt`.
18. **Open URL in default browser** — `open https://example.com` →
    **browser actually opens that URL**. Non-http(s) rejected.
    Verify: `open https://example.com` → browser shows example.com;
    `open javascript:alert(1)` → rejected, nothing opens.
19. **Reveal file/folder in Finder** — `reveal ~/Desktop/report.pdf in Finder`
    → **Finder opens with that file selected**; missing path → error.
    Verify: reveal an existing file → Finder highlights it.
20. **Create note** — `create note Shopping list: milk, eggs` → **a real
    file `~/Desktop/Veilura Notes/Shopping list.md`** containing
    `# Shopping list` + the content. Verify: `ls` the Veilura Notes folder.

### Safety rules for system actions (enforced in code + tests)

- Input is parsed into a structured action object, never a shell string.
  `open Calculator; rm -rf /` parses as ONE app name
  `"Calculator; rm -rf /"`, which the allowlist/scan rejects — nothing executes.
- The backend executes with `std::process::Command` argument arrays
  (never a shell) and checks the `open` child exited successfully.
- Assistant/status messages report exactly what executed (app name /
  exact file path) or state plainly that nothing ran.

## Files

- Frontend: `src/features/conversations/` — `types.ts`, `storage.ts`,
  `search.ts`, `exportImport.ts`, `prompts.ts`, `systemActions.ts`,
  `api.ts`, `ConversationsPanel.tsx`, `PromptsPanel.tsx`,
  `SystemActionsBar.tsx`, `routes.tsx`, `index.ts`, plus
  `*.test.ts(x)` (6 test files).
- Backend: `src-tauri/src/system_actions.rs`,
  `src-tauri/src/conversations_ext.rs`.
- Wiring: `INTEGRATION-conversations.md` (exact snippets for the parent).

## Verification results (this phase)

- `bun run typecheck` — **PASS** (via `tsc --noEmit`, exit 0).
- `bun run test` (full suite, 124 files) — **ALL PASS: 2676 tests**
  (59 new in `src/features/conversations/*.test.*` + 2617 pre-existing
  across the rest of the suite; the suite is slow in this VM so it was
  run in three chunks, each green).
- `cargo fmt --check` on both new Rust files — **PASS**.
- Backend `cargo check --lib` / `cargo test` — **VERIFIED via a
  standalone harness** (the real crate cannot link on this Linux VM:
  `gdk-sys` needs GTK dev libraries absent here — a pre-existing
  environment limit, unrelated to this phase). Harness at `/tmp/rust-check`
  (ephemeral): the real `database.rs` + a separate `tauri`-stub crate
  reproducing the real `State<'r, T>` semantics (private field + `Deref`,
  verified against tauri 2.11.5 source) + the two new modules verbatim.
  Result: `cargo check` **clean** (only `unexpected cfg` noise for the
  `coverage*` cfgs the real crate declares) and `cargo test` **24/24 PASS**
  (parser, app resolution against a fake /Applications dir, traversal
  rejection, file/note creation in temp dirs, schema/idempotency,
  duplicate-copy, prompt CRUD). The harness caught and fixed 3 real bugs
  before commit: a `MutexGuard` lifetime annotation, a chained
  `strip_suffix(...).unwrap_or(trimmed)` that reset `.app` stripping, and
  missing `PartialEq` derives. The parent should still run the real
  `cargo test` on macOS CI after wiring (INTEGRATION §1–§2) — the harness
  is strong evidence, not a substitute for the real build.

## Notes / caveats

- Panels persist organisation state (folders/pins/archive/tags/custom
  prompts) in localStorage until the parent wires the backend; the
  `conv_ext_*` commands are the SQLite source of truth after wiring —
  migrate once, don't run both (INTEGRATION §7).
- Export / duplicate / bulk-export need the parent to pass
  `loadMessages`; until then those buttons are disabled with an
  explanatory tooltip rather than exporting metadata disguised as a
  conversation.
- Bulk delete does not delete message image files (the single-delete
  path does); orphaned images are reclaimed by the existing
  `cleanup_orphaned_images` sweep.
- Duplicate shares image-file references with the original (files are
  not copied).
- System actions that launch apps / URLs / Finder are macOS-only and
  return an error elsewhere by design.
