/**
 * Full-text conversation search + list filters.
 *
 * Search covers titles AND message bodies. Matching is token-based and
 * case/diacritic-insensitive: every query token must appear somewhere in
 * the title or in any message. Results are ranked by a simple transparent
 * score (title matches weigh more than body matches, earlier messages
 * weigh slightly more), then by recency. No index is maintained — the
 * conversation list is small and this runs on each keystroke over
 * in-memory data; the Rust side (`conv_ext_search`) does the equivalent
 * with SQL LIKE for the persisted path.
 */

import type { ChatMessageLike, ConversationMeta } from './types';

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Splits a query on whitespace; quoted phrases stay together. */
export function tokenizeQuery(query: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(query)) !== null) {
    const token = normalizeText((match[1] ?? match[2] ?? '').trim());
    if (token) tokens.push(token);
  }
  return tokens;
}

export interface SearchHit {
  readonly conversation: ConversationMeta;
  /** 0 when the conversation does not match the query. */
  readonly score: number;
  /** Short excerpts around the first body match per matched token. */
  readonly snippets: readonly string[];
}

const SNIPPET_RADIUS = 40;

function snippetFor(content: string, token: string): string | null {
  const hay = normalizeText(content);
  const idx = hay.indexOf(token);
  if (idx < 0) return null;
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(content.length, idx + token.length + SNIPPET_RADIUS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < content.length ? '…' : '';
  return `${prefix}${content.slice(start, end).replace(/\s+/g, ' ')}${suffix}`;
}

/**
 * Scores one conversation against the query tokens. Returns 0 on no match.
 * Title token hit = 10, body token hit = 3 (+1 if in the first message).
 * All tokens must match somewhere (AND semantics).
 */
export function scoreConversation(
  conversation: ConversationMeta,
  messages: readonly ChatMessageLike[],
  tokens: readonly string[],
): { score: number; snippets: string[] } {
  if (tokens.length === 0) return { score: 0, snippets: [] };
  const title = normalizeText(conversation.title ?? '');
  const bodies = messages.map((m) => normalizeText(m.content));
  let score = 0;
  const snippets: string[] = [];
  for (const token of tokens) {
    let matched = false;
    if (title.includes(token)) {
      score += 10;
      matched = true;
    }
    for (let i = 0; i < bodies.length; i += 1) {
      if (bodies[i]?.includes(token)) {
        score += i === 0 ? 4 : 3;
        matched = true;
        const snippet = snippetFor(messages[i]?.content ?? '', token);
        if (snippet) snippets.push(snippet);
        break;
      }
    }
    if (!matched) return { score: 0, snippets: [] };
  }
  return { score, snippets };
}

/**
 * Searches conversations. An empty/blank query returns every conversation
 * (score 0, unsorted beyond the caller's order) so the panel can reuse this
 * for both the search and the plain list.
 */
export function searchConversations(
  conversations: readonly ConversationMeta[],
  messagesById: Readonly<Record<string, readonly ChatMessageLike[]>>,
  query: string,
): SearchHit[] {
  const tokens = tokenizeQuery(query);
  const hits: SearchHit[] = conversations.map((conversation) => {
    if (tokens.length === 0) {
      return { conversation, score: 0, snippets: [] };
    }
    const { score, snippets } = scoreConversation(
      conversation,
      messagesById[conversation.id] ?? [],
      tokens,
    );
    return { conversation, score, snippets };
  });
  const filtered = tokens.length === 0 ? hits : hits.filter((h) => h.score > 0);
  filtered.sort(
    (a, b) =>
      b.score - a.score ||
      b.conversation.updated_at - a.conversation.updated_at,
  );
  return filtered;
}

/** Pinned conversations first, then by recency. Stable for equal keys. */
export function sortConversations(
  conversations: readonly ConversationMeta[],
): ConversationMeta[] {
  return [...conversations].sort((a, b) => {
    const pinDiff = Number(b.pinned ?? false) - Number(a.pinned ?? false);
    if (pinDiff !== 0) return pinDiff;
    return b.updated_at - a.updated_at;
  });
}

export function filterByFolder(
  conversations: readonly ConversationMeta[],
  folderId: string | 'all' | 'unfiled',
): ConversationMeta[] {
  if (folderId === 'all') return [...conversations];
  if (folderId === 'unfiled') {
    return conversations.filter((c) => !c.folder_id);
  }
  return conversations.filter((c) => c.folder_id === folderId);
}

export function filterByTag(
  conversations: readonly ConversationMeta[],
  tag: string | null,
): ConversationMeta[] {
  if (!tag) return [...conversations];
  return conversations.filter((c) => c.tags?.includes(tag));
}

export function filterByArchived(
  conversations: readonly ConversationMeta[],
  showArchived: boolean,
): ConversationMeta[] {
  return conversations.filter((c) => (c.archived ?? false) === showArchived);
}
