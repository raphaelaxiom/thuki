/* v8 ignore file -- type-only declarations, no runtime code */

/**
 * Shared types for the Models / Input / Output feature set (Phase 2C).
 *
 * All state in this module is plain JSON so it can be persisted to
 * localStorage (frontend) or SQLite (backend) without transformation.
 * Nothing here imports Tauri or React.
 */

/** One model as shown in the Models panels. */
export interface ModelMeta {
  /** Stable id, e.g. a registry slug or Ollama name. */
  id: string;
  /** Human-readable label. */
  displayName: string;
  /** Weights size in bytes (0 when unknown). */
  sizeBytes: number;
  /** Parameter count in billions, when known (e.g. 12 for 12B). */
  paramsB: number | null;
  /** Max context length in tokens. */
  contextLength: number;
  /** Quantisation label, e.g. "Q4_K_M". */
  quant: string;
  /** Whether the model accepts image inputs. */
  vision: boolean;
  /** Whether the weights are downloaded locally. */
  downloaded: boolean;
  /** Free-form per-model note written by the user. */
  notes: string;
  /**
   * Blob SHA-256s for the downloaded weights (+ mmproj), resolved via the
   * `installed_models` manifest. Needed by delete; omitted for demo models
   * and for models that are not downloaded.
   */
  blobSha256s?: string[];
}

/** Per-model inference settings, persisted per model id. */
export interface PerModelSettings {
  /** Sampling temperature, clamped to 0..2. */
  temperature: number;
  /** Nucleus sampling cutoff, clamped to 0..1. */
  topP: number;
  /** Context length in tokens actually requested at inference time. */
  contextLength: number;
  /** System-prompt override; empty string means "use the global default". */
  systemPromptOverride: string;
}

/** One entry in the multi-download queue. */
export type DownloadQueueStatus =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'done'
  | 'cancelled'
  | 'failed';

export interface DownloadQueueItem {
  id: string;
  modelId: string;
  fileName: string;
  totalBytes: number;
  downloadedBytes: number;
  status: DownloadQueueStatus;
  /** Bytes already on disk when this attempt started (resume floor). */
  resumedFrom: number;
  /**
   * Whether the server answered a Range request (206) for this file.
   * `null` = not probed yet. `false` means resume falls back to a full
   * restart and the UI must say so — never silently corrupt a partial.
   */
  supportsRange: boolean | null;
  error: string | null;
}

/** One remembered clipboard text. */
export interface ClipboardEntry {
  id: string;
  text: string;
  /** Epoch ms when captured. */
  at: number;
}

/** A file the user attached via drag-and-drop / file picker. */
export type AttachedFileKind = 'text' | 'image' | 'other';

export interface AttachedFile {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  kind: AttachedFileKind;
  /** Decoded text for text files; undefined for binary files. */
  textContent?: string;
  /** data: URL preview for images; undefined otherwise. */
  dataUrl?: string;
}

/** One generated variant of the last assistant reply. */
export interface ReplyVariant {
  id: string;
  content: string;
  createdAt: number;
  promptTokens: number;
  completionTokens: number;
  elapsedMs: number;
}

/** Token / latency stats for one reply plus running totals. */
export interface TokenStats {
  promptTokens: number;
  completionTokens: number;
  /** Wall-clock ms for this reply. */
  elapsedMs: number;
  /** ms per completion token; 0 when no completion tokens. */
  msPerToken: number;
  /** Running totals across the session (persisted). */
  totalPromptTokens: number;
  totalCompletionTokens: number;
}

/** A numbered web-search source citation. */
export interface Citation {
  index: number;
  title: string;
  url: string;
}

/** Text-to-speech settings for read-aloud. */
export interface TtsSettings {
  /** macOS voice name, e.g. "Samantha". Empty = system default. */
  voice: string;
  /** Speech rate multiplier, clamped to 0.5..2. */
  rate: number;
  enabled: boolean;
}

/** A rectangle in image-pixel coordinates for screenshot crop/annotate. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One annotation drawn on a screenshot before attaching. */
export type Annotation =
  | {
      kind: 'arrow';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
    }
  | { kind: 'text'; x: number; y: number; text: string; color: string };
