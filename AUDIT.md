# Veilura — Phase 2A Audit + UI Overhaul

> Branch: `ui-overhaul` (base `884c19d`, rebrand commit). Worktree:
> `~/workspace/thuki-rebrand-ui`. No push. `.github/workflows/`, upstream,
> fork main untouched. `App.tsx` untouched (shell only — no feature routes
> added). No `src-tauri/src/*.rs` edits: backend findings are REPORTED here
> for the safety worker, not fixed.
>
> Method: read-only inspection of frontend + Rust (grep + targeted reads),
> plus the UI changes listed in §2. No live macOS run was possible in this
> sandbox (no cargo/rustc, no Tauri runtime): anything marked
> "not live-verified" needs a real Mac / CI check before shipping.
>
> Verdict: the codebase is in unusually good shape. Security hardening
> (SSRF default-deny, nonce-fenced search, Keychain-only secrets, SHA-256
> model verification) is already present and sound. The real gaps were
> frontend: no shared design tokens, no global focus-visible ring, warm
> pre-rebrand neutrals in Settings, one dead-end error state, one
> hover-only control, and one below-contrast accent. All of those are fixed
> in this branch. The single High-severity item is pre-existing release
> infrastructure (upstream updater key + placeholder update server).

## 1. Findings

Severity: Critical / High / Med / Low / Info. "Fixed" = changed in this
branch. "Left" = named owner + reason.

### 1.1 Accessibility

| ID | Sev | Location | Finding | Status |
|----|-----|----------|---------|--------|
| A-01 | Med | `src/App.css`, `src/styles/settings.module.css` (before) | No global `:focus-visible` ring. Only 2 Tailwind spots + `.citation-link` had one; every other button/link/input relied on browser defaults or nothing. | **Fixed** — one ring in `src/styles/tokens.css` (`button/a/input/…:focus-visible` + `*:focus-visible` guard), imported by both windows. |
| A-02 | Med | `src/components/HistoryPanel.tsx:288` (before) | History search `<input>` had `placeholder` only — no label. Screen readers announced an unlabeled field. | **Fixed** — `aria-label="Search past chats"`. |
| A-03 | Med | `src/components/ConversationItem.tsx:74` (before) | Delete button `opacity-0` until row hover: keyboard focus landed on an invisible control; touch devices (no hover) could not reach delete at all. | **Fixed** — also visible on `group-focus-within` / `focus-visible`. |
| A-04 | Med | `src/components/HistoryPanel.tsx:315` (before) | History load failure was a dead end: "Couldn't load history - try again." with no retry action. | **Fixed** — Retry button wired to the existing `fetchList` (re-runs current search). |
| A-05 | Low | `src/components/CommandSuggestion.tsx`, `src/view/askbar/LexicalAskBarInput.tsx` | Suggestion listbox has `role="listbox"` / `role="option"` / `aria-selected`, but options are not focusable and the Lexical input has no `aria-activedescendant` pointing at the highlighted option — a screen reader does not follow arrow-key navigation. | **Partial** — added stable `id="cmd-option-<trigger>"` per option so the wiring has an anchor. Full `aria-activedescendant` wiring left for the AskBar owner (needs input↔listbox coordination; shell-only rule kept `App.tsx` untouched). |
| A-06 | Low | 22 `<button>` across `src/components/*`, `src/view/onboarding/*`, `src/settings/tabs/models/ModelSelect.tsx` | Missing `type="button"`. No `<form>` exists anywhere in `src/`, so no submit bug — consistency/hygiene only. | **Fixed** — all 155 `<button>` in `src/` now carry `type` (verified by scan). |
| A-07 | Low | `src/components/TipBar.tsx:78` | Typing effect writes `span.innerHTML = chars`. Current `TIPS` (`src/config/tips.ts`) are static strings, so no live XSS — but the first dynamic/remote tip would render as HTML. | **Left** (frontend follow-up) — switch to `textContent` or escape `chars`. One-line change, but it touches the typing animation; verify visually on a Mac. |
| A-08 | Low | `src/components/MarkdownRenderer.tsx:248` | Link-click delegation sits on a `<span onClick>`; keyboard activation still works because inner links are real `<a>` elements (`tabIndex={0}`, `aria-label`). No fix needed. | Accepted — documented, no change. |
| A-09 | Low | `src/components/HistoryPanel.tsx` + 4 other `autoFocus` sites | `autoFocus` steals focus when the history drawer opens. Acceptable for a search-first panel; no focus trap exists (Esc/close remain reachable). | Accepted — documented, no change. |
| A-10 | Med | `src/App.css` `.citation-link` (before) | Citation color `rgba(232,131,90,0.75)` was below 4.5:1 on the indigo bubble for small text. | **Fixed** — `#f2a38a`, clears 4.5:1. Hover keeps the violet treatment. |
| A-11 | Low | `src/components/StarterMatrix.tsx:341` (before) | Dimmed (non-recommended) tier column at `opacity: 0.32` washed body text below the contrast floor. Decorative `—` placeholders at `rgba(255,255,255,0.28)` are exempt (non-text). | **Fixed** — dimmed opacity `0.32` → `0.55`. |
| A-12 | Low | Framer Motion / JS tweens | New global reduced-motion kill-switch in `tokens.css` covers all CSS animation. JS-driven tweens (Framer morph, `ThreeDotMotion` already checks `matchMedia`) are out of CSS reach. | **Left** — per-component JS `matchMedia` checks for the morph tween; needs a Mac to verify the feel. |
| A-13 | Info | All `<img>` in `src/` | Full-tag scan: every image already has `alt` (logo images `alt="Veilura"`, attachments `alt="Attached"`). No missing-alt findings. | No change needed. |
| A-14 | Info | `tabIndex` usage | 9 sites, all `0` or roving `-1` (Settings tabs, segmented panes, ModelSelect). No positive `tabIndex` (no broken tab order). Focus order follows DOM order in inspected panels. | No change needed. |
| A-15 | Info | Text tokens | `--color-text-secondary` `#9a97b8` on the dark surface measures 6.3:1; primary `#f2f1fb` measures 15.7:1. No token change needed. | No change needed. |

