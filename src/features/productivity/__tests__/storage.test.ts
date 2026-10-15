import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildBackup,
  downloadTextFile,
  readFileAsText,
  readJson,
  storedBytes,
  storedItemCount,
  writeJson,
} from '../storage';

describe('storage helpers', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips JSON and falls back on corrupt data', () => {
    writeJson('veilura:productivity:test', { a: 1 });
    expect(readJson('veilura:productivity:test', {})).toEqual({ a: 1 });
    window.localStorage.setItem('veilura:productivity:test', '{bad');
    expect(readJson('veilura:productivity:test', { fallback: true })).toEqual({
      fallback: true,
    });
  });

  it('measures bytes and item counts', () => {
    writeJson('veilura:productivity:test', [1, 2, 3]);
    expect(storedItemCount('veilura:productivity:test')).toBe(3);
    expect(storedBytes('veilura:productivity:test')).toBeGreaterThan(0);
    expect(storedBytes('veilura:productivity:missing')).toBe(0);
    expect(storedItemCount('veilura:productivity:missing')).toBe(0);
  });

  it('builds a versioned backup document', () => {
    const backup = buildBackup({
      reminders: [],
      focusSessions: [],
      settings: {
        theme: 'dark',
        fontSizePx: 15,
        density: 'comfortable',
        privacy: {
          clipboardCapture: false,
          screenCapture: false,
          webSearch: true,
          telemetry: false,
        },
        contentFilterEnabled: true,
        focus: { focusMin: 25, shortBreakMin: 5, longBreakMin: 15 },
      },
      shortcuts: [],
      auditLog: [],
    });
    expect(backup.version).toBe(1);
    expect(backup.app).toBe('veilura');
  });

  it('downloads a file with the given name', () => {
    const clickSpy = vi
      .spyOn(window.HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const urlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:veilura-test');
    const revokeSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {});
    downloadTextFile('test.json', '{"a":1}', 'application/json');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(urlSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith('blob:veilura-test');
  });

  it('reads a file back as text', async () => {
    const text = await readFileAsText(
      new File(['hello'], 'hello.txt', { type: 'text/plain' }),
    );
    expect(text).toBe('hello');
  });
});
