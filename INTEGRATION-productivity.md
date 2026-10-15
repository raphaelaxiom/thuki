# INTEGRATION — Productivity + Settings + Safety (Phase 2D)

Branch: `feat-productivity` (worktree `~/workspace/thuki-rebrand-prod`).
This phase creates **only** new files under `src/features/productivity/**`,
one new backend module `src-tauri/src/productivity.rs`, one new engine
module `src-tauri/src/engine/recovery.rs`, and small edits inside
`src-tauri/src/net/**` + `src-tauri/src/engine/process.rs`.
It does **not** touch `lib.rs`, `commands.rs`, `tauri.conf.json`,
capabilities, `package.json`, `App.tsx`, or any existing component.
The parent applies the wiring below.

---

## 1. Backend module registration

### 1a. `src-tauri/src/lib.rs` — declare the module

```rust
pub mod productivity;
```

### 1b. `src-tauri/src/lib.rs` — register the commands in `invoke_handler`

```rust
#[cfg(not(coverage))]
productivity::productivity_redact_prompt,
#[cfg(not(coverage))]
productivity::productivity_validate_backup,
#[cfg(not(coverage))]
productivity::productivity_check_shortcut_conflicts,
```

(Follow the existing `#[cfg(not(coverage))]` convention used for the
other command entries.)

### 1c. Capabilities

No change needed. The three commands are pure functions (no FS, no
network, no dialog, no shell), so no new capability permissions are
required. Everything else in this phase reuses already-registered
commands (`get_engine_status`, `list_conversations`, `reset_conversation`,
`history_stats`, `list_installed_models`, `delete_installed_model`,
`clear_all_conversations`).

---

## 2. Frontend mounting

### 2a. Mount the routes

```tsx
import { ProductivityRoutes } from './features/productivity/routes';
// … in the app's route table / switch:
{ProductivityRoutes.map((r) => (
  <Route key={r.path} path={r.path} element={r.element} />
))}
// Or render the hub directly: <ProductivityHome />
```

`ProductivityRoutes` is `Array<{ path, label, element }>`; the hub
`<ProductivityHome />` renders the same panels behind a nav.

### 2b. Quick-action pipeline (one listener in `App.tsx`)

`QuickActions` dispatches a cancelable `veilura:quick-action`
`CustomEvent` with `detail: { kind, prompt }`, and falls back to
`invoke('submit_quick_action', { prompt, kind })`. Wire **one** of these:

```ts
// Option A — window event (recommended, no new command needed):
window.addEventListener('veilura:quick-action', (e) => {
  const { prompt } = (e as CustomEvent).detail;
  e.preventDefault(); // marks the event handled so the panel reports "Sent"
  submitToChat(prompt); // the existing send path
});
```

```rust
// Option B — Tauri command (if the parent prefers invoke):
// add a `submit_quick_action` command that feeds `prompt` into the
// existing `ask_model` path, then register it in invoke_handler.
```

Until one of these lands, the panel copies the prompt and tells the
user to paste it into chat — no dead button, no silent drop.

### 2c. Menubar / tray

* `veilura:new-chat` — the parent should reset the conversation (the
  panel already tries `invoke('reset_conversation')` first) and focus
  the overlay.
* `veilura:quit-requested` — wire to the existing quit flow
  (`request_quit` in `lib.rs`, which warns about in-flight downloads).
  The panel only dispatches the event; it never quits by itself.
* The native macOS tray menu (built in `lib.rs`) should gain the same
  four entries the `MenubarExtras` panel shows — Recent conversations
  (`list_conversations`), Quick new chat, Engine status
  (`get_engine_status`), Quit — so the tray and the panel agree.

### 2d. Global shortcuts

The editor persists bindings to
`localStorage['veilura:productivity:shortcuts']` and normalises them
with the same rules as the Rust `normalize_shortcut`. The parent's
hotkey registration (activator / global-shortcut setup) should read
that stored value on launch for at least `summon` + `new_chat`, and
keep `detectShortcutConflicts` as the gate before registering.

### 2e. Appearance

`applyAppearance(settings)` sets `data-veilura-theme`,
`data-veilura-theme-setting`, `data-veilura-density`, and the
`--veilura-font-size` / `--veilura-density-spacing` CSS variables on
`document.documentElement`. The app stylesheet should map those to
real colours/spacing (see `src/features/productivity/settings.ts`).
`ProductivityHome` applies the persisted appearance on mount.

### 2f. Privacy toggles