### 1.2 UI / UX — per page

| Page / view | State before | Change in this branch |
|---|---|---|
| Overlay / ask bar (`src/view/AskBarView.tsx`, `src/App.tsx`) | No global focus ring; long unbroken strings relied on `break-word` alone; command palette missing option ids. | Focus ring (tokens), `.chat-bubble` `overflow-wrap: anywhere` + `min-width: 0` (long URLs/tokens can no longer widen the 600px window), `cmd-option-*` ids. Behaviour unchanged. |
| Conversation view (`src/view/ConversationView.tsx`, `src/components/ChatBubble.tsx`) | Good: streaming / search / reasoning / error states all present (`RequestStatusStrip`, `ErrorCard`, `SearchProgressBlock`). Citation contrast low (A-10). | Citation fix only. No blank-screen path: empty conversation renders the starter picker; streaming shows a loading placeholder bubble (`App.tsx:2468`). |
| Slash-command palette (`src/components/CommandSuggestion.tsx`) | Good empty state ("No commands found"), `listbox`/`option` roles, Tab badge. | Option ids (A-05 partial). |
| Model library — Settings → Models (`src/settings/tabs/models/*`, `src/styles/settings.module.css`) | Warm pre-rebrand neutrals (`#100e0d`, `#eceae7`, `rgba(36,30,26,…)`) diverged from the Veilura indigo/violet system (REBRAND.md §8 deferred this to Phase 2). Empty states present everywhere (Library "No models downloaded yet", Browse "No models found", Staff Picks "No curated models are available", ModelSelect "No models found"). | **Retokenized**: `--base` → `#181630`, `--rail` → `#12102a`, `--t1` → `#f2f1fb`, `--t2/--t3` → indigo-tinted, `--cap-text` warm stone → lavender stone `#c9c4e8`, 17 warm overlay fills → `rgba(28,26,58,…)`. |
| Settings — all tabs (`src/settings/*`) | Same warm-neutral drift; no shared tokens; focus ring absent. | Tokens import + retokenize + global focus ring. Tabs verified present: Behaviour, Display, Models, About, Changelog. Corrupt-config recovery banner + SaveField states already good. |
| History (`src/components/HistoryPanel.tsx`, `ConversationItem.tsx`) | Empty state ("No conversations yet"), grouped by date, search with debounce. Dead-end load error (A-04), hover-only delete (A-03), unlabeled search (A-02). | All three fixed. Long titles already `truncate`; active row has `aria-current` + violet rail. |
| Welcome / onboarding (`src/view/onboarding/*`) | 5 steps (Intro, Permissions, ModelCheck, BuiltinAnnouncement + shared). Buttons now typed (A-06). No missing alts (A-13). | `type="button"` only. Content/flow untouched. |
| Update window (`src/view/update/UpdateWindow.tsx`) | Settings-parity shell already in `App.css` (`.update-window-shell`, `.update-notes`). | No visual change. See U-06. |
| Safe-mode recovery (`src/components/SafeModeRecoveryCard.tsx`) | Good: distinct card, two typed actions, programmatic focus target (`tabIndex={-1}`) with documented rationale. | `type="button"` only. |

