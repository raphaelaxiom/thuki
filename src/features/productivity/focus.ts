/**
 * Focus timer (Pomodoro): pure state helpers + persistence.
 *
 * The timer itself ticks in the component with `setInterval`; these
 * helpers own the phase math, the durations, and the session history so
 * they are unit-testable without timers.
 */

import type { FocusDurations, FocusPhase, FocusSession } from './types';
import { newId, readJson, STORAGE_KEYS, writeJson } from './storage';

export const DEFAULT_DURATIONS: FocusDurations = {
  focusMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
};

/** After every 4th focus block, take a long break. */
export const FOCUSES_PER_LONG_BREAK = 4;

export function loadFocusSessions(): FocusSession[] {
  const items = readJson<FocusSession[]>(STORAGE_KEYS.focusSessions, []);
  return Array.isArray(items) ? items : [];
}

export function saveFocusSessions(items: FocusSession[]): void {
  writeJson(STORAGE_KEYS.focusSessions, items);
}

/** Planned seconds for a phase under the given durations. */
export function phaseSeconds(
  phase: FocusPhase,
  durations: FocusDurations,
): number {
  switch (phase) {
    case 'focus':
      return durations.focusMin * 60;
    case 'shortBreak':
      return durations.shortBreakMin * 60;
    case 'longBreak':
      return durations.longBreakMin * 60;
  }
}

/**
 * Next phase after a finished one. `focusCompleted` counts focus blocks
 * finished in this cycle (including the one just ended).
 */
export function nextPhase(
  phase: FocusPhase,
  focusCompleted: number,
): FocusPhase {
  if (phase === 'focus') {
    return focusCompleted % FOCUSES_PER_LONG_BREAK === 0
      ? 'longBreak'
      : 'shortBreak';
  }
  return 'focus';
}

export function focusLabel(phase: FocusPhase): string {
  switch (phase) {
    case 'focus':
      return 'Focus';
    case 'shortBreak':
      return 'Short break';
    case 'longBreak':
      return 'Long break';
  }
}

export function validateDurations(durations: FocusDurations): string | null {
  if (
    !Number.isInteger(durations.focusMin) ||
    durations.focusMin < 1 ||
    durations.focusMin > 180
  ) {
    return 'Focus duration must be 1–180 minutes.';
  }
  if (
    !Number.isInteger(durations.shortBreakMin) ||
    durations.shortBreakMin < 1 ||
    durations.shortBreakMin > 60
  ) {
    return 'Short break must be 1–60 minutes.';
  }
  if (
    !Number.isInteger(durations.longBreakMin) ||
    durations.longBreakMin < 1 ||
    durations.longBreakMin > 90
  ) {
    return 'Long break must be 1–90 minutes.';
  }
  return null;
}

export function buildSession(
  phase: FocusPhase,
  plannedMin: number,
  elapsedSec: number,
  completed: boolean,
): FocusSession {
  return {
    id: newId('focus'),
    phase,
    plannedMin,
    elapsedSec,
    completed,
    endedAtMs: Date.now(),
  };
}

/** Total completed focus minutes across the history. */
export function totalFocusMinutes(sessions: FocusSession[]): number {
  return Math.round(
    sessions
      .filter((s) => s.phase === 'focus' && s.completed)
      .reduce((sum, s) => sum + s.elapsedSec, 0) / 60,
  );
}

/** Sessions finished today (local calendar day). */
export function todaysSessions(
  sessions: FocusSession[],
  nowMs: number,
): FocusSession[] {
  const today = new Date(nowMs).toDateString();
  return sessions.filter((s) => new Date(s.endedAtMs).toDateString() === today);
}

export function formatClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const min = Math.floor(clamped / 60);
  const sec = clamped % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
