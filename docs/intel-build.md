# Veilura on Intel Macs (x86_64)

The pre-rebrand Thuki 0.16.3 release shipped Apple Silicon only. This tree adds a fully working
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
  `VEILURA_LLAMA_ARCH=arm64|x86_64`. The stamp now includes the arch, so
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
  until ~Aug 2027) and uploads `Veilura-<version>-Intel-x64.dmg`.

## Intentional Intel-build differences

- **Updater off.** The Intel DMG build disables the updater (the frozen
  workflow sets `.plugins.updater.active = false` via `jq` at build time).
  This is doubly required: no update server exists yet (the endpoint is a
  placeholder — see REBRAND.md), and an Intel build must never self-update
  into an arm64 artifact it cannot execute. Re-download the Intel DMG for
  updates.
- **Metal BF16 off** (see above). Metal acceleration itself stays on;
  Intel Macs run the same Metal backend, just without BF16 weight storage.
- Product name (`Veilura`) and bundle ID (`com.veilura.app`) are the
  same on both arches, so the Intel and Apple Silicon builds of Veilura
  install as the same `Veilura.app` and share the Veilura app-data and
  Keychain locations. Thuki data is migrated into the Veilura dir on first
  launch — see REBRAND.md.

## Building the Intel DMG

Two options:

**Option A — GitHub Actions (produces the DMG):**

1. Push this branch to a fork.
2. Actions → "Build Intel DMG" → Run workflow.
3. Download the `Veilura-Intel-x64-dmg` artifact (`Veilura-1.0.0-Intel-x64.dmg`).

The workflow verifies every Mach-O binary in the bundle is `x86_64`
(app binary, `llama-server` sidecar, all bundled dylibs), mounts the DMG,
and confirms `Veilura.app` is inside before uploading.

**Option B — on an Intel Mac:**

```bash
bun install
bun run engine:ensure          # builds the x86_64 sidecar on an Intel host
bun run tauri build --target x86_64-apple-darwin --bundles app
# then package the .app with create-dmg as in the workflow
```

## Verification checklist (performed by the workflow)

- [ ] `lipo -archs` == `x86_64` for: `Veilura` binary, `llama-server`
      sidecar, every `Contents/Frameworks/*.dylib`
- [ ] `codesign --verify` passes on the .app
- [ ] `Info.plist`: `CFBundleExecutable=Veilura`,
      `CFBundleIdentifier=com.veilura.app`, version `1.0.0`
- [ ] DMG mounts (`hdiutil verify` + attach) and contains `Veilura.app`
- [ ] Frontend tests (`vitest`) + backend tests (`cargo test`) pass on
      the Intel runner
