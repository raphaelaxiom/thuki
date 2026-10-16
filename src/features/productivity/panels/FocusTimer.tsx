/** Focus timer (Pomodoro) panel. */
import { useEffect, useRef, useState } from 'react';
import { appendAuditEntry } from '../audit';
import {
  buildSession,
  focusLabel,
  formatClock,
  loadFocusSessions,
  nextPhase,
  phaseSeconds,
  saveFocusSessions,
  todaysSessions,
  totalFocusMinutes,
  validateDurations,
} from '../focus';
import { loadSettings, saveSettings } from '../settings';
import type { FocusPhase, FocusSession } from '../types';
import {
  buttonStyle,
  cardStyle,
  inputStyle,
  Panel,
  rowStyle,
  statusStyle,
} from './Panel';

export function FocusTimer() {
  const [settings, setSettings] = useState(() => loadSettings());
  const [sessions, setSessions] = useState<FocusSession[]>(() =>
    loadFocusSessions(),
  );
  const [phase, setPhase] = useState<FocusPhase>('focus');
  const [remaining, setRemaining] = useState(() =>
    phaseSeconds('focus', loadSettings().focus),
  );
  const [running, setRunning] = useState(false);
  const [focusCompleted, setFocusCompleted] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const elapsedRef = useRef(0);

  const durations = settings.focus;

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      elapsedRef.current += 1;
      setRemaining((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running, phase]);

  // Phase completion: record the session, advance, stop (user starts next).
  useEffect(() => {
    if (!running || remaining !== 0) return;
    const plannedMin =
      phase === 'focus'
        ? durations.focusMin
        : phase === 'shortBreak'
          ? durations.shortBreakMin
          : durations.longBreakMin;
    const session = buildSession(phase, plannedMin, elapsedRef.current, true);
    const next = [...sessions, session];
    setSessions(next);
    saveFocusSessions(next);
    appendAuditEntry(
      'system_action',
      `Focus session completed: ${focusLabel(phase)} (${plannedMin} min)`,
    );
    const completed = phase === 'focus' ? focusCompleted + 1 : focusCompleted;
    setFocusCompleted(completed);
    const nextPhaseValue = nextPhase(phase, completed);
    setPhase(nextPhaseValue);
    setRemaining(phaseSeconds(nextPhaseValue, durations));
    elapsedRef.current = 0;
    setRunning(false);
    setStatus(
      `${focusLabel(phase)} complete. Next: ${focusLabel(nextPhaseValue)}.`,
    );
    // eslint-disable-next-line @eslint-react/exhaustive-deps
  }, [remaining, running]);

  const startPause = () => {
    setRunning((prev) => !prev);
    setStatus(null);
  };

  const reset = () => {
    setRunning(false);
    elapsedRef.current = 0;
    setRemaining(phaseSeconds(phase, durations));
    setStatus('Timer reset.');
  };

  const skip = () => {
    const session = buildSession(
      phase,
      phase === 'focus'
        ? durations.focusMin
        : phase === 'shortBreak'
          ? durations.shortBreakMin
          : durations.longBreakMin,
      elapsedRef.current,
      false,
    );
    const next = [...sessions, session];
    setSessions(next);
    saveFocusSessions(next);
    const completed = phase === 'focus' ? focusCompleted + 1 : focusCompleted;
    setFocusCompleted(completed);
    const nextPhaseValue = nextPhase(phase, completed);
    setPhase(nextPhaseValue);
    setRemaining(phaseSeconds(nextPhaseValue, durations));
    elapsedRef.current = 0;
    setRunning(false);
    setStatus('Phase skipped.');
  };

  const saveDurations = (patch: Partial<typeof durations>) => {
    const nextDurations = { ...durations, ...patch };
    const error = validateDurations(nextDurations);
    if (error) {
      setStatus(error);
      return;
    }
    const nextSettings = { ...settings, focus: nextDurations };
    setSettings(nextSettings);
    saveSettings(nextSettings);
    setRemaining(phaseSeconds(phase, nextDurations));
    setStatus('Durations saved.');
  };

  const today = todaysSessions(sessions, Date.now());

  return (
    <Panel
      title="Focus timer"
      description="Pomodoro timer: focus, then a short break; every 4th focus block earns a long break. Sessions are saved to history."
    >
      <div style={{ ...cardStyle, alignItems: 'center' }}>
        <span style={{ fontSize: 13 }}>{focusLabel(phase)}</span>
        <strong style={{ fontSize: 48, lineHeight: 1 }} aria-live="polite">
          {formatClock(remaining)}
        </strong>
        <span style={statusStyle}>
          Focus blocks this cycle: {focusCompleted} · Today:{' '}
          {totalFocusMinutes(today)} min
        </span>
        <span style={rowStyle}>
          <button style={buttonStyle} onClick={startPause}>
            {running ? 'Pause' : 'Start'}
          </button>
          <button style={buttonStyle} onClick={reset}>
            Reset
          </button>
          <button style={buttonStyle} onClick={skip}>
            Skip phase
          </button>
        </span>
        {status ? <p style={statusStyle}>{status}</p> : null}
      </div>
      <div style={rowStyle}>
        <label>
          Focus (min){' '}
          <input
            style={inputStyle}
            aria-label="Focus minutes"
            type="number"
            min={1}
            max={180}
            value={durations.focusMin}
            onChange={(e) =>
              saveDurations({ focusMin: Number(e.target.value) })
            }
          />
        </label>
        <label>
          Short break (min){' '}
          <input
            style={inputStyle}
            aria-label="Short break minutes"
            type="number"
            min={1}
            max={60}
            value={durations.shortBreakMin}
            onChange={(e) =>
              saveDurations({ shortBreakMin: Number(e.target.value) })
            }
          />
        </label>
        <label>
          Long break (min){' '}
          <input
            style={inputStyle}
            aria-label="Long break minutes"
            type="number"
            min={1}
            max={90}
            value={durations.longBreakMin}
            onChange={(e) =>
              saveDurations({ longBreakMin: Number(e.target.value) })
            }
          />
        </label>
      </div>
      <h3 style={{ margin: 0, fontSize: 15 }}>Session history</h3>
      {sessions.length === 0 ? (
        <p style={statusStyle}>No sessions yet.</p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {[...sessions]
            .slice(-10)
            .reverse()
            .map((session) => (
              <li key={session.id} style={statusStyle}>
                {new Date(session.endedAtMs).toLocaleString()} ·{' '}
                {focusLabel(session.phase)} ·{' '}
                {Math.round(session.elapsedSec / 60)} min ·{' '}
                {session.completed ? 'completed' : 'skipped'}
              </li>
            ))}
        </ul>
      )}
    </Panel>
  );
}
