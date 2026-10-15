/**
 * Daily briefing: a morning summary generated locally from stored data.
 *
 * The briefing never invents content: every line comes from a real stored
 * reminder or a real stored focus session. When there is nothing to report
 * it says so instead of fabricating a summary.
 */

import type { FocusSession, Reminder } from './types';
import { dueReminders, formatDueTime, isDueSoon } from './reminders';
import { todaysSessions, totalFocusMinutes } from './focus';

export interface BriefingLine {
  kind: 'reminder' | 'focus' | 'note';
  text: string;
}

export interface DailyBriefing {
  dateLabel: string;
  greeting: string;
  lines: BriefingLine[];
  /** True when every line is real stored data (always true by design). */
  fromStoredDataOnly: true;
}

export function buildDailyBriefing(
  reminders: Reminder[],
  sessions: FocusSession[],
  nowMs: number,
): DailyBriefing {
  const date = new Date(nowMs);
  const hour = date.getHours();
  const greeting =
    hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const lines: BriefingLine[] = [];

  const overdue = dueReminders(reminders, nowMs);
  const soon = reminders.filter((r) => isDueSoon(r, nowMs));
  const pending = reminders.filter(
    (r) => !r.done && !overdue.includes(r) && !soon.includes(r),
  );

  if (overdue.length > 0) {
    lines.push({
      kind: 'reminder',
      text: `${overdue.length} overdue reminder${overdue.length === 1 ? '' : 's'}: ${overdue
        .map((r) => r.title)
        .join('; ')}.`,
    });
  }
  for (const reminder of soon) {
    lines.push({
      kind: 'reminder',
      text: `Coming up — ${reminder.title} (${formatDueTime(reminder.dueAtMs, nowMs)}).`,
    });
  }
  if (pending.length > 0) {
    lines.push({
      kind: 'reminder',
      text: `${pending.length} more reminder${pending.length === 1 ? '' : 's'} scheduled later.`,
    });
  }
  if (overdue.length === 0 && soon.length === 0 && pending.length === 0) {
    lines.push({ kind: 'note', text: 'No reminders today.' });
  }

  const today = todaysSessions(sessions, nowMs);
  const completedFocus = today.filter(
    (s) => s.phase === 'focus' && s.completed,
  ).length;
  if (completedFocus > 0 || today.length > 0) {
    lines.push({
      kind: 'focus',
      text: `Focus so far today: ${completedFocus} completed focus session${
        completedFocus === 1 ? '' : 's'
      } (${totalFocusMinutes(today)} min).`,
    });
  } else {
    lines.push({ kind: 'focus', text: 'No focus sessions logged yet today.' });
  }

  return {
    dateLabel: date.toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    greeting,
    lines,
    fromStoredDataOnly: true,
  };
}
