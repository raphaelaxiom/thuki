import { describe, it, expect } from 'vitest';
import {
  addVariant,
  buildCompareRows,
  canAttachImage,
  clampContextLength,
  clampTemperature,
  clampTopP,
  clampTtsRate,
  clampVariantIndex,
  classifyAttachedFile,
  computeDiskUsage,
  computeTokenStats,
  createQueueItem,
  decideResume,
  deleteModelConfirmation,
  dictationAvailability,
  enqueueDownload,
  extractCodeBlocks,
  filterFavourites,
  formatBytes,
  formatTokenStats,
  isSafeCitationUrl,
  isValidAnnotation,
  normalizeCropRect,
  nextQueuedItem,
  parseCitations,
  pauseQueueItem,
  cancelQueueItem,
  pushClipboardHistory,
  queueItemProgress,
  resolvePerModelSettings,
  sanitizeTtsText,
  toggleFavourite,
  validateAttachment,
  validateSystemPromptOverride,
  MAX_CLIPBOARD_HISTORY,
} from '../pure';
import type { ModelMeta, ReplyVariant } from '../types';

const model = (over: Partial<ModelMeta> = {}): ModelMeta => ({
  id: 'a',
  displayName: 'Model A',
  sizeBytes: 1_000_000_000,
  paramsB: 9,
  contextLength: 32768,
  quant: 'Q4_K_M',
  vision: true,
  downloaded: true,
  notes: 'hello',
  ...over,
});

describe('formatBytes', () => {
  it('formats 0 and GB values', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1_500_000_000)).toContain('GB');
    expect(formatBytes(-5)).toBe('0 B');
  });
});

describe('favourites', () => {
  it('toggles and filters', () => {
    expect(toggleFavourite([], 'a')).toEqual(['a']);
    expect(toggleFavourite(['a'], 'a')).toEqual([]);
    const models = [model({ id: 'a' }), model({ id: 'b', displayName: 'B' })];
    expect(filterFavourites(models, ['b'], true)).toHaveLength(1);
    expect(filterFavourites(models, ['b'], false)).toHaveLength(2);
  });
});

describe('compare', () => {
  it('builds one row per attribute with Yes/No states', () => {
    const rows = buildCompareRows([model(), model({ id: 'b', downloaded: false, notes: '' })]);
    expect(rows.map((r) => r.label)).toContain('Downloaded');
    const downloaded = rows.find((r) => r.label === 'Downloaded');
    expect(downloaded?.values).toEqual(['Yes', 'No']);
    const notes = rows.find((r) => r.label === 'Notes');
    expect(notes?.values).toEqual(['hello', '—']);
  });
});

describe('per-model settings', () => {
  it('clamps out-of-range values and merges defaults', () => {
    expect(clampTemperature(9)).toBe(2);
    expect(clampTemperature(-1)).toBe(0);
    expect(clampTopP(2)).toBe(1);
    expect(clampContextLength(10)).toBe(1024);
    expect(clampContextLength(999_999)).toBe(131072);
    const resolved = resolvePerModelSettings({ temperature: 5 });
    expect(resolved.temperature).toBe(2);
    expect(resolved.topP).toBe(0.9);
    expect(validateSystemPromptOverride('x'.repeat(4001))).toMatch(/at most/);
    expect(validateSystemPromptOverride('ok')).toBeNull();
  });
});

describe('download queue', () => {
  it('enqueue / pause / cancel / progress / next', () => {
    const item = createQueueItem('a', 'a.gguf', 1000);
    expect(item.status).toBe('queued');
    expect(queueItemProgress({ ...item, downloadedBytes: 250 })).toBe(0.25);
    const queue = enqueueDownload([item], { ...item, id: 'second' });
    expect(nextQueuedItem(queue)?.id).toBe(item.id);
    const paused = pauseQueueItem(
      queue.map((i) => (i.id === item.id ? { ...i, status: 'downloading' as const } : i)),
      item.id,
    );
    expect(paused.find((i) => i.id === item.id)?.status).toBe('paused');
    const cancelled = cancelQueueItem(paused, item.id);
    expect(cancelled.find((i) => i.id === item.id)?.status).toBe('cancelled');
  });

  it('decideResume restarts when Range is unsupported, resumes otherwise', () => {
    const base = createQueueItem('a', 'a.gguf', 1000);
    expect(decideResume({ ...base, downloadedBytes: 100, supportsRange: false }).action).toBe('restart');
    expect(decideResume({ ...base, downloadedBytes: 100, supportsRange: true }).action).toBe('resume-range');
    expect(decideResume({ ...base, downloadedBytes: 1000 }).action).toBe('already-complete');
  });
});

describe('disk usage', () => {
  it('counts downloaded models only and confirms delete with freed space', () => {
    const usage = computeDiskUsage([
      model({ sizeBytes: 100 }),
      model({ id: 'b', downloaded: false, sizeBytes: 999 }),
    ]);
    expect(usage.totalBytes).toBe(100);
    expect(deleteModelConfirmation(model())).toContain('frees');
  });
});

