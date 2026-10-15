/** Backup export + restore (with validation and confirmation). */
import { useState } from 'react';
import { appendAuditEntry } from '../audit';
import {
  diffBackup,
  exportBackupFile,
  parseBackup,
  type BackupValidation,
} from '../backup';
import { applyAppearance, loadSettings, saveSettings } from '../settings';
import {
  downloadTextFile,
  readFileAsText,
  readJson,
  STORAGE_KEYS,
  writeJson,
} from '../storage';
import type { ProductivityBackup } from '../types';
import {
  buttonStyle,
  cardStyle,
  dangerButtonStyle,
  Panel,
  rowStyle,
  statusStyle,
} from './Panel';

export function BackupPanel() {
  const [incoming, setIncoming] = useState<ProductivityBackup | null>(null);
  const [validation, setValidation] = useState<BackupValidation | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const currentData = (): ProductivityBackup['data'] => ({
    reminders: readJson(STORAGE_KEYS.reminders, []),
    focusSessions: readJson(STORAGE_KEYS.focusSessions, []),
    settings: loadSettings(),
    shortcuts: readJson(STORAGE_KEYS.shortcuts, []),
    auditLog: readJson(STORAGE_KEYS.auditLog, []),
  });

  const exportBackup = () => {
    const { filename, content } = exportBackupFile(currentData());
    downloadTextFile(filename, content, 'application/json');
    appendAuditEntry('backup', `Exported backup ${filename}`);
    setStatus(`Backup exported: ${filename}`);
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setStatus(null);
    setConfirmed(false);
    try {
      const text = await readFileAsText(file);
      const { backup, validation: v } = parseBackup(text);
      setIncoming(backup);
      setValidation(v);
    } catch (err) {
      setIncoming(null);
      setValidation(null);
      setStatus(
        err instanceof Error ? err.message : 'Could not read that backup file.',
      );
    }
  };

  const restore = () => {
    if (!incoming) return;
    if (!confirmed) {
      setStatus(
        'Tick the confirmation box first — restore replaces current data.',
      );
      return;
    }
    // Restore is all-or-nothing over the local keys: write every section,
    // then re-apply appearance so theme/font/density take effect at once.
    writeJson(STORAGE_KEYS.reminders, incoming.data.reminders);
    writeJson(STORAGE_KEYS.focusSessions, incoming.data.focusSessions);
    writeJson(STORAGE_KEYS.shortcuts, incoming.data.shortcuts);
    writeJson(STORAGE_KEYS.auditLog, incoming.data.auditLog);
    const settings = {
      ...loadSettings(),
      ...incoming.data.settings,
      privacy: {
        ...loadSettings().privacy,
        ...(incoming.data.settings.privacy ?? {}),
        telemetry: false as const,
      },
    };
    saveSettings(settings);
    applyAppearance(settings);
    appendAuditEntry(
      'restore',
      `Restored backup exported at ${incoming.exportedAt}`,
    );
    setStatus(
      'Backup restored. Conversations were untouched (they live in the database).',
    );
    setIncoming(null);
    setValidation(null);
    setConfirmed(false);
  };

  const diff = incoming ? diffBackup(currentData(), incoming) : null;

  return (
    <Panel
      title="Backup & restore"
      description="Export a full backup file, or restore one. Restore validates the file first and never overwrites without your explicit confirmation."
    >
      <div style={rowStyle}>
        <button style={buttonStyle} onClick={exportBackup}>
          Export full backup
        </button>
      </div>
      <div style={cardStyle}>
        <strong>Restore from a backup file</strong>
        <input
          type="file"
          accept="application/json,.json"
          aria-label="Backup file"
          onChange={(e) => void pickFile(e.target.files?.[0])}
        />
        {validation ? (
          <p style={statusStyle}>
            Valid backup (version {validation.version}) — reminders:{' '}
            {validation.counts.reminders}, focus sessions:{' '}
            {validation.counts.focusSessions}, shortcuts:{' '}
            {validation.counts.shortcuts}, audit entries:{' '}
            {validation.counts.auditEntries}.
          </p>
        ) : null}
        {diff ? (
          <p style={statusStyle}>
            Current data — reminders: {diff.current.reminders}, focus sessions:{' '}
            {diff.current.focusSessions}, shortcuts: {diff.current.shortcuts},
            audit entries: {diff.current.auditEntries}.{' '}
            {diff.replacesData
              ? 'Restore will REPLACE this data.'
              : 'No current data to replace.'}
          </p>
        ) : null}
        <p style={statusStyle}>
          Conversations are not in this backup file — they stay in
          Veilura&apos;s database and are never touched by restore.
        </p>
        <label style={rowStyle}>
          <input
            type="checkbox"
            checked={confirmed}
            disabled={!incoming}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span style={statusStyle}>
            I understand restore replaces my current productivity data.
          </span>
        </label>
        <span style={rowStyle}>
          <button
            style={dangerButtonStyle}
            disabled={!incoming}
            onClick={restore}
          >
            Restore backup
          </button>
        </span>
      </div>
      {status ? <p style={statusStyle}>{status}</p> : null}
    </Panel>
  );
}
