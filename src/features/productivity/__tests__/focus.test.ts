import { describe, expect, it } from 'vitest';
import {
  buildSession,
  focusLabel,
  formatClock,
  nextPhase,
  phaseSeconds,
  todaysSessions,
  totalFocusMinutes,
  validateDurations,
} from '../focus';

describe('focus timer helpers', () => {
  it('maps phases to seconds', () => {
    const durations = { focusMin: 25, shortBreakMin: 5, longBreakMin: 15 };
    expect(phaseSeconds('focus', durations)).toBe(1500);
    expect(phaseSeconds('shortBreak', durations)).toBe(300);
    expect(phaseSeconds('longBreak', durations)).toBe(900);
  });

  it('takes a long break after every 4th focus block', () => {
    expect(nextPhase('focus', 1)).toBe('shortBreak');
    expect(nextPhase('focus', 3)).toBe('shortBreak');
    expect(nextPhase('focus', 4)).toBe('longBreak');
    expect(nextPhase('focus', 8)).toBe('longBreak');
    expect(nextPhase('shortBreak', 1)).toBe('focus');
    expect(nextPhase('longBreak', 4)).toBe('focus');
  });

  it('labels phases', () => {
    expect(focusLabel('focus')).toBe('Focus');
    expect(focusLabel('shortBreak')).toBe('Short break');
    expect(focusLabel('longBreak')).toBe('Long break');
  });

  it('validates durations', () => {
    expect(
      validateDurations({ focusMin: 25, shortBreakMin: 5, longBreakMin: 15 }),
    ).toBeNull();
    expect(
      validateDurations({ focusMin: 0, shortBreakMin: 5, longBreakMin: 15 }),
    ).toContain('Focus');
    expect(
      validateDurations({ focusMin: 25, shortBreakMin: 61, longBreakMin: 15 }),
    ).toContain('Short');
    expect(
      validateDurations({ focusMin: 25, shortBreakMin: 5, longBreakMin: 91 }),
    ).toContain('Long');
  });

  it('builds sessions and totals focus minutes', () => {
    const sessions = [
      buildSession('focus', 25, 1500, true),
      buildSession('focus', 25, 750, true),
      buildSession('shortBreak', 5, 300, true),
      buildSession('focus', 25, 100, false),
    ];
    expect(totalFocusMinutes(sessions)).toBe(38); // (1500+750)/60 = 37.5 → 38
    expect(todaysSessions(sessions, Date.now())).toHaveLength(4);
  });

  it('formats the clock', () => {
    expect(formatClock(1500)).toBe('25:00');
    expect(formatClock(65)).toBe('01:05');
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(-5)).toBe('00:00');
  });
});
