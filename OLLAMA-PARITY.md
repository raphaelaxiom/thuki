# Ollama provider parity

Every feature that used to work only on the built-in engine now works on
Ollama too — or is documented here with the exact technical reason it
cannot. This is the inventory for the Phase 3 parity work, with the
file:line of each gate (before) and each implementation (after).

> User-facing summary: see
> [Search and tools work on both providers](./docs/models-and-providers.md#search-and-tools-work-on-both-providers).
> Pipeline design: see [built-in-web-search.md](./docs/built-in-web-search.md).

## The one gate that mattered

| # | Feature | Old gate | Status |
| - | ------- | -------- | ------ |
| 1 | `/search` + web search on Ollama | `ask_model` in `src-tauri/src/commands.rs` returned `StreamChunk::Error("Web search needs the built-in engine\nSwitch to Built-in in Settings to use /search.")` for any non-built-in route | **Fixed.** The gate is deleted. The Ollama arm runs the same search pipeline as the built-in arm. |

## How parity is implemented

The search pipeline was already provider-agnostic by design: the
orchestrator (`src-tauri/src/websearch/orchestrator.rs`) depends on three
trait objects — `PrePass`, `SufficiencyJudge`, `Synthesizer` — plus
provider-neutral transport/reachability/scoring. Parity wires Ollama
implementations of those three edges into the same pipeline:

| Piece | Built-in | Ollama | File:line |
| ----- | -------- | ------ | --------- |
| Search pipeline core | `run_builtin_search` (monolith) | `run_search_pipeline` (shared) | `src-tauri/src/commands.rs:1129` |
| Built-in entry point | — | `run_builtin_search` (thin wrapper: re-ensure engine, build builtin trio) | `src-tauri/src/commands.rs:1287` |
| Ollama entry point | — | `run_ollama_search` (build Ollama trio, no engine warm-up) | `src-tauri/src/commands.rs:1381` |
| Classifier (pre-pass) | `BuiltinPrePass` (`/v1`, `json_schema`) | `OllamaPrePass` (Ollama `/v1`, `json_object`) | `src-tauri/src/websearch/prepass.rs:175` |
| Sufficiency judge | `BuiltinSufficiencyJudge` (`/v1`, `json_schema`) | `OllamaSufficiencyJudge` (Ollama `/v1`, `json_object`) | `src-tauri/src/websearch/judge.rs:431` |
| Cache-reuse synthesizer | `BuiltinSynthesizer` (`stream_builtin_chat`) | `OllamaSynthesizer` (`stream_ollama_chat`, swallowing sink) | `src-tauri/src/commands.rs:1059` |
| Search gate | `builtin_search_gate` | `search_gate` (renamed, provider-agnostic) | `src-tauri/src/commands.rs:925` |
| Search outcome | `BuiltinSearchResult` | `SearchResult` (renamed, provider-agnostic) | `src-tauri/src/commands.rs:663` |
| Citation repair | `refine_grounded_answer` | `refine_grounded_answer_ollama` (repair rounds re-stream via `/api/chat`) | `src-tauri/src/commands.rs:1658` |
| Stream finalize | `finalize_builtin_stream` | `finalize_stream` (renamed, shared) | `src-tauri/src/commands.rs:1759` |
| Structured-output flavor | `V1Flavor::Builtin` | `V1Flavor::Ollama` (`json_object`, no llama.cpp kwargs, Ollama-specific error copy) | `src-tauri/src/openai.rs` |

Why `json_object` for Ollama: Ollama's OpenAI-compatible endpoint accepts
`response_format: {"type": "json_object"}` but does not reliably support the
strict `json_schema` mode the bundled engine uses. The classifier/judge
prompts already say "output ONLY a JSON object", and their parsers accept
plain JSON content, so `json_object` is the whole contract. `json_request_body`
branches on flavor (`src-tauri/src/openai.rs`); the bundled engine and
generic remote servers keep the strict schema form.

## Auto-search trigger

Auto-search is the shared classifier prompt, not a per-provider hack. The
same `CLASSIFIER_SYSTEM` drives `BuiltinPrePass` and `OllamaPrePass`, and
it now carries an explicit ignorance rule
(`src-tauri/src/websearch/prepass.rs`, `CLASSIFIER_SYSTEM`):

> If you cannot answer confidently from your own knowledge — because the
> fact is live, niche, or simply not something you are sure of — choose
> "web". Never plan to answer "I don't know" without searching first:
> when Auto search is on, an uncertain answer is a search turn, not an
> admission of ignorance. A question you would answer with "I don't know"
> or "I'm not sure" is a "web" turn.

Trigger coverage (all via the one classifier, both providers):

- Time-sensitive / live facts: prices, rates, scores, weather, schedules,
  news, recent events.
- Dates and present-tense attributes of people/entities (age, title, role,
  employer, net worth) — training is frozen, so these are `web` turns.
- Unknown entities / niche facts the model is not sure of → `web`.
- Explicit look-it-up / verify / double-check → `web` + cache bypass.
- Transform commands (`/rewrite`, `/refine`, `/translate`, `/tldr`,
  `/bullets`, `/todos`, `/extract`) never auto-search
  (`slash_skips_auto_search`, `src-tauri/src/commands.rs`).

Honesty rule, enforced by the pipeline (not by prose): if search ran, the
answer carries `SearchSources` and numbered citations; if it didn't run,
nothing claims it did. An unreachable web falls back to the `Unreachable`
outcome — a grounded disclosure-bearing answer, never a fake search claim.

## Per-feature inventory

"Works on Ollama" means: same code path or a real Ollama equivalent, with
real engine data. Verified by code inspection + the tests listed in
[Verification](#verification).

| # | Feature | Old gate / old behaviour | Ollama behaviour now |
| - | ------- | ------------------------ | -------------------- |
| 1 | `/search` (explicit) | Capability error (see above) | Same pipeline; `force` bypasses cache, forces `Run` |
| 2 | Auto search | Classifier + pipeline ran only on the built-in arm; Ollama turns were plain streams | Ollama arm runs `search_gate` → `run_ollama_search` on `Run`; classifier prompt shared |
| 3 | Search citations | `SearchSources` chunk only emitted on the built-in path | Emitted by `run_search_pipeline` for both providers; citation audit + repair run on both (`refine_grounded_answer_ollama`) |
| 4 | Search status / sources pill UI | Frontend renders chunks provider-agnostically | Unchanged; now receives the chunks on Ollama turns too |
| 5 | Slash commands (`/explain`, `/think`, `/screen`, `/rewrite`, `/translate`, …) | Never provider-gated: they flow through `ask()` → `ask_model` on any provider | Unchanged; `/search` now also works on Ollama |
| 6 | `/screen` context | Screenshot attach → images on the turn; provider-agnostic | Unchanged. Vision Ollama models see the photo (classifier + writer); non-vision models take the strip path (gate `Plain`, honest "model doesn't support images" handling via the capability filter) |
| 7 | Clipboard / quoted-text context | Provider-agnostic (`build_user_content`) | Unchanged |
| 8 | Quick actions (summarise / rewrite / translate / explain) | Frontend slash commands via the real chat pipeline | Unchanged |
| 9 | Token / cost stats | `stream_ollama_chat` already recorded real `prompt_eval_count` / `eval_count` via `record_engine_usage`; built-in turns record nothing there | Unchanged for the writer. On Ollama cache-reuse turns the synthesizer's generation IS the reused answer, so its tokens are recorded too (real engine numbers, not estimates) |
| 10 | Per-model settings (temperature / top-p / context / system-prompt override) | Already passed to Ollama via `OllamaChatParams` | Unchanged for the writer; the Ollama search edges (synthesizer) now use the same effective temperature / top-p / `num_ctx` |
| 11 | Stop generation | Cancel token + 50 ms stop-flag poll in `stream_ollama_chat` | Unchanged; the Ollama search pipeline receives the same `cancel_token`, and the Ollama arm's repair loop checks it per attempt |
| 12 | Regenerate | Frontend re-ask | Unchanged |
| 13 | Model compare | Frontend feature, no provider gate | Unchanged |
| 14 | Screenshot / vision | Capability filter strips images for non-vision models (provider-agnostic); Ollama vision via `/api/chat` images | Unchanged. Vision capability for Ollama comes from the capabilities cache (populated from Ollama `/api/show`). A text-only Ollama model never receives images, and the search gate fails closed (`cached_vision`, `src-tauri/src/commands.rs`) — no faked vision |
| 15 | Conversation search / pin / folders / tags / export / import | Local SQLite + frontend, no provider gate | Unchanged |
| 16 | Prompt library / templates | Frontend + local storage | Unchanged |
| 17 | Reminders / focus timer / daily briefing | Local, no provider gate | Unchanged |
| 18 | Themes / font size / density / shortcuts | Frontend | Unchanged |
| 19 | Privacy toggles / audit log / backup / content filter | Local | Unchanged |
| 20 | TTS read-aloud / dictation | macOS `say` / Web Speech | Unchanged |
| 21 | System actions (open app, create file, open URL, reveal in Finder, create note) | Structured/allowlisted, provider-agnostic | Unchanged |

## Settings / copy changes

| File | Change |
| ---- | ------ |
| `src/hooks/useModel.ts:418` | `forceSearch` doc: was "force built-in engines-only web search" → "force web search on any provider that runs the search pipeline" |
| `src/contexts/ConfigContext.tsx:113` | `autoSearch` doc: was "the built-in engine may search" → "the active local provider (built-in engine or Ollama) may search" |
| `src/settings/types.ts:53` | `autoSearch` doc: provider-neutral |
| `src/settings/configHelpers.ts` | `auto_search` helper already provider-neutral ("search the web when a plain message needs live facts") — unchanged, guarded by test |
| `src/components/SearchProgressBlock.tsx` | Comment: "built-in auto-search" → "auto-search" |
| `src/config/commandArtifacts.ts` | Search policy already provider-neutral — unchanged, guarded by test |
| `docs/models-and-providers.md` | New "Search and tools work on both providers" section |
| `docs/built-in-web-search.md` | Header: pipeline runs on built-in AND Ollama |

## Genuinely provider-scoped items (not gates — real boundaries)

| Item | Why it stays provider-specific | User-visible behaviour |
| ---- | ------------------------------ | ---------------------- |
| Library / Discover (GGUF model management) | Library/Discover manage GGUF files for the bundled engine. Ollama models are a different format and live in Ollama's own store; a GGUF catalog cannot install into Ollama. | `BuiltinOnlyGate` (`src/settings/tabs/models/BuiltinOnlyGate.tsx`) still dims Library/Discover while Ollama is active, with copy explaining the switch. Ollama models are browsed/pulled from the model picker (`ModelPickerPanel.tsx`: "Browse and pull any model on Ollama. Veilura auto-detects it."). This is the Ollama equivalent, not a missing feature. |
| Search on generic OpenAI-compatible (`openai`-kind) providers | Remote servers vary in structured-output support; the pipeline's classifier/judge cannot run against them reliably. Extending search there would need per-server capability probing, which does not exist. | `/search` fails loudly: "Web search is not supported on generic OpenAI-compatible providers yet / Switch to Built-in or Ollama in Settings to use /search." (`ask_model`, `src-tauri/src/commands.rs`). Auto search simply does not trigger there (pre-existing plain-stream behaviour, unchanged). No silent "answered without searching". |
| Built-in engine lifecycle (warm-up, memory gate, reasoning backstop, `mmproj` handling) | llama.cpp-internals: the sidecar is Veilura's own process. Ollama manages its own server, memory, and model files. | No user-facing difference: Ollama turns never touch the sidecar lifecycle. The reasoning backstop (manifest-based) is built-in-only by construction and is skipped on Ollama turns. |
| "Ollama isn't running" strip | Not a feature gate: it fires only when the Ollama daemon is actually unreachable, offering "Get Ollama ↗" or "switch to Built-in". | Unchanged (`src/utils/capabilityConflicts.ts`). |

## Verification

- `cargo check --lib --tests` on Linux: **47 errors, all pre-existing
  macOS-only code** (`tauri_nspanel`, `ocr`/`permissions` Tauri commands,
  Darwin libc, `get_webview_panel`, `show_onboarding_window`) — identical
  count on the pristine tip before this change. **Zero errors in the
  touched files**, including the new `#[cfg(test)]` code.
- `cargo clippy --lib --tests`: no warnings in touched files.
- `cargo fmt --check`: clean.
- Rust tests added:
  - `openai.rs`: Ollama structured body uses `json_object` + no
    `chat_template_kwargs` + no `json_schema`; Ollama unreachable/404 copy.
  - `prepass.rs`: classifier prompt contains the don't-know → web rule;
    `OllamaPrePass` posts `json_object` to Ollama `/v1` and parses a `Web`
    decision (wiremock).
  - `judge.rs`: `OllamaSufficiencyJudge` posts `json_object` and parses a
    sufficient verdict (wiremock).
  - `commands.rs`: existing `search_gate` / `search_outcome_label` /
    `finalize_stream` tests updated for the renames (same assertions).
- Vitest tests added:
  - `src/settings/configHelpers.test.ts`: auto-search helper copy is
    provider-neutral.
  - `src/config/__tests__/commandArtifacts.test.ts`: the `/search` policy
    the model reads never gates on the built-in engine.
- Frontend: `bun run typecheck`, full vitest, `bun run lint:frontend` —
  see the commit report for numbers.
- **Not verified here (needs a live Mac + Ollama):** an end-to-end Ollama
  search turn against a real Ollama daemon, and `cargo test` on macOS.
  CI on `macos-15-intel` runs the full suite. The Ollama path degrades
  safely without a daemon: pre-pass/judge request failures surface as the
  pipeline's `Unreachable` outcome (grounded disclosure answer), and a
  down daemon still produces the existing "Ollama isn't running" strip.