describe('clipboard history', () => {
  it('dedupes consecutive, drops blanks, caps length', () => {
    let entries = pushClipboardHistory([], 'hello');
    entries = pushClipboardHistory(entries, 'hello');
    expect(entries).toHaveLength(1);
    entries = pushClipboardHistory(entries, '   ');
    expect(entries).toHaveLength(1);
    for (let i = 0; i < MAX_CLIPBOARD_HISTORY + 5; i++) {
      entries = pushClipboardHistory(entries, `item-${i}`);
    }
    expect(entries).toHaveLength(MAX_CLIPBOARD_HISTORY);
    expect(entries[0].text).toBe(`item-${MAX_CLIPBOARD_HISTORY + 4}`);
  });
});

describe('attachments', () => {
  it('classifies text/image/other and enforces the size cap', () => {
    expect(classifyAttachedFile('a.txt', '')).toBe('text');
    expect(classifyAttachedFile('a.png', 'image/png')).toBe('image');
    expect(classifyAttachedFile('a.bin', 'application/octet-stream')).toBe('other');
    expect(validateAttachment({ name: 'big.bin', sizeBytes: 11 * 1024 * 1024, mimeType: '' })).toMatch(/limited/);
    expect(validateAttachment({ name: 'empty.txt', sizeBytes: 0, mimeType: '' })).toMatch(/empty/);
    expect(validateAttachment({ name: 'ok.txt', sizeBytes: 10, mimeType: '' })).toBeNull();
  });

  it('vision gating is honest', () => {
    expect(canAttachImage(false).allowed).toBe(false);
    expect(canAttachImage(true).allowed).toBe(true);
  });
});

describe('crop + annotations', () => {
  it('clamps crop rects and rejects degenerate annotations', () => {
    expect(normalizeCropRect({ x: -10, y: -10, width: 50, height: 50 }, 100, 100)).toEqual({
      x: 0, y: 0, width: 50, height: 50,
    });
    expect(normalizeCropRect({ x: 0, y: 0, width: 0, height: 10 }, 100, 100)).toBeNull();
    expect(isValidAnnotation({ kind: 'arrow', x1: 0, y1: 0, x2: 0, y2: 0, color: '#f00' })).toBe(false);
    expect(isValidAnnotation({ kind: 'text', x: 1, y: 1, text: 'hi', color: '#f00' })).toBe(true);
    expect(isValidAnnotation({ kind: 'text', x: 1, y: 1, text: '  ', color: '#f00' })).toBe(false);
  });
});

describe('dictation availability', () => {
  it('prefers backend, then Web Speech, then none', () => {
    expect(dictationAvailability({ hasBackend: true, hasWebSpeech: false }).path).toBe('backend');
    expect(dictationAvailability({ hasBackend: false, hasWebSpeech: true }).path).toBe('web-speech');
    expect(dictationAvailability({ hasBackend: false, hasWebSpeech: false }).available).toBe(false);
  });
});

describe('TTS', () => {
  it('strips markdown and clamps rate', () => {
    expect(sanitizeTtsText('Hello `code` and [link](https://example.com)')).not.toContain('`');
    expect(sanitizeTtsText('```js\nconst x = 1;\n``` done')).toContain('code block omitted');
    expect(clampTtsRate(9)).toBe(2);
    expect(clampTtsRate(0)).toBe(0.5);
  });
});

describe('code blocks + variants', () => {
  it('extracts fenced blocks and caps variants', () => {
    const blocks = extractCodeBlocks('a\n```ts\nconst x = 1;\n```\nb\n```\nplain\n```');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].language).toBe('ts');
    let variants: ReplyVariant[] = [];
    for (let i = 0; i < 12; i++) {
      variants = addVariant(variants, {
        id: `v${i}`, content: `c${i}`, createdAt: i, promptTokens: 0, completionTokens: 0, elapsedMs: 0,
      });
    }
    expect(variants).toHaveLength(10);
    expect(clampVariantIndex(variants, 99)).toBe(9);
    expect(clampVariantIndex([], 3)).toBe(0);
  });
});

describe('token stats', () => {
  it('computes ms/token from real engine numbers', () => {
    const stats = computeTokenStats({
      promptTokens: 10, completionTokens: 20, elapsedMs: 1000,
      totalPromptTokens: 10, totalCompletionTokens: 20,
    });
    expect(stats.msPerToken).toBe(50);
    expect(formatTokenStats(stats)).toContain('20.0 tok/s');
    const empty = computeTokenStats({
      promptTokens: 0, completionTokens: 0, elapsedMs: 0,
      totalPromptTokens: 0, totalCompletionTokens: 0,
    });
    expect(empty.msPerToken).toBe(0);
  });
});

describe('citations', () => {
  it('numbers markdown links and footnote-only sources', () => {
    const text = 'See [Apple](https://apple.com) and [Apple again](https://apple.com).\n\n[1]: https://example.com/source';
    const { citations } = parseCitations(text);
    expect(citations).toHaveLength(2);
    expect(citations[0].url).toBe('https://apple.com');
    expect(citations[1].url).toBe('https://example.com/source');
    expect(isSafeCitationUrl('https://example.com')).toBe(true);
    expect(isSafeCitationUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeCitationUrl('not a url')).toBe(false);
  });
});