| ID | Sev | Finding | Status |
|----|-----|---------|--------|
| U-01 | Med | Settings warm neutrals vs brand system (see table above). | **Fixed**. |
| U-02 | Low | No light/dark theme: app is dark-only; `--color-paper` (`#faf7f2`) existed but was never used as a surface. | **Left** (parent/feature decision) — `tokens.css` now defines the full light contract under `[data-veilura-theme="light"]` (Paper surfaces, indigo text, same brand accents). No toggle is wired: shipping a toggle re-skins every surface and must be a deliberate product decision, not a drive-by. |
| U-03 | Low | Long unbroken strings could force the chat window wider (KaTeX already contained; plain URLs relied on `break-word`). | **Fixed** — `overflow-wrap: anywhere` + `min-width: 0` on `.chat-bubble`. |
| U-04 | Low | No shared design tokens: spacing/type/radii/shadows/motion/z values were invented per surface. | **Fixed** — `src/styles/tokens.css` (spacing 4px scale, type scale, radii, shadows mirroring `--shadow-bar`/`--shadow-chat`, motion, z-index, focus ring, dark + light theme tokens). Imported by `App.css` and `settings.module.css`. File holds only `:root`/attribute/element selectors so CSS-Modules inlining never hashes anything. |
| U-05 | Info | Empty / error / loading states: verified present on every page (see table). No blank screens found. | No change needed. |
| U-06 | Low | `src/view/update/UpdateWindow.tsx:128` — update-window action failure only `console.error`s; the user sees nothing. | **Left** (feature worker) — needs a user-visible error/toast decision; no toast system exists in the update window. |
| U-07 | Low | Settings window is fixed 760px (`minWidth = maxWidth = 760` in `tauri.conf.json`): no narrow-display fallback. | **Left** (parent decision — Tauri window config change). |
| U-08 | Info | Dead buttons: none found. All 155 `<button>` have handlers (scan); no `<form>` in tree. | No change needed. |

### 1.3 Security — for the safety worker (NOT fixed here; backend-owned)

These were inspected read-only. The backend is already well hardened;
items below are residual risks / pre-existing infrastructure, not live bugs.