The toggles are the source of truth for the feature's own behaviour
(web search on/off gates the panel's search affordances). If the
parent wants them to gate the *existing* capture/search pipelines
(clipboard, screenshot, web search), read
`localStorage['veilura:productivity:settings'].privacy` in those
pipelines. Telemetry has no toggle anywhere: it is always off.

### 2g. Backup / restore — conversation scope

The backup file covers the productivity data (reminders, focus
sessions, settings, shortcuts, audit log) plus conversation *stats*.
Conversations themselves stay in SQLite and are never touched by
restore. If the parent later wants full conversation backup, add a
backend command that reads messages **without** mutating the
in-memory history (the existing `load_conversation` replaces it, so
it must not be used for export), then extend the backup `data` shape.

---

## 3. Engine crash recovery — runner wiring (REQUIRED for feature (c))

`src-tauri/src/engine/recovery.rs` is the pure policy:
`CrashRecoveryTracker` (max 3 consecutive restarts, 500 ms → 1 s → 2 s
backoff capped at 8 s, user-visible messages). The runner does not yet
consult it. Apply this wiring in `src-tauri/src/engine/runner.rs`:

```rust
// Core gains: `recovery: CrashRecoveryTracker`, `last_target: Option<Target>`,
// `retry_tx: mpsc::Sender<Command>` (a clone of the actor channel).
// Command gains: `CrashRetry { target: Target }`.

// In run_actor, Wake::Health(Ok(())) arm — a healthy load resets the budget:
core.recovery.record_healthy();

// In run_actor, Wake::ChildExit arm — replace the plain dispatch:
let was_loaded = matches!(core.state, EngineState::Loaded { .. });
let target = match &core.state {
    EngineState::Loaded { target, .. } => Some(target.clone()),
    _ => None,
};
let reason = crash_reason(/* …existing… */);
core.child = None;
core.health = None;
if was_loaded {
    if let Some(target) = target {
        let (decision, message) = core.recovery.record_crash(&reason);
        match decision {
            RecoveryDecision::Restart { attempt: _, delay } => {
                // User-visible "restarting (attempt N of 3)" status:
                core.status_tx.send_replace(EngineStatus {
                    state: "restarting".to_string(),
                    model_path: target.model_path.display().to_string(),
                    port: None,
                    error: Some(message),
                });
                let retry_tx = core.retry_tx.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(delay).await;
                    let _ = retry_tx.send(Command::CrashRetry { target }).await;
                });
            }
            RecoveryDecision::GiveUp { .. } => {
                core.dispatch(Event::ChildCrashed(message)).await;
            }
        }
        continue; // skip the plain dispatch below
    }
}
core.dispatch(Event::ChildCrashed(reason)).await;

// New command arm:
Wake::Cmd(Some(Command::CrashRetry { target })) => {
    core.dispatch(Event::Ensure(target)).await;
}
```

Notes:

* Only crashes while `Loaded` restart. A crash during `Starting` is a
  start failure and still goes straight to `Failed` (unchanged).
* Manual `Unload` / `Shutdown` must cancel a pending retry: on those
  arms, drop/ignore a `CrashRetry` whose target no longer matches, or
  track a generation counter. Simplest correct form: `CrashRetry`
  dispatches `Ensure(target)` only when the state is `Failed`; in any
  other state the retry is a no-op.
* **Test impact (expected):** the two existing runner tests
  `crash_emits_failed_status` and `crash_surfaces_captured_stderr_reason`
  crash a *loaded* engine and assert an immediate `Failed` status.
  After this wiring, the first crash yields a `restarting` status and a
  respawn, so those tests must be updated to assert: first crash →
  `restarting` + respawn; three consecutive crashes → `Failed` with
  the "stopped after 3 restart attempts" message. The
  `engine/recovery.rs` unit tests already pin the policy itself.

---

## 4. Backend audit fixes — what changed (no wiring needed)

* `src-tauri/src/net/ssrf.rs` — new `SsrfError::BlockedCredentials`;
  `validate_request_url` now rejects any `http(s)` URL carrying
  `user[:pass]@host` (pre-flight and every redirect hop).
* `src-tauri/src/net/transport.rs` — `redirect_decision` off-by-one fix:
  `hops > max` → `hops >= max`. With `MAX_HTTP_REDIRECTS = 5`, a chain
  is now allowed at most 5 redirects, never 6. New tests prove:
  redirect-loop exhaustion, at-cap rejection, private-IP / credential
  redirect rejection, and oversize accumulation against
  `MAX_HTTP_RESPONSE_BYTES`.
* `src-tauri/src/engine/process.rs` — new `ENGINE_BIND_HOST`
  (`"127.0.0.1"`) constant used by `llama_server_args` and
  `free_port`; new `validate_engine_bind_host` /
  `validate_engine_bind_addr` guards; `spawn` fails closed on a
  non-loopback bind host instead of starting a LAN-reachable
  unauthenticated server. Tests pin: loopback-only acceptance,
  `localhost`/`0.0.0.0`/LAN rejection, and `--host 127.0.0.1` in argv.

## 5. Changed defaults

None. No default behaviour changes except the redirect-cap correction
(5 hops enforced, previously 6) and the SSRF credential rejection —
both are security tightenings, not user-visible features.
