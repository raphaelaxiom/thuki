# INTEGRATION — Models / Input / Output (Phase 2C)

Branch: `feat-models-io`. This feature ships as **new files only**. The parent
applies the wiring below; nothing in this module edits existing files.

## Files added

- `src/features/modelsio/types.ts` — shared types
- `src/features/modelsio/pure.ts` — pure logic (clamping, resume, parsing, stats)
- `src/features/modelsio/store.ts` — localStorage persistence
- `src/features/modelsio/backend.ts` — Tauri `models_io_*` wrappers
- `src/features/modelsio/ModelsSection.tsx` — features 1–6
- `src/features/modelsio/InputSection.tsx` — features 7–12
- `src/features/modelsio/OutputSection.tsx` — features 13–18
- `src/features/modelsio/ModelsIoPanel.tsx` — composite panel
- `src/features/modelsio/routes.tsx` — `export const ModelsIoRoutes = [...]`
- `src/features/modelsio/index.ts` — barrel
- `src/features/modelsio/__tests__/modelsio-pure.test.ts`
- `src/features/modelsio/__tests__/modelsio-components.test.tsx`
- `src-tauri/src/models_io.rs` — backend module + unit tests

## 1. Backend module — `src-tauri/src/lib.rs`

```rust
pub mod models_io;
```

## 2. Invoke handler — `src-tauri/src/lib.rs`, inside `tauri::generate_handler![...]`

```rust
models_io::models_io_resolve_settings,
models_io::models_io_set_model_settings,
models_io::models_io_get_model_settings,
models_io::models_io_disk_usage,
models_io::models_io_delete_model,
models_io::models_io_enqueue_download,
models_io::models_io_pause_download,
models_io::models_io_resume_download,
models_io::models_io_cancel_download,
models_io::models_io_list_downloads,
models_io::models_io_read_clipboard,
models_io::models_io_capture_screenshot,
models_io::models_io_dictate,
models_io::models_io_speak,
models_io::models_io_stop_speaking,
models_io::models_io_stop_generation,
models_io::models_io_last_token_stats,
models_io::models_io_sanitize_tts,
models_io::models_io_extract_code_blocks,
models_io::models_io_parse_citations,
```

No new capability entries are needed: these commands use only
`core:default` plus the existing process-spawn surface (`say`, `pbpaste`,
`screencapture` are spawned via `std::process::Command`, not the
shell plugin). If the project's capability audit requires explicit
shell scope, add `shell:allow-execute` for `say`, `pbpaste`,
`screencapture`, `pkill` in `src-tauri/capabilities/default.json`.

## 3. Routes — parent mount (pick one)

```tsx
import { ModelsIoRoutes } from './features/modelsio/routes';
// React Router:
{ModelsIoRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
// …or render <ModelsIoPanel /> directly in the settings/main surface.
```

Real model data: pass the picker inventory as `initialModels` with
`blobSha256s` resolved from the `installed_models` manifest (weights SHA +
mmproj SHA). Without `blobSha256s`, delete falls back to local removal and
says so.

## 4. Per-model settings → inference (feature 3, required)

Before `ask_model`, resolve and apply the stored settings:

```ts
import { getInferenceParamsForModel } from './features/modelsio/ModelsSection';
const params = getInferenceParamsForModel(activeModelId);
// Pass params.temperature / params.topP / params.contextLength into the
// ask_model payload (extend the command), and use
// params.systemPromptOverride when non-empty instead of the global prompt.
```

Backend equivalent (Rust, in the ask path):

```rust
let settings = models_io::resolve_per_model_settings(
    /* stored settings for the active model, if any */ None,
);
// use settings.temperature / settings.top_p / settings.context_length
// and settings.system_prompt_override when non-empty.
```

## 5. Stop generation (feature 18, required)

In the ask loop, poll the flag alongside the existing cancellation token:

```rust
if models_io::take_generation_cancel_requested() {
    // abort the in-flight request exactly as cancel_generation does
}
```

`models_io_stop_generation` only sets this flag; it never touches another
module's token.

## 6. Token stats (feature 16, required)

After the engine responds, record the real usage:

```rust
models_io::record_token_stats(models_io::compute_token_stats(
    prompt_tokens, completion_tokens, elapsed_ms,
    total_prompt_tokens, total_completion_tokens,
));
```

Frontend `OutputSection` reads it via `models_io_last_token_stats`. When the
engine reports no usage, the UI shows "no usage numbers" — never invented.

## 7. Download queue transfer (features 4–5)

The `models_io_*download` commands own queue *state*. Byte transfer reuses
the existing `models::download` machinery: when a queue item starts, run
the existing download for that model and update the item's
`downloaded_bytes` / `supports_range` (from the HTTP response: 206 ⇒
`true`, 200 to a Range request ⇒ `false`) / `status`. On pause, keep the
partial; on resume, apply `models_io::decide_resume_action` — a `restart`
decision zeroes the partial and tells the user.

## 8. Dictation (feature 12)

`models_io_dictate` deliberately returns an error (SFSpeechRecognizer needs
entitlement + Info.plist wiring). The frontend falls back to the Web Speech
API, which is the real working path. To enable the backend path later, wire
SFSpeechRecognizer and make the command return the transcript; no frontend
change is needed.

## 9. Startup init

No startup init call is required. Settings load lazily per model; the
download queue starts empty; token stats start as `None`.

## 10. DB migrations

None. Settings live in `<app_data>/modelsio/settings.json`. Disk usage and
delete read the existing `<app_data>/models` store + `installed_models`
manifest (no schema change).
