/**
 * Productivity feature types (Phase 2D).
 *
 * All state is plain JSON so it can be persisted to localStorage, exported
 * in a backup file, and validated by the Rust `validate_backup_json`.
 */

export interface Reminder {
  id: string;
  title: string;
  /** Optional source message this reminder was created from. */
  sourceMessage?: string;
  /** Unix timestamp (ms) the reminder is due. */
  dueAtMs: number;
  done: boolean;
  createdAtMs: number;
  /** Set when the user marks the reminder done. */
  doneAtMs?: number;
}

export type FocusPhase = 'focus' | 'shortBreak' | 'longBreak';

export interface FocusDurations {
  focusMin: number;
  shortBreakMin: number;
  longBreakMin: number;
}

export interface FocusSession {
  id: string;
  phase: FocusPhase;
  /** Planned length in minutes. */
  plannedMin: number;
  /** Actual elapsed seconds when the session ended. */
  elapsedSec: number;
  completed: boolean;
  endedAtMs: number;
}

export interface FocusState {
  durations: FocusDurations;
  sessions: FocusSession[];
}

export type QuickActionKind = 'summarise' | 'rewrite' | 'translate' | 'explain';

export interface QuickActionRequest {
  kind: QuickActionKind;
  /** The selected text the action runs on. */
  selection: string;
  /** Target language for `translate` (e.g. "Hindi"). Defaults to "English". */
  targetLanguage?: string;
}

export type ThemeId = 'light' | 'dark' | 'system' | 'forest' | 'sunset';
export type DensityId = 'compact' | 'comfortable';

export interface PrivacySettings {
  clipboardCapture: boolean;
  screenCapture: boolean;
  webSearch: boolean;
  /** Telemetry is permanently off: there is no toggle to enable it. */
  telemetry: false;
}

export interface ProductivitySettings {
  theme: ThemeId;
  fontSizePx: number;
  density: DensityId;
  privacy: PrivacySettings;
  /** When true, outbound prompts pass through secret redaction. */
  contentFilterEnabled: boolean;
  focus: FocusDurations;
}

export interface ShortcutBinding {
  id: string;
  label: string;
  keys: string;
}

export type AuditKind =
  | 'outbound_request'
  | 'system_action'
  | 'setting_change'
  | 'data_delete'
  | 'backup'
  | 'restore'
  | 'engine_restart';

export interface AuditEntry {
  id: string;
  tsMs: number;
  kind: AuditKind;
  /** Human-readable detail. Must never contain secret values. */
  detail: string;
}

export interface ProductivityBackup {
  version: 1;
  app: 'veilura';
  exportedAt: string;
  data: {
    reminders: Reminder[];
    focusSessions: FocusSession[];
    settings: ProductivitySettings;
    shortcuts: ShortcutBinding[];
    auditLog: AuditEntry[];
  };
}

export interface StorageBreakdownEntry {
  key: string;
  label: string;
  bytes: number;
  items: number;
}
