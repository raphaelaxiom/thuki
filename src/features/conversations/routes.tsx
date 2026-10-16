/**
 * Tabbed wrapper around the three panels, for parents that want a single
 * mount point. Tabs are plain buttons + conditional rendering (no router
 * dependency — the app has no router). `ConversationsRoutes` below is the
 * route-table form for parents that mount by path instead.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  ConversationsPanel,
  type ConversationsPanelProps,
} from './ConversationsPanel';
import { PromptsPanel, type PromptsPanelProps } from './PromptsPanel';
import {
  SystemActionsBar,
  type SystemActionsBarProps,
} from './SystemActionsBar';

export interface ConversationsFeatureProps
  extends ConversationsPanelProps, PromptsPanelProps, SystemActionsBarProps {}

type Tab = 'conversations' | 'prompts' | 'system-actions';

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'conversations', label: 'Conversations' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'system-actions', label: 'System actions' },
];

export function ConversationsFeature(props: ConversationsFeatureProps) {
  const [tab, setTab] = useState<Tab>('conversations');
  const { onInsertPrompt, onResult, ...panelProps } = props;
  return (
    <div data-testid="conversations-feature">
      <div
        role="tablist"
        aria-label="Conversation features"
        style={{ display: 'flex', gap: 8, padding: '12px 16px 0' }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'conversations' && <ConversationsPanel {...panelProps} />}
      {tab === 'prompts' && <PromptsPanel onInsertPrompt={onInsertPrompt} />}
      {tab === 'system-actions' && <SystemActionsBar onResult={onResult} />}
    </div>
  );
}

/** Route-table form. The parent mounts the element matching the path. */
export interface ConversationRoute {
  /** URL-style path the parent matches against (no router required). */
  readonly path: string;
  readonly label: string;
  readonly element: ReactNode;
}

export const ConversationsRoutes: readonly ConversationRoute[] = [
  {
    path: '/conversations',
    label: 'Conversations',
    element: <ConversationsPanel conversations={[]} />,
  },
  {
    path: '/prompts',
    label: 'Prompts',
    element: <PromptsPanel />,
  },
  {
    path: '/system-actions',
    label: 'System actions',
    element: <SystemActionsBar />,
  },
];
