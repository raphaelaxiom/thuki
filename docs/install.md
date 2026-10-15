# Installing Veilura

**Requirements:** macOS 13.4 (Ventura) or later, Apple Silicon (M1–M5) or Intel (x86_64).

## Recommended: one-line install

> **Placeholder:** `https://veilura.online/install.sh` is not published yet — the commands below describe the intended installer. Until it lands, use the manual DMG or build-from-source paths.

```bash
curl -fsSL https://veilura.online/install.sh | sh
```

This downloads the latest `Veilura.dmg` over HTTPS, verifies its RSA-4096 signature with the `openssl` already on your Mac, and installs it to `/Applications`. Because the download arrives without a quarantine flag, Veilura opens cleanly with no Gatekeeper prompt and no manual `xattr` step.

On first launch macOS asks for two permissions: **Accessibility** (the global hotkey that summons Veilura from any app) and **Screen Recording** (the `/screen` command). Grant both once; they persist across restarts. Onboarding then downloads a starter model right inside the app.

The sections below cover the alternative paths.

## Inspect the install script

Read it in the terminal without saving anything:

```bash
curl -fsSL https://veilura.online/install.sh | less
```

Or visit [veilura.online/install.sh](https://veilura.online/install.sh) to download it and open the saved file in an editor first.

## Nightly (side by side with stable)

```bash
curl -fsSL https://veilura.online/install.sh | VEILURA_CHANNEL=nightly sh
```

Same script URL; the `VEILURA_CHANNEL=nightly` env (or `sh -s -- --nightly`) installs **Veilura Nightly.app** beside stable `Veilura.app`. Nightly uses a different bundle id (`com.veilura.app.nightly`), so data, Keychain secrets, and TCC grants stay separate. Not for production. Do not run both at once: they both claim double-tap Control and will fight over the hotkey.

## Manual install (download the DMG)

Prefer to download by hand? Grab the DMG and clear the quarantine flag yourself.

1. Download `Veilura.dmg` from the [latest stable release](https://github.com/veilura/veilura/releases/latest), or grab the bleeding-edge build from the [`nightly`](https://github.com/veilura/veilura/releases/tag/nightly) channel, rebuilt automatically from `main`.
2. Double-click `Veilura.dmg` to open it, then drag the app onto the `Applications` folder shortcut. Stable ships as `Veilura.app`; nightly as `Veilura Nightly.app`.
3. Eject the disk image (drag it to Trash in the Finder sidebar, or right-click and choose Eject).
4. **Before opening for the first time**, run this command in Terminal (use the path that matches the channel you installed):

   ```bash
   # stable
   xattr -rd com.apple.quarantine /Applications/Veilura.app

   # nightly
   xattr -rd com.apple.quarantine "/Applications/Veilura Nightly.app"
   ```

   > **Why is this needed?** Veilura ships outside the Mac App Store, so Gatekeeper blocks it until this one-time command clears the quarantine flag. It is safe and [documented by Apple](https://support.apple.com/en-us/102445). The one-line installer does this for you.

5. Open the app. It will appear in your menu bar.

## Build from source

**Prerequisites:** [Bun](https://bun.sh) and [Rust](https://rustup.rs)

```bash
# Clone and install dependencies
git clone https://github.com/veilura/veilura.git
cd veilura
bun install

# Launch in development mode (hot-reload frontend)
bun run dev
```

See [CONTRIBUTING.md](../CONTRIBUTING.md#development-setup) for the full development setup guide.

To produce a standalone app instead of running the dev server, build it and open the bundle directly:

```bash
bun run build:all
open src-tauri/target/release/bundle/macos/Veilura.app
```
