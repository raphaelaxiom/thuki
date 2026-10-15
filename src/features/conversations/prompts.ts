/**
 * Prompt library: built-in prompts, `{{variable}}` templates, favourites.
 *
 * Built-ins are constants (never persisted). Custom prompts live in the
 * `ExtState` store (storage.ts) and are mirrored by the `prompts` table in
 * `conversations_ext.rs` once the parent wires the backend.
 *
 * Template syntax is exactly `{{name}}` — letters, digits, underscores,
 * spaces trimmed. `fillTemplate` replaces only variables present in
 * `values`; anything unfilled stays literally in the text so the caller
 * can surface it via `missingVariables` instead of silently sending a
 * half-filled prompt.
 */

import type { PromptItem } from './types';

export const BUILTIN_PROMPTS: readonly PromptItem[] = [
  {
    id: 'builtin-summarize',
    title: 'Summarise',
    body: 'Summarise the following text in {{sentences}} sentences, keeping the key facts and leaving out repetition:\n\n{{text}}',
    favourite: false,
    builtin: true,
    created_at: 0,
    updated_at: 0,
  },
  {
    id: 'builtin-rewrite-concise',
    title: 'Rewrite concisely',
    body: 'Rewrite the following text to be clear and concise, keeping the meaning exactly the same. Use a {{tone}} tone:\n\n{{text}}',
    favourite: false,
    builtin: true,
    created_at: 0,
    updated_at: 0,
  },
  {
    id: 'builtin-explain-code',
    title: 'Explain code',
    body: 'Explain what this {{language}} code does, line by line where it matters, and point out any bugs or edge cases:\n\n{{code}}',
    favourite: false,
    builtin: true,
    created_at: 0,
    updated_at: 0,
  },
  {
    id: 'builtin-draft-email',
    title: 'Draft email',
    body: 'Draft a professional email to {{recipient}} about {{topic}}. Keep it under {{max_words}} words and end with a clear next step.',
    favourite: false,
    builtin: true,
    created_at: 0,
    updated_at: 0,
  },
  {
    id: 'builtin-brainstorm',
    title: 'Brainstorm ideas',
    body: 'Brainstorm {{count}} creative ideas for {{topic}}. For each idea give a one-line description and one reason it could work.',
    favourite: false,
    builtin: true,
    created_at: 0,
    updated_at: 0,
  },
  {
    id: 'builtin-translate',
    title: 'Translate',
    body: 'Translate the following text to {{language}}. Keep the tone and formatting, and do not add explanations:\n\n{{text}}',
    favourite: false,
    builtin: true,
    created_at: 0,
    updated_at: 0,
  },
];

const VARIABLE_RE = /\{\{\s*([A-Za-z0-9_][A-Za-z0-9_ ]*?)\s*\}\}/g;

/** Variable names in first-appearance order, deduplicated. */
export function extractVariables(body: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of body.matchAll(VARIABLE_RE)) {
    const name = (match[1] ?? '').trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/** Variables in `body` that have no (non-empty) value in `values`. */
export function missingVariables(
  body: string,
  values: Readonly<Record<string, string>>,
): string[] {
  return extractVariables(body).filter((name) => !values[name]?.trim());
}

/** Replaces `{{name}}` with the matching value; unfilled ones stay as-is. */
export function fillTemplate(
  body: string,
  values: Readonly<Record<string, string>>,
): string {
  return body.replace(VARIABLE_RE, (whole, rawName: string) => {
    const name = String(rawName).trim();
    const value = values[name];
    return value !== undefined ? value : whole;
  });
}

/** Validation for the custom-prompt editor. Returns an error or null. */
export function validatePrompt(title: string, body: string): string | null {
  if (!title.trim()) return 'Give the prompt a title.';
  if (title.trim().length > 120) return 'Title is too long (max 120 chars).';
  if (!body.trim()) return 'Prompt body cannot be empty.';
  if (body.length > 20_000) return 'Prompt body is too long (max 20,000 chars).';
  return null;
}

/** Case-insensitive title/body search; favourites-first ordering. */
export function filterPrompts(
  prompts: readonly PromptItem[],
  query: string,
  favouritesOnly: boolean,
): PromptItem[] {
  const q = query.trim().toLowerCase();
  const filtered = prompts.filter((p) => {
    if (favouritesOnly && !p.favourite) return false;
    if (!q) return true;
    return (
      p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q)
    );
  });
  return [...filtered].sort(
    (a, b) =>
      Number(b.favourite) - Number(a.favourite) ||
      a.title.localeCompare(b.title),
  );
}

/** Merges built-ins (with favourite flags from state) + custom prompts. */
export function allPrompts(
  customPrompts: readonly PromptItem[],
  favouriteBuiltinIds: readonly string[],
): PromptItem[] {
  const builtins = BUILTIN_PROMPTS.map((p) => ({
    ...p,
    favourite: favouriteBuiltinIds.includes(p.id),
  }));
  return [...builtins, ...customPrompts];
}
