//! Config migration helpers shared by the loader (TOML-shape migration) and
//! startup orchestration (SQLite active-model fold-in). Kept pure so both
//! halves are unit-tested without a Tauri app or a real SQLite connection.

use super::defaults::PROVIDER_KIND_OLLAMA;
use super::schema::AppConfig;

/// Attaches a legacy SQLite `active_model` onto the active provider's `model`
/// field when that provider is Ollama-kind and has no model yet. The legacy
/// slug is by definition an Ollama model name, so it never attaches to a
/// provider of any other kind. Returns true if it mutated the config (so
/// startup can decide whether to persist). No-op when `legacy` is
/// empty/whitespace, the active provider is not Ollama-kind, or it already
/// has a model.
pub fn attach_legacy_active_model(config: &mut AppConfig, legacy: Option<&str>) -> bool {
    let Some(model) = legacy.map(str::trim).filter(|m| !m.is_empty()) else {
        return false;
    };
    let active_id = config.inference.active_provider.clone();
    if let Some(provider) = config
        .inference
        .providers
        .iter_mut()
        .find(|p| p.id == active_id)
    {
        if provider.kind != PROVIDER_KIND_OLLAMA {
            return false;
        }
        if provider.model.trim().is_empty() {
            provider.model = model.to_string();
            return true;
        }
    }
    false
}

/// True if the given config TOML text already carries a non-empty
/// `[[inference.providers]]` array (i.e. it is the new shape). Used by startup
/// to decide whether to perform the one-time old → new shape upgrade write.
/// Unparseable input is treated as "not the new shape".
pub fn toml_has_providers(toml_text: &str) -> bool {
    toml_text
        .parse::<toml::Table>()
        .ok()
        .and_then(|table| {
            table
                .get("inference")?
                .as_table()?
                .get("providers")?
                .as_array()
                .map(|a| !a.is_empty())
        })
        .unwrap_or(false)
}

/// Bundle id of the pre-rebrand Thuki app whose Application Support
/// directory Veilura migrates from on first launch. Kept as a literal:
/// it names a product that no longer exists, so it must never track the
/// live bundle id.
pub const LEGACY_BUNDLE_ID: &str = "com.quietnode.thuki";

/// Outcome of [`migrate_legacy_app_support_dir`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LegacyAppSupportMigration {
    /// The new dir already had content; nothing was copied.
    SkippedNewDirNotEmpty,
    /// No legacy dir existed; nothing to do.
    NoLegacyDir,
    /// Copied `files` entries from the legacy dir into the new dir.
    Copied { files: usize },
}

