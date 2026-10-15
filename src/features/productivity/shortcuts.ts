/**
 * Keyboard shortcuts: defaults, normalisation, conflict detection, persistence.
 *
 * Mirrors the Rust `normalize_shortcut` / `detect_shortcut_conflicts` in
 * `src-tauri/src/productivity.rs` so the editor and the backend agree.
 */

import type { ShortcutBinding } from './types';
import { readJson, STORAGE_KEYS, writeJson } from './storage';

export interface ShortcutConflict {
  keys: string;
  ids: string[];
}

/** The full default set. `summon` is the overlay hotkey. */
export function defaultShortcuts(): ShortcutBinding[] {
  return [
    { id: 'summon', label: 'Summon Veilura overlay', keys: 'Ctrl+Ctrl' },
    { id: 'new_chat', label: 'New chat', keys: 'CmdOrCtrl+Shift+N' },
    {
      id: 'quick_summarise',
      label: 'Quick action: Summarise selection',
      keys: 'CmdOrCtrl+Shift+S',
    },
    {
      id: 'quick_rewrite',
      label: 'Quick action: Rewrite selection',
      keys: 'CmdOrCtrl+Shift+R',
    },
    {
      id: 'quick_translate',
      label: 'Quick action: Translate selection',
      keys: 'CmdOrCtrl+Shift+T',
    },
    {
      id: 'quick_explain',
      label: 'Quick action: Explain selection',
      keys: 'CmdOrCtrl+Shift+E',
    },
    {
      id: 'focus_start',
      label: 'Start / pause focus timer',
      keys: 'CmdOrCtrl+Shift+F',
    },
    {
      id: 'toggle_theme',
      label: 'Toggle light / dark theme',
      keys: 'CmdOrCtrl+Shift+L',
    },
  ];
}

/**
 * Canonical modifier order. `Cmd` on macOS is the Command key; `Meta`,
 * `Super`, `Win` collapse to it. `CmdOrCtrl` is the cross-platform form.
 */
const MODIFIER_RANK: Record<string, number> = {
  CmdOrCtrl: 0,
  Ctrl: 1,
  Cmd: 2,
  Meta: 3,
  Alt: 4,
  Shift: 5,
};

function canonicalModifier(part: string): string | null {
  switch (part.toLowerCase()) {
    case 'cmdorctrl':
    case 'ctrlcmd':
    case 'cmdctrl':
      return 'CmdOrCtrl';
    case 'ctrl':
    case 'control':
      return 'Ctrl';
    case 'cmd':
    case 'command':
    case 'meta':
    case 'super':
    case 'win':
      return 'Cmd';
    case 'alt':
    case 'option':
      return 'Alt';
    case 'shift':
      return 'Shift';
    default:
      return null;
  }
}

/**
 * Normalises a shortcut so `shift+cmd+k`, `Cmd+Shift+K` and
 * `Cmd + Shift + K` compare equal. Empty input normalises to `""`.
 */
export function normalizeShortcut(keys: string): string {
  const modifiers: string[] = [];
  const keyParts: string[] = [];
  for (const raw of keys.split('+')) {
    const part = raw.trim();
    if (part === '') continue;
    const modifier = canonicalModifier(part);
    if (modifier !== null) {
      if (!modifiers.includes(modifier)) modifiers.push(modifier);
    } else {
      const key = part.charAt(0).toUpperCase() + part.slice(1);
      if (!keyParts.includes(key)) keyParts.push(key);
    }
  }
  modifiers.sort((a, b) => (MODIFIER_RANK[a] ?? 99) - (MODIFIER_RANK[b] ?? 99));
  return [...modifiers, ...keyParts].join('+');
}

/** Every group of 2+ actions sharing normalised keys is a conflict. */
export function detectShortcutConflicts(
  bindings: ShortcutBinding[],
): ShortcutConflict[] {
  const groups = new Map<string, string[]>();
  for (const binding of bindings) {
    const keys = normalizeShortcut(binding.keys);
    if (keys === '') continue;
    const ids = groups.get(keys) ?? [];
    if (!ids.includes(binding.id)) ids.push(binding.id);
    groups.set(keys, ids);
  }
  const conflicts: ShortcutConflict[] = [];
  for (const [keys, ids] of groups) {
    if (ids.length > 1) conflicts.push({ keys, ids: [...ids].sort() });
  }
  return conflicts;
}

/**
 * Validates one binding's keys: must have a non-modifier key, at most one
 * non-modifier key, and at least one modifier (a bare letter would hijack
 * typing). Returns an error message or null when valid.
 */
export function validateShortcutKeys(keys: string): string | null {
  const parts = keys
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return 'Shortcut must not be empty.';
  const nonModifiers = parts.filter((p) => canonicalModifier(p) === null);
  if (nonModifiers.length === 0)
    return 'Shortcut needs a non-modifier key (e.g. K).';
  if (nonModifiers.length > 1)
    return 'Shortcut can have only one non-modifier key.';
  const modifiers = parts.filter((p) => canonicalModifier(p) !== null);
  if (modifiers.length === 0)
    return 'Shortcut needs at least one modifier (Cmd, Ctrl, Alt, Shift).';
  return null;
}

export function loadShortcuts(): ShortcutBinding[] {
  const stored = readJson<ShortcutBinding[]>(STORAGE_KEYS.shortcuts, []);
  if (Array.isArray(stored) && stored.length > 0) return stored;
  return defaultShortcuts();
}

export function saveShortcuts(bindings: ShortcutBinding[]): void {
  writeJson(STORAGE_KEYS.shortcuts, bindings);
}

export function resetShortcuts(): ShortcutBinding[] {
  const defaults = defaultShortcuts();
  saveShortcuts(defaults);
  return defaults;
}
