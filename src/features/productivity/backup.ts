/**
 * Backup export / restore: schema validation + apply.
 *
 * Mirrors the Rust `validate_backup_json` in
 * `src-tauri/src/productivity.rs`. Restore never overwrites without
 * confirmation: the panel shows a diff summary and requires an explicit
 * "Replace current data" confirmation before `applyBackup` runs.
 */

import type { ProductivityBackup } from './types';
import { buildBackup } from './storage';

export interface BackupValidation {
  valid: boolean;
  errors: string[];
  version: number | null;
  counts: {
    reminders: number;
    focusSessions: number;
    shortcuts: number;
    auditEntries: number;
  };
}

function invalid(errors: string[], version: number | null): BackupValidation {
  return {
    valid: false,
    errors,
    version,
    counts: { reminders: 0, focusSessions: 0, shortcuts: 0, auditEntries: 0 },
  };
}

/** Validates parsed backup JSON. Accepts `unknown` so malformed files fail cleanly. */
export function validateBackup(value: unknown): BackupValidation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(['Backup must be a JSON object.'], null);
  }
  const obj = value as Record<string, unknown>;
  const errors: string[] = [];
  const version = typeof obj.version === 'number' ? obj.version : null;
  if (version !== 1)
    errors.push(
      `Unsupported backup version: ${String(obj.version)} (expected 1).`,
    );
  if (obj.app !== 'veilura')
    errors.push(`Wrong backup app: ${String(obj.app)} (expected "veilura").`);
  if (typeof obj.exportedAt !== 'string')
    errors.push('Missing backup `exportedAt` timestamp.');
  if (
    typeof obj.data !== 'object' ||
    obj.data === null ||
    Array.isArray(obj.data)
  ) {
    errors.push('Missing backup `data` object.');
    return invalid(errors, version);
  }
  const data = obj.data as Record<string, unknown>;
  const countArray = (key: string): number => {
    const arr = data[key];
    if (arr === undefined) return 0;
    if (!Array.isArray(arr)) {
      errors.push(`Backup \`data.${key}\` must be an array.`);
      return 0;
    }
    return arr.length;
  };
  const reminders = countArray('reminders');
  const focusSessions = countArray('focusSessions');
  const shortcuts = countArray('shortcuts');
  const auditEntries = countArray('auditLog');
  if (
    data.settings !== undefined &&
    (typeof data.settings !== 'object' || data.settings === null)
  ) {
    errors.push('Backup `data.settings` must be an object.');
  }
  const reminderArr = data.reminders;
  if (Array.isArray(reminderArr)) {
    for (let i = 0; i < reminderArr.length; i += 1) {
      const item = reminderArr[i] as Record<string, unknown> | null;
      if (
        typeof item !== 'object' ||
        item === null ||
        typeof item.id !== 'string' ||
        typeof item.title !== 'string'
      ) {
        errors.push(`Backup reminder #${i} is missing \`id\` or \`title\`.`);
        break;
      }
    }
  }
  if (errors.length > 0) return invalid(errors, version);
  return {
    valid: true,
    errors: [],
    version,
    counts: { reminders, focusSessions, shortcuts, auditEntries },
  };
}

/** Parses backup JSON text, validating the schema. Throws on bad JSON. */
export function parseBackup(jsonText: string): {
  backup: ProductivityBackup;
  validation: BackupValidation;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText) as unknown;
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const validation = validateBackup(parsed);
  if (!validation.valid) {
    throw new Error(`Invalid backup: ${validation.errors.join(' ')}`);
  }
  return { backup: parsed as ProductivityBackup, validation };
}

export interface BackupDiff {
  current: {
    reminders: number;
    focusSessions: number;
    shortcuts: number;
    auditEntries: number;
  };
  incoming: {
    reminders: number;
    focusSessions: number;
    shortcuts: number;
    auditEntries: number;
  };
  /** True when the incoming file would replace any non-empty current data. */
  replacesData: boolean;
}

export function diffBackup(
  current: ProductivityBackup['data'],
  incoming: ProductivityBackup,
): BackupDiff {
  const currentCounts = {
    reminders: current.reminders.length,
    focusSessions: current.focusSessions.length,
    shortcuts: current.shortcuts.length,
    auditEntries: current.auditLog.length,
  };
  const incomingCounts = {
    reminders: incoming.data.reminders.length,
    focusSessions: incoming.data.focusSessions.length,
    shortcuts: incoming.data.shortcuts.length,
    auditEntries: incoming.data.auditLog.length,
  };
  return {
    current: currentCounts,
    incoming: incomingCounts,
    replacesData: Object.values(currentCounts).some((n) => n > 0),
  };
}

/** Serialises the current state as a backup file (export). */
export function exportBackupFile(data: ProductivityBackup['data']): {
  filename: string;
  content: string;
} {
  const backup = buildBackup(data);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    filename: `veilura-backup-${stamp}.json`,
    content: JSON.stringify(backup, null, 2),
  };
}
