# FEATURES — Productivity + Settings + Safety (Phase 2D)

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
