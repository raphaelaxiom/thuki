/** Daily briefing panel: morning summary from stored data only. */
import { useState } from 'react';
import { buildDailyBriefing } from '../briefing';
import { loadFocusSessions } from '../focus';
import { loadReminders } from '../reminders';
import { buttonStyle, Panel, rowStyle, statusStyle } from './Panel';

export function DailyBriefing() {
  const [now, setNow] = useState(() => Date.now());
  const briefing = buildDailyBriefing(
    loadReminders(),
    loadFocusSessions(),
    now,
  );

  return (
    <Panel
      title="Daily briefing"
      description="Your morning summary. Every line comes from stored reminders and focus sessions — nothing is invented."
    >
      <p style={{ margin: 0, fontSize: 15 }}>
        {briefing.greeting}. {briefing.dateLabel}.
      </p>
      <ul
        style={{
          margin: 0,
          paddingLeft: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        {briefing.lines.map((line, i) => (
          <li key={i} style={statusStyle}>
            {line.text}
          </li>
        ))}
      </ul>
      <div style={rowStyle}>
        <button style={buttonStyle} onClick={() => setNow(Date.now())}>
          Refresh briefing
        </button>
        <span style={statusStyle}>
          Generated locally from stored data only.
        </span>
      </div>
    </Panel>
  );
}
