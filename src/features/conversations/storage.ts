/**
 * Local persistence for conversation organisation + prompt library.
 *
 * Until the parent wires `conversations_ext.rs` into the Tauri invoke
 * handler, the panels persist folders / pins / archive flags / tags /
 * custom prompts in localStorage under a single versioned key. The state
 * shape mirrors the SQLite tables in `conversations_ext.rs` so the parent
 * can migrate it 1:1 (see INTEGRATION-conversations.md).
 *
 * All updaters are pure functions over `ExtState` (easy to unit-test);
 * `loadExtState` / `saveExtState` are the only functions that touch
 * localStorage, and both tolerate missing / corrupt data by falling back
 * to the default state.
 */

import type { ConversationFolder, PromptItem } from './types';

export const EXT_STORAGE_KEY = 'veilura.conversations.ext.v1';

export interface ExtState {
  readonly folders: readonly ConversationFolder[];
  /** conversation id -> folder id (absent = unfiled). */
  readonly folderByConversation: Readonly<Record<string, string>>;
  /** conversation id -> tags. */
  readonly tagsByConversation: Readonly<Record<string, readonly string[]>>;
  readonly pinnedIds: readonly string[];
  readonly archivedIds: readonly string[];
  /** Custom (non-built-in) prompts only; built-ins live in prompts.ts. */
  readonly customPrompts: readonly PromptItem[];
  /** Ids of built-in prompts the user favourited. */
  readonly favouriteBuiltinIds: readonly string[];
}

export function defaultExtState(): ExtState {
  return {
    folders: [],
    folderByConversation: {},
    tagsByConversation: {},
    pinnedIds: [],
    archivedIds: [],
    customPrompts: [],
    favouriteBuiltinIds: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/** Parses stored JSON defensively; returns the default state on any defect. */
export function parseExtState(raw: string | null): ExtState {
  if (!raw) return defaultExtState();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return defaultExtState();
  }
  if (!isRecord(parsed)) return defaultExtState();
  const foldersRaw = Array.isArray(parsed.folders) ? parsed.folders : [];
  const folders: ConversationFolder[] = [];
  for (const f of foldersRaw) {
    if (
      isRecord(f) &&
      typeof f.id === 'string' &&
      typeof f.name === 'string' &&
      typeof f.created_at === 'number'
    ) {
      folders.push({ id: f.id, name: f.name, created_at: f.created_at });
    }
  }
  const folderByConversation: Record<string, string> = {};
  if (isRecord(parsed.folderByConversation)) {
    for (const [k, v] of Object.entries(parsed.folderByConversation)) {
      if (typeof v === 'string') folderByConversation[k] = v;
    }
  }
  const tagsByConversation: Record<string, readonly string[]> = {};
  if (isRecord(parsed.tagsByConversation)) {
    for (const [k, v] of Object.entries(parsed.tagsByConversation)) {
      tagsByConversation[k] = asStringArray(v);
    }
  }
  const customPrompts: PromptItem[] = [];
  if (Array.isArray(parsed.customPrompts)) {
    for (const p of parsed.customPrompts) {
      if (
        isRecord(p) &&
        typeof p.id === 'string' &&
        typeof p.title === 'string' &&
        typeof p.body === 'string' &&
        typeof p.created_at === 'number' &&
        typeof p.updated_at === 'number'
      ) {
        customPrompts.push({
          id: p.id,
          title: p.title,
          body: p.body,
          favourite: p.favourite === true,
          builtin: false,
          created_at: p.created_at,
          updated_at: p.updated_at,
        });
      }
    }
  }
  return {
    folders,
    folderByConversation,
    tagsByConversation,
    pinnedIds: asStringArray(parsed.pinnedIds),
    archivedIds: asStringArray(parsed.archivedIds),
    customPrompts,
    favouriteBuiltinIds: asStringArray(parsed.favouriteBuiltinIds),
  };
}

export function loadExtState(): ExtState {
  try {
    return parseExtState(window.localStorage.getItem(EXT_STORAGE_KEY));
  } catch {
    return defaultExtState();
  }
}

export function saveExtState(state: ExtState): void {
  try {
    window.localStorage.setItem(EXT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full / unavailable: organisation state is best-effort.
  }
}

export function newId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const MAX_FOLDER_NAME = 80;
const MAX_TAG_LENGTH = 40;

/** Normalises a tag: trimmed, lowercased, no whitespace runs. */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '-').slice(0, MAX_TAG_LENGTH);
}

function without<T>(list: readonly T[], value: T): T[] {
  return list.filter((v) => v !== value);
}

// ─── Folders ────────────────────────────────────────────────────────────────

export function addFolder(
  state: ExtState,
  name: string,
  now = Date.now(),
): ExtState {
  const clean = name.trim().slice(0, MAX_FOLDER_NAME);
  if (!clean) return state;
  if (
    state.folders.some((f) => f.name.toLowerCase() === clean.toLowerCase())
  ) {
    return state;
  }
  return {
    ...state,
    folders: [
      ...state.folders,
      { id: newId(), name: clean, created_at: now },
    ],
  };
}

