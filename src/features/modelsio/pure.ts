/**
 * Pure logic for the Models / Input / Output feature set (Phase 2C).
 *
 * Every function here is side-effect free and unit-tested in
 * `__tests__/modelsio-pure.test.ts`. Components and Tauri wrappers live in
 * their own files; this file is the single source of truth for the rules
 * both sides must agree on (clamping, resume decisions, parsing, stats).
 */

import type {
  Annotation,
  AttachedFile,
  AttachedFileKind,
  Citation,
  ClipboardEntry,
  CropRect,
  DownloadQueueItem,
  ModelMeta,
  PerModelSettings,
  ReplyVariant,
  TokenStats,
} from './types';

/* ─── Shared formatting ─────────────────────────────────────────────────── */

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/* ─── 1. Favourites ─────────────────────────────────────────────────────── */

/** Toggle a model id in the favourites list (sorted, deduped). */
export function toggleFavourite(favourites: string[], modelId: string): string[] {
  const set = new Set(favourites);
  if (set.has(modelId)) set.delete(modelId);
  else set.add(modelId);
  return [...set].sort();
}

export function isFavourite(favourites: string[], modelId: string): boolean {
  return favourites.includes(modelId);
}

/** When `onlyFavourites` is true, keep only favourited models. */
export function filterFavourites(
  models: ModelMeta[],
  favourites: string[],
  onlyFavourites: boolean,
): ModelMeta[] {
  if (!onlyFavourites) return models;
  const fav = new Set(favourites);
  return models.filter((m) => fav.has(m.id));
}

/* ─── 2. Model compare ──────────────────────────────────────────────────── */

export interface CompareRow {
  label: string;
  values: string[];
}

/**
 * Side-by-side comparison table. Columns follow the order of `models`.
 * `downloaded` renders as Yes/No so the state is comparable at a glance.
 */
export function buildCompareRows(models: ModelMeta[]): CompareRow[] {
  const yesNo = (v: boolean): string => (v ? 'Yes' : 'No');
  const params = (m: ModelMeta): string =>
    m.paramsB === null ? 'Unknown' : `${m.paramsB}B`;
  return [
    { label: 'Model', values: models.map((m) => m.displayName) },
    { label: 'Size', values: models.map((m) => formatBytes(m.sizeBytes)) },
    { label: 'Parameters', values: models.map(params) },
    {
      label: 'Context length',
      values: models.map((m) => `${m.contextLength.toLocaleString()} tokens`),
    },
    { label: 'Quantisation', values: models.map((m) => m.quant) },
    { label: 'Vision', values: models.map((m) => yesNo(m.vision)) },
    { label: 'Downloaded', values: models.map((m) => yesNo(m.downloaded)) },
    {
      label: 'Notes',
      values: models.map((m) => (m.notes.trim() === '' ? '—' : m.notes)),
    },
  ];
}

/* ─── 3. Per-model settings ─────────────────────────────────────────────── */

export const DEFAULT_PER_MODEL_SETTINGS: PerModelSettings = {
  temperature: 0.7,
  topP: 0.9,
  contextLength: 8192,
  systemPromptOverride: '',
};

export const MAX_SYSTEM_PROMPT_CHARS = 4000;
export const MIN_CONTEXT_LENGTH = 1024;
export const MAX_CONTEXT_LENGTH = 131072;

export function clampTemperature(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PER_MODEL_SETTINGS.temperature;
  return Math.min(2, Math.max(0, value));
}

export function clampTopP(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PER_MODEL_SETTINGS.topP;
  return Math.min(1, Math.max(0, value));
}

export function clampContextLength(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PER_MODEL_SETTINGS.contextLength;
  return Math.min(
    MAX_CONTEXT_LENGTH,
    Math.max(MIN_CONTEXT_LENGTH, Math.floor(value)),
  );
}

/** Validate a system-prompt override. Empty string = "use global default". */
export function validateSystemPromptOverride(value: string): string | null {
  if (value.length > MAX_SYSTEM_PROMPT_CHARS) {
    return `System prompt must be at most ${MAX_SYSTEM_PROMPT_CHARS} characters (got ${value.length}).`;
  }
  return null;
}

/**
 * Merge stored per-model settings over the defaults and clamp every
 * numeric field. Unknown / partial stored objects resolve to sane values
 * instead of NaN — the resolved object is what is passed to inference.
 */
