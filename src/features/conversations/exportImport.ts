/**
 * Conversation export (Markdown / JSON / print-to-PDF) and import
 * (Markdown / JSON).
 *
 * Export formats are deliberately boring and portable:
 * - Markdown: `# <title>` + `## User` / `## Assistant` sections, the same
 *   shape the importer reads back, so export → import round-trips.
 * - JSON: `{ title, model, exported_at, messages: [{role, content}] }`.
 * - Print-to-PDF: a standalone HTML document written to a new window and
 *   printed via `window.print()` — the browser's own "Save as PDF"
 *   destination produces the PDF. No server, no fake PDF bytes.
 *
 * Import is strict about shape (unknown roles / absurd sizes are
 * rejected) and never executes anything in the file: content is treated
 * as plain text throughout.
 */

import type {
  ChatMessageLike,
  ConversationExportData,
  ConversationMeta,
} from './types';

export const MAX_IMPORT_MESSAGES = 5000;
export const MAX_IMPORT_CONTENT_CHARS = 2_000_000;
const VALID_ROLES = new Set(['user', 'assistant']);

export function displayTitle(
  meta: Pick<ConversationMeta, 'title'>,
  fallback = 'Untitled conversation',
): string {
  const title = meta.title?.trim();
  return title ? title : fallback;
}

/** `veilura-chat-my-title-2026-10-16.md` — filename-safe, no message text. */
export function exportFilename(
  title: string | null,
  ext: 'md' | 'json',
  now = new Date(),
): string {
  const slug = (title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const base = slug ? `veilura-chat-${slug}` : 'veilura-chat';
  return `${base}-${yyyy}-${mm}-${dd}.${ext}`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+\-.!])/g, '\\$1');
}

export function conversationToMarkdown(
  data: ConversationExportData,
  now = new Date(),
): string {
  const lines: string[] = [
    `# ${escapeMarkdown(displayTitle(data))}`,
    '',
    `Model: ${escapeMarkdown(data.model)}`,
    `Exported: ${now.toISOString()}`,
    `Messages: ${data.messages.length}`,
    '',
  ];
  for (const message of data.messages) {
    const heading = message.role === 'assistant' ? 'Assistant' : 'User';
    lines.push(`## ${heading}`, '', message.content.trim(), '');
  }
  return lines.join('\n');
}

export function conversationToJson(
  data: ConversationExportData,
  now = new Date(),
): string {
  return (
    JSON.stringify(
      {
        format: 'veilura-conversation',
        version: 1,
        title: data.title,
        model: data.model,
        exported_at: now.toISOString(),
        messages: data.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      },
      null,
      2,
    ) + '\n'
  );
}

export interface ParsedImport {
  readonly title: string | null;
  readonly model: string;
  readonly messages: ChatMessageLike[];
}

function parseJsonImport(text: string): ParsedImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error('File is not valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('JSON import must be an object with a messages array.');
  }
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.messages)) {
    throw new Error('JSON import must contain a messages array.');
  }
  if (obj.messages.length > MAX_IMPORT_MESSAGES) {
    throw new Error(
      `Import has too many messages (max ${MAX_IMPORT_MESSAGES}).`,
    );
  }
  const messages: ChatMessageLike[] = [];
  let total = 0;
  for (const raw of obj.messages as unknown[]) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error('Each imported message must be an object.');
    }
    const m = raw as Record<string, unknown>;
    if (typeof m.role !== 'string' || !VALID_ROLES.has(m.role)) {
      throw new Error('Imported messages must have role "user" or "assistant".');
    }
    if (typeof m.content !== 'string') {
      throw new Error('Imported messages must have string content.');
    }
    total += m.content.length;
    if (total > MAX_IMPORT_CONTENT_CHARS) {
      throw new Error('Import is too large.');
    }
    messages.push({ role: m.role, content: m.content });
  }
  return {
    title: typeof obj.title === 'string' ? obj.title : null,
    model: typeof obj.model === 'string' ? obj.model : 'imported',
    messages,
  };
}

