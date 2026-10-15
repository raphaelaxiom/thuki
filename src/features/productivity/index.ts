/** Public surface of the productivity features. */
export { ProductivityRoutes, type ProductivityRoute } from './routes';
export {
  ProductivityHome,
  PRODUCTIVITY_SECTIONS,
} from './panels/ProductivityHome';
export { RemindersPanel } from './panels/RemindersPanel';
export { FocusTimer } from './panels/FocusTimer';
export { QuickActions } from './panels/QuickActions';
export {
  GlobalShortcutsPanel,
  KeyboardShortcutEditor,
} from './panels/ShortcutsPanels';
export { MenubarExtras } from './panels/MenubarExtras';
export { DailyBriefing } from './panels/DailyBriefing';
export {
  AppearancePanel,
  DensityPanel,
  FontSizePanel,
  ThemesPanel,
} from './panels/AppearancePanel';
export { PrivacyPanel } from './panels/PrivacyPanel';
export { DataManagementPanel } from './panels/DataManagementPanel';
export { BackupPanel } from './panels/BackupPanel';
export { ContentFilterPanel } from './panels/ContentFilterPanel';
export { AuditLogPanel } from './panels/AuditLogPanel';
export * from './types';
export * from './storage';
export * from './redaction';
export * from './audit';
export * from './shortcuts';
export * from './settings';
export * from './reminders';
export * from './focus';
export * from './quickActions';
export { buildDailyBriefing } from './briefing';
export type {
  BriefingLine,
  DailyBriefing as DailyBriefingData,
} from './briefing';
export * from './backup';
export * from './dataManagement';
