# REA evidence summary — Thuki Intel build

Target: Thuki v0.16.3 (Tauri v2 app) — cloned source at
`~/workspace/thuki-intel/` + shipped release artifacts from
`quiet-node/thuki` v0.16.3 (public release, downloaded to `/tmp`).

Tool: REA `rea-agents@latest` CLI (`rea@6.5.0`), invoked as
`npx -y rea-agents@latest <command> --json`. No MCP registration, no
Hopper, no Ghidra, no unrelated installs.

## 1. Doctor + setup (the "setup agent" flow)

- `rea doctor --json` → `healthy: false`, `environment_healthy: false`.
  Healthy: Node 24.20.0, Ubuntu 24.04 host. Missing: Hopper, Ghidra,
  IDA, JADX (native decompilation engines) + REA skill identity.
- `rea setup --dry-run --json` (no client) → `status: "planned"`,
  `plannedActions: []`. With no client selected it plans **nothing**.
- Decision (per REA `connection-and-recovery.md`): this session runs
  under Muse, which is not a supported REA client, so registering MCP
  for a foreign client (Claude Code, Codex, …) would write config for
  an app that never runs here and would not attach tools to this
  session. For unsupported clients the guide prescribes the CLI path —
  which is what every command below uses. Hopper/Ghidra installs were
  **not** performed (explicitly out of scope). Result: full static
  + artifact-graph evidence via CLI; native decompilation
  (`analyze`/`inspect` on the DMG) is the one unavailable operation,
  recorded below with its exact error.

## 2. JavaScript application analysis (the "drag app, type app path" flow)

- Command: `rea analyze-javascript-application ~/workspace/thuki-intel --json`
- Run 1 (pre-Intel-edits tree): `evidence/rea-js.json` (116 MB),
  Evidence ID `ev_b41da58bf2fa9b1d5d020cb3f23429040f39cd906dd770a4f51dc950c980f31b`,
  inventory `agm_e8b2a6aa19d77aa013db64c233cc15cca0d82636ef5332f74f80e018fb7891cc`,
  integrity contradictions **0**.
- Run 2 (final Intel tree): `evidence/rea-js-intel.json`,
  Evidence ID recorded in `evidence/LEDGER.md` after the run.
- Coverage (run 1): 276 relevant files, 264 JS files parsed
  (330,019 AST nodes), 1 parse failure, parsed as inert text
  (nothing executed).
- Electron-boundary summary: **0 browser windows, 0 preload
  entry points, 0 contextBridge APIs, 0 IPC operations, 0 native
  addon bindings.** Observation: the JS tree is a plain Vite/React
  frontend with no Electron main/preload boundary — consistent with
  the repo being **Tauri v2**, not Electron. The Silicon-only
  lock-in therefore lives in the native side (engine sidecar +
  build target), not in the JS.

## 3. Shipped DMG / .app (release v0.16.3)

- `Thuki.dmg` SHA-256
  `50a0fbd5b19249d8a0766ff6ef8232cd9618d793f05194bb407edd298fa76095`
  (20,031,669 bytes); `Thuki_0.16.3_aarch64.app.tar.gz` SHA-256
  `c25a987442f327fb8202cc7a82a3e7baa1810c037eb5b5ce7bae3479d8ac7637`.
- `rea analyze <Thuki.dmg>` and `rea inspect <Thuki.dmg>` →
  **failed, recorded**: `capability_unavailable /
  unsupported_provider` — "The selected analysis provider does not
  support this target. Choose another provider or open a supported
  extracted binary." Candidate providers were Ghidra/Hopper/IDA
  (not installed, out of scope). Evidence saved as
  `evidence/rea-dmg-analyze.json` + `evidence/rea-dmg-inspect.json`.
- `rea trace-dylib-resolution <Thuki.app>` → **succeeded**,
  Evidence ID
  `ev_7412d85aea1f3d23e0316f5a2c8abd55d6287b9a7b39511f6bca4d37009056db`
  (saved as `evidence/rea-dylib-resolution.json`, 87 KB).
  Coverage: **complete**. 12 images: 2 executables
  (`Contents/MacOS/thuki`, `Contents/MacOS/llama-server`) + the 10
  bundled dylibs — exactly the `bundle.macOS.frameworks` list in
  `tauri.conf.json`. Every bundled `@rpath` edge resolves via
  `@loader_path/../Frameworks` (the rpath
  `ensure-llama-server.ts` adds). The only non-resolved edges are
  system libraries (`/usr/lib/*`, `/System/Library/Frameworks/*`)
  — "undetermined", provided by the dyld shared cache on macOS.
  System frameworks in the graph include Metal, Accelerate,
  WebKit, AppKit — all present on Intel macOS too.
- `rea inspect-with-objdump <thuki> file_headers` → recorded
  Evidence `ev_c49b4cee02828b1fb4d28d04ca29f16c9fafd400813bd51cd571dc7fee5acdd6`:
  GNU objdump 2.42 on Linux does not recognise Mach-O
  ("file format not recognized"). Arch facts therefore come from
  REA's trace (`architecture: arm64`) + a Mach-O header parse
  (ordinary Python tool): all 12 shipped binaries are thin
  arm64 (`magic 0xfeedfacf`, `cputype 0x0100000c`).

## 4. Shipped bundle layout (ordinary-tool observation, not REA)

Extracted `Thuki.app`: `Contents/MacOS/{thuki, llama-server}`
(binary is lowercase `thuki` — this caught a bug in the first
draft of the Intel CI workflow, which checked for `Thuki`; fixed),
`Contents/Frameworks/` (10 dylibs), `Contents/Resources/`,
`_CodeSignature/`. `Info.plist`: `CFBundleExecutable=thuki`,
`CFBundleIdentifier=com.quietnode.thuki`,
`CFBundleShortVersionString=0.16.3`, `LSMinimumSystemVersion=13.4`.

## 5. What this Evidence established for the Intel rebuild

- Feature inventory / behaviour: unchanged source — no feature
  work needed; the port is the arch of 12 Mach-O images + the
  sidecar-resolution + engine-build scripts.
- The 3 Silicon pins (ensure script, `engine_sidecar_path` debug
  branch, engine-gate binary path) + the arm64-only CI are the
  complete list of arch-specific code (verified by grep + REA's
  no-Electron / no-native-addon result).
- The Intel build must produce: thin x86_64 for all 12 images,
  same bundle layout, same `Info.plist` identity, same dylib
  closure via the same `@loader_path/../Frameworks` rpath,
  `LSMinimumSystemVersion 13.4`, ad-hoc signature. The CI workflow
  verifies exactly this with `lipo -archs`, `codesign --verify`,
  `PlistBuddy`, and a mount check.
- Intentional Intel differences (documented in
  `docs/intel-build.md`): updater off (upstream serves arm64-only
  artifacts), `GGML_METAL_USE_BF16=OFF` (Intel GPUs lack BF16),
  residency-set audit arm64-only (Intel GPUs have no residency sets).
