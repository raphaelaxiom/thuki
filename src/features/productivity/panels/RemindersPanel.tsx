/** Reminders / follow-ups panel. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { appendAuditEntry } from '../audit';
import {
  createReminder,
  deleteReminder,
  dueReminders,
  formatDueTime,
  isOverdue,
  loadReminders,
  markReminderDone,
  notifyDueReminders,
  saveReminders,
  sortReminders,
} from '../reminders';
import type { Reminder } from '../types';
import {
  buttonStyle,
  cardStyle,
  inputStyle,
  Panel,
  rowStyle,
  statusStyle,
} from './Panel';

function toLocalInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function RemindersPanel() {
  const [items, setItems] = useState<Reminder[]>(() => loadReminders());
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(() =>
    toLocalInput(Date.now() + 60 * 60 * 1000),
  );
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const notifiedRef = useRef<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState(Date.now());

  const sorted = useMemo(() => sortReminders(items), [items]);
  const dueCount = useMemo(() => dueReminders(items, now).length, [items, now]);

  // Poll for newly-due reminders: local notification + in-app list.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = loadReminders();
      setNow(Date.now());
      notifiedRef.current = notifyDueReminders(
        current,
        notifiedRef.current,
        Date.now(),
      );
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const persist = (next: Reminder[]) => {
    setItems(next);
    saveReminders(next);
  };

  const add = () => {
    const dueMs = new Date(due).getTime();
    const reminder = createReminder(
      title,
      dueMs,
      message.trim() ? message : undefined,
    );
    if (!reminder) {
      setError('Enter a title and a valid due time.');
      return;
    }
    setError(null);
    persist([reminder, ...items]);
    appendAuditEntry('system_action', `Reminder created: ${reminder.title}`);
    setTitle('');
    setMessage('');
  };

  const useMessageAsReminder = () => {
    const text = message.trim();
    if (!text) {
      setError('Paste a message first.');
      return;
    }
    setError(null);
    // Title defaults to the message's first line (max 100 chars).
    setTitle(text.split('\n')[0].slice(0, 100));
  };

  return (
    <Panel
      title="Reminders"
      description="Create a follow-up from any message. Due reminders notify you locally and stay listed here until marked done."
    >
      <div style={rowStyle}>
        <input
          style={{ ...inputStyle, flex: 1, minWidth: 200 }}
          aria-label="Reminder title"
          placeholder="Reminder title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          style={inputStyle}
          aria-label="Due time"
          type="datetime-local"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
        <button style={buttonStyle} onClick={add}>
          Add reminder
        </button>
      </div>
      <div style={rowStyle}>
        <textarea
          style={{ ...inputStyle, flex: 1, minWidth: 200, minHeight: 56 }}
          aria-label="Source message"
          placeholder="Paste a message to create a reminder from it…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button style={buttonStyle} onClick={useMessageAsReminder}>
          Use message as title
        </button>
      </div>
      {error ? (
        <p style={{ ...statusStyle, color: '#b3261e' }}>{error}</p>
      ) : null}
      {dueCount > 0 ? (
        <p style={statusStyle} role="status">
          {dueCount} reminder{dueCount === 1 ? '' : 's'} due now.
        </p>
      ) : null}
      {sorted.length === 0 ? (
        <p style={statusStyle}>No reminders yet.</p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {sorted.map((reminder) => (
            <li key={reminder.id} style={cardStyle}>
              <strong
                style={{
                  textDecoration: reminder.done ? 'line-through' : 'none',
                }}
              >
                {reminder.title}
              </strong>
              <span style={statusStyle}>
                {formatDueTime(reminder.dueAtMs, now)}
              </span>
              {reminder.sourceMessage ? (
                <span style={statusStyle}>
                  From message: {reminder.sourceMessage}
                </span>
              ) : null}
              {isOverdue(reminder, now) && !reminder.done ? (
                <span style={{ ...statusStyle, color: '#b3261e' }}>
                  Due now
                </span>
              ) : null}
              <span style={rowStyle}>
                {!reminder.done ? (
                  <button
                    style={buttonStyle}
                    onClick={() => {
                      persist(markReminderDone(items, reminder.id));
                      appendAuditEntry(
                        'system_action',
                        `Reminder done: ${reminder.title}`,
                      );
                    }}
                  >
                    Mark done
                  </button>
                ) : null}
                <button
                  style={buttonStyle}
                  onClick={() => {
                    persist(deleteReminder(items, reminder.id));
                    appendAuditEntry(
                      'data_delete',
                      `Reminder deleted: ${reminder.title}`,
                    );
                  }}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