| ID | Sev | Location | Finding | Owner |
|----|-----|----------|---------|-------|
| S-01 | **High** | `src-tauri/tauri.conf.json:116-118`, `src-tauri/src/config/defaults.rs:683` | **Updater pubkey is the upstream Thuki key; update endpoint `https://veilura.online/updates/latest.json` serves nothing yet.** If a release ever ships with this key + a live manifest, update integrity depends on a key Veilura does not control. Already documented in REBRAND.md §6; still the highest-severity item in the tree. | Safety worker + parent: generate a fresh updater keypair, stand up the manifest host, replace pubkey before any release. |
| S-02 | Med | `src-tauri/src/commands.rs:2903` `open_url` | Scheme guard (`http/https` prefix) is sound; `Command::new("open").arg(url)` passes one argv (no shell splitting). Residual: any `http(s)` URL opens on user click, including attacker URLs from model output/citations — user-clicked, so acceptable, but a confirm step for non-docs/non-HF hosts is a possible UX hardening. | Safety worker + parent (UX decision). |
| S-03 | Info | `src-tauri/src/net/ssrf.rs`, `src-tauri/src/net/transport.rs:260-322` | SSRF posture verified sound: default-deny classifier (private/loopback/link-local/CGNAT/TEST-NET/benchmarking/multicast, IPv6-embedded-IPv4 reclassification), re-check on every redirect hop, pinned-DNS screening (closes DNS rebinding), `MAX_HTTP_RESPONSE_BYTES` cap with gzip-bomb-safe accounting, redirect cap. No action. | — |
| S-04 | Med | `src-tauri/src/websearch/writer.rs` (`mint_nonce`), `judge.rs:152-205`, `src/utils/sanitizeAssistantContent.ts`, `STRIP_PATTERNS` | Prompt-injection defences verified present: per-turn CSPRNG nonce-fenced untrusted web text, instruction-ignoring clause, special-token stripping both sides, `rehype-sanitize` in `MarkdownRenderer`. Residual: a model can still follow instructions inside quoted content — mitigation, not elimination. | Safety worker: ongoing search-eval coverage, no code fix in this branch. |
| S-05 | Low | `src/components/TipBar.tsx:78` | Same as A-07: `innerHTML` typing effect; safe while tips are static. | Frontend follow-up (see A-07). |
| S-06 | Low | `src-tauri/tauri.conf.json:67` CSP | `style-src 'self' 'unsafe-inline'` widens XSS impact if a renderer bug ever occurs. Tailwind + inline styles currently need it. | Safety worker + parent: removing it means moving all inline styles to classes — large refactor, not a drive-by. |
| S-07 | Low | `src-tauri/src/commands.rs:2026-2932` (prod `lock().unwrap()` sites) | Poisoned-mutex `unwrap()` panics inside Tauri commands (`GenerationState` token, conversation history, `reset_conversation`). A panic in a command can wedge that call path. | Safety worker: `lock().unwrap_or_else(\|e\| e.into_inner())` at prod sites. |
| S-08 | Low | `src/utils/isNonLocalUrl.ts:32` | IPv6: only `::1` counts as local; ULA (`fc00::/7`) / link-local (`fe80::/10`) count as remote → warning fires (fail-safe direction). A ULA Ollama URL gets a "remote" warning only, no block — acceptable for user-configured providers. | Accepted — documented. |
| S-09 | Info | `src-tauri/src/keychain.rs`, `src-tauri/src/context.rs:146-171` | Secrets posture verified: provider API keys Keychain-only, never returned to frontend, never in TOML; no secrets in `localStorage`/`sessionStorage`/cookies (only a test shim touches `localStorage`); clipboard save → synthetic Cmd+C → `pbpaste` → restore-original flow. No findings. | — |
| S-10 | Info | `src-tauri/src/engine/process.rs:144`, `src-tauri/src/config/loader.rs:301-332`, `src-tauri/src/models/download.rs:556-559` | Engine binds `127.0.0.1` only; provider `base_url` validated to `http(s)`; model downloads resume via `Range` and install only on SHA-256 match. No findings. | — |
| S-11 | Low | `src-tauri/src/database.rs:81-82` | SQLite uses WAL + `foreign_keys = ON`, but no `PRAGMA integrity_check` on open and no DB-corruption recovery UI (config corruption has one: `config/loader.rs` rename + marker + banner). A corrupt `veilura.db` surfaces as opaque command failures. | Safety worker: integrity check on open + backup/restore path. |
| S-12 | Info | `src-tauri/src/screenshot.rs`, `src/view/onboarding/PermissionsStep.tsx` | Screen capture excludes Veilura's own windows; TCC (Accessibility / Screen Recording) re-grant after the bundle-ID change is covered by onboarding. No findings. | — |
| S-13 | Info | `src-tauri/capabilities/default.json` | Minimal Tauri capabilities (window hide/start-dragging/set-size/set-focus, no shell/fs/dialog/http permissions). No over-broad grants. | — |

### 1.4 Performance

| ID | Sev | Finding | Status |
|----|-----|---------|--------|
| P-01 | Info | Heaviest deps: `framer-motion`, `streamdown`, `katex`, `lexical`, `@fontsource/nunito`. Single bundle serves all three windows (main + settings + update); no code-splitting. | **Left** — measured below; splitting Settings/Update into lazy chunks is a build-config decision for the parent, not a UI-branch change. |
| P-02 | Low | `src/App.tsx` is 4,708 lines in one component — re-render surface and review cost. | **Left** — out of scope (shell-only rule); decomposition is a feature-worker job. |
| P-03 | Info | Model downloads: `Range` resume + SHA-256 verify present; single-stream (no parallel chunks). Adequate for multi-GB GGUF files; parallel chunks add server-compatibility risk. | No change. |
| P-04 | Info | Backend perf (startup, engine warmup) not measured here: no cargo/rustc in this sandbox. | CI / Mac must cover. |

### 1.5 Reliability

| ID | Sev | Finding | Status |
|----|-----|---------|--------|
| R-01 | Info | Engine crash recovery present: `src-tauri/src/engine/runner.rs` supervises the sidecar; `src-tauri/src/engine/orphan.rs` reaps `SIGKILL` orphans at startup (strict identity checks, SIGTERM → grace → re-verify → SIGKILL). Not live-verified here (no macOS). | No change. CI/Mac must live-verify. |
| R-02 | Info | Config corruption: rename to `<name>.corrupt-<ts>` + marker file + recovery banner (`config/loader.rs`, `SettingsWindow.tsx`). Present and sound. | No change. |
| R-03 | Info | Offline behaviour: Ollama-down / engine errors surface via `ErrorCard` + strips; updater poller fails closed; downloads keep `.partial` for resume. Present. | No change. |
| R-04 | Low | Update-window silent action failure — see U-06. | **Left** (feature worker). |

