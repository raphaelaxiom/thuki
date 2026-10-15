# FEATURES — Models / Input / Output (Phase 2C)

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
