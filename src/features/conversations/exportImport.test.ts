import { describe, it, expect } from 'vitest';
import {
  buildPrintHtml,
  conversationToJson,
  conversationToMarkdown,
  exportFilename,
  parseConversationImport,
} from './exportImport';
import type { ConversationExportData } from './types';

const DATA: ConversationExportData = {
  title: 'My <chat> & stuff',
  model: 'model-x',
  messages: [
    { role: 'user', content: 'Hello?' },
    { role: 'assistant', content: 'Hi there.\nSecond line.' },
  ],
};

describe('conversationToMarkdown', () => {
  it('emits title + User/Assistant sections and round-trips', () => {
    const md = conversationToMarkdown(DATA);
    expect(md).toContain('## User');
    expect(md).toContain('## Assistant');
    expect(md).toContain('Hello?');
    const parsed = parseConversationImport(md, 'chat.md');
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[1]?.content).toContain('Second line.');
  });

  it('uses a fallback title when none is set', () => {
    const md = conversationToMarkdown({ ...DATA, title: null });
    expect(md.startsWith('# Untitled conversation')).toBe(true);
  });
});

describe('conversationToJson', () => {
  it('emits versioned JSON that parses back', () => {
    const json = conversationToJson(DATA);
    const parsed = parseConversationImport(json, 'chat.json');
    expect(parsed.title).toBe(DATA.title);
    expect(parsed.messages).toHaveLength(2);
  });
});

describe('parseConversationImport', () => {
  it('rejects empty files and files with no messages', () => {
    expect(() => parseConversationImport('', 'x.md')).toThrow('empty');
    expect(() => parseConversationImport('# Just a title\n', 'x.md')).toThrow(
      'Could not find any messages',
    );
  });

  it('rejects JSON with bad roles or non-string content', () => {
    expect(() =>
      parseConversationImport(
        JSON.stringify({ messages: [{ role: 'system', content: 'x' }] }),
        'x.json',
      ),
    ).toThrow('role');
    expect(() =>
      parseConversationImport(
        JSON.stringify({ messages: [{ role: 'user', content: 5 }] }),
        'x.json',
      ),
    ).toThrow('string content');
  });

  it('parses **User:** prefixed lines', () => {
    const parsed = parseConversationImport(
      '**User:** hi\n**Assistant:** hello\n',
      'x.md',
    );
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.messages[0]?.role).toBe('user');
  });

  it('parses a Markdown title', () => {
    const parsed = parseConversationImport(
      '# Trip plan\n\n## User\n\nGo where?\n',
      'x.md',
    );
    expect(parsed.title).toBe('Trip plan');
    expect(parsed.messages).toHaveLength(1);
  });
});

describe('exportFilename', () => {
  it('builds a slug filename with the date', () => {
    expect(
      exportFilename('My Chat! v2', 'md', new Date(2026, 9, 16)),
    ).toBe('veilura-chat-my-chat-v2-2026-10-16.md');
  });

  it('falls back when the title is empty', () => {
    expect(exportFilename(null, 'json', new Date(2026, 0, 1))).toBe(
      'veilura-chat-2026-01-01.json',
    );
  });
});

describe('buildPrintHtml', () => {
  it('escapes HTML in titles and content', () => {
    const html = buildPrintHtml({
      ...DATA,
      messages: [{ role: 'user', content: '<script>alert(1)</script>' }],
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('My &lt;chat&gt;');
  });
});
