import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createReminder,
  deleteReminder,
  dueReminders,
  formatDueTime,
  isDueSoon,
  isOverdue,
  loadReminders,
  markReminderDone,
  saveReminders,
  sortReminders,
} from '../reminders';
import { STORAGE_KEYS } from '../storage';

describe('reminders', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('creates, persists, and loads reminders', () => {
    const reminder = createReminder(
      'Call back',
      Date.now() + 3600_000,
      'source msg',
    );
    expect(reminder).not.toBeNull();
    expect(reminder?.sourceMessage).toBe('source msg');
    saveReminders([reminder!]);
    expect(loadReminders()).toHaveLength(1);
    expect(loadReminders()[0].title).toBe('Call back');
  });

  it('rejects empty titles and bad due times', () => {
    expect(createReminder('   ', Date.now() + 1000)).toBeNull();
    expect(createReminder('x', 0)).toBeNull();
    expect(createReminder('x', Number.NaN)).toBeNull();
  });

  it('marks done and deletes', () => {
    const a = createReminder('A', Date.now() + 1000)!;
    const b = createReminder('B', Date.now() + 2000)!;
    const done = markReminderDone([a, b], a.id);
    expect(done.find((r) => r.id === a.id)?.done).toBe(true);
    expect(done.find((r) => r.id === a.id)?.doneAtMs).toBeGreaterThan(0);
    expect(deleteReminder(done, a.id)).toHaveLength(1);
  });

  it('classifies overdue and due-soon', () => {
    const now = Date.now();
    const overdue = createReminder('old', now - 1000)!;
    const soon = createReminder('soon', now + 30 * 60 * 1000)!;
    const later = createReminder('later', now + 5 * 60 * 60 * 1000)!;
    expect(isOverdue(overdue, now)).toBe(true);
    expect(isOverdue(soon, now)).toBe(false);
    expect(isDueSoon(soon, now)).toBe(true);
    expect(isDueSoon(later, now)).toBe(false);
    expect(dueReminders([overdue, soon, later], now)).toEqual([overdue]);
  });

  it('sorts pending first by due time, done last', () => {
    const now = Date.now();
    const done = { ...createReminder('done', now + 1000)!, done: true };
    const later = createReminder('later', now + 5000)!;
    const sooner = createReminder('sooner', now + 1000)!;
    expect(sortReminders([done, later, sooner]).map((r) => r.title)).toEqual([
      'sooner',
      'later',
      'done',
    ]);
  });

  it('formats due times', () => {
    const now = Date.now();
    expect(formatDueTime(now - 1, now)).toContain('Overdue');
    expect(formatDueTime(now + 30 * 60 * 1000, now)).toContain('Due in 30 min');
  });

  it('tolerates corrupt stored JSON', () => {
    window.localStorage.setItem(STORAGE_KEYS.reminders, '{bad json');
    expect(loadReminders()).toEqual([]);
  });
});
