import { describe, expect, it } from 'vitest';
import {
  defaultShortcuts,
  detectShortcutConflicts,
  normalizeShortcut,
  validateShortcutKeys,
} from '../shortcuts';

describe('normalizeShortcut', () => {
  it('canonicalises order, case, and spacing', () => {
    expect(normalizeShortcut('shift+cmd+k')).toBe('Cmd+Shift+K');
    expect(normalizeShortcut('Cmd + Shift + K')).toBe('Cmd+Shift+K');
    expect(normalizeShortcut('cmdorctrl+shift+k')).toBe('CmdOrCtrl+Shift+K');
    expect(normalizeShortcut('')).toBe('');
    expect(normalizeShortcut('F5')).toBe('F5');
  });
});

describe('detectShortcutConflicts', () => {
  it('finds two actions sharing normalised keys', () => {
    const conflicts = detectShortcutConflicts([
      { id: 'summon', label: 'Summon', keys: 'Cmd+Shift+K' },
      { id: 'quick', label: 'Quick', keys: 'shift+cmd+k' },
      { id: 'other', label: 'Other', keys: 'Cmd+Shift+J' },
    ]);
    expect(conflicts).toEqual([
      { keys: 'Cmd+Shift+K', ids: ['quick', 'summon'] },
    ]);
  });

  it('ignores unbound and unique shortcuts', () => {
    expect(
      detectShortcutConflicts([
        { id: 'a', label: 'A', keys: '' },
        { id: 'b', label: 'B', keys: 'Cmd+K' },
      ]),
    ).toEqual([]);
  });

  it('defaults have no conflicts', () => {
    expect(detectShortcutConflicts(defaultShortcuts())).toEqual([]);
  });
});

describe('validateShortcutKeys', () => {
  it('requires a modifier and exactly one non-modifier key', () => {
    expect(validateShortcutKeys('')).toBe('Shortcut must not be empty.');
    expect(validateShortcutKeys('K')).toContain('modifier');
    expect(validateShortcutKeys('Cmd+Shift')).toContain('non-modifier');
    expect(validateShortcutKeys('Cmd+K+J')).toContain('only one');
    expect(validateShortcutKeys('Cmd+Shift+K')).toBeNull();
  });
});
