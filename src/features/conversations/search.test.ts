import { describe, it, expect } from 'vitest';
import {
  filterByArchived,
  filterByFolder,
  filterByTag,
  normalizeText,
  scoreConversation,
  searchConversations,
  sortConversations,
  tokenizeQuery,
} from './search';
import type { ConversationMeta } from './types';

function meta(overrides: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    id: 'c1',
    title: 'Pasta recipes',
    model: 'm1',
    updated_at: 1000,
    message_count: 2,
    ...overrides,
  };
}

describe('normalizeText / tokenizeQuery', () => {
  it('strips diacritics and lowercases', () => {
    expect(normalizeText('CAFÉ au Lait')).toBe('cafe au lait');
  });

  it('keeps quoted phrases together', () => {
    expect(tokenizeQuery('"machine learning" basics')).toEqual([
      'machine learning',
      'basics',
    ]);
  });
});

describe('scoreConversation', () => {
  it('requires every token to match (AND)', () => {
    const result = scoreConversation(
      meta(),
      [{ role: 'user', content: 'How do I make pasta?' }],
      ['pasta', 'missing'],
    );
    expect(result.score).toBe(0);
  });

  it('weights title matches above body matches', () => {
    const titleHit = scoreConversation(meta(), [], ['pasta']);
    const bodyHit = scoreConversation(
      meta({ title: 'Other' }),
      [{ role: 'user', content: 'pasta please' }],
      ['pasta'],
    );
    expect(titleHit.score).toBeGreaterThan(bodyHit.score);
  });

  it('returns a snippet around the body match', () => {
    const result = scoreConversation(
      meta({ title: 'Other' }),
      [{ role: 'user', content: 'I love talking about pasta and sauce' }],
      ['pasta'],
    );
    expect(result.snippets[0]).toContain('pasta');
  });
});

describe('searchConversations', () => {
  const convs = [
    meta({ id: 'a', title: 'Pasta night', updated_at: 3000 }),
    meta({ id: 'b', title: 'Budget', updated_at: 2000 }),
    meta({ id: 'c', title: 'Other', updated_at: 1000 }),
  ];
  const messages = {
    c: [{ role: 'user', content: 'tell me about pasta' }],
  };

  it('returns all conversations for a blank query', () => {
    expect(searchConversations(convs, {}, '  ')).toHaveLength(3);
  });

  it('matches titles and message bodies', () => {
    const hits = searchConversations(convs, messages, 'pasta');
    expect(hits.map((h) => h.conversation.id)).toEqual(['a', 'c']);
  });

  it('returns nothing when nothing matches', () => {
    expect(searchConversations(convs, messages, 'zzz')).toHaveLength(0);
  });
});

describe('filters and sort', () => {
  const convs = [
    meta({
      id: 'a',
      pinned: true,
      updated_at: 1000,
      folder_id: 'f1',
      tags: ['x'],
    }),
    meta({
      id: 'b',
      pinned: false,
      updated_at: 3000,
      folder_id: null,
      archived: true,
    }),
    meta({ id: 'c', pinned: false, updated_at: 2000, folder_id: 'f1' }),
  ];

  it('sorts pinned first then by recency', () => {
    expect(sortConversations(convs).map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('filters by folder / tag / archived', () => {
    expect(filterByFolder(convs, 'f1').map((c) => c.id)).toEqual(['a', 'c']);
    expect(filterByFolder(convs, 'unfiled').map((c) => c.id)).toEqual(['b']);
    expect(filterByTag(convs, 'x').map((c) => c.id)).toEqual(['a']);
    expect(filterByArchived(convs, true).map((c) => c.id)).toEqual(['b']);
    expect(filterByArchived(convs, false).map((c) => c.id)).toEqual(['a', 'c']);
  });
});
