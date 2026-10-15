/** Global shortcuts + full keyboard shortcut editor. */
import { useMemo, useState } from 'react';
import { appendAuditEntry } from '../audit';
import {
  defaultShortcuts,
  detectShortcutConflicts,
  loadShortcuts,
  normalizeShortcut,
  resetShortcuts,
  saveShortcuts,
  validateShortcutKeys,
} from '../shortcuts';
import type { ShortcutBinding } from '../types';
import {
  buttonStyle,
  cardStyle,
  inputStyle,
  Panel,
  rowStyle,
  statusStyle,
} from './Panel';

function ConflictList({ bindings }: { bindings: ShortcutBinding[] }) {
  const conflicts = useMemo(
    () => detectShortcutConflicts(bindings),
    [bindings],
  );
  if (conflicts.length === 0) return <p style={statusStyle}>No conflicts.</p>;
  return (
    <div style={{ ...cardStyle, borderColor: '#b3261e' }}>
      <strong>Conflicts detected</strong>
      {conflicts.map((c) => (
        <p key={c.keys} style={statusStyle}>
          {c.keys} is bound to: {c.ids.join(', ')}
        </p>
      ))}
    </div>
  );
}

function useBindings() {
  const [bindings, setBindings] = useState<ShortcutBinding[]>(() =>
    loadShortcuts(),
  );
  const update = (id: string, keys: string) => {
    const next = bindings.map((b) => (b.id === id ? { ...b, keys } : b));
    setBindings(next);
    saveShortcuts(next);
  };
  return { bindings, setBindings, update };
}

/**
 * Global shortcuts: remap the summon hotkey and the second shortcut
 * (new chat). Persisted; conflicts against the full set are detected.
 */
export function GlobalShortcutsPanel() {
  const { bindings, update } = useBindings();
  const summon = bindings.find((b) => b.id === 'summon');
  const second = bindings.find((b) => b.id === 'new_chat');
  const [status, setStatus] = useState<string | null>(null);

  const edit = (binding: ShortcutBinding | undefined, keys: string) => {
    if (!binding) return;
    const error = validateShortcutKeys(keys);
    if (error) {
      setStatus(error);
      return;
    }
    update(binding.id, keys);
    appendAuditEntry(
      'setting_change',
      `Shortcut changed: ${binding.label} → ${normalizeShortcut(keys)}`,
    );
    setStatus(`Saved: ${binding.label} → ${normalizeShortcut(keys)}`);
  };

  if (!summon || !second) return null;
  return (
    <Panel
      title="Global shortcuts"
      description="Remap the summon hotkey and the second global shortcut. Changes persist immediately; conflicts are flagged before they can bite."
    >
      <label style={rowStyle}>
        Summon Veilura overlay{' '}
        <input
          style={inputStyle}
          aria-label="Summon shortcut"
          defaultValue={summon.keys}
          onBlur={(e) => edit(summon, e.target.value)}
        />
        <span style={statusStyle}>
          Current: {normalizeShortcut(summon.keys)}
        </span>
      </label>
      <label style={rowStyle}>
        New chat{' '}
        <input
          style={inputStyle}
          aria-label="New chat shortcut"
          defaultValue={second.keys}
          onBlur={(e) => edit(second, e.target.value)}
        />
        <span style={statusStyle}>
          Current: {normalizeShortcut(second.keys)}
        </span>
      </label>
      {status ? <p style={statusStyle}>{status}</p> : null}
      <ConflictList bindings={bindings} />
      <p style={statusStyle}>
        Note: the native OS-level hotkey is registered by the parent app from
        these values (see INTEGRATION-productivity.md). Until then, these values
        are the source of truth the app reads on launch.
      </p>
    </Panel>
  );
}

/** Full keyboard shortcut editor: list all, edit, reset to defaults. */
export function KeyboardShortcutEditor() {
  const { bindings, setBindings, update } = useBindings();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(null);

  const edit = (binding: ShortcutBinding, keys: string) => {
    const error = validateShortcutKeys(keys);
    setErrors((prev) => ({ ...prev, [binding.id]: error ?? '' }));
    if (error) return;
    update(binding.id, keys);
  };

  const reset = () => {
    setBindings(resetShortcuts());
    setErrors({});
    appendAuditEntry('setting_change', 'Shortcuts reset to defaults');
    setStatus('Shortcuts reset to defaults.');
  };

  return (
    <Panel
      title="Keyboard shortcut editor"
      description="Every shortcut in one place. Edit a binding, fix any conflict, or reset everything to defaults."
    >
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
        {bindings.map((binding) => (
          <li key={binding.id} style={rowStyle}>
            <span style={{ flex: 1, minWidth: 200 }}>{binding.label}</span>
            <input
              style={inputStyle}
              aria-label={`Shortcut for ${binding.label}`}
              defaultValue={binding.keys}
              onBlur={(e) => edit(binding, e.target.value)}
            />
            <span style={statusStyle}>→ {normalizeShortcut(binding.keys)}</span>
            {errors[binding.id] ? (
              <span style={{ ...statusStyle, color: '#b3261e' }}>
                {errors[binding.id]}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <div style={rowStyle}>
        <button style={buttonStyle} onClick={reset}>
          Reset to defaults
        </button>
        {status ? <span style={statusStyle}>{status}</span> : null}
      </div>
      <ConflictList bindings={bindings} />
      <p style={statusStyle}>
        Defaults: {defaultShortcuts().length} shortcuts. Changes persist
        immediately.
      </p>
    </Panel>
  );
}
