/**
 * System actions bar: lets the user run a real system action from typed
 * text ("open Calculator", "create file notes.txt on Desktop", …) or from
 * the quick-action buttons, and reports exactly what executed.
 *
 * Safety contract (mirrors `system_actions.rs`):
 * - Input is parsed into a structured action — never a shell string.
 * - The backend validates again and executes with `Command`, never a shell.
 * - The status line only claims success when the backend reported success;
 *   failures show the backend's error verbatim. If the backend command is
 *   not wired yet, the status says so instead of pretending it worked.
 */

import { useState } from 'react';
import type { SystemActionRequest, SystemActionResult } from './types';
import {
  describeSystemAction,
  executeSystemAction,
  parseSystemActionText,
} from './systemActions';

export interface SystemActionsBarProps {
  /** Receives every executed (or failed) result for logging / display. */
  readonly onResult?: (result: SystemActionResult) => void;
}

const QUICK_ACTIONS: readonly {
  readonly label: string;
  readonly action: SystemActionRequest;
}[] = [
  { label: 'Open Calculator', action: { kind: 'open_app', app: 'Calculator' } },
  { label: 'Open Notes', action: { kind: 'open_app', app: 'Notes' } },
  {
    label: 'New note',
    action: { kind: 'create_note', title: 'Quick note', content: '' },
  },
  {
    label: 'Reveal Desktop in Finder',
    action: { kind: 'reveal_in_finder', path: '~/Desktop' },
  },
];

export function SystemActionsBar(props: SystemActionsBarProps) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SystemActionResult | null>(null);
  const [preview, setPreview] = useState<SystemActionRequest | null>(null);

  const report = (next: SystemActionResult) => {
    setResult(next);
    props.onResult?.(next);
  };

  const run = async (action: SystemActionRequest) => {
    setBusy(true);
    try {
      report(await executeSystemAction(action));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = () => {
    const action = parseSystemActionText(text);
    if (!action) {
      report({
        ok: false,
        message:
          'Could not understand that as a system action. Try “open Calculator”, “create file notes.txt on Desktop”, “create note Shopping list”, “reveal ~/Desktop in Finder”, or “open https://example.com”. Nothing was run.',
      });
      return;
    }
    void run(action);
  };

  const handleTextChange = (value: string) => {
    setText(value);
    setPreview(parseSystemActionText(value));
  };

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}
      data-testid="system-actions-bar"
    >
      <h2 style={{ margin: 0 }}>System actions</h2>
      <p style={{ margin: 0, fontSize: 13, opacity: 0.8 }}>
        Type an action and Veilura really runs it — opening apps, creating
        files on your Desktop, opening URLs, revealing files in Finder, or
        creating notes. Actions are validated before they run, and the
        result below reports exactly what happened.
      </p>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          aria-label="System action"
          placeholder='Try: open Calculator, or create file notes.txt on Desktop…'
          value={text}
          disabled={busy}
          onChange={(e) => handleTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
          }}
          style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(128,128,128,0.4)' }}
        />
        <button type="button" disabled={busy} onClick={handleSubmit}>
          {busy ? 'Running…' : 'Run'}
        </button>
      </div>

      {preview && (
        <div style={{ fontSize: 13 }} aria-live="polite">
          Will run: <strong>{describeSystemAction(preview)}</strong>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} aria-label="Quick actions">
        {QUICK_ACTIONS.map((item) => (
          <button
            key={item.label}
            type="button"
            disabled={busy}
            onClick={() => void run(item.action)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {result && (
        <div
          role="status"
          style={{
            padding: 10,
            borderRadius: 8,
            border: `1px solid ${result.ok ? 'green' : 'red'}`,
          }}
        >
          <strong>{result.ok ? 'Done: ' : 'Did not run: '}</strong>
          {result.message}
          {result.detail && (
            <div style={{ fontSize: 12, opacity: 0.8 }}>{result.detail}</div>
          )}
        </div>
      )}
    </div>
  );
}
