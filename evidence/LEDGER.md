# Evidence ledger — Thuki Intel (x86_64) build

Source: https://github.com/quiet-node/thuki @ `f3577592ea832bd46b4ae69a15661dcedce6faaf`
(Thuki v0.16.3, Apache-2.0). Work tree: `~/workspace/thuki-intel/`
(a behaviour-preserving Intel port; original untouched at `~/workspace/thuki/`).

## REA analysis (mandatory skill run)

- Tool: `npx -y rea-agents@latest analyze-javascript-application <tree> --json`
  (CLI fallback; no MCP registration, no Hopper/Ghidra — none required for a
  JS/Electron-tree target per the REA skill). Full setup/analyze flow
  (doctor, setup dry-run, DMG + .app analysis) is documented in
  `evidence/REA-SUMMARY.md`.
- Raw Evidence: `evidence/rea-js.json` (116 MB)
- Evidence ID: `ev_b41da58bf2fa9b1d5d020cb3f23429040f39cd906dd770a4f51dc950c980f31b`
- Inventory manifest: `agm_e8b2a6aa19d77aa013db64c233cc15cca0d82636ef5332f74f80e018fb7891cc`
- Root artifact SHA-256: `39dc09503ca1067d979667a3393a484c8d95e2e6d22861bef67ae17ab69ac804`
- Integrity contradictions: **0**
- Coverage: 276 relevant files, 264 JS files parsed (330,019 AST nodes),
  1 parse failure, text parsed as inert (nothing executed).
- Electron-boundary summary: **0 browser windows, 0 preload entry points,
  0 contextBridge APIs, 0 IPC operations, 0 native addon bindings.**
  Observation (not inference): the JS tree is a plain Vite/React frontend
  with no Electron main/preload boundary — consistent with the repo being
  **Tauri v2** (Rust backend `src-tauri/` + React frontend `src/`), not
  Electron. The Silicon-only lock-in therefore lives in the native side,
  not in the JS.
- Limitations (REA): graph coverage incomplete for a few large test files
  (per-file static facts retained on file nodes); binding relationships
  resolved only within the inventoried container.

## Static findings (repo inspection, corroborated by REA's no-Electron result)

| #   | Location                                             | Silicon-only pin                                                                                                                                                              | Intel fix in this branch                                                                           |
| --- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | `scripts/ensure-llama-server.ts`                     | `CMAKE_OSX_ARCHITECTURES=arm64`, binary `llama-server-aarch64-apple-darwin`, gate `process.arch !== 'arm64'` → skip, lipo audit `arm64`, arm64-only Metal residency-set check | Arch from host / `THUKI_LLAMA_ARCH`; arch in stamp; BF16 OFF on x86_64; residency check arm64-only |
| 2   | `src-tauri/src/lib.rs` `engine_sidecar_path` (debug) | hardcoded `llama-server-aarch64-apple-darwin`                                                                                                                                 | `cfg!(target_arch)` selects `x86_64` / `aarch64` triple                                            |
| 3   | `scripts/engine-gate/collect.ts`                     | hardcoded aarch64 binary path                                                                                                                                                 | `process.arch`-aware path                                                                          |
| 4   | Release pipeline (`.github/workflows/`)              | arm64 runners only (`macos-15`)                                                                                                                                               | NEW `build-intel-dmg.yml` on `macos-15-intel`                                                      |
| 5   | `README.md`                                          | "Apple Silicon (M1-M5)"                                                                                                                                                       | "Apple Silicon (M1–M5) or Intel (x86_64)"                                                          |

No other `target_arch` / arm64 gates exist in `src/`, `scripts/`,
`src-tauri/src/` (verified by grep). `tauri.conf.json` `externalBin`
(`binaries/llama-server`) is arch-neutral — Tauri resolves the
triple-suffixed binary for the build target. No code changes to app
features, commands, UI, or data handling: behaviour parity is by
construction (same source, same config, same engine pin
`llama.cpp b10056 @ b85833e934123f373a8dc087316e385b28c98cc0`).

## Intentional Intel differences (documented, not bugs)

