/**
 * Data management: storage breakdown + destructive deletes.
 *
 * Breakdown covers the productivity localStorage keys plus, when the
 * Tauri commands are available, the backend conversation history
 * (`history_stats`) and installed models (`list_installed_models`). Deletes
 * go through the existing backend commands (`clear_all_conversations`,
 * `delete_installed_model`) so files and rows stay consistent; the local
 * keys are cleared alongside.
 */

import { invoke } from '@tauri-apps/api/core';
import type { StorageBreakdownEntry } from './types';
import {
  productivityKeys,
  removeKeys,
  STORAGE_KEYS,
  storedBytes,
  storedItemCount,
} from './storage';

const KEY_LABELS: Record<string, string> = {
  [STORAGE_KEYS.reminders]: 'Reminders',
  [STORAGE_KEYS.focusSessions]: 'Focus sessions',
  [STORAGE_KEYS.settings]: 'Productivity settings',
  [STORAGE_KEYS.shortcuts]: 'Keyboard shortcuts',
  [STORAGE_KEYS.auditLog]: 'Audit log',
};

export interface BackendStorageInfo {
  conversations: { count: number; bytes: number } | null;
  models: { id: string; bytes: number }[];
  /** Non-null when a backend probe failed; breakdown still shows local data. */
  error: string | null;
}

interface HistoryStatsShape {
  count: number;
  bytes: number;
}

interface InstalledModelShape {
  id?: string;
  model_id?: string;
  name?: string;
  size_bytes?: number;
  sizeBytes?: number;
}

/** Measures the local productivity storage. Always works, even offline. */
export function localStorageBreakdown(): StorageBreakdownEntry[] {
  return productivityKeys().map((key) => ({
    key,
    label: KEY_LABELS[key] ?? key,
    bytes: storedBytes(key),
    items: storedItemCount(key),
  }));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Probes backend storage. Never throws: failures become `error`. */
export async function probeBackendStorage(): Promise<BackendStorageInfo> {
  let conversations: BackendStorageInfo['conversations'] = null;
  let models: BackendStorageInfo['models'] = [];
  let error: string | null = null;
  try {
    const stats = await invoke<HistoryStatsShape>('history_stats');
    conversations = { count: stats.count, bytes: stats.bytes };
  } catch {
    error = 'Conversation storage is unavailable (backend not connected).';
  }
  try {
    const installed = await invoke<InstalledModelShape[]>(
      'list_installed_models',
    );
    models = (Array.isArray(installed) ? installed : []).map((m) => ({
      id: m.id ?? m.model_id ?? m.name ?? 'unknown model',
      bytes: m.size_bytes ?? m.sizeBytes ?? 0,
    }));
  } catch {
    error = (error ?? '') + ' Model list is unavailable.';
  }
  return { conversations, models, error: error?.trim() || null };
}

/** Deletes ALL conversations via the backend command + clears local keys. */
export async function deleteAllConversations(): Promise<void> {
  await invoke('clear_all_conversations');
  removeKeys(productivityKeys());
}

/** Deletes ALL installed models, one backend call per model. Returns failures. */
export async function deleteAllModels(modelIds: string[]): Promise<string[]> {
  const failures: string[] = [];
  for (const id of modelIds) {
    try {
      await invoke('delete_installed_model', { modelId: id });
    } catch {
      failures.push(id);
    }
  }
  return failures;
}

/** Clears only the local productivity keys (reminders, focus, settings, …). */
export function clearLocalProductivityData(): void {
  removeKeys(productivityKeys());
}

/** Exports everything this feature owns as one JSON document. */
export function exportAllData(parts: {
  reminders: unknown;
  focusSessions: unknown;
  settings: unknown;
  shortcuts: unknown;
  auditLog: unknown;
  conversationStats: unknown;
}): string {
  return JSON.stringify(
    {
      version: 1,
      app: 'veilura',
      exportedAt: new Date().toISOString(),
      data: {
        reminders: parts.reminders,
        focusSessions: parts.focusSessions,
        settings: parts.settings,
        shortcuts: parts.shortcuts,
        auditLog: parts.auditLog,
        conversationStats: parts.conversationStats,
      },
    },
    null,
    2,
  );
}
