/** Local-only audit log: view, filter, export, clear. */
import { useMemo, useState } from 'react';
import {
  appendAuditEntry,
  AUDIT_KINDS,
  auditLogToText,
  filterAuditLog,
  loadAuditLog,
  saveAuditLog,
  sortAuditLogNewestFirst,
} from '../audit';
import { downloadTextFile } from '../storage';
import type { AuditKind } from '../types';
import {
  buttonStyle,
  cardStyle,
  dangerButtonStyle,
  inputStyle,
  Panel,
  rowStyle,
  statusStyle,
} from './Panel';

export function AuditLogPanel() {
  const [entries, setEntries] = useState(() => loadAuditLog());
  const [kind, setKind] = useState<AuditKind | 'all'>('all');
  const [status, setStatus] = useState<string | null>(null);

  const visible = useMemo(
    () => sortAuditLogNewestFirst(filterAuditLog(entries, kind)),
    [entries, kind],
  );

  const exportLog = () => {
    downloadTextFile(
      `veilura-audit-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
      auditLogToText(visible),
      'text/plain',
    );
    appendAuditEntry('backup', 'Exported audit log');
    setStatus('Audit log exported.');
  };

  const clear = () => {
    saveAuditLog([]);
    setEntries([]);
    appendAuditEntry('data_delete', 'Audit log cleared');
    setEntries(loadAuditLog());
    setStatus('Audit log cleared.');
  };

  return (
    <Panel
      title="Audit log"
      description="Every outbound network request and every system action, logged locally with a timestamp. This log never leaves the device."
    >
      <div style={rowStyle}>
        <label>
          Filter{' '}
          <select
            style={inputStyle}
            aria-label="Filter audit log by kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as AuditKind | 'all')}
          >
            <option value="all">All kinds</option>
            {AUDIT_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <button style={buttonStyle} onClick={exportLog}>
          Export log
        </button>
        <button style={dangerButtonStyle} onClick={clear}>
          Clear log
        </button>
        <span style={statusStyle}>
          {visible.length} entr{visible.length === 1 ? 'y' : 'ies'} shown ·{' '}
          {entries.length} total
        </span>
      </div>
      {visible.length === 0 ? (
        <p style={statusStyle}>No audit entries yet.</p>
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
          {visible.slice(0, 200).map((entry) => (
            <li key={entry.id} style={cardStyle}>
              <span style={statusStyle}>
                {new Date(entry.tsMs).toLocaleString()} · [{entry.kind}]
              </span>
              <span>{entry.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {status ? <p style={statusStyle}>{status}</p> : null}
    </Panel>
  );
}