export function resolvePerModelSettings(
  stored: Partial<PerModelSettings> | null | undefined,
): PerModelSettings {
  return {
    temperature: clampTemperature(
      stored?.temperature ?? DEFAULT_PER_MODEL_SETTINGS.temperature,
    ),
    topP: clampTopP(stored?.topP ?? DEFAULT_PER_MODEL_SETTINGS.topP),
    contextLength: clampContextLength(
      stored?.contextLength ?? DEFAULT_PER_MODEL_SETTINGS.contextLength,
    ),
    systemPromptOverride: stored?.systemPromptOverride ?? '',
  };
}

/* ─── 4 + 5. Download queue + pause/resume ──────────────────────────────── */

let queueCounter = 0;

/** Deterministic-enough ids for queue items (uniqueness within a session). */
export function nextQueueId(): string {
  queueCounter += 1;
  return `dl-${Date.now().toString(36)}-${queueCounter}`;
}

export function createQueueItem(
  modelId: string,
  fileName: string,
  totalBytes: number,
): DownloadQueueItem {
  return {
    id: nextQueueId(),
    modelId,
    fileName,
    totalBytes,
    downloadedBytes: 0,
    status: 'queued',
    resumedFrom: 0,
    supportsRange: null,
    error: null,
  };
}

/** 0..1 progress fraction for one queue item. */
export function queueItemProgress(item: DownloadQueueItem): number {
  if (item.totalBytes <= 0) return 0;
  return Math.min(1, Math.max(0, item.downloadedBytes / item.totalBytes));
}

export function enqueueDownload(
  queue: DownloadQueueItem[],
  item: DownloadQueueItem,
): DownloadQueueItem[] {
  return [...queue, item];
}

export function cancelQueueItem(
  queue: DownloadQueueItem[],
  id: string,
): DownloadQueueItem[] {
  return queue.map((item) =>
    item.id === id && (item.status === 'queued' || item.status === 'downloading' || item.status === 'paused')
      ? { ...item, status: 'cancelled' as const }
      : item,
  );
}

export function pauseQueueItem(
  queue: DownloadQueueItem[],
  id: string,
): DownloadQueueItem[] {
  return queue.map((item) =>
    item.id === id && item.status === 'downloading'
      ? { ...item, status: 'paused' as const }
      : item,
  );
}

export type ResumeAction = 'resume-range' | 'restart' | 'already-complete';

/**
 * Decide how a paused item restarts. `supportsRange === false` means the
 * server ignored Range — restart from zero and tell the user, never append
 * to a partial that would corrupt the file. A partial that already spans
 * the full file is complete, not a download.
 */
export function decideResume(
  item: DownloadQueueItem,
): { action: ResumeAction; note: string } {
  if (item.downloadedBytes >= item.totalBytes && item.totalBytes > 0) {
    return { action: 'already-complete', note: 'File is already complete.' };
  }
  if (item.supportsRange === false) {
    return {
      action: 'restart',
      note: 'Server does not support resume — restarting from the beginning.',
    };
  }
  return {
    action: 'resume-range',
    note:
      item.downloadedBytes > 0
        ? `Resuming from ${formatBytes(item.downloadedBytes)}.`
        : 'Starting download.',
  };
}

/** First item that may start downloading (at most one active download). */
export function nextQueuedItem(
  queue: DownloadQueueItem[],
): DownloadQueueItem | null {
  if (queue.some((item) => item.status === 'downloading')) return null;
  return queue.find((item) => item.status === 'queued') ?? null;
}

/* ─── 6. Disk usage ─────────────────────────────────────────────────────── */

export interface DiskUsage {
  perModel: { id: string; displayName: string; bytes: number }[];
  totalBytes: number;
  totalLabel: string;
}

/** Disk usage from downloaded models only; non-downloaded models cost 0. */
export function computeDiskUsage(models: ModelMeta[]): DiskUsage {
  const perModel = models
    .filter((m) => m.downloaded)
    .map((m) => ({ id: m.id, displayName: m.displayName, bytes: m.sizeBytes }))
    .sort((a, b) => b.bytes - a.bytes);
  const totalBytes = perModel.reduce((sum, m) => sum + m.bytes, 0);
  return { perModel, totalBytes, totalLabel: formatBytes(totalBytes) };
}