function parseMarkdownImport(text: string): ParsedImport {
  const lines = text.split(/\r?\n/);
  let title: string | null = null;
  const messages: ChatMessageLike[] = [];
  let currentRole: string | null = null;
  let currentBody: string[] = [];
  const flush = () => {
    if (currentRole) {
      const content = currentBody.join('\n').trim();
      if (content) messages.push({ role: currentRole, content });
    }
    currentRole = null;
    currentBody = [];
  };
  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+?)\s*$/);
    if (h1 && title === null && currentRole === null) {
      title = h1[1]?.replace(/\\(.)/g, '$1') ?? null;
      continue;
    }
    const h2 = line.match(/^##\s+(User|Assistant)\s*$/i);
    if (h2) {
      flush();
      currentRole = (h2[1] ?? 'user').toLowerCase();
      continue;
    }
    const prefixed = line.match(/^\*\*(User|Assistant):\*\*\s?(.*)$/i);
    if (prefixed) {
      // A `**Role:**` line always starts a new message: flush the previous
      // one first. This is the import format's message delimiter.
      flush();
      currentRole = (prefixed[1] ?? 'user').toLowerCase();
      currentBody = [prefixed[2] ?? ''];
      continue;
    }
    if (currentRole) currentBody.push(line);
  }
  flush();
  if (messages.length === 0) {
    throw new Error(
      'Could not find any messages. Use ## User / ## Assistant sections or a Veilura JSON export.',
    );
  }
  if (messages.length > MAX_IMPORT_MESSAGES) {
    throw new Error(
      `Import has too many messages (max ${MAX_IMPORT_MESSAGES}).`,
    );
  }
  return { title, model: 'imported', messages };
}

/**
 * Parses an imported conversation file. JSON is tried when the text looks
 * like JSON (or the filename ends in .json); otherwise Markdown is tried.
 * Throws an Error with a user-facing message on invalid input.
 */
export function parseConversationImport(
  text: string,
  filename: string,
): ParsedImport {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Import file is empty.');
  if (filename.toLowerCase().endsWith('.json') || trimmed.startsWith('{')) {
    return parseJsonImport(trimmed);
  }
  return parseMarkdownImport(text);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Standalone printable HTML for one conversation (print → Save as PDF). */
export function buildPrintHtml(
  data: ConversationExportData,
  now = new Date(),
): string {
  const rows = data.messages
    .map(
      (m) =>
        `<section class="msg ${m.role === 'assistant' ? 'assistant' : 'user'}">` +
        `<h2>${m.role === 'assistant' ? 'Assistant' : 'User'}</h2>` +
        `<p>${escapeHtml(m.content).replace(/\n/g, '<br>')}</p></section>`,
    )
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    displayTitle(data),
  )}</title><style>
body{font-family:-apple-system,system-ui,sans-serif;max-width:720px;margin:32px auto;padding:0 24px;color:#111}
h1{font-size:22px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#555;margin:0 0 6px}
.msg{border-top:1px solid #ddd;padding:14px 0;page-break-inside:avoid}
.msg p{white-space:pre-wrap;word-break:break-word;margin:0;font-size:14px;line-height:1.55}
.meta{color:#666;font-size:12px}
@media print{body{margin:0;max-width:none}}
</style></head><body><h1>${escapeHtml(displayTitle(data))}</h1>` +
    `<p class="meta">Model: ${escapeHtml(data.model)} · Exported: ${escapeHtml(
      now.toISOString(),
    )} · Messages: ${data.messages.length}</p>${rows}</body></html>`;
}

/**
 * Opens the printable document in a new window and invokes the browser
 * print dialog. Returns false when popups are blocked (caller reports it).
 */
export function printConversation(data: ConversationExportData): boolean {
  const win = window.open('', '_blank', 'width=800,height=900');
  if (!win) return false;
  win.document.write(buildPrintHtml(data));
  win.document.close();
  win.focus();
  win.print();
  return true;
}

/** Triggers a real browser download of `content` as `filename`. */
export function downloadTextFile(
  filename: string,
  content: string,
  mime: 'text/markdown' | 'application/json',
): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
