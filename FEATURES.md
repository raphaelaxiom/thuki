# FEATURES — Veilura Phase 2 (53 features)

Merged from the three Phase 2 feature branches. Each feature keeps its
one-line "how to verify". Per-phase source docs remain at
`FEATURES-conversations.md`, `src/features/modelsio/FEATURES-modelsio.md`,
and `FEATURES-productivity.md`; wiring lives in `MERGE.md`.

Total: 20 (conversations / prompts / system actions) + 18 (models / input /
output) + 15 (productivity / settings / safety) = **53 features**.

---

## Conversations / Prompts / System Actions (Phase 2B, 20 features)

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

---

## Models / Input / Output (Phase 2C, 18 features)

All 18 features live in `src/features/modelsio/` (+ `src-tauri/src/models_io.rs`).
Each line states how to verify it.

## Models

1. **Favourite models** — star/unstar per model; "Favourites only" filter; persisted.
   Verify: star Qwen → toggle "Favourites only" → only Qwen remains; reload → star persists.
2. **Model compare** — side-by-side table: size, params, context, quant, vision, downloaded, notes (up to 4 models).
   Verify: tick Compare on two models → table shows both columns with differing values.
3. **Per-model settings** — temperature, top-p, context length, system-prompt override; persisted per model; resolved + clamped values are passed to inference via `getInferenceParamsForModel` (see INTEGRATION §4).
   Verify: set temperature 9 → saved as 2; reload → value kept; ask with that model → backend receives clamped values.
4. **Download queue** — enqueue multiple downloads; per-item progress; cancel one without affecting others.
   Verify: enqueue 2 models → both listed; cancel one → other stays queued.
5. **Pause/resume download** — pause keeps the partial; resume uses HTTP Range when the server supports it, else restarts from zero with the message "Server does not support resume — restarting from the beginning."
   Verify: pause → resume with `supportsRange: false` → progress resets to 0% + restart note; with `true` → resumes from prior bytes.
6. **Disk usage + delete** — per-model + total from the real `<app_data>/models` store; delete asks confirmation showing freed space and reports freed bytes after.
   Verify: Disk usage shows store total; Delete → dialog names freed size → confirm → "freed X of disk space".

## Input

7. **Clipboard history** — last 20 clipboard texts (deduped, blanks ignored); click to insert into the ask bar; macOS `pbpaste` via backend, web clipboard fallback, permission-aware error.
   Verify: Read clipboard → text appears in history + draft; click an entry → inserted; deny permission → clear error, no crash.
8. **Drag-and-drop files** — drop onto the ask bar area; file chips show name/kind; text-file content is read and included.
   Verify: drop a .txt file → chip shows "N chars of text included"; drop >10 MiB → size error, not attached.
9. **Image attach** — attach + thumbnail preview; sent as vision context only when the active model supports vision; otherwise the picker is disabled with an honest explanation.
   Verify: vision model → image input enabled + thumbnail; text-only model → disabled + "does not support vision" message.
10. **Screenshot capture with crop** — capture via `screencapture -i`; numeric crop rect clamped to image bounds; attached image is the cropped image.
    Verify: capture → set crop → attach → attached image dimensions equal the crop rect.
11. **Screenshot annotate** — draw arrows / place text on the crop before attaching; annotations baked into the attached image; invalid (zero-length) annotations ignored.
    Verify: draw an arrow + text → attach → attached image contains the arrow/text.
12. **Voice dictation** — backend macOS speech recogniser attempted first; Web Speech API fallback is the real working path; unavailable everywhere → honest "unavailable" status, never a fake transcript.
    Verify: dictate in a browser build → transcript appears via Web Speech; with neither API → "unavailable" message.

## Output

13. **Read-aloud / TTS** — speak the reply via macOS `say` (backend) with stop/pause/resume + voice/speed settings; browser `speechSynthesis` fallback; markdown stripped before speaking.
    Verify: Speak → audio starts; Stop → audio stops; set speed 2 → faster speech; code fences are not read aloud.
14. **Copy code blocks** — copy button on every fenced code block; copies the block's code exactly.
    Verify: reply with two code blocks → each has Copy → click → clipboard holds that block's code; button shows "Copied".
15. **Regenerate variants** — regenerate keeps all variants (max 10); switch between them via the selector.
    Verify: regenerate twice → "Showing variant 2 of 2"; switch to variant 1 → original text returns.
16. **Token/cost stats per reply** — prompt/completion tokens, ms/token, tok/s, running session totals — from the engine's reported usage only; "no usage numbers" when the engine reports none.
    Verify: reply with usage {10 prompt, 20 completion, 1000 ms} → "10 prompt · 20 completion · 20.0 tok/s"; reply without usage → no invented figures.
17. **Citations** — web-search answers show numbered sources; each opens the real URL in a new tab; non-http(s) URLs are never linked.
    Verify: reply with `[Source](https://example.com/x)` → "[1] Source" link → click opens example.com; `javascript:` URL → shown unlinked.