/// One-time Thuki → Veilura Application Support migration.
///
/// On first launch the bundle id changes the Tauri app dir from
/// `~/Library/Application Support/com.quietnode.thuki` to
/// `~/Library/Application Support/com.veilura.app`. Without this, a
/// rebrand upgrade would look like a fresh install: config, history,
/// models, and traces left behind.
///
/// Rules (see REBRAND.md):
/// - Runs only when the new dir is absent or empty; a non-empty new dir
///   wins and nothing is copied (the user may already have Veilura data).
/// - COPY, never move/delete: the old Thuki dir is left untouched so the
///   old app (if still installed) keeps working and the migration is
///   re-runnable.
/// - The database file is renamed in flight: legacy `thuki.db` (plus its
///   `-wal` / `-shm` / `-journal` files) lands as `veilura.db` (+ journals),
///   matching [`crate::database::DB_FILE_NAME`]. Every other entry keeps
///   its name.
/// - Symlinks are skipped, never followed (a link could point anywhere).
/// - Any I/O error aborts with `Err`; the caller logs it and continues
///   startup with fresh state rather than failing launch.
pub fn migrate_legacy_app_support_dir(
    new_dir: &std::path::Path,
    old_dir: &std::path::Path,
) -> std::io::Result<LegacyAppSupportMigration> {
    if new_dir.exists() {
        let mut entries = std::fs::read_dir(new_dir)?;
        if entries.next().is_some() {
            return Ok(LegacyAppSupportMigration::SkippedNewDirNotEmpty);
        }
    }
    if !old_dir.exists() {
        return Ok(LegacyAppSupportMigration::NoLegacyDir);
    }
    std::fs::create_dir_all(new_dir)?;
    let mut copied = 0usize;
    // Explicit stack instead of recursion: directory depth is user data.
    let mut stack: Vec<(std::path::PathBuf, std::path::PathBuf)> =
        vec![(old_dir.to_path_buf(), new_dir.to_path_buf())];
    while let Some((src_dir, dst_dir)) = stack.pop() {
        for entry in std::fs::read_dir(&src_dir)? {
            let entry = entry?;
            let ft = entry.file_type()?;
            if ft.is_symlink() {
                continue;
            }
            let src = entry.path();
            let mut dst_name = entry.file_name().to_string_lossy().into_owned();
            if dst_name == crate::database::LEGACY_DB_FILE_NAME {
                dst_name = crate::database::DB_FILE_NAME.to_string();
            } else if let Some(rest) = dst_name.strip_prefix(crate::database::LEGACY_DB_FILE_NAME) {
                // SQLite sidecar journals: `thuki.db-wal` -> `veilura.db-wal`, etc.
                if rest == "-wal" || rest == "-shm" || rest == "-journal" {
                    dst_name = format!("{}{}", crate::database::DB_FILE_NAME, rest);
                }
            }
            let dst = dst_dir.join(dst_name);
            if ft.is_dir() {
                std::fs::create_dir_all(&dst)?;
                stack.push((src, dst));
            } else if ft.is_file() && !dst.exists() {
                std::fs::copy(&src, &dst)?;
                copied += 1;
            }
        }
    }
    Ok(LegacyAppSupportMigration::Copied { files: copied })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_dir(tag: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("veilura-migrate-{tag}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn legacy_migration_copies_config_and_renames_db() {
        let tmp = tmp_dir("copy");
        let old = tmp.join("old");
        let new = tmp.join("new");
        fs::create_dir_all(old.join("models")).unwrap();
        fs::create_dir_all(old.join("traces")).unwrap();
        fs::write(old.join("config.toml"), b"[updater]\n").unwrap();
        fs::write(old.join("thuki.db"), b"db-bytes").unwrap();
        fs::write(old.join("thuki.db-wal"), b"wal-bytes").unwrap();
        fs::write(old.join("models").join("blob.bin"), b"blob").unwrap();
        fs::write(old.join("traces").join("x.jsonl"), b"{}\n").unwrap();

        let outcome = migrate_legacy_app_support_dir(&new, &old).unwrap();
        assert_eq!(outcome, LegacyAppSupportMigration::Copied { files: 5 });

        // New dir: config + models + traces copied, DB renamed in flight.
        assert_eq!(fs::read(new.join("config.toml")).unwrap(), b"[updater]\n");
        assert_eq!(fs::read(new.join("veilura.db")).unwrap(), b"db-bytes");
        assert_eq!(fs::read(new.join("veilura.db-wal")).unwrap(), b"wal-bytes");
        assert!(!new.join("thuki.db").exists());
        assert_eq!(
            fs::read(new.join("models").join("blob.bin")).unwrap(),
            b"blob"
        );
        assert_eq!(
            fs::read(new.join("traces").join("x.jsonl")).unwrap(),
            b"{}\n"
        );

        // Old dir untouched: COPY, never move/delete.
        assert!(old.join("thuki.db").exists());
        assert_eq!(fs::read(old.join("thuki.db")).unwrap(), b"db-bytes");
        assert!(old.join("config.toml").exists());

        fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn legacy_migration_skips_when_new_dir_not_empty() {
        let tmp = tmp_dir("skip");
        let old = tmp.join("old");
        let new = tmp.join("new");
        fs::create_dir_all(&old).unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(old.join("config.toml"), b"old\n").unwrap();
        fs::write(new.join("config.toml"), b"new\n").unwrap();

        let outcome = migrate_legacy_app_support_dir(&new, &old).unwrap();
        assert_eq!(outcome, LegacyAppSupportMigration::SkippedNewDirNotEmpty);
        assert_eq!(fs::read(new.join("config.toml")).unwrap(), b"new\n");

        fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn legacy_migration_copies_into_empty_new_dir() {
        let tmp = tmp_dir("empty");
        let old = tmp.join("old");
        let new = tmp.join("new");
        fs::create_dir_all(&old).unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(old.join("config.toml"), b"x\n").unwrap();

        let outcome = migrate_legacy_app_support_dir(&new, &old).unwrap();
        assert_eq!(outcome, LegacyAppSupportMigration::Copied { files: 1 });

        fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn legacy_migration_no_op_when_old_missing() {
        let tmp = tmp_dir("missing");
        let old = tmp.join("old");
        let new = tmp.join("new");

        let outcome = migrate_legacy_app_support_dir(&new, &old).unwrap();
        assert_eq!(outcome, LegacyAppSupportMigration::NoLegacyDir);
        assert!(!new.exists());

        fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn legacy_migration_skips_symlinks() {
        let tmp = tmp_dir("symlink");
        let old = tmp.join("old");
        let new = tmp.join("new");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("config.toml"), b"x\n").unwrap();
        std::os::unix::fs::symlink("/etc/passwd", old.join("escape-link")).unwrap();

        let outcome = migrate_legacy_app_support_dir(&new, &old).unwrap();
        assert_eq!(outcome, LegacyAppSupportMigration::Copied { files: 1 });
        assert!(!new.join("escape-link").exists());

        fs::remove_dir_all(&tmp).unwrap();
    }
}
