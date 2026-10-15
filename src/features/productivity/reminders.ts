/**
 * Reminders / follow-ups.
 *
 * A reminder can be created from any message (the message text is stored as
 * `sourceMessage`), has a due time, fires a local notification + appears in
 * the in-app list, and can be marked done.
 */

import type { Reminder } from './types';
import { newId, readJson, STORAGE_KEYS, writeJson } from './storage';

export function loadReminders(): Reminder[] {
  const items = readJson<Reminder[]>(STORAGE_KEYS.reminders, []);
  return Array.isArray(items) ? items : [];
}

export function saveReminders(items: Reminder[]): void {
  writeJson(STORAGE_KEYS.reminders, items);
}

export function createReminder(
  title: string,
  dueAtMs: number,
  sourceMessage?: string,
): Reminder | null {
  const trimmed = title.trim();
  if (trimmed === '' || !Number.isFinite(dueAtMs) || dueAtMs <= 0) return null;
  return {
    id: newId('rem'),
    title: trimmed.slice(0, 500),
    sourceMessage: sourceMessage?.trim()
      ? sourceMessage.trim().slice(0, 2000)
      : undefined,
    dueAtMs,
    done: false,
    createdAtMs: Date.now(),
  };
}

export function markReminderDone(items: Reminder[], id: string): Reminder[] {
  return items.map((r) =>
    r.id === id ? { ...r, done: true, doneAtMs: Date.now() } : r,
  );
}

export function deleteReminder(items: Reminder[], id: string): Reminder[] {
  return items.filter((r) => r.id !== id);
}

export function isOverdue(reminder: Reminder, nowMs: number): boolean {
  return !reminder.done && reminder.dueAtMs <= nowMs;
}

export function isDueSoon(
  reminder: Reminder,
  nowMs: number,
  windowMs = 60 * 60 * 1000,
): boolean {
  return (
    !reminder.done &&
    reminder.dueAtMs > nowMs &&
    reminder.dueAtMs - nowMs <= windowMs
  );
}

export function sortReminders(items: Reminder[]): Reminder[] {
  return [...items].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return a.dueAtMs - b.dueAtMs;
  });
}

/** Reminders that are due (overdue) and not yet notified. */
export function dueReminders(items: Reminder[], nowMs: number): Reminder[] {
  return items.filter((r) => isOverdue(r, nowMs));
}

/**
 * Fires a local OS notification for each newly-due reminder. Guarded:
 * no-ops when the Notification API is unavailable or permission is not
 * granted. `alreadyNotified` holds ids notified before, so each reminder
 * notifies once; returns the updated set.
 */
export function notifyDueReminders(
  items: Reminder[],
  alreadyNotified: ReadonlySet<string>,
  nowMs: number,
): Set<string> {
  const notified = new Set(alreadyNotified);
  if (
    typeof Notification === 'undefined' ||
    Notification.permission !== 'granted'
  ) {
    return notified;
  }
  for (const reminder of dueReminders(items, nowMs)) {
    if (notified.has(reminder.id)) continue;
    try {
      new Notification('Veilura reminder', { body: reminder.title });
      notified.add(reminder.id);
    } catch {
      // Notification construction can throw (e.g. in some webviews);
      // the in-app list still shows the reminder.
    }
  }
  return notified;
}

export function formatDueTime(dueAtMs: number, nowMs: number): string {
  const diff = dueAtMs - nowMs;
  const date = new Date(dueAtMs);
  const time = date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  if (diff <= 0) return `Overdue · due ${time}`;
  if (diff < 60 * 1000) return 'Due in under a minute';
  if (diff < 60 * 60 * 1000) return `Due in ${Math.round(diff / 60000)} min`;
  const sameDay = date.toDateString() === new Date(nowMs).toDateString();
  return sameDay
    ? `Due today at ${time}`
    : `Due ${date.toLocaleDateString()} at ${time}`;
}
