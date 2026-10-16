import { describe, it, expect, vi } from 'vitest';
import {
  describeSystemAction,
  executeSystemAction,
  parseSystemActionText,
  validateSystemAction,
} from './systemActions';
import type { SystemActionRequest } from './types';

describe('parseSystemActionText', () => {
  it('parses open <app>', () => {
    expect(parseSystemActionText('open Calculator')).toEqual({
      kind: 'open_app',
      app: 'Calculator',
    });
    expect(parseSystemActionText('  launch   Safari  ')).toEqual({
      kind: 'open_app',
      app: 'Safari',
    });
  });

  it('parses open <url> as open_url, including www. shorthand', () => {
    expect(parseSystemActionText('open https://example.com/x')).toEqual({
      kind: 'open_url',
      url: 'https://example.com/x',
    });
    expect(parseSystemActionText('open www.example.com')).toEqual({
      kind: 'open_url',
      url: 'https://www.example.com',
    });
  });

  it('parses create file with location and content', () => {
    expect(
      parseSystemActionText(
        'create file notes.txt on Desktop with content Hello there',
      ),
    ).toEqual({
      kind: 'create_file',
      filename: 'notes.txt',
      content: 'Hello there',
      location: 'desktop',
    });
    expect(parseSystemActionText('create notes.txt on Documents')).toEqual({
      kind: 'create_file',
      filename: 'notes.txt',
      content: '',
      location: 'documents',
    });
    expect(parseSystemActionText('create file todo.txt')).toEqual({
      kind: 'create_file',
      filename: 'todo.txt',
      content: '',
      location: 'desktop',
    });
  });

  it('parses create note with colon and with-content forms', () => {
    expect(
      parseSystemActionText('create note Shopping list: milk, eggs'),
    ).toEqual({
      kind: 'create_note',
      title: 'Shopping list',
      content: 'milk, eggs',
    });
    expect(
      parseSystemActionText('create note Idea with brainstorm later'),
    ).toEqual({
      kind: 'create_note',
      title: 'Idea',
      content: 'brainstorm later',
    });
    expect(parseSystemActionText('create note Just a title')).toEqual({
      kind: 'create_note',
      title: 'Just a title',
      content: '',
    });
  });

  it('parses reveal in Finder and bare paths', () => {
    expect(
      parseSystemActionText('reveal ~/Desktop/report.pdf in Finder'),
    ).toEqual({ kind: 'reveal_in_finder', path: '~/Desktop/report.pdf' });
    expect(
      parseSystemActionText('open ~/Desktop/report.pdf in Finder'),
    ).toEqual({
      kind: 'reveal_in_finder',
      path: '~/Desktop/report.pdf',
    });
  });

  it('parses go to / visit URL', () => {
    expect(parseSystemActionText('go to https://example.com')).toEqual({
      kind: 'open_url',
      url: 'https://example.com',
    });
  });

  it('returns null for ordinary chat — never invents an action', () => {
    expect(parseSystemActionText('what is the weather?')).toBeNull();
    expect(parseSystemActionText('')).toBeNull();
    expect(parseSystemActionText('open')).toBeNull();
    expect(parseSystemActionText('tell me a joke')).toBeNull();
  });

  it('never produces a shell string: injection text stays one app name', () => {
    const parsed = parseSystemActionText('open Calculator; rm -rf /');
    expect(parsed).toEqual({
      kind: 'open_app',
      app: 'Calculator; rm -rf /',
    });
    // The backend allowlist/scan rejects this — it is never executed.
    expect(JSON.stringify(parsed)).not.toContain('sh');
  });
});

describe('validateSystemAction', () => {
  it('rejects path traversal in file names and non-http URLs', () => {
    expect(
      validateSystemAction({
        kind: 'create_file',
        filename: '../evil.txt',
        content: '',
        location: 'desktop',
      }),
    ).toContain('no folders');
    expect(
      validateSystemAction({
        kind: 'create_file',
        filename: 'a/b.txt',
        content: '',
        location: 'desktop',
      }),
    ).toContain('no folders');
    expect(
      validateSystemAction({ kind: 'open_url', url: 'javascript:alert(1)' }),
    ).toContain('http');
    expect(
      validateSystemAction({ kind: 'open_url', url: 'https://example.com' }),
    ).toBeNull();
  });
});

describe('describeSystemAction', () => {
  it('labels every action kind', () => {
    const actions: SystemActionRequest[] = [
      { kind: 'open_app', app: 'Calculator' },
      {
        kind: 'create_file',
        filename: 'a.txt',
        content: '',
        location: 'desktop',
      },
      { kind: 'open_url', url: 'https://example.com' },
      { kind: 'reveal_in_finder', path: '/tmp/x' },
      { kind: 'create_note', title: 'N', content: '' },
    ];
    for (const action of actions) {
      expect(describeSystemAction(action).length).toBeGreaterThan(0);
    }
  });
});

describe('executeSystemAction', () => {
  it('returns the backend result on success', async () => {
    const invokeFn = vi.fn(async () => ({
      ok: true,
      message: 'Opened Calculator.',
      detail: 'Calculator',
    }));
    const result = await executeSystemAction(
      { kind: 'open_app', app: 'Calculator' },
      invokeFn,
    );
    expect(result.ok).toBe(true);
    expect(result.message).toBe('Opened Calculator.');
    expect(invokeFn).toHaveBeenCalledWith('system_execute_action', {
      action: { kind: 'open_app', app: 'Calculator' },
    });
  });

  it('never claims success when invoke rejects (e.g. command not wired)', async () => {
    const invokeFn = vi.fn(async () => {
      throw new Error('No such command: system_execute_action');
    });
    const result = await executeSystemAction(
      { kind: 'open_app', app: 'Calculator' },
      invokeFn,
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain('did not run');
  });

  it('fails validation locally without invoking', async () => {
    const invokeFn = vi.fn(async () => ({}));
    const result = await executeSystemAction(
      { kind: 'open_url', url: 'ftp://example.com' },
      invokeFn,
    );
    expect(result.ok).toBe(false);
    expect(invokeFn).not.toHaveBeenCalled();
  });
});
