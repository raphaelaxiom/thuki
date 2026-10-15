/**
 * Route table for the productivity features. The parent mounts these
 * (see INTEGRATION-productivity.md) — this module owns no router.
 */
import type { ReactElement } from 'react';
import { AppearancePanel } from './panels/AppearancePanel';
import { AuditLogPanel } from './panels/AuditLogPanel';
import { BackupPanel } from './panels/BackupPanel';
import { ContentFilterPanel } from './panels/ContentFilterPanel';
import { DailyBriefing } from './panels/DailyBriefing';
import { DataManagementPanel } from './panels/DataManagementPanel';
import { FocusTimer } from './panels/FocusTimer';
import { ProductivityHome } from './panels/ProductivityHome';
import {
  GlobalShortcutsPanel,
  KeyboardShortcutEditor,
} from './panels/ShortcutsPanels';
import { MenubarExtras } from './panels/MenubarExtras';
import { PrivacyPanel } from './panels/PrivacyPanel';
import { QuickActions } from './panels/QuickActions';
import { RemindersPanel } from './panels/RemindersPanel';

export interface ProductivityRoute {
  /** URL path the parent maps to this panel. */
  path: string;
  /** Label for nav / menus. */
  label: string;
  element: ReactElement;
}

export const ProductivityRoutes: ProductivityRoute[] = [
  {
    path: '/productivity',
    label: 'Productivity',
    element: <ProductivityHome />,
  },
  {
    path: '/productivity/briefing',
    label: 'Daily briefing',
    element: <DailyBriefing />,
  },
  {
    path: '/productivity/reminders',
    label: 'Reminders',
    element: <RemindersPanel />,
  },
  {
    path: '/productivity/focus',
    label: 'Focus timer',
    element: <FocusTimer />,
  },
  {
    path: '/productivity/quick-actions',
    label: 'Quick actions',
    element: <QuickActions />,
  },
  {
    path: '/productivity/global-shortcuts',
    label: 'Global shortcuts',
    element: <GlobalShortcutsPanel />,
  },
  {
    path: '/productivity/shortcut-editor',
    label: 'Shortcut editor',
    element: <KeyboardShortcutEditor />,
  },
  {
    path: '/productivity/menubar',
    label: 'Menubar extras',
    element: <MenubarExtras />,
  },
  {
    path: '/productivity/appearance',
    label: 'Appearance',
    element: <AppearancePanel />,
  },
  {
    path: '/productivity/privacy',
    label: 'Privacy',
    element: <PrivacyPanel />,
  },
  {
    path: '/productivity/data',
    label: 'Data management',
    element: <DataManagementPanel />,
  },
  {
    path: '/productivity/backup',
    label: 'Backup & restore',
    element: <BackupPanel />,
  },
  {
    path: '/productivity/content-filter',
    label: 'Content filter',
    element: <ContentFilterPanel />,
  },
  {
    path: '/productivity/audit-log',
    label: 'Audit log',
    element: <AuditLogPanel />,
  },
];
