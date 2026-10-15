# MERGE — Phase 2 features + wiring (Veilura)

Final integration of the three Phase 2 feature branches plus the UI
overhaul onto `rebrand-veilura`. Parent dispatch: CI runs on
`macos-15-intel`.

## Merge order (all `--no-ff`, onto `rebrand-veilura` @ `884c19d`)

1. `merge: ui-overhaul` — `ui-overhaul` @ `9522bf1` (AUDIT.md + UI overhaul).
2. `merge: feat-conversations` — `feat-conversations` @ `edc1ece` (20 features).
3. `merge: feat-models-io` — `feat-models-io` @ `7d4d742` (18 features).
4. `merge: feat-productivity` — `feat-productivity` @ `6a0bf9f` (15 features).
5. `merge: Phase 2 features + wiring (53 features)` — this wiring commit.

## Conflicts resolved

**None.** All four merges applied cleanly with no conflicting hunks: the
feature branches touched disjoint files (new `src/features/**` trees, new
`src-tauri/src/*.rs` modules), and the UI branch touched only pre-existing
UI files.

## Wiring applied

### Rust — `src-tauri/src/lib.rs`

- Module declarations: `conversations_ext`, `system_actions`, `models_io`,
  `productivity`.
- Invoke handler: 20 `conv_ext_*` + 2 `system_*` (with
  `#[cfg(not(coverage))]`, per the conversations doc) + 20 `models_io_*`
  (plain, per the models-io doc — the task brief said 21, but the module
  defines exactly 20 `models_io_*` commands) + 3 `productivity_*` (with
  `#[cfg(not(coverage))]`, per the productivity doc).
- New Tauri command `request_app_quit` — the frontend quit path for the
  `veilura:quit-requested` event; routes through the same download-aware
  `request_quit` as the tray / app-menu Quit items.
- Tray menu: added **New Chat** (shows the overlay + emits Tauri event
  `veilura:new-chat`) and **Engine Status…** (shows the overlay, where the
  live engine state renders in the chat header). Quit unchanged.

### Frontend mounting — `src/App.tsx`

- Header **Features (✦)** button (`WindowControls` ← `ConversationView` ←
  `App`) opens the features drawer in chat mode with three tabs:
  Conversations / Models & I/O / Productivity, rendering
  `ConversationsFeature`, `ModelsIoPanel`, and `ProductivityHome`.
- Conversations tab is wired to real state: seeded from
  `list_conversations` (SQLite), `loadMessages` via `load_conversation`,
  open via the existing history loader, import/duplicate persisted via
  `conv_ext_import`, prompt insert into the ask bar, system-action results
  shown as a notice line.
- Models & I/O tab uses the real picker inventory (mapped to the panel's
  `ModelMeta` shape: display names, real sizes, real vision flags) and the
  last assistant reply; Stop is wired to the real generation cancel.
- Appearance from Productivity → Appearance applies on launch
  (`applyAppearance(loadSettings())`).
- `veilura:quick-action` listener: preventDefault + send through the
  existing chat pipeline (`ask(prompt)`); the panel already redacted the
  prompt. `veilura:new-chat` listeners (window event from MenubarExtras +
  Tauri event from the tray) → `handleNewConversation`.
  `veilura:quit-requested` → `invoke('request_app_quit')`.
- Privacy: the Productivity → Privacy screen-capture toggle gates the
  frontend screenshot path (`handleScreenshot` refuses with an explanatory
  message when off).
