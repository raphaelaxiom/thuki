/**
 * Local-only audit log.
 *
 * Every outbound network request and every system action the productivity
 * features take is recorded here with a timestamp. The log lives in
 * localStorage, is capped (oldest entries drop), and is viewable +
 * exportable from the AuditLogPanel. It is never sent anywhere: there is
 * no code path that transmits it.
 */

import type { AuditEntry, AuditKind } from './types';
import { readJson, STORAGE_KEYS, writeJson } from './storage';

export const AUDIT_LOG_MAX_ENTRIES = 500;

export const AUDIT_KINDS: readonly AuditKind[] = [
  'outbound_request',
  'system_action',
  'setting_change',
  'data_delete',
  'backup',
  'restore',
  'engine_restart',
];

export function loadAuditLog(): AuditEntry[] {
  const entries = readJson<AuditEntry[]>(STORAGE_KEYS.auditLog, []);
  return Array.isArray(entries) ? entries : [];
}

export function saveAuditLog(entries: AuditEntry[]): void {
  writeJson(STORAGE_KEYS.auditLog, entries.slice(-AUDIT_LOG_MAX_ENTRIES));
}

/**
 * Appends one entry and persists the capped log. Returns the entry.
 * `detail` must already be redacted — never pass secret values here.
 */
export function appendAuditEntry(kind: AuditKind, detail: string): AuditEntry {
  const entry: AuditEntry = {
    id: `audit-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    tsMs: Date.now(),
    kind,
    detail,
  };
  const entries = loadAuditLog();
  entries.push(entry);
  saveAuditLog(entries);
  return entry;
}

/** Logs an outbound network request (URL host only, never bodies/keys). */
export function logOutboundRequest(url: string, status?: number): AuditEntry {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    // Not a parseable URL: log the raw string truncated, never the body.
    host = url.slice(0, 120);
  }
  const detail =
    status === undefined
      ? `Outbound request to ${host}`
      : `Outbound request to ${host} → HTTP ${status}`;
  return appendAuditEntry('outbound_request', detail);
}

export function filterAuditLog(
  entries: AuditEntry[],
  kind: AuditKind | 'all',
): AuditEntry[] {
  if (kind === 'all') return entries;
  return entries.filter((e) => e.kind === kind);
}

/** Newest-first ordering for display. Ties (same millisecond) keep the
 * later-appended entry first, so the order is deterministic. */
export function sortAuditLogNewestFirst(entries: AuditEntry[]): AuditEntry[] {
  return [...entries].reverse().sort((a, b) => b.tsMs - a.tsMs);
}

/** Renders the log as exportable text (one line per entry). */
export function auditLogToText(entries: AuditEntry[]): string {
  return entries
    .map((e) => `${new Date(e.tsMs).toISOString()} [${e.kind}] ${e.detail}`)
    .join('\n');
}
