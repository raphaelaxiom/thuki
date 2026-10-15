/** Quick actions panel: one-click actions on selected text. */
import { useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { appendAuditEntry } from '../audit';
import {
  buildQuickActionPrompt,
  copyQuickActionPrompt,
  dispatchQuickAction,
  QUICK_ACTION_LABELS,
  validateQuickAction,
} from '../quickActions';
import { redactPrompt, redactionSummary } from '../redaction';
import { loadSettings } from '../settings';
import type { QuickActionKind } from '../types';
import { buttonStyle, inputStyle, Panel, rowStyle, statusStyle } from './Panel';

const ACTIONS: QuickActionKind[] = [
  'summarise',
  'rewrite',
  'translate',
  'explain',
];

export function QuickActions() {
  const [selection, setSelection] = useState('');
  const [kind, setKind] = useState<QuickActionKind>('summarise');
  const [targetLanguage, setTargetLanguage] = useState('English');
  const [status, setStatus] = useState<string | null>(null);

  const settings = useMemo(() => loadSettings(), []);
  const request = { kind, selection, targetLanguage };
  const validationError = validateQuickAction(request);
  const prompt = validationError ? '' : buildQuickActionPrompt(request);
  const redaction = useMemo(
    () => (prompt ? redactPrompt(prompt, settings.contentFilterEnabled) : null),
    [prompt, settings.contentFilterEnabled],
  );

  const send = async () => {
    if (validationError || !prompt) {
      setStatus(validationError ?? 'Nothing to send.');
      return;
    }
    // Content filter: redact secrets before the prompt leaves this panel.
    const outgoing = redaction?.text ?? prompt;
    if (redaction?.redacted) {
      appendAuditEntry(
        'system_action',
        `Content filter: ${redactionSummary(redaction)}`,
      );
    }
    let handled = dispatchQuickAction(outgoing, kind);
    if (!handled) {
      try {
        await invoke('submit_quick_action', { prompt: outgoing, kind });
        handled = true;
      } catch {
        handled = false;
      }
    }
    if (handled) {
      appendAuditEntry('outbound_request', `Quick action sent: ${kind}`);
      setStatus(`Sent: ${QUICK_ACTION_LABELS[kind]}.`);
    } else {
      const copied = await copyQuickActionPrompt(outgoing);
      setStatus(
        copied
          ? 'Chat pipeline is not wired yet — the prompt was copied, paste it into chat.'
          : 'Chat pipeline is not wired yet — copy the prompt below and paste it into chat.',
      );
    }
  };

  return (
    <Panel
      title="Quick actions"
      description="Run a one-click action on selected text. The prompt is sent through the chat pipeline; secrets are redacted first when the content filter is on."
    >
      <textarea
        style={{
          ...inputStyle,
          minHeight: 96,
          width: '100%',
          boxSizing: 'border-box',
        }}
        aria-label="Selected text"
        placeholder="Paste or type the text to act on…"
        value={selection}
        onChange={(e) => setSelection(e.target.value)}
      />
      <div style={rowStyle}>
        {ACTIONS.map((action) => (
          <button
            key={action}
            style={{
              ...buttonStyle,
              fontWeight: kind === action ? 700 : 400,
              textDecoration: kind === action ? 'underline' : 'none',
            }}
            onClick={() => setKind(action)}
            aria-pressed={kind === action}
          >
            {QUICK_ACTION_LABELS[action]}
          </button>
        ))}
        {kind === 'translate' ? (
          <label>
            To{' '}
            <input
              style={inputStyle}
              aria-label="Target language"
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
            />
          </label>
        ) : null}
      </div>
      {validationError ? (
        <p style={statusStyle}>{validationError}</p>
      ) : (
        <>
          <label style={statusStyle} htmlFor="quick-action-preview">
            Prompt that will be sent:
          </label>
          <textarea
            id="quick-action-preview"
            style={{
              ...inputStyle,
              minHeight: 96,
              width: '100%',
              boxSizing: 'border-box',
            }}
            aria-label="Prompt preview"
            readOnly
            value={redaction?.text ?? prompt}
          />
          {redaction?.redacted ? (
            <p style={statusStyle}>
              Content filter: {redactionSummary(redaction)}
            </p>
          ) : null}
          <div style={rowStyle}>
            <button style={buttonStyle} onClick={send}>
              Send to chat
            </button>
            <button
              style={buttonStyle}
              onClick={async () => {
                const copied = await copyQuickActionPrompt(
                  redaction?.text ?? prompt,
                );
                setStatus(
                  copied ? 'Prompt copied.' : 'Could not copy the prompt.',
                );
              }}
            >
              Copy prompt
            </button>
          </div>
        </>
      )}
      {status ? <p style={statusStyle}>{status}</p> : null}
    </Panel>
  );
}