/** Confirmation copy for deleting a downloaded model. */
export function deleteModelConfirmation(model: ModelMeta): string {
  return (
    `Delete ${model.displayName}? This frees ${formatBytes(model.sizeBytes)} ` +
    `of disk space. The model can be re-downloaded later.`
  );
}

/* ─── 7. Clipboard history ──────────────────────────────────────────────── */

export const MAX_CLIPBOARD_HISTORY = 20;

/**
 * Push a clipboard text onto the history: ignore blanks and consecutive
 * duplicates, cap at MAX_CLIPBOARD_HISTORY (newest first).
 */
export function pushClipboardHistory(
  entries: ClipboardEntry[],
  text: string,
  at = Date.now(),
): ClipboardEntry[] {
  const trimmed = text.trim();
  if (trimmed === '') return entries;
  if (entries[0]?.text === trimmed) return entries;
  const entry: ClipboardEntry = {
    id: `clip-${at.toString(36)}-${entries.length}`,
    text: trimmed,
    at,
  };
  return [entry, ...entries].slice(0, MAX_CLIPBOARD_HISTORY);
}

/* ─── 8. Drag-and-drop attachments ──────────────────────────────────────── */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MiB
export const TEXT_MIME_PREFIX = 'text/';
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'ts', 'tsx', 'js', 'jsx', 'py', 'rs',
  'go', 'java', 'c', 'cpp', 'h', 'html', 'css', 'xml', 'yaml', 'yml', 'toml',
  'log', 'sh', 'sql',
]);

export function classifyAttachedFile(
  name: string,
  mimeType: string,
): AttachedFileKind {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith(TEXT_MIME_PREFIX)) return 'text';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  return 'other';
}

export function validateAttachment(
  file: Pick<AttachedFile, 'name' | 'sizeBytes' | 'mimeType'>,
): string | null {
  if (file.sizeBytes > MAX_ATTACHMENT_BYTES) {
    return `${file.name} is ${formatBytes(file.sizeBytes)} — attachments are limited to ${formatBytes(MAX_ATTACHMENT_BYTES)}.`;
  }
  if (file.sizeBytes <= 0) return `${file.name} is empty.`;
  return null;
}

/* ─── 9. Image attach + vision gating ──────────────────────────────────── */

export function canAttachImage(
  modelVision: boolean,
): { allowed: boolean; reason: string } {
  if (modelVision) {
    return { allowed: true, reason: '' };
  }
  return {
    allowed: false,
    reason:
      'The current model does not support vision. Images are disabled until you switch to a vision model.',
  };
}

/* ─── 10 + 11. Screenshot crop + annotate ──────────────────────────────── */

/**
 * Clamp a crop rect to the image bounds. Returns null when the rect has no
 * usable area (zero/negative size after clamping).
 */
export function normalizeCropRect(
  rect: CropRect,
  imageWidth: number,
  imageHeight: number,
): CropRect | null {
  const x = Math.max(0, Math.min(rect.x, imageWidth));
  const y = Math.max(0, Math.min(rect.y, imageHeight));
  const width = Math.max(0, Math.min(rect.width, imageWidth - x));
  const height = Math.max(0, Math.min(rect.height, imageHeight - y));
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

export function isValidAnnotation(a: Annotation): boolean {
  if (a.kind === 'arrow') {
    return (
      Number.isFinite(a.x1) && Number.isFinite(a.y1) &&
      Number.isFinite(a.x2) && Number.isFinite(a.y2) &&
      (a.x1 !== a.x2 || a.y1 !== a.y2)
    );
  }
  return a.text.trim() !== '' && Number.isFinite(a.x) && Number.isFinite(a.y);
}

/* ─── 12. Voice dictation ───────────────────────────────────────────────── */

/**
 * Dictation availability: the Tauri backend (macOS speech recogniser) is
 * tried first; the Web Speech API is the fallback. At least one path must
 * exist or dictation is honestly unavailable — never a fake transcript.
 */
export function dictationAvailability(input: {
  hasBackend: boolean;
  hasWebSpeech: boolean;
}): { available: boolean; path: 'backend' | 'web-speech' | 'none' } {
  if (input.hasBackend) return { available: true, path: 'backend' };
  if (input.hasWebSpeech) return { available: true, path: 'web-speech' };
  return { available: false, path: 'none' };
}

/* ─── 13. Read-aloud / TTS ─────────────────────────────────────────────── */

export const MAX_TTS_CHARS = 5000;

/**
 * Strip markdown/code fences from a reply before speaking so the user
 * hears prose, not backticks. Truncates to MAX_TTS_CHARS.
 */
export function sanitizeTtsText(text: string): string {
  const stripped = text
    .replace(/```[\s\S]*?```/g, ' code block omitted ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.slice(0, MAX_TTS_CHARS);
}

export function clampTtsRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(2, Math.max(0.5, rate));
}

/* ─── 14. Copy code blocks ──────────────────────────────────────────────── */

export interface CodeBlock {
  language: string;
  code: string;
}

/** Extract every fenced code block from a markdown reply. */
export function extractCodeBlocks(markdown: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const re = /```([^\n`]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown)) !== null) {
    blocks.push({ language: match[1].trim() || 'text', code: match[2] });
  }
  return blocks;
}

