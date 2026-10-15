import { beforeEach, describe, expect, it } from 'vitest';
import {
  appendAuditEntry,
  auditLogToText,
  filterAuditLog,
  loadAuditLog,
  logOutboundRequest,
  sortAuditLogNewestFirst,
} from '../audit';
import { STORAGE_KEYS } from '../storage';

describe('audit log', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('appends, persists, and filters entries', () => {
    appendAuditEntry('setting_change', 'Theme set to Dark');
    appendAuditEntry('backup', 'Exported backup');
    const entries = loadAuditLog();
    expect(entries).toHaveLength(2);
    expect(filterAuditLog(entries, 'backup')).toHaveLength(1);
    expect(filterAuditLog(entries, 'all')).toHaveLength(2);
  });

  it('logs outbound requests by host only', () => {
    const entry = logOutboundRequest(
      'https://api.example.com/search?q=secret',
      200,
    );
    expect(entry.kind).toBe('outbound_request');
    expect(entry.detail).toContain('api.example.com');
    expect(entry.detail).not.toContain('secret');
  });

  it('sorts newest first and renders text', () => {
    const a = appendAuditEntry('backup', 'first');
    const b = appendAuditEntry('backup', 'second');
    const sorted = sortAuditLogNewestFirst(loadAuditLog());
    expect(sorted[0].id).toBe(b.id);
    expect(sorted[1].id).toBe(a.id);
    expect(auditLogToText(sorted)).toContain('[backup] second');
  });

  it('caps the log at 500 entries', async () => {
    const existing = loadAuditLog();
    expect(existing.length).toBeLessThanOrEqual(500);
    // Directly seed 499 entries, then append two: the log must stay capped.
    const seeded = Array.from({ length: 499 }, (_, i) => ({
      id: `audit-seed-${i}`,
      tsMs: i,
      kind: 'backup' as const,
      detail: `seed ${i}`,
    }));
    window.localStorage.setItem(STORAGE_KEYS.auditLog, JSON.stringify(seeded));
    appendAuditEntry('backup', 'one');
    appendAuditEntry('backup', 'two');
    expect(loadAuditLog()).toHaveLength(500);
  });
});