- Updater disabled in the Intel build: upstream `latest.json` serves
  arm64-only artifacts; an Intel build must not self-update into an
  arm64 build it cannot execute. (Same approach as upstream nightly.)
- `GGML_METAL_USE_BF16=OFF` on x86_64: Intel GPUs lack BF16. Metal
  acceleration itself stays ON.
- Residency-set weak-import audit skipped on x86_64: Intel GPUs have no
  residency sets; absence is the correct state.

## Shipped-artifact evidence (release v0.16.3, REA + ordinary tools)

- `Thuki.dmg` SHA-256 `50a0fbd5b19249d8a0766ff6ef8232cd9618d793f05194bb407edd298fa76095`
  (20,031,669 bytes). REA `analyze`/`inspect` on the DMG: unavailable —
  needs Ghidra/Hopper/IDA (not installed, out of scope); recorded in
  `evidence/rea-dmg-analyze.json`.
- REA `trace-dylib-resolution` on the extracted `.app` (Evidence
  `ev_7412d85aea1f3d23e0316f5a2c8abd55d6287b9a7b39511f6bca4d37009056db`,
  coverage complete): 12 images — `thuki` + `llama-server` + the same
  10 dylibs as `bundle.macOS.frameworks`; all bundled `@rpath` edges
  resolve via `@loader_path/../Frameworks`; only system libs are
  undetermined (dyld shared cache). System frameworks used include
  Metal, Accelerate, WebKit, AppKit — all present on Intel macOS.
- Mach-O header parse (ordinary Python tool): all 12 shipped binaries
  are thin arm64 (`magic 0xfeedfacf`, `cputype 0x0100000c`).
- Bundle layout: `Contents/MacOS/{thuki, llama-server}` (binary is
  lowercase `thuki` — caught + fixed a `MacOS/Thuki` path bug in the
  first draft of the Intel CI workflow), `Contents/Frameworks/` (10
  dylibs), `Info.plist` `CFBundleExecutable=thuki`,
  `CFBundleIdentifier=com.quietnode.thuki`, version `0.16.3`,
  `LSMinimumSystemVersion=13.4`.

## Build + verification

- Builder: GitHub Actions `macos-15-intel` (last GitHub-hosted Intel
  runner, available until ~Aug 2027), fork `raphaelaxiom/thuki`,
  branch `intel-dmg`, workflow `.github/workflows/build-intel-dmg.yml`.
- In-workflow verification: `lipo -archs == x86_64` for app binary,
  sidecar, all dylibs; `codesign --verify`; Info.plist checks;
  `hdiutil verify` + mount + `Thuki.app` presence; frontend tests
  (vitest) + backend tests (`cargo test`) on the Intel runner.
- Local (Linux) pre-checks: workflow YAML parses; `ensure-llama-server.ts`
  skips on Linux (exit 0), rejects `THUKI_LLAMA_ARCH=bogus` (exit 1),
  accepts `x86_64`; `bun run typecheck` passes; `bun run test`
  (vitest) **118 files / 2617 tests, all passed**; `rustfmt --check`
  passes on `src-tauri/src/lib.rs`; ESLint on changed scripts: 0 errors
  (files outside the `src/` ESLint scope, ignored by config).

## Deliverable

- `Thuki-0.16.3-Intel-x64.dmg` — real Apple disk image (create-dmg),
  containing `Thuki.app` (x86_64) + Applications drop-link.
- SHA-256 + size: recorded in the final delivery report after the CI
  artifact is downloaded and re-verified locally (Mach-O header parse).
- STATUS (2026-10-16): Intel source complete + verified locally; the
  CI workflow file is committed locally but its push to the fork is
  blocked — the `gh` token lacks the `workflow` scope GitHub requires
  to push `.github/workflows/*` files. Unblock: run
  `gh auth refresh --hostname github.com -s workflow` and complete
  the device authorization at `https://github.com/login/device`
  (browser step), then push the workflow commit + `gh workflow run
  build-intel-dmg.yml --repo raphaelaxiom/thuki --ref intel-dmg`.