## 2. UI changes made in this branch

1. **`src/styles/tokens.css` (new)** — design-system tokens: spacing (4px
   scale), typography scale, radii, shadows, motion, z-index, focus ring,
   dark theme (live) + light Paper theme under
   `[data-veilura-theme="light"]` (contract only, no toggle wired — U-02),
   global `:focus-visible` ring, global reduced-motion kill-switch.
2. **`src/App.css`** — imports tokens; `.chat-bubble`
   `overflow-wrap: anywhere` + `min-width: 0`; citation-link contrast fix.
3. **`src/styles/settings.module.css`** — imports tokens; Settings palette
   retokenized warm → indigo (base/rail/text/cap-text + 15 warm overlay
   fills → indigo).
4. **`src/settings/tabs/models/ModelSelect.module.css`** — 2 warm overlay
   fills → indigo.
5. **`src/components/HistoryPanel.tsx`** — search `aria-label`; Retry
   button on load error (wired to existing `fetchList`).
6. **`src/components/ConversationItem.tsx`** — delete button visible on
   keyboard focus (`group-focus-within` / `focus-visible`).
7. **`src/components/CommandSuggestion.tsx`** — stable `id` per option.
8. **`src/components/StarterMatrix.tsx`** — dimmed-column opacity
   `0.32` → `0.55` (contrast).
9. **`type="button"`** — added to the 22 buttons missing it
   (`CopyButton`, `DownloadProgress` ×3, `ReplaceButton`,
   `SafeModeRecoveryCard` ×2, `StarterMatrix` ×6, `StarterPicker` ×2,
   `ModelSelect`, onboarding ×6). No behaviour change (no `<form>` in tree).
10. **Not changed (deliberate):** `App.tsx` (shell-only), any `.rs` file,
    `.github/workflows/`, onboarding content/flow, any copy, any handler
    logic. All fixes are presentation/attributes/wiring-to-existing-actions.

## 3. Verification

- `bun run typecheck` — **PASS** (`tsc --noEmit`, exit 0).
- `bun run test` (vitest) — **PASS: 118 test files, 2,617 tests, all
  passed** (~21 min on this 2-CPU sandbox; no failures). One test needed an
  intentional update along the way: `StarterMatrix.test.tsx` pinned the old
  dimmed opacity `0.32`; it now pins `0.55` (A-11 fix) with a comment. No
  new tests added: every other change sits in already-covered render paths
  (new Retry button lives inside the already-covered `loadError` branch;
  attribute/class changes add no new branches). Coverage gate (`100%`) was
  not run — `bun run test` only, per task; the milestone gate
  `bun run test:all:coverage` must still run in CI.
- `cargo fmt --check` — **not run**: cargo/rustc not installed in this
  sandbox. No `.rs` files were touched, so formatting is unaffected.
- `bun run build:frontend` — **PASS** (`tsc` + Vite build in 8.8s).
  Bundle baseline (P-01): single JS chunk **1,685 kB (512 kB gzip)**,
  CSS **163 kB (33 kB gzip)**, `dist/` total **3.6 MB**. Vite emits its
  chunk-size warning (>1000 kB) — the code-splitting follow-up stands.

## 4. For the parent at merge time

- Merge order: this branch touches only frontend presentation. It does not
  conflict semantically with the safety worker (backend files) or feature
  workers (routes/handlers), but it does touch shared components
  (`HistoryPanel`, `StarterMatrix`, onboarding) — merge before feature
  workers rebase, or expect small conflicts on those files.
- The light theme is tokens-only. Do **not** present the app as
  "light-mode ready" — no toggle exists and most surfaces still hardcode
  dark values inline. Wiring the toggle is a separate, every-surface job.
- `tokens.css` is imported by both `App.css` and `settings.module.css`.
  If a future worker converts Settings to plain CSS (not modules), keep
  the import — it is what gives Settings the focus ring + tokens.
- Highest-priority follow-up is **S-01** (fresh updater keypair + live
  manifest host) — it gates any real release, and it is not a UI-branch
  job.
- Remaining named follow-ups: A-05 (aria-activedescendant), A-07 (TipBar
  `innerHTML`), A-12 (JS reduced-motion), U-06 (update-window error UI),
  S-06 (CSP `unsafe-inline`), S-07 (mutex poisoning), S-11 (DB integrity
  check), P-01 (bundle splitting).
