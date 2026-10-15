/**
 * localStorage persistence for the Models / Input / Output feature set.
 *
 * All helpers are defensive: corrupted JSON, missing keys, or an
 * unavailable `localStorage` (SSR / private mode) resolve to the caller's
 * fallback instead of throwing. Keys are namespaced under
 * `veilura:modelsio:` so they never collide with existing app keys.
 *
 * The backend (SQLite via `models_io.rs`) is the durable store once the
 * parent wires the commands; this frontend store keeps the panels working
 * standalone and survives reloads in the meantime.
 */

import type {
  ClipboardEntry,
  PerModelSettings,
  ReplyVariant,
  TtsSettings,
} from './types';

const PREFIX = 'veilura:modelsio:';

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function loadJson<T>(key: string, fallback: T): T {
  const store = storage();
  if (!store) return fallback;
  try {
    const raw = store.getItem(PREFIX + key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota exceeded / unavailable: persistence is best-effort.
  }
}

/* ─── 1. Favourites ─────────────────────────────────────────────────────── */

export function loadFavourites(): string[] {
  const value = loadJson<unknown>('favourites', []);
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function saveFavourites(favourites: string[]): void {
  saveJson('favourites', favourites);
}

/* ─── 2. Per-model notes ────────────────────────────────────────────────── */

export function loadModelNotes(): Record<string, string> {
  const value = loadJson<unknown>('model-notes', {});
  if (typeof value !== 'object' || value === null) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

export function saveModelNotes(notes: Record<string, string>): void {
  saveJson('model-notes', notes);
}

/* ─── 3. Per-model settings ─────────────────────────────────────────────── */

export function loadPerModelSettings(): Record<string, PerModelSettings> {
  const value = loadJson<unknown>('per-model-settings', {});
  if (typeof value !== 'object' || value === null) return {};
  return value as Record<string, PerModelSettings>;
}

export function savePerModelSettings(settings: Record<string, PerModelSettings>): void {
  saveJson('per-model-settings', settings);
}

/* ─── 7. Clipboard history ─────────────────────────────────────────────── */

export function loadClipboardHistory(): ClipboardEntry[] {
  const value = loadJson<unknown>('clipboard-history', []);
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is ClipboardEntry =>
      typeof v === 'object' && v !== null &&
      typeof (v as ClipboardEntry).text === 'string',
  );
}

export function saveClipboardHistory(entries: ClipboardEntry[]): void {
  saveJson('clipboard-history', entries);
}

/* ─── 15. Reply variants ───────────────────────────────────────────────── */

export function loadVariants(conversationKey: string): ReplyVariant[] {
  const value = loadJson<unknown>(`variants:${conversationKey}`, []);
  return Array.isArray(value) ? (value as ReplyVariant[]) : [];
}

export function saveVariants(conversationKey: string, variants: ReplyVariant[]): void {
  saveJson(`variants:${conversationKey}`, variants);
}

/* ─── 16. Token totals ─────────────────────────────────────────────────── */

export interface TokenTotals {
  totalPromptTokens: number;
  totalCompletionTokens: number;
}

export function loadTokenTotals(): TokenTotals {
  const value = loadJson<unknown>('token-totals', {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
  });
  if (typeof value !== 'object' || value === null) {
    return { totalPromptTokens: 0, totalCompletionTokens: 0 };
  }
  const v = value as Partial<TokenTotals>;
  return {
    totalPromptTokens: typeof v.totalPromptTokens === 'number' ? v.totalPromptTokens : 0,
    totalCompletionTokens:
      typeof v.totalCompletionTokens === 'number' ? v.totalCompletionTokens : 0,
  };
}

export function saveTokenTotals(totals: TokenTotals): void {
  saveJson('token-totals', totals);
}

/* ─── 13. TTS settings ─────────────────────────────────────────────────── */

export function loadTtsSettings(): TtsSettings {
  const value = loadJson<unknown>('tts-settings', {});
  if (typeof value !== 'object' || value === null) {
    return { voice: '', rate: 1, enabled: true };
  }
  const v = value as Partial<TtsSettings>;
  return {
    voice: typeof v.voice === 'string' ? v.voice : '',
    rate: typeof v.rate === 'number' ? v.rate : 1,
    enabled: typeof v.enabled === 'boolean' ? v.enabled : true,
  };
}

export function saveTtsSettings(settings: TtsSettings): void {
  saveJson('tts-settings', settings);
}
