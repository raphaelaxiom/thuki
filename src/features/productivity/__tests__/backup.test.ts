import { describe, expect, it } from 'vitest';
import {
  diffBackup,
  exportBackupFile,
  parseBackup,
  validateBackup,
} from '../backup';
import { defaultSettings } from '../settings';
import type { ProductivityBackup } from '../types';

function currentData() {
  return {
    reminders: [],
    focusSessions: [],
    settings: defaultSettings(),
    shortcuts: [],
    auditLog: [],
  };
}

describe('backup', () => {
  it('validates a well-formed backup', () => {
    const { content } = exportBackupFile(currentData());
    const { backup, validation } = parseBackup(content);
    expect(validation.valid).toBe(true);
    expect(backup.version).toBe(1);
    expect(backup.app).toBe('veilura');
    expect(validation.counts.reminders).toBe(0);
  });

  it('rejects malformed JSON and wrong version/app', () => {
    expect(() => parseBackup('{nope')).toThrow('not valid JSON');
    const bad = validateBackup({
      version: 2,
      app: 'other',
      exportedAt: 'x',
      data: {},
    });
    expect(bad.valid).toBe(false);
    expect(bad.errors.some((e) => e.includes('version'))).toBe(true);
    expect(bad.errors.some((e) => e.includes('app'))).toBe(true);
  });

  it('rejects missing data and malformed reminders', () => {
    expect(
      validateBackup({ version: 1, app: 'veilura', exportedAt: 'x' }).valid,
    ).toBe(false);
    const bad = validateBackup({
      version: 1,
      app: 'veilura',
      exportedAt: 'x',
      data: { reminders: [{ id: 'r1' }] },
    });
    expect(bad.valid).toBe(false);
    expect(bad.errors.some((e) => e.includes('reminder'))).toBe(true);
  });

  it('diffs current vs incoming and flags replacement', () => {
    const incoming = JSON.parse(
      exportBackupFile(currentData()).content,
    ) as ProductivityBackup;
    const diff = diffBackup(
      {
        ...currentData(),
        reminders: [
          {
            id: 'r1',
            title: 'x',
            dueAtMs: 1,
            done: false,
            createdAtMs: 1,
          },
        ],
      },
      incoming,
    );
    expect(diff.replacesData).toBe(true);
    expect(diff.current.reminders).toBe(1);
    expect(diff.incoming.reminders).toBe(0);
    expect(diffBackup(currentData(), incoming).replacesData).toBe(false);
  });
});
