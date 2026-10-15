import { describe, it, expect, beforeEach } from 'vitest';
import {
  addFolder,
  addTag,
  allTags,
  defaultExtState,
  deleteCustomPrompt,
  deleteFolder,
  moveConversationToFolder,
  parseExtState,
  removeTag,
  renameFolder,
  setArchived,
  setPinned,
  setPromptFavourite,
  upsertCustomPrompt,
  type ExtState,
} from './storage';
import type { PromptItem } from './types';

function makePrompt(overrides: Partial<PromptItem> = {}): PromptItem {
  return {
    id: 'p1',
    title: 'Test',
    body: 'Hello {{name}}',
    favourite: false,
    builtin: false,
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  };
}

describe('parseExtState', () => {
  it('returns defaults for null / corrupt / wrong-shaped input', () => {
    expect(parseExtState(null)).toEqual(defaultExtState());
    expect(parseExtState('not json')).toEqual(defaultExtState());
    expect(parseExtState('[]')).toEqual(defaultExtState());
  });

  it('parses a valid stored state and drops malformed entries', () => {
    const state = parseExtState(
      JSON.stringify({
        folders: [{ id: 'f1', name: 'Work', created_at: 1 }, { id: 5 }],
        pinnedIds: ['c1', 42],
        archivedIds: [],
        folderByConversation: { c1: 'f1', c2: 9 },
        tagsByConversation: { c1: ['a', 'b', 3] },
        customPrompts: [makePrompt()],
        favouriteBuiltinIds: ['builtin-summarize'],
      }),
    );
    expect(state.folders).toHaveLength(1);
    expect(state.pinnedIds).toEqual(['c1']);
    expect(state.folderByConversation).toEqual({ c1: 'f1' });
    expect(state.tagsByConversation).toEqual({ c1: ['a', 'b'] });
    expect(state.customPrompts).toHaveLength(1);
    expect(state.favouriteBuiltinIds).toEqual(['builtin-summarize']);
  });
});

describe('folders', () => {
  let state: ExtState;
  beforeEach(() => {
    state = defaultExtState();
  });

  it('adds, rejects blanks and duplicate names (case-insensitive)', () => {
    const added = addFolder(state, '  Work ');
    expect(added.folders).toHaveLength(1);
    expect(added.folders[0]?.name).toBe('Work');
    expect(addFolder(added, 'work')).toBe(added);
    expect(addFolder(added, '   ')).toBe(added);
  });

  it('renames and rejects clashing names', () => {
    const s1 = addFolder(addFolder(state, 'A'), 'B');
    const folderA = s1.folders[0];
    if (!folderA) throw new Error('missing folder');
    expect(renameFolder(s1, folderA.id, 'B')).toBe(s1);
    expect(renameFolder(s1, folderA.id, 'A2').folders[0]?.name).toBe('A2');
  });

  it('deleting a folder unfiles its conversations', () => {
    const s1 = addFolder(state, 'Work');
    const folder = s1.folders[0];
    if (!folder) throw new Error('missing folder');
    const s2 = moveConversationToFolder(s1, 'c1', folder.id);
    const s3 = deleteFolder(s2, folder.id);
    expect(s3.folders).toHaveLength(0);
    expect(s3.folderByConversation['c1']).toBeUndefined();
  });

  it('moving to an unknown folder is a no-op; moving to null unfiles', () => {
    expect(moveConversationToFolder(state, 'c1', 'nope')).toBe(state);
    const s1 = addFolder(state, 'Work');
    const folder = s1.folders[0];
    if (!folder) throw new Error('missing folder');
    const s2 = moveConversationToFolder(s1, 'c1', folder.id);
    expect(s2.folderByConversation['c1']).toBe(folder.id);
    expect(
      moveConversationToFolder(s2, 'c1', null).folderByConversation['c1'],
    ).toBeUndefined();
  });
});

describe('pins / archive / tags', () => {
  it('toggles pins and archive flags idempotently', () => {
    const state = defaultExtState();
    const pinned = setPinned(state, 'c1', true);
    expect(pinned.pinnedIds).toEqual(['c1']);
    expect(setPinned(pinned, 'c1', true).pinnedIds).toEqual(['c1']);
    expect(setPinned(pinned, 'c1', false).pinnedIds).toEqual([]);
    const archived = setArchived(state, 'c1', true);
    expect(archived.archivedIds).toEqual(['c1']);
  });

  it('normalises tags and lists all tags sorted', () => {
    let state = defaultExtState();
    state = addTag(state, 'c1', '  Machine Learning ');
    expect(state.tagsByConversation['c1']).toEqual(['machine-learning']);
    state = addTag(state, 'c1', 'machine-learning');
    expect(state.tagsByConversation['c1']).toEqual(['machine-learning']);
    state = addTag(state, 'c2', 'apple');
    expect(allTags(state)).toEqual(['apple', 'machine-learning']);
    state = removeTag(state, 'c1', 'machine-learning');
    expect(state.tagsByConversation['c1']).toBeUndefined();
    expect(allTags(state)).toEqual(['apple']);
  });
});

describe('custom prompts in storage', () => {
  it('upserts, favourites, and deletes custom prompts', () => {
    let state = defaultExtState();
    state = upsertCustomPrompt(state, makePrompt(), 2000);
    expect(state.customPrompts).toHaveLength(1);
    expect(state.customPrompts[0]?.created_at).toBe(2000);
    state = upsertCustomPrompt(state, makePrompt({ title: 'Updated' }), 3000);
    expect(state.customPrompts).toHaveLength(1);
    expect(state.customPrompts[0]?.title).toBe('Updated');
    state = setPromptFavourite(state, makePrompt({ favourite: false }), true);
    expect(state.customPrompts[0]?.favourite).toBe(true);
    state = deleteCustomPrompt(state, 'p1');
    expect(state.customPrompts).toHaveLength(0);
  });

  it('favourites built-ins via the builtin id list', () => {
    const builtin = makePrompt({ id: 'builtin-x', builtin: true });
    const state = setPromptFavourite(defaultExtState(), builtin, true);
    expect(state.favouriteBuiltinIds).toEqual(['builtin-x']);
    expect(setPromptFavourite(state, builtin, false).favouriteBuiltinIds).toEqual([]);
  });
});
