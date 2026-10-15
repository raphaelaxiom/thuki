/** Productivity home: navigation across all Phase 2D panels. */
import { useEffect, useState } from 'react';
import { applyAppearance, loadSettings } from '../settings';
import { AppearancePanel } from './AppearancePanel';
import { AuditLogPanel } from './AuditLogPanel';
import { BackupPanel } from './BackupPanel';
import { ContentFilterPanel } from './ContentFilterPanel';
import { DailyBriefing } from './DailyBriefing';
import { DataManagementPanel } from './DataManagementPanel';
import { FocusTimer } from './FocusTimer';
import {
  GlobalShortcutsPanel,
  KeyboardShortcutEditor,
} from './ShortcutsPanels';
import { MenubarExtras } from './MenubarExtras';
import { PrivacyPanel } from './PrivacyPanel';
import { QuickActions } from './QuickActions';
import { RemindersPanel } from './RemindersPanel';
import { buttonStyle, rowStyle } from './Panel';

export const PRODUCTIVITY_SECTIONS = [
  { id: 'briefing', label: 'Daily briefing' },
  { id: 'reminders', label: 'Reminders' },
  { id: 'focus', label: 'Focus timer' },
  { id: 'quick-actions', label: 'Quick actions' },
  { id: 'global-shortcuts', label: 'Global shortcuts' },
  { id: 'shortcut-editor', label: 'Shortcut editor' },
  { id: 'menubar', label: 'Menubar extras' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'data', label: 'Data management' },
  { id: 'backup', label: 'Backup & restore' },
  { id: 'content-filter', label: 'Content filter' },
  { id: 'audit-log', label: 'Audit log' },
] as const;

export type ProductivitySectionId =
  (typeof PRODUCTIVITY_SECTIONS)[number]['id'];

export function ProductivityHome({
  initialSection = 'briefing',
}: {
  initialSection?: ProductivitySectionId;
}) {
  const [section, setSection] = useState<ProductivitySectionId>(initialSection);

  // Apply the persisted appearance as soon as this surface mounts.
  useEffect(() => {
    applyAppearance(loadSettings());
  }, []);

  return (
    <div>
      <nav
        aria-label="Productivity"
        style={{ ...rowStyle, padding: '12px 16px 0' }}
      >
        {PRODUCTIVITY_SECTIONS.map((s) => (
          <button
            key={s.id}
            style={{ ...buttonStyle, fontWeight: section === s.id ? 700 : 400 }}
            aria-current={section === s.id ? 'page' : undefined}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>
      {section === 'briefing' ? <DailyBriefing /> : null}
      {section === 'reminders' ? <RemindersPanel /> : null}
      {section === 'focus' ? <FocusTimer /> : null}
      {section === 'quick-actions' ? <QuickActions /> : null}
      {section === 'global-shortcuts' ? <GlobalShortcutsPanel /> : null}
      {section === 'shortcut-editor' ? <KeyboardShortcutEditor /> : null}
      {section === 'menubar' ? <MenubarExtras /> : null}
      {section === 'appearance' ? <AppearancePanel /> : null}
      {section === 'privacy' ? <PrivacyPanel /> : null}
      {section === 'data' ? <DataManagementPanel /> : null}
      {section === 'backup' ? <BackupPanel /> : null}
      {section === 'content-filter' ? <ContentFilterPanel /> : null}
      {section === 'audit-log' ? <AuditLogPanel /> : null}
    </div>
  );
}
