import type { ComponentType } from 'react';
import type { BuiltinAppId } from '@shared/index';

export interface AppComponentProps {
  windowId: string;
  metadata?: Record<string, unknown>;
}

export type AppLoader = () => Promise<{ default: ComponentType<AppComponentProps> }>;

const component = <T,>(
  load: () => Promise<T>,
  select: (module: T) => ComponentType<AppComponentProps>,
): AppLoader => async () => ({ default: select(await load()) });

export const APP_LOADERS: Record<BuiltinAppId, AppLoader> = {
  'file-manager': component(
    () => import('./FileManagerApp'),
    (module) => module.FileManagerApp as ComponentType<AppComponentProps>,
  ),
  terminal: component(
    () => import('./TerminalApp'),
    (module) => module.TerminalApp as ComponentType<AppComponentProps>,
  ),
  browser: component(
    () => import('./BrowserApp'),
    (module) => module.BrowserApp as ComponentType<AppComponentProps>,
  ),
  chat: component(
    () => import('./ChatApp'),
    (module) => module.ChatApp as ComponentType<AppComponentProps>,
  ),
  x: component(
    () => import('./XApp'),
    (module) => module.XApp as ComponentType<AppComponentProps>,
  ),
  'code-editor': component(
    () => import('./CodeEditorApp'),
    (module) => module.CodeEditorApp as ComponentType<AppComponentProps>,
  ),
  'text-editor': component(
    () => import('./TextEditorApp'),
    (module) => module.TextEditorApp as ComponentType<AppComponentProps>,
  ),
  spreadsheet: component(
    () => import('./SpreadsheetApp'),
    (module) => module.SpreadsheetApp as ComponentType<AppComponentProps>,
  ),
  email: component(
    () => import('./EmailApp'),
    (module) => module.EmailApp as ComponentType<AppComponentProps>,
  ),
  calendar: component(
    () => import('./CalendarApp'),
    (module) => module.CalendarApp as ComponentType<AppComponentProps>,
  ),
  settings: component(
    () => import('./SettingsApp'),
    (module) => module.SettingsApp as ComponentType<AppComponentProps>,
  ),
  'plugin-manager': component(
    () => import('./PluginManagerApp'),
    (module) => module.PluginManagerApp as ComponentType<AppComponentProps>,
  ),
  'digital-human': component(
    () => import('./DigitalHumanApp'),
    (module) => module.DigitalHumanApp as ComponentType<AppComponentProps>,
  ),
  'image-viewer': component(
    () => import('./ImageViewerApp'),
    (module) => module.ImageViewerApp as ComponentType<AppComponentProps>,
  ),
  'office-viewer': component(
    () => import('./OfficeViewerApp'),
    (module) => module.OfficeViewerApp as ComponentType<AppComponentProps>,
  ),
  'media-viewer': component(
    () => import('./MediaViewerApp'),
    (module) => module.MediaViewerApp as ComponentType<AppComponentProps>,
  ),
  'agent-manager': component(
    () => import('./AgentManagerApp'),
    (module) => module.AgentManagerApp as ComponentType<AppComponentProps>,
  ),
  subscription: component(
    () => import('./SubscriptionApp'),
    (module) => module.SubscriptionApp as ComponentType<AppComponentProps>,
  ),
  admin: component(
    () => import('./AdminApp'),
    (module) => module.AdminApp as ComponentType<AppComponentProps>,
  ),
  canvas: component(
    () => import('./CanvasApp'),
    (module) => module.CanvasApp as ComponentType<AppComponentProps>,
  ),
  diff: component(
    () => import('./DiffApp'),
    (module) => module.DiffApp as ComponentType<AppComponentProps>,
  ),
  'system-monitor': component(
    () => import('./SystemMonitorApp'),
    (module) => module.SystemMonitorApp as ComponentType<AppComponentProps>,
  ),
  'quick-notes': component(
    () => import('./QuickNotesApp'),
    (module) => module.QuickNotesApp as ComponentType<AppComponentProps>,
  ),
  pomodoro: component(
    () => import('./PomodoroTimerApp'),
    (module) => module.PomodoroTimerApp as ComponentType<AppComponentProps>,
  ),
  'world-clock': component(
    () => import('./WorldClockApp'),
    (module) => module.WorldClockApp as ComponentType<AppComponentProps>,
  ),
  bookmarks: component(
    () => import('./BookmarkManagerApp'),
    (module) => module.BookmarkManagerApp as ComponentType<AppComponentProps>,
  ),
  'clipboard-manager': component(
    () => import('./ClipboardManagerApp'),
    (module) => module.ClipboardManagerApp as ComponentType<AppComponentProps>,
  ),
  'habit-tracker': component(
    () => import('./HabitTrackerApp'),
    (module) => module.HabitTrackerApp as ComponentType<AppComponentProps>,
  ),
  'password-generator': component(
    () => import('./PasswordGeneratorApp'),
    (module) => module.PasswordGeneratorApp as ComponentType<AppComponentProps>,
  ),
  'unit-converter': component(
    () => import('./UnitConverterApp'),
    (module) => module.UnitConverterApp as ComponentType<AppComponentProps>,
  ),
  calculator: component(
    () => import('./CalculatorApp'),
    (module) => module.CalculatorApp as ComponentType<AppComponentProps>,
  ),
  'color-picker': component(
    () => import('./ColorPickerApp'),
    (module) => module.ColorPickerApp as ComponentType<AppComponentProps>,
  ),
  'dice-roller': component(
    () => import('./DiceRollerApp'),
    (module) => module.DiceRollerApp as ComponentType<AppComponentProps>,
  ),
  'decision-journal': component(
    () => import('./DecisionJournalApp'),
    (module) => module.default as ComponentType<AppComponentProps>,
  ),
  'delegation-tracker': component(
    () => import('./DelegationTrackerApp'),
    (module) => module.default as ComponentType<AppComponentProps>,
  ),
  'weekly-planner': component(
    () => import('./WeeklyPlannerApp'),
    (module) => module.default as ComponentType<AppComponentProps>,
  ),
  changelog: component(
    () => import('./ChangelogApp'),
    (module) => module.default as ComponentType<AppComponentProps>,
  ),
  'reading-list': component(
    () => import('./ReadingListApp'),
    (module) => module.default as ComponentType<AppComponentProps>,
  ),
};