export function renameFolder(
  state: ExtState,
  folderId: string,
  name: string,
): ExtState {
  const clean = name.trim().slice(0, MAX_FOLDER_NAME);
  if (!clean) return state;
  if (
    state.folders.some(
      (f) =>
        f.id !== folderId && f.name.toLowerCase() === clean.toLowerCase(),
    )
  ) {
    return state;
  }
  return {
    ...state,
    folders: state.folders.map((f) =>
      f.id === folderId ? { ...f, name: clean } : f,
    ),
  };
}

/** Deletes the folder; conversations filed in it become unfiled. */
export function deleteFolder(state: ExtState, folderId: string): ExtState {
  const folderByConversation: Record<string, string> = {};
  for (const [convId, fid] of Object.entries(state.folderByConversation)) {
    if (fid !== folderId) folderByConversation[convId] = fid;
  }
  return {
    ...state,
    folders: state.folders.filter((f) => f.id !== folderId),
    folderByConversation,
  };
}

export function moveConversationToFolder(
  state: ExtState,
  conversationId: string,
  folderId: string | null,
): ExtState {
  const folderByConversation = { ...state.folderByConversation };
  if (folderId === null) {
    delete folderByConversation[conversationId];
  } else {
    if (!state.folders.some((f) => f.id === folderId)) return state;
    folderByConversation[conversationId] = folderId;
  }
  return { ...state, folderByConversation };
}

// ─── Pins / archive ─────────────────────────────────────────────────────────

export function setPinned(
  state: ExtState,
  conversationId: string,
  pinned: boolean,
): ExtState {
  return {
    ...state,
    pinnedIds: pinned
      ? state.pinnedIds.includes(conversationId)
        ? state.pinnedIds
        : [...state.pinnedIds, conversationId]
      : without(state.pinnedIds, conversationId),
  };
}

export function setArchived(
  state: ExtState,
  conversationId: string,
  archived: boolean,
): ExtState {
  return {
    ...state,
    archivedIds: archived
      ? state.archivedIds.includes(conversationId)
        ? state.archivedIds
        : [...state.archivedIds, conversationId]
      : without(state.archivedIds, conversationId),
  };
}

// ─── Tags ───────────────────────────────────────────────────────────────────

export function addTag(
  state: ExtState,
  conversationId: string,
  rawTag: string,
): ExtState {
  const tag = normalizeTag(rawTag);
  if (!tag) return state;
  const existing = state.tagsByConversation[conversationId] ?? [];
  if (existing.includes(tag)) return state;
  return {
    ...state,
    tagsByConversation: {
      ...state.tagsByConversation,
      [conversationId]: [...existing, tag],
    },
  };
}

export function removeTag(
  state: ExtState,
  conversationId: string,
  tag: string,
): ExtState {
  const existing = state.tagsByConversation[conversationId] ?? [];
  const next = without(existing, tag);
  const tagsByConversation = { ...state.tagsByConversation };
  if (next.length === 0) delete tagsByConversation[conversationId];
  else tagsByConversation[conversationId] = next;
  return { ...state, tagsByConversation };
}

/** Every distinct tag in use, sorted alphabetically. */
export function allTags(state: ExtState): string[] {
  const set = new Set<string>();
  for (const tags of Object.values(state.tagsByConversation)) {
    for (const t of tags) set.add(t);
  }
  return [...set].sort();
}

// ─── Custom prompts ─────────────────────────────────────────────────────────

export function upsertCustomPrompt(
  state: ExtState,
  prompt: PromptItem,
  now = Date.now(),
): ExtState {
  const clean: PromptItem = {
    ...prompt,
    builtin: false,
    updated_at: now,
  };
  const exists = state.customPrompts.some((p) => p.id === prompt.id);
  return {
    ...state,
    customPrompts: exists
      ? state.customPrompts.map((p) => (p.id === prompt.id ? clean : p))
      : [...state.customPrompts, { ...clean, created_at: now }],
  };
}

export function deleteCustomPrompt(state: ExtState, promptId: string): ExtState {
  return {
    ...state,
    customPrompts: state.customPrompts.filter((p) => p.id !== promptId),
  };
}

export function setPromptFavourite(
  state: ExtState,
  prompt: PromptItem,
  favourite: boolean,
): ExtState {
  if (prompt.builtin) {
    return {
      ...state,
      favouriteBuiltinIds: favourite
        ? state.favouriteBuiltinIds.includes(prompt.id)
          ? state.favouriteBuiltinIds
          : [...state.favouriteBuiltinIds, prompt.id]
        : without(state.favouriteBuiltinIds, prompt.id),
    };
  }
  return {
    ...state,
    customPrompts: state.customPrompts.map((p) =>
      p.id === prompt.id ? { ...p, favourite } : p,
    ),
  };
}
