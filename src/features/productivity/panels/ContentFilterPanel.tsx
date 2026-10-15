/** Content filter: block/redact secrets & API keys in outbound prompts. */
import { useMemo, useState } from 'react';
import { appendAuditEntry } from '../audit';
import { redactPrompt, redactionSummary } from '../redaction';
import { loadSettings, saveSettings } from '../settings';
import type { ProductivitySettings } from '../types';
import { inputStyle, Panel, rowStyle, statusStyle } from './Panel';

export function ContentFilterPanel() {
  const [settings, setSettings] = useState<ProductivitySettings>(() =>
    loadSettings(),
  );
  const [sample, setSample] = useState(
    'Here is my key: ghp_abcdefghij1234567890abcdefghij1234 — please use it.',
  );
  const preview = useMemo(
    () => redactPrompt(sample, settings.contentFilterEnabled),
    [sample, settings.contentFilterEnabled],
  );

  const toggle = (enabled: boolean) => {
    const next = { ...settings, contentFilterEnabled: enabled };
    setSettings(next);
    saveSettings(next);
    appendAuditEntry(
      'setting_change',
      `Content filter ${enabled ? 'enabled' : 'disabled'}`,
    );
  };

  return (
    <Panel
      title="Content filter"
      description="When on, secrets and API keys are redacted from outbound prompts before they leave this device. The preview shows exactly what would be redacted — never the secret itself."
    >
      <label style={rowStyle}>
        <input
          type="checkbox"
          checked={settings.contentFilterEnabled}
          onChange={(e) => toggle(e.target.checked)}
        />
        <span>
          <strong>Redact secrets in outbound prompts</strong>
        </span>
      </label>
      <label style={statusStyle} htmlFor="filter-sample">
        Try it — paste a prompt containing a test secret:
      </label>
      <textarea
        id="filter-sample"
        style={{
          ...inputStyle,
          minHeight: 72,
          width: '100%',
          boxSizing: 'border-box',
        }}
        aria-label="Sample prompt"
        value={sample}
        onChange={(e) => setSample(e.target.value)}
      />
      <p style={statusStyle}>
        <strong>What would be sent:</strong>
      </p>
      <pre
        style={{
          ...statusStyle,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          margin: 0,
        }}
      >
        {preview.text}
      </pre>
      <p style={statusStyle}>{redactionSummary(preview)}</p>
      <p style={statusStyle}>
        Covered: GitHub / Slack / AWS / OpenAI / Anthropic / Google keys, bearer
        tokens, JWTs, private-key blocks, and `key = value` credential
        assignments. Use test secrets above — never paste a real secret to try
        this out.
      </p>
    </Panel>
  );
}
