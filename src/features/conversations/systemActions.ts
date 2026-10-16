/**
 * System actions — frontend side.
 *
 * The assistant never executes a model-generated shell string. The user
 * (or assistant) intent is parsed into a structured `SystemActionRequest`
 * and sent to the Rust backend (`system_execute_action` in
 * `system_actions.rs`), which validates and executes it with
 * `std::process::Command` — never a shell. The TS parser below mirrors the
 * Rust `parse_system_action_text` so the input box can show what will run
 * before anything is sent.
 *
 * `executeSystemAction` reports exactly what happened: on success the
 * backend's message (app name / exact file path); on failure the error.
 * It never claims success when the backend did not execute.
 */

import { invoke } from '@tauri-apps/api/core';
import type { SystemActionRequest, SystemActionResult } from './types';

export type InvokeFn = (
  cmd: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

const DEFAULT_INVOKE: InvokeFn = (cmd, args) =>
  invoke(cmd, args as Record<string, never>);

/** Human-readable label for a structured action (shown before executing). */
export function describeSystemAction(action: SystemActionRequest): string {
  switch (action.kind) {
    case 'open_app':
      return `Open ${action.app}`;
    case 'create_file':
      return `Create file ${action.filename} on ${action.location}`;
    case 'open_url':
      return `Open ${action.url} in browser`;
    case 'reveal_in_finder':
      return `Reveal ${action.path} in Finder`;
    case 'create_note':
      return `Create note “${action.title}”`;
  }
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value) || /^www\.\S+\.\S+/i.test(value);
}

function normalizeUrl(value: string): string {
  if (/^www\./i.test(value)) return `https://${value}`;
  return value;
}

/**
 * Parses free text like "open Calculator", "create file notes.txt on
 * Desktop with content Hello", "create note Shopping list: milk, eggs",
 * "reveal ~/Desktop/report.pdf in Finder", "open https://example.com".
 * Returns null when the text is not a recognised system-action request —
 * callers must then treat it as ordinary chat, not an action.
 */
export function parseSystemActionText(
  rawText: string,
): SystemActionRequest | null {
  const text = rawText.trim().replace(/\s+/g, ' ');
  if (!text) return null;
  const lower = text.toLowerCase();

  // open / launch / start <target> — app or URL.
  const openMatch = text.match(/^(?:open|launch|start)\s+(.+)$/i);
  if (openMatch) {
    let target = stripQuotes(openMatch[1] ?? '').replace(
      /\s+in (?:the )?browser$/i,
      '',
    );
    target = target.replace(/\s+in finder$/i, '');
    if (!target) return null;
    if (looksLikeUrl(target)) {
      return { kind: 'open_url', url: normalizeUrl(target) };
    }
    // "open <path> in Finder" phrasing reaches here only when the
    // "in Finder" suffix was already stripped above; a bare existing-looking
    // path is a reveal, not an app launch.
    if (/^[/~].*/.test(target)) {
      return { kind: 'reveal_in_finder', path: target };
    }
    return { kind: 'open_app', app: target };
  }

  // reveal / show <path> in Finder.
  const revealMatch = text.match(
    /^(?:reveal|show)\s+(.+?)\s+in (?:the )?finder$/i,
  );
  if (revealMatch) {
    const path = stripQuotes(revealMatch[1] ?? '');
    if (!path) return null;
    return { kind: 'reveal_in_finder', path };
  }

  // create note <title> [: content...] / create note <title> with <content>
  const noteMatch = text.match(/^create\s+(?:a\s+)?note\s+(.+)$/i);
  if (noteMatch) {
    const rest = (noteMatch[1] ?? '').trim();
    if (!rest) return null;
    const withMatch = rest.match(/^(.+?)\s+with\s+(.+)$/i);
    const colonMatch = rest.match(/^([^:]+):\s*(.+)$/);
    if (withMatch) {
      return {
        kind: 'create_note',
        title: stripQuotes(withMatch[1] ?? ''),
        content: withMatch[2] ?? '',
      };
    }
    if (colonMatch) {
      return {
        kind: 'create_note',
        title: stripQuotes(colonMatch[1] ?? ''),
        content: colonMatch[2] ?? '',
      };
    }
    return { kind: 'create_note', title: stripQuotes(rest), content: '' };
  }

  // create file <name> on Desktop|Documents [with content ...]
  const fileMatch = text.match(
    /^create\s+(?:a\s+)?file\s+(\S+)(?:\s+on\s+(desktop|documents))?(?:\s+with\s+content\s+(.+))?$/i,
  );
  if (fileMatch) {
    const filename = stripQuotes(fileMatch[1] ?? '');
    if (!filename) return null;
    const location =
      (fileMatch[2]?.toLowerCase() as 'desktop' | 'documents' | undefined) ??
      'desktop';
    return {
      kind: 'create_file',
      filename,
      content: fileMatch[3] ?? '',
      location,
    };
  }

  // "create <name> on Desktop" without the word "file".
  const bareFileMatch = text.match(
    /^create\s+(\S+\.\w+)\s+on\s+(desktop|documents)(?:\s+with\s+content\s+(.+))?$/i,
  );
  if (bareFileMatch) {
    return {
      kind: 'create_file',
      filename: stripQuotes(bareFileMatch[1] ?? ''),
      content: bareFileMatch[3] ?? '',
      location: bareFileMatch[2]?.toLowerCase() as 'desktop' | 'documents',
    };
  }

  // "go to <url>" / "visit <url>".
  const visitMatch = text.match(/^(?:go to|visit|browse to)\s+(\S+)$/i);
  if (visitMatch && looksLikeUrl(visitMatch[1] ?? '')) {
    return { kind: 'open_url', url: normalizeUrl(visitMatch[1] ?? '') };
  }

  void lower;
  return null;
}