/* ─── 15. Regenerate variants ──────────────────────────────────────────── */

export const MAX_VARIANTS = 10;

/** Append a variant, capping history at MAX_VARIANTS (oldest dropped). */
export function addVariant(
  variants: ReplyVariant[],
  variant: ReplyVariant,
): ReplyVariant[] {
  return [...variants, variant].slice(-MAX_VARIANTS);
}

/** Index of the variant to show; clamps out-of-range selections. */
export function clampVariantIndex(variants: ReplyVariant[], index: number): number {
  if (variants.length === 0) return 0;
  return Math.min(variants.length - 1, Math.max(0, index));
}

/* ─── 16. Token / cost stats ───────────────────────────────────────────── */

/**
 * Build stats for one reply from the engine's real numbers. Never invent
 * counts: callers pass the prompt/completion tokens the engine reported
 * (0 when the engine did not report them) and the measured wall-clock time.
 */
export function computeTokenStats(input: {
  promptTokens: number;
  completionTokens: number;
  elapsedMs: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
}): TokenStats {
  const completionTokens = Math.max(0, Math.floor(input.completionTokens));
  const elapsedMs = Math.max(0, input.elapsedMs);
  return {
    promptTokens: Math.max(0, Math.floor(input.promptTokens)),
    completionTokens,
    elapsedMs,
    msPerToken: completionTokens > 0 ? elapsedMs / completionTokens : 0,
    totalPromptTokens: Math.max(0, Math.floor(input.totalPromptTokens)),
    totalCompletionTokens: Math.max(0, Math.floor(input.totalCompletionTokens)),
  };
}

export function formatTokenStats(stats: TokenStats): string {
  const speed =
    stats.msPerToken > 0
      ? `${(1000 / stats.msPerToken).toFixed(1)} tok/s`
      : '—';
  return (
    `${stats.promptTokens} prompt · ${stats.completionTokens} completion · ` +
    `${speed} · session ${stats.totalPromptTokens + stats.totalCompletionTokens} tokens`
  );
}

/* ─── 17. Citations ───────────────────────────────────────────────────── */

/**
 * Extract numbered citations from a web-search answer. Supports Markdown
 * links `[title](url)` (numbered in order of appearance, deduped by URL)
 * and footnote definitions `[n]: url`. Returns the text with citation
 * markers left intact and the source list.
 */
export function parseCitations(text: string): {
  citations: Citation[];
  footnoteUrls: Map<number, string>;
} {
  const footnoteUrls = new Map<number, string>();
  const footnoteRe = /^\[(\d+)\]:\s*(https?:\/\/\S+)\s*$/gm;
  let fm: RegExpExecArray | null;
  while ((fm = footnoteRe.exec(text)) !== null) {
    footnoteUrls.set(Number(fm[1]), fm[2]);
  }
  const citations: Citation[] = [];
  const seen = new Set<string>();
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let lm: RegExpExecArray | null;
  while ((lm = linkRe.exec(text)) !== null) {
    const url = lm[2];
    if (seen.has(url)) continue;
    seen.add(url);
    citations.push({ index: citations.length + 1, title: lm[1], url });
  }
  // Footnote-only sources (no inline link) join the list after links.
  for (const [num, url] of [...footnoteUrls.entries()].sort((a, b) => a[0] - b[0])) {
    void num;
    if (seen.has(url)) continue;
    seen.add(url);
    citations.push({ index: citations.length + 1, title: url, url });
  }
  return { citations, footnoteUrls };
}

/** True when a URL is safe to open from a citation (http/https only). */
export function isSafeCitationUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
