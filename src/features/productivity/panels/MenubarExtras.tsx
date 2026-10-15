/**
 * Menubar extras: the data behind the menubar menu — recent conversations,
 * quick new chat, live engine status, and quit.
 *
 * The native macOS tray menu itself lives in the parent app (see
 * INTEGRATION-productivity.md); this panel is the in-app mirror that reads
 * the same commands, so the menu contents are verifiable without the tray.
 */
import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { appendAuditEntry } from '../audit';
import { buttonStyle, cardStyle, Panel, rowStyle, statusStyle } from './Panel';

interface EngineStatusShape {
  state: string;
  model_path: string;
  port: number | null;
  error: string | null;
}

interface RecentConversation {
  id: string;
  title: string;
}

function toRecent(raw: Record<string, unknown>): RecentConversation {
  const id = String(raw.conversation_id ?? raw.id ?? '');
  const title = String(raw.title ?? raw.name ?? 'Untitled conversation');
  return { id, title: title || 'Untitled conversation' };
}

export function MenubarExtras() {
  const [engine, setEngine] = useState<EngineStatusShape | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentConversation[]>([]);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const state = await invoke<EngineStatusShape>('get_engine_status');
      if (!state || typeof state.state !== 'string')
        throw new Error('bad engine status');
      setEngine(state);
      setEngineError(null);
    } catch {
      setEngine(null);
      setEngineError('Engine status unavailable (backend not connected).');
    }
    try {
      const list = await invoke<Array<Record<string, unknown>>>(
        'list_conversations',
        {
          search: null,
        },
      );
      if (!Array.isArray(list)) throw new Error('bad conversation list');
      setRecent(list.slice(0, 5).map(toRecent));
      setRecentError(null);
    } catch {
      setRecent([]);
      setRecentError(
        'Recent conversations unavailable (backend not connected).',
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const newChat = async () => {
    try {
      await invoke('reset_conversation');
    } catch {
      // Fall through to the event; the parent may handle either path.
    }
    window.dispatchEvent(new CustomEvent('veilura:new-chat'));
    appendAuditEntry('system_action', 'New chat started from menubar extras');
    setStatus('New chat started.');
  };

  const quit = () => {
    // The parent wires `veilura:quit-requested` to its quit flow (which
    // warns about in-flight downloads). No destructive action happens here.
    window.dispatchEvent(new CustomEvent('veilura:quit-requested'));
    appendAuditEntry('system_action', 'Quit requested from menubar extras');
    setStatus(
      'Quit requested — the app will confirm if a download is in flight.',
    );
  };

  return (
    <Panel
      title="Menubar extras"
      description="What the menubar menu shows: recent conversations, quick new chat, live engine status, and quit."
    >
      <div style={cardStyle}>
        <strong>Engine status</strong>
        {engine ? (
          <p style={statusStyle}>
            {engine.state}
            {engine.model_path ? ` · ${engine.model_path}` : ''}
            {engine.port !== null ? ` · port ${engine.port}` : ''}
            {engine.error ? ` · ${engine.error}` : ''}
          </p>
        ) : (
          <p style={statusStyle}>{engineError ?? 'Loading…'}</p>
        )}
        <span style={rowStyle}>
          <button style={buttonStyle} onClick={() => void refresh()}>
            Refresh
          </button>
        </span>
      </div>
      <div style={cardStyle}>
        <strong>Recent conversations</strong>
        {recentError ? (
          <p style={statusStyle}>{recentError}</p>
        ) : recent.length === 0 ? (
          <p style={statusStyle}>No recent conversations.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {recent.map((c) => (
              <li key={c.id} style={statusStyle}>
                {c.title}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div style={rowStyle}>
        <button style={buttonStyle} onClick={() => void newChat()}>
          Quick new chat
        </button>
        <button style={buttonStyle} onClick={quit}>
          Quit Veilura
        </button>
      </div>
      {status ? <p style={statusStyle}>{status}</p> : null}
    </Panel>
  );
}
