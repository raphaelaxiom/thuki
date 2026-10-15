/** Privacy toggles: capture controls + the local-only guarantee. */
import { useState } from 'react';
import { appendAuditEntry } from '../audit';
import { loadSettings, saveSettings } from '../settings';
import type { PrivacySettings, ProductivitySettings } from '../types';
import { Panel, rowStyle, statusStyle } from './Panel';

function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
}) {
  return (
    <label style={rowStyle}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <strong>{label}</strong>
        {hint ? <span style={statusStyle}> — {hint}</span> : null}
      </span>
    </label>
  );
}

export function PrivacyPanel() {
  const [settings, setSettings] = useState<ProductivitySettings>(() =>
    loadSettings(),
  );

  const setPrivacy = (patch: Partial<PrivacySettings>) => {
    const next: ProductivitySettings = {
      ...settings,
      privacy: { ...settings.privacy, ...patch, telemetry: false },
    };
    setSettings(next);
    saveSettings(next);
    appendAuditEntry(
      'setting_change',
      `Privacy updated: ${JSON.stringify(patch)}`,
    );
  };

  return (
    <Panel
      title="Privacy"
      description="What Veilura is allowed to capture. Everything stays on this device — there is no account, no cloud, and no telemetry."
    >
      <Toggle
        label="Clipboard capture"
        checked={settings.privacy.clipboardCapture}
        onChange={(next) => setPrivacy({ clipboardCapture: next })}
        hint="Read the clipboard for quick actions. Off by default."
      />
      <Toggle
        label="Screen capture"
        checked={settings.privacy.screenCapture}
        onChange={(next) => setPrivacy({ screenCapture: next })}
        hint="Capture the screen for screenshots / OCR. On by default — turn off to block screenshots."
      />
      <Toggle
        label="Web search"
        checked={settings.privacy.webSearch}
        onChange={(next) => setPrivacy({ webSearch: next })}
        hint="Allow outbound web-search requests. Off blocks all search traffic."
      />
      <div style={rowStyle}>
        <span>
          <strong>Telemetry: OFF</strong>
          <span style={statusStyle}>
            {' '}
            — permanently disabled. Veilura sends no usage data, no analytics,
            and no crash reports anywhere. There is no way to turn telemetry on.
          </span>
        </span>
      </div>
      <p style={statusStyle}>
        Local-only guarantee: prompts, conversations, reminders, and the audit
        log live on this device. The only network traffic is web search (when
        enabled above) and model downloads you explicitly start.
      </p>
    </Panel>
  );
}