/**
 * Client-side validation before invoking. The backend re-validates
 * everything; this catches obvious mistakes early with a clear message.
 * Returns an error string, or null when the action looks valid.
 */
export function validateSystemAction(
  action: SystemActionRequest,
): string | null {
  switch (action.kind) {
    case 'open_app':
      if (!action.app.trim()) return 'App name is empty.';
      if (action.app.length > 100) return 'App name is too long.';
      return null;
    case 'create_file': {
      if (!action.filename.trim()) return 'File name is empty.';
      if (
        action.filename.includes('/') ||
        action.filename.includes('\\') ||
        action.filename === '.' ||
        action.filename === '..' ||
        action.filename.includes('..')
      ) {
        return 'File name must be a plain file name (no folders or ..).';
      }
      return null;
    }
    case 'open_url':
      if (!/^https?:\/\/\S+$/i.test(action.url)) {
        return 'Only http:// and https:// URLs can be opened.';
      }
      return null;
    case 'reveal_in_finder':
      if (!action.path.trim()) return 'Path is empty.';
      return null;
    case 'create_note':
      if (!action.title.trim()) return 'Note title is empty.';
      return null;
  }
}

/**
 * Executes a structured action through the Rust backend. `invokeFn` is
 * injectable for tests. On any transport / backend failure returns
 * `{ ok: false, message }` — never a success claim.
 */
export async function executeSystemAction(
  action: SystemActionRequest,
  invokeFn: InvokeFn = DEFAULT_INVOKE,
): Promise<SystemActionResult> {
  const localError = validateSystemAction(action);
  if (localError) return { ok: false, message: localError };
  try {
    const raw = (await invokeFn('system_execute_action', {
      action,
    })) as { ok?: unknown; message?: unknown; detail?: unknown } | string;
    if (typeof raw === 'string') {
      return { ok: true, message: raw };
    }
    if (typeof raw === 'object' && raw !== null) {
      return {
        ok: raw.ok === true,
        message:
          typeof raw.message === 'string'
            ? raw.message
            : 'System action completed.',
        detail: typeof raw.detail === 'string' ? raw.detail : undefined,
      };
    }
    return { ok: true, message: 'System action completed.' };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: `System action did not run: ${detail}`,
    };
  }
}
