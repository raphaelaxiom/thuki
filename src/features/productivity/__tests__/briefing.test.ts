import { describe, expect, it } from 'vitest';
import { buildDailyBriefing } from '../briefing';
import { buildSession } from '../focus';
import { createReminder } from '../reminders';

describe('daily briefing', () => {
  it('reports no reminders and no sessions honestly', () => {
    const briefing = buildDailyBriefing([], [], Date.now());
    expect(briefing.fromStoredDataOnly).toBe(true);
    expect(briefing.lines.some((l) => l.text === 'No reminders today.')).toBe(
      true,
    );
    expect(
      briefing.lines.some(
        (l) => l.text === 'No focus sessions logged yet today.',
      ),
    ).toBe(true);
  });

  it('builds lines only from stored reminders and sessions', () => {
    const now = Date.now();
    const overdue = createReminder('Pay the bill', now - 1000)!;
    const soon = createReminder('Standup', now + 15 * 60 * 1000)!;
    const later = createReminder('Dentist', now + 5 * 60 * 60 * 1000)!;
    const sessions = [buildSession('focus', 25, 1500, true)];
    const briefing = buildDailyBriefing([overdue, soon, later], sessions, now);
    const text = briefing.lines.map((l) => l.text).join('\n');
    expect(text).toContain('1 overdue reminder');
    expect(text).toContain('Pay the bill');
    expect(text).toContain('Standup');
    expect(text).toContain('1 more reminder scheduled later');
    expect(text).toContain('Focus so far today: 1 completed focus session');
    // Nothing invented: no line mentions a reminder that was not stored.
    expect(text).not.toContain('Meeting');
  });
});
