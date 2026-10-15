# Thuki on Intel Macs (x86_64)

Thuki 0.16.3 ships Apple Silicon only. This branch adds a fully working
Intel (x86_64) build with identical behaviour: same UI, same commands, same
local engine, same data layout. The only intentional differences are the
ones an Intel build requires (below).

## Why the stock build was Silicon-only

Three places pinned the build to arm64:

1. `scripts/ensure-llama-server.ts` — built the llama.cpp `llama-server`
   sidecar with `-DCMAKE_OSX_ARCHITECTURES=arm64`, named it
   `llama-server-aarch64-apple-darwin`, refused to run on any other arch,
   and audited the result as arm64 (including an Apple-Silicon-only Metal
   residency-set check).
2. `src-tauri/src/lib.rs` (`engine_sidecar_path`) — the debug-build path
   hardcoded `llama-server-aarch64-apple-darwin`.
3. The release pipeline builds on arm64 runners only, so no Intel DMG was
   ever produced.

Everything else (Rust backend, React frontend, Tauri config) was already
arch-neutral: no `target_arch` gates, no arm64-only APIs. Tauri's
`externalBin` resolves the triple-suffixed sidecar for the build target
automatically.

## Changes in this branch

- `scripts/ensure-llama-server.ts` — target arch derives from the build
  host (`arm64` on Apple Silicon, `x86_64` on Intel), overridable with
  `THUKI_LLAMA_ARCH=arm64|x86_64`. The stamp now includes the arch, so
  switching hosts forces a rebuild instead of reusing a stale binary.
  `GGML_METAL_USE_BF16` is ON for arm64 and OFF for x86_64 (Intel GPUs
  lack BF16). The residency-set weak-import audit runs on arm64 only
  (Intel GPUs have no residency sets — absence there is correct).
- `src-tauri/src/lib.rs` — debug sidecar path picks the triple matching
  `cfg!(target_arch)`.
- `scripts/engine-gate/collect.ts` — gate binary path follows
  `process.arch`.
- `README.md` — requirements now read "Apple Silicon (M1–M5) or Intel
  (x86_64)".
- `.github/workflows/build-intel-dmg.yml` — manual workflow that builds
  on `macos-15-intel` (the last GitHub-hosted Intel runner, available
  until ~Aug 2027) and uploads `Thuki-<version>-Intel-x64.dmg`.

## Intentional Intel-build differences

- **Updater off.** The upstream updater endpoint serves arm64-only
  artifacts; an Intel build must not self-update into an arm64 build it
  cannot execute. The Intel DMG therefore has the updater disabled (same
  approach as the nightly build). Re-download the Intel DMG for updates.
- **Metal BF16 off** (see above). Metal acceleration itself stays on;
  Intel Macs run the same Metal backend, just without BF16 weight storage.
- Product name (`Thuki`) and bundle ID (`com.quietnode.thuki`) are
  unchanged, so the app installs as `Thuki.app` and keeps the same app-data
  and Keychain locations.

## Building the Intel DMG

Two options:

**Option A — GitHub Actions (produces the DMG):**

1. Push this branch to a fork.
2. Actions → "Build Intel DMG" → Run workflow.
3. Download the `Thuki-Intel-x64-dmg` artifact (`Thuki-0.16.3-Intel-x64.dmg`).

The workflow verifies every Mach-O binary in the bundle is `x86_64`
(app binary, `llama-server` sidecar, all bundled dylibs), mounts the DMG,
and confirms `Thuki.app` is inside before uploading.

**Option B — on an Intel Mac:**

```bash
bun install
bun run engine:ensure          # builds the x86_64 sidecar on an Intel host
bun run tauri build --target x86_64-apple-darwin --bundles app
# then package the .app with create-dmg as in the workflow
```

## Verification checklist (performed by the workflow)

- [ ] `lipo -archs` == `x86_64` for: `Thuki` binary, `llama-server`
      sidecar, every `Contents/Frameworks/*.dylib`
- [ ] `codesign --verify` passes on the .app
- [ ] `Info.plist`: `CFBundleExecutable=Thuki`,
      `CFBundleIdentifier=com.quietnode.thuki`, version `0.16.3`
- [ ] DMG mounts (`hdiutil verify` + attach) and contains `Thuki.app`
- [ ] Frontend tests (`vitest`) + backend tests (`cargo test`) pass on
      the Intel runner
