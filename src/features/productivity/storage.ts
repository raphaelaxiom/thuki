/**
 * localStorage persistence for the productivity features.
 *
 * Keys are namespaced under `veilura:productivity:`. Reads are defensive:
 * corrupt JSON returns the fallback instead of throwing, so one bad value
 * can never break the whole panel.
 */

import type { ProductivityBackup } from './types';

export const STORAGE_PREFIX = 'veilura:productivity:';

export const STORAGE_KEYS = {
  reminders: `${STORAGE_PREFIX}reminders`,
  focusSessions: `${STORAGE_PREFIX}focus-sessions`,
  settings: `${STORAGE_PREFIX}settings`,
  shortcuts: `${STORAGE_PREFIX}shortcuts`,
  auditLog: `${STORAGE_PREFIX}audit-log`,
} as const;

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full / unavailable: the in-memory state still works; the
    // panel surfaces this via `storageWriteFailed` where it matters.
  }
}

export function removeKeys(keys: readonly string[]): void {
  for (const key of keys) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Best effort.
    }
  }
}

/** All productivity localStorage keys, for wipe / export. */
export function productivityKeys(): string[] {
  return Object.values(STORAGE_KEYS);
}

/** Byte size of one stored value (UTF-8), 0 when absent. */
export function storedBytes(key: string): number {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? 0 : new TextEncoder().encode(raw).length;
  } catch {
    return 0;
  }
}

/** Number of items in a stored JSON array, 0 when absent / not an array. */
export function storedItemCount(key: string): number {
  const value: unknown = readJson<unknown>(key, null);
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Builds a full backup document from the current local state. Conversations
 * stay in Veilura's SQLite database (see BackupPanel copy); this covers the
 * productivity data that this feature owns.
 */
export function buildBackup(
  parts: ProductivityBackup['data'],
): ProductivityBackup {
  return {
    version: 1,
    app: 'veilura',
    exportedAt: new Date().toISOString(),
    data: parts,
  };
}

/** Downloads `content` as a file in the browser (no backend needed). */
export function downloadTextFile(
  filename: string,
  content: string,
  mime: string,
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Reads a user-picked file as text (used by Restore). */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsText(file);
  });
}

let idCounter = 0;
/** Collision-resistant-enough ids for local items (no backend needed). */
export function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.floor(
    Math.random() * 1e6,
  ).toString(36)}`;
}