18. **Stop generation** — stop button sets the backend cancel flag (parent polls it in the ask loop) and aborts the local request; UI confirms "Generation stopped."
    Verify: start generation → Stop generation → request aborts; status shows "Generation stopped."

---

## Productivity / Settings / Safety (Phase 2D, 15 features)

15 counted features. Each line states how to verify it. All persistence
is local (localStorage + existing backend commands); nothing leaves the
device. Rust audit fixes are listed separately at the end — they are
required engineering, not counted features.

## Productivity

1. **Reminders / follow-ups** — create from any message (paste it, "Use
   message as title"), due time, local notification + in-app list, mark
   done. *Verify: add a reminder → it appears; set it due in the past →
   "due now" shows; Mark done → struck through and persisted.*
2. **Focus timer (Pomodoro)** — start/pause/reset, configurable
   durations, session history. *Verify: start → clock counts down;
   finish a block → session recorded in history; change durations →
   they persist and the clock uses them.*
3. **Quick actions** — summarise / rewrite / translate / explain on
   selected text via real prompts through the chat pipeline.
   *Verify: paste text, pick an action → prompt preview shows the real
   prompt; Send → "Sent" (once the parent wires §2b) or prompt copied
   with an honest fallback message.*
4. **Global shortcuts customisation** — remap the summon hotkey + a
   second shortcut, persisted, conflicts detected. *Verify: change
   Summon → reload → value kept; set it equal to another binding →
   conflict flagged.*
5. **Menubar extras** — recent conversations, quick new chat, engine
   status, quit. *Verify: panel shows live engine state + up to 5 recent
   conversations; Quick new chat dispatches; Quit requests quit.*
6. **Daily briefing** — morning summary of reminders + recent focus
   sessions, generated locally from stored data only. *Verify: with no
   data it says "No reminders today" (invents nothing); with stored
   reminders/sessions it lists them.*

## Settings

7. **Themes** — light / dark / system + 2 accent themes (Forest,
   Sunset), persisted. *Verify: pick Forest → `data-veilura-theme`
   becomes `forest` and survives reload.*
8. **Font-size setting** — 12–22px slider + number input, applies
   across the app via `--veilura-font-size`, persisted. *Verify: set
   18px → CSS variable is `18px` and survives reload.*
9. **Privacy toggles** — clipboard capture, screen capture, web search
   on/off; telemetry is and stays OFF with the local-only guarantee
   shown. *Verify: toggle each → persists; telemetry has no toggle and
   stays `false` even with crafted storage.*
10. **Data management** — storage breakdown (local + backend
    conversations/models), delete all conversations, delete all models,
    export all data. *Verify: breakdown shows real byte counts; export
    downloads a JSON file; deletes require a confirmation tick.*
11. **Backup + restore** — export full backup file; import validates
    schema, shows a diff, and never overwrites without confirmation.
    *Verify: export → valid JSON; import a tampered file → rejected
    with reasons; restore without ticking confirm → refused.*
12. **Keyboard shortcut editor** — list all shortcuts, edit, reset to
    defaults, persisted. *Verify: edit a binding → persists; set a
    duplicate → conflict flagged; Reset → defaults restored.*
13. **Density** — compact / comfortable spacing, actually changes
    spacing. *Verify: toggle → `data-veilura-density` and
    `--veilura-density-spacing` change (`6px` vs `12px`).*

## Safety

14. **Content filter** — toggle: block/redact secrets & API keys in
    outbound prompts (real regex redaction) with a preview of what was
    redacted. *Verify: paste a test `ghp_…` token → preview shows
    `[REDACTED]` + "github_token ×1"; Quick Actions applies the same
    redaction before sending.*
15. **Local-only audit log** — every outbound network request + every
    system action logged locally with timestamp, viewable + exportable,
    never leaves the device. *Verify: do anything (change a setting,
    export) → entry appears; Export downloads the log; no code path
    transmits it.*

## Backend audit fixes (engineering, not counted)

* **(a) Web-search SSRF policy** — redirect-cap off-by-one fixed
  (`hops >= max`, max 5), embedded-credential URLs rejected, tests
  proving blocked private-IP / redirect-loop / oversize cases.
* **(b) Engine loopback-only bind** — `ENGINE_BIND_HOST = 127.0.0.1`,
  spawn refuses non-loopback binds; tests prove `0.0.0.0`, LAN, and
  `localhost` are refused.
* **(c) Engine crash recovery** — policy in
  `src-tauri/src/engine/recovery.rs`: up to 3 restarts with 500 ms →
  1 s → 2 s backoff (cap 8 s), user-visible "restarting (attempt N
  of 3)" / "stopped after 3 attempts" status, then stop. Runner
  wiring is specified in `INTEGRATION-productivity.md` §3 (parent
  applies; two existing runner crash tests will need their
  expectations updated as described there).