- **Default corrected (real-cause fix, see Verification):** the
  productivity branch shipped `privacy.screenCapture: false` ("off by
  default"), which would have silently killed the pre-existing screenshot
  button for every user once the gate was wired. The default is now
  `true` (an explicit screenshot click is consent; the toggle still lets
  users turn capture off), the Privacy panel hint was updated to match,
  and the settings test pins the new default.

### Inference — per-model settings (Phase 2C §4)

- `useModel.ts`: before `ask_model`, resolves
  `getInferenceParamsForModel(activeModelId)` and sends only fields the user
  actually customized (anything still at the default is sent as `null`).
- `ask_model` (Rust) accepts `temperature` / `top_p` / `context_length` /
  `system_prompt_override` (all optional), clamps them with the models_io
  rules, and applies them: Ollama sampling options + `num_ctx`, built-in
  target `num_ctx`, search-pipeline `num_ctx`, system prompt (incl. trace),
  and `/v1` request body (built-in + remote). Unset fields keep the exact
  previous behaviour (Ollama 1.0 / 0.95, global `num_ctx`, global prompt, no
  explicit sampling keys on built-in requests).
- Internal sub-streams (cache-reuse synthesis, citation repair) keep engine
  defaults — they are not user replies.

### Stop generation (Phase 2C §5)

- `stream_ollama_chat` and `stream_openai_chat` poll
  `models_io::take_generation_cancel_requested()` every 50 ms alongside the
  existing cancel token; on fire they drop the stream and emit `Cancelled`.
- `ask_model` drains a stale flag at turn start so a Stop pressed with
  nothing in flight cannot cancel the next turn.

### Token stats (Phase 2C §6)

- New `models_io::record_engine_usage(prompt, completion, elapsed_ms)`
  accumulates session totals and records via `compute_token_stats`.
- Ollama path parses the real `prompt_eval_count` / `eval_count` from the
  final `done: true` message and records them.
- `/v1` path sends `stream_options: { include_usage: true }` to the
  built-in engine only, parses `usage` whenever a server sends it, and
  records it on `[DONE]` / EOF. When the engine reports no usage, nothing
  is recorded — the UI shows "no usage numbers", never invented figures.
- Caveat: a turn that also runs citation repair records the repair
  sub-stream's usage last (it is still real engine usage from that turn).

### Crash recovery (Phase 2D §3)

- `engine/runner.rs`: `Core` gains `recovery: CrashRecoveryTracker` +
  `retry_tx`; new `Command::CrashRetry`; `Health(Ok)` resets the budget;
  `ChildExit` while `Loaded` consults the policy — Restart → state machine
  `Failed` + user-visible `restarting` status + delayed retry (500 ms →
  1 s → 2 s backoff); GiveUp → `Failed` with the "stopped after 3 restart
  attempts" message. `CrashRetry` only fires while state is `Failed`, so a
  manual Unload / Shutdown or a newer Ensure cancels the pending restart.
  A crash during `Starting` still goes straight to `Failed` (unchanged).
- The two existing runner crash tests were updated to the new expectations
  (first crash → `restarting` + respawn; 3 restarts → `Failed` + give-up
  message; stderr reason surfaces in the restarting status).
- New engine status value `"restarting"` is emitted on the status watch;
  existing frontend state checks treat it as neither loaded nor failed.

### Rust fmt

- All wiring hunks are `rustfmt --check` clean. The crate has
  pre-existing fmt diffs under the installed rustfmt 1.99 (e.g.
  `commands.rs` had 2 before this change); those were left untouched.

## NOT wired + why

- **Updater key (S-01) — PRE-RELEASE BLOCKER.** The updater pubkey is
  still upstream Thuki's. No key was invented. A fresh keypair + key
  rotation must land before any release; until then shipped updates would
  not verify as Veilura's.
- **Light-mode toggle unwired.** The Appearance panel sets
  `data-veilura-theme` / CSS variables, but the app stylesheet does not yet
  map those attributes to real colours/spacing, so picking Light/Forest/
  Sunset changes attributes without changing the visible theme. Needs a
  stylesheet mapping pass.
- **Dictation = Web Speech fallback.** `models_io_dictate` deliberately
  returns an error (SFSpeechRecognizer needs entitlement + Info.plist
  wiring); the frontend falls back to the Web Speech API, which is the real
  working path.
- **Global-shortcut remapping not wired natively.** The shortcut editor
  persists + conflict-checks, but the summon hotkey is a hardcoded
  double-tap-Option CGEventTap in `activator.rs` — there is no Rust-side
  global-shortcut registration to point the stored bindings at. Wiring it
  needs an activator rework / global-shortcut plugin.
- **Privacy toggles vs backend pipelines.** The screen-capture toggle gates
  the frontend capture path. Clipboard-read and web-search gating in the
  backend pipelines is not wired (the backend does not read the frontend's
  localStorage; that needs a config field + pipeline checks). Telemetry
  stays always-off with no toggle.
- **Tray "Recent conversations" not in the native tray menu.** The native
  tray menu is rebuilt only on refresh, so a static snapshot would go
  stale; live recents live in the in-app MenubarExtras panel
  (`list_conversations` on every open). The native tray has New Chat,
  Engine Status, Settings, Quit (+ update item when available).
- **Conversations panels keep localStorage as their organisation store**
  (folders / pins / archive / tags / custom prompts) until a one-time
  migration to SQLite is run (INTEGRATION-conversations §7: migrate once,
  don't run both). The `conv_ext_*` commands are registered and used for
  search-adjacent persistence (import), but the panel's own state is not
  yet migrated.
- **ModelsIoPanel regenerate uses its built-in echo fallback** (no
  `onRegenerate` passed): there is no App-level "regenerate and return the
  new reply string" API to wire it to. Regenerate-via-retry exists in the
  chat flow but does not return the string the panel needs.
- **ModelsIoPanel `paramsB` / `quant` / `contextLength` show unknown**
  (0 / null / ''): the frontend picker inventory does not expose those
  fields, so the mapping passes real ids / names / sizes / vision flags and
  unknown for the rest.
- **`.github/workflows/` untouched** (byte-identical), bundle ID /
  version / product name unchanged.

## Verification (this merge)

- `bun run typecheck` — PASS.
- `bun run test` (full vitest suite, final run) — **141 test files passed,
  2765 tests passed, 0 failed** (EXIT 0). An earlier full run exposed 3
  screenshot-test failures from the privacy gate: the productivity branch
  shipped `privacy.screenCapture: false` ("off by default"), which would
  have silently killed the pre-existing screenshot button for every user
  once the gate was wired. Real-cause fix: default is now `true` (an
  explicit screenshot click is consent; the toggle still lets users turn
  capture off), the Privacy panel hint was updated to match, the settings
  test pins the new default, and a new App test covers the gate blocking
  capture when the user turns it off.
- Rust: `cargo check --lib --tests` on this Linux VM typechecks **all**
  Phase 2 wiring with zero errors in the touched files — including the
  two rewritten runner crash tests. The crate as a whole does not link
  on Linux: the remaining 49 errors are all pre-existing macOS-only code
  (Darwin `libc` types, macOS-gated `permissions`/`ocr` commands,
  `tauri_nspanel`, `get_webview_panel`) in files this merge never touched.
  Two real compile errors in the wiring were caught and fixed by this
  check: (1) `history.rs` title generation's `OllamaChatParams` literal
  was missing the new `temperature`/`top_p` fields (now 1.0 / 0.95);
  (2) the feat-models-io branch derived `Copy` on `PerModelSettings`
  despite its `String` field (derive removed; `.copied()` → `.cloned()`).
  `cargo fmt --check` is clean on all wiring hunks (remaining diffs are
  pre-existing). `cargo test` still needs macOS CI (the Linux build
  cannot link the macOS-only code).
- `grep -ri thuki` sanity: no NEW Thuki references beyond the justified
  ones in `REBRAND.md` (S-01 note) and pre-existing migration comments.
- No merge conflicts; no upstream / fork-main / `~/workspace/thuki/`
  touched.

## Docs

- `FEATURES.md` — merged 53-feature list (20 + 18 + 15), each with its
  one-line verification.
- `AUDIT.md`, `REBRAND.md` at root, unchanged.
- Per-phase docs kept: `FEATURES-conversations.md`,
  `INTEGRATION-conversations.md`, `FEATURES-productivity.md`,
  `INTEGRATION-productivity.md`,
  `src/features/modelsio/FEATURES-modelsio.md`,
  `src/features/modelsio/INTEGRATION-modelsio.md`.
