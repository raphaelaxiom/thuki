/** Data management: storage breakdown + destructive deletes + export. */
import { useEffect, useState } from 'react';
import { appendAuditEntry } from '../audit';
import {
  clearLocalProductivityData,
  deleteAllConversations,
  deleteAllModels,
  exportAllData,
  formatBytes,
  localStorageBreakdown,
  probeBackendStorage,
  type BackendStorageInfo,
} from '../dataManagement';
import { downloadTextFile, readJson, STORAGE_KEYS } from '../storage';
import {
  buttonStyle,
  cardStyle,
  dangerButtonStyle,
  Panel,
  rowStyle,
  statusStyle,
} from './Panel';

export function DataManagementPanel() {
  const [backend, setBackend] = useState<BackendStorageInfo | null>(null);
  const [local, setLocal] = useState(() => localStorageBreakdown());
  const [confirmConversations, setConfirmConversations] = useState(false);
  const [confirmModels, setConfirmModels] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    void probeBackendStorage().then(setBackend);
  }, []);

  const refreshLocal = () => setLocal(localStorageBreakdown());
  const localTotal = local.reduce((sum, e) => sum + e.bytes, 0);

  const exportAll = () => {
    const content = exportAllData({
      reminders: readJson(STORAGE_KEYS.reminders, []),
      focusSessions: readJson(STORAGE_KEYS.focusSessions, []),
      settings: readJson(STORAGE_KEYS.settings, {}),
      shortcuts: readJson(STORAGE_KEYS.shortcuts, []),
      auditLog: readJson(STORAGE_KEYS.auditLog, []),
      conversationStats: backend?.conversations ?? null,
    });
    downloadTextFile(
      `veilura-data-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      content,
      'application/json',
    );
    appendAuditEntry('backup', 'Exported all productivity data');
    setStatus('Export downloaded.');
  };

  const wipeConversations = async () => {
    if (!confirmConversations) {
      setStatus('Tick the confirmation box first.');
      return;
    }
    try {
      await deleteAllConversations();
      appendAuditEntry(
        'data_delete',
        'Deleted all conversations (backend + local)',
      );
      refreshLocal();
      setBackend(await probeBackendStorage());
      setStatus('All conversations deleted.');
      setConfirmConversations(false);
    } catch {
      setStatus('Could not delete conversations — backend not connected.');
    }
  };

  const wipeModels = async () => {
    if (!confirmModels) {
      setStatus('Tick the confirmation box first.');
      return;
    }
    const failures = await deleteAllModels(
      (backend?.models ?? []).map((m) => m.id),
    );
    appendAuditEntry(
      'data_delete',
      `Deleted all models (${(backend?.models ?? []).length - failures.length} ok, ${failures.length} failed)`,
    );
    setBackend(await probeBackendStorage());
    setStatus(
      failures.length === 0
        ? 'All models deleted.'
        : `Some models could not be deleted: ${failures.join(', ')}`,
    );
    setConfirmModels(false);
  };

  return (
    <Panel
      title="Data management"
      description="See what Veilura stores, export everything, or delete conversations and models. Deletes are irreversible."
    >
      <div style={cardStyle}>
        <strong>Storage breakdown</strong>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {local.map((entry) => (
            <li key={entry.key} style={statusStyle}>
              {entry.label}: {formatBytes(entry.bytes)} · {entry.items} item
              {entry.items === 1 ? '' : 's'}
            </li>
          ))}
          <li style={statusStyle}>
            Productivity local total: {formatBytes(localTotal)}
          </li>
          {backend?.conversations ? (
            <li style={statusStyle}>
              Conversations (database): {backend.conversations.count} chats ·{' '}
              {formatBytes(backend.conversations.bytes)}
            </li>
          ) : (
            <li style={statusStyle}>Conversations (database): unavailable</li>
          )}
          {(backend?.models ?? []).map((m) => (
            <li key={m.id} style={statusStyle}>
              Model {m.id}: {formatBytes(m.bytes)}
            </li>
          ))}
        </ul>
        {backend?.error ? <p style={statusStyle}>{backend.error}</p> : null}
      </div>
      <div style={rowStyle}>
        <button style={buttonStyle} onClick={exportAll}>
          Export all data
        </button>
      </div>
      <div style={cardStyle}>
        <strong>Delete all conversations</strong>
        <label style={rowStyle}>
          <input
            type="checkbox"
            checked={confirmConversations}
            onChange={(e) => setConfirmConversations(e.target.checked)}
          />
          <span style={statusStyle}>
            I understand this permanently deletes every conversation.
          </span>
        </label>
        <span style={rowStyle}>
          <button
            style={dangerButtonStyle}
            onClick={() => void wipeConversations()}
          >
            Delete all conversations
          </button>
        </span>
      </div>
      <div style={cardStyle}>
        <strong>Delete all models</strong>
        <label style={rowStyle}>
          <input
            type="checkbox"
            checked={confirmModels}
            onChange={(e) => setConfirmModels(e.target.checked)}
          />
          <span style={statusStyle}>
            I understand this permanently deletes every downloaded model (
            {(backend?.models ?? []).length}).
          </span>
        </label>
        <span style={rowStyle}>
          <button style={dangerButtonStyle} onClick={() => void wipeModels()}>
            Delete all models
          </button>
        </span>
      </div>
      <div style={rowStyle}>
        <button
          style={buttonStyle}
          onClick={() => {
            clearLocalProductivityData();
            appendAuditEntry('data_delete', 'Cleared local productivity data');
            refreshLocal();
            setStatus('Local productivity data cleared.');
          }}
        >
          Clear local productivity data
        </button>
      </div>
      {status ? <p style={statusStyle}>{status}</p> : null}
    </Panel>
  );
}
