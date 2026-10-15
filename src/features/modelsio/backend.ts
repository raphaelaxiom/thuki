/**
 * Tauri command wrappers for the Models / Input / Output feature set.
 *
 * Each wrapper calls one `models_io_*` command (see
 * `src-tauri/src/models_io.rs` and `INTEGRATION-modelsio.md`). Until the
 * parent wires those commands, every wrapper rejects with a clear
 * "not wired yet" error instead of silently doing nothing — components
 * catch that and fall back to their local path (localStorage, Web Speech
 * API, `speechSynthesis`, canvas crop) so the UI stays usable.
 *
 * Callers must never let a wrapper rejection crash the panel: handle it
 * and surface the fallback status in the UI.
 */

import { invoke } from '@tauri-apps/api/core';
import type {
  DownloadQueueItem,
  PerModelSettings,
  TokenStats,
} from './types';

export const MODELS_IO_NOT_WIRED = 'models_io command not wired yet';

/** True when running inside the Tauri webview (vs. plain browser / tests). */
export function isTauri(): boolean {
  try {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  } catch {
    return false;
  }
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error(MODELS_IO_NOT_WIRED);
  return invoke<T>(command, args);
}

/* ─── Models ────────────────────────────────────────────────────────────── */

/** Persist per-model settings server-side (SQLite) in addition to localStorage. */
export function savePerModelSettingsBackend(
  modelId: string,
  settings: PerModelSettings,
): Promise<void> {
  return call('models_io_set_model_settings', { modelId, settings });
}

export function loadPerModelSettingsBackend(
  modelId: string,
): Promise<PerModelSettings | null> {
  return call('models_io_get_model_settings', { modelId });
}

/**
 * Delete a downloaded model's files. The caller passes the blob SHA-256s
 * resolved via the `installed_models` manifest (see ModelMeta.blobSha256s);
 * the backend validates each SHA and returns bytes actually freed.
 */
export function deleteDownloadedModelBackend(
  modelId: string,
  blobSha256s: string[],
): Promise<number> {
  return call('models_io_delete_model', { modelId, blobSha256s });
}

/** Disk usage rows from the real model store (`blobs/` + `tmp/`). */
export function getDiskUsageBackend(): Promise<
  { sha256: string; bytes: number; location: string }[]
> {
  return call('models_io_disk_usage', {});
}

/* ─── Download queue ────────────────────────────────────────────────────── */

/** Enqueue a model download on the backend queue. */
export function enqueueDownloadBackend(item: DownloadQueueItem): Promise<void> {
  return call('models_io_enqueue_download', { item });
}

/** Pause one queued/in-flight download (partial kept for resume). */
export function pauseDownloadBackend(id: string): Promise<void> {
  return call('models_io_pause_download', { id });
}

/**
 * Resume a paused download. The backend answers with whether the server
 * honoured Range; the UI reports a restart honestly when it did not.
 */
export function resumeDownloadBackend(id: string): Promise<{ resumed: boolean; note: string }> {
  return call('models_io_resume_download', { id });
}

export function cancelDownloadBackend(id: string): Promise<void> {
  return call('models_io_cancel_download', { id });
}

/* ─── Input ─────────────────────────────────────────────────────────────── */

/** Read the macOS clipboard via the backend (`pbpaste`). */
export function readClipboardBackend(): Promise<string> {
  return call('models_io_read_clipboard', {});
}

/**
 * Capture a screenshot region via the backend. Returns a base64 PNG, or
 * null when the user cancelled the selection.
 */
export function captureScreenshotBackend(): Promise<string | null> {
  return call('models_io_capture_screenshot', {});
}

/** Start macOS speech recognition via the backend. Returns the transcript. */
export function dictateBackend(): Promise<string> {
  return call('models_io_dictate', {});
}

/* ─── Output ────────────────────────────────────────────────────────────── */

/** Speak text via macOS `say` (backend). `stop` cancels any in-flight speech. */
export function speakBackend(text: string, voice: string, rate: number): Promise<void> {
  return call('models_io_speak', { text, voice, rate });
}

export function stopSpeakingBackend(): Promise<void> {
  return call('models_io_stop_speaking', {});
}

/** Abort the in-flight generation (same backend token as `cancel_generation`). */
export function stopGenerationBackend(): Promise<void> {
  return call('models_io_stop_generation', {});
}

/**
 * Token stats for the last reply, from the engine's real usage numbers.
 * Returns null when the engine reported no usage block.
 */
export function getLastTokenStatsBackend(): Promise<TokenStats | null> {
  return call('models_io_last_token_stats', {});
}
