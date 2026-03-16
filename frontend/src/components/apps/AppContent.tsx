import type { AppIdentifier, BuiltinAppId } from '@shared/index';
import { resolveBuiltinId, isMiniApp } from '@/appRegistry';
import { FileManagerApp } from './FileManagerApp';
import { TerminalApp } from './TerminalApp';
import { BrowserApp } from './BrowserApp';
import { ChatApp } from './ChatApp';
import { CodeEditorApp } from './CodeEditorApp';
import { TextEditorApp } from './TextEditorApp';
import { SpreadsheetApp } from './SpreadsheetApp';
import { EmailApp } from './EmailApp';
import { CalendarApp } from './CalendarApp';
import { SettingsApp } from './SettingsApp';
import { TaskTimelineApp } from './TaskTimelineApp';
import { ImageViewerApp } from './ImageViewerApp';
import { OfficeViewerApp } from './OfficeViewerApp';
import { MediaViewerApp } from './MediaViewerApp';
import { XApp } from './XApp';
import { AgentManagerApp } from './AgentManagerApp';
import { XBoardApp } from './XBoardApp';
import { SubscriptionApp } from './SubscriptionApp';
import { AdminApp } from './AdminApp';
import { SkillsApp } from './SkillsApp';
import { McpApp } from './McpApp';
import { ChannelsApp } from './ChannelsApp';
import { ExtensionsApp } from './ExtensionsApp';
import { MiniAppView } from './MiniAppView';

interface Props {
  appId: AppIdentifier;
  windowId: string;
  metadata?: Record<string, unknown>;
}

function BuiltinAppContent({ builtinId, windowId, metadata }: { builtinId: BuiltinAppId; windowId: string; metadata?: Record<string, unknown> }) {
  switch (builtinId) {
    case 'file-manager':
      return <FileManagerApp windowId={windowId} metadata={metadata} />;
    case 'terminal':
      return <TerminalApp windowId={windowId} />;
    case 'browser':
      return <BrowserApp windowId={windowId} metadata={metadata} />;
    case 'chat':
      return <ChatApp windowId={windowId} />;
    case 'x':
      return <XApp />;
    case 'code-editor':
      return <CodeEditorApp windowId={windowId} metadata={metadata} />;
    case 'text-editor':
      return <TextEditorApp windowId={windowId} metadata={metadata} />;
    case 'spreadsheet':
      return <SpreadsheetApp windowId={windowId} />;
    case 'email':
      return <EmailApp windowId={windowId} />;
    case 'calendar':
      return <CalendarApp windowId={windowId} />;
    case 'settings':
      return <SettingsApp windowId={windowId} />;
    case 'task-timeline':
      return <TaskTimelineApp windowId={windowId} />;
    case 'agent-manager':
      return <AgentManagerApp windowId={windowId} />;
    case 'x-board':
      return <XBoardApp windowId={windowId} />;
    case 'subscription':
      return <SubscriptionApp />;
    case 'admin':
      return <AdminApp />;
    case 'image-viewer':
      return <ImageViewerApp windowId={windowId} metadata={metadata} />;
    case 'office-viewer':
      return <OfficeViewerApp windowId={windowId} metadata={metadata} />;
    case 'media-viewer':
      return <MediaViewerApp windowId={windowId} metadata={metadata} />;
    case 'extensions':
      return <ExtensionsApp windowId={windowId} />;
    case 'skills':
      return <SkillsApp windowId={windowId} />;
    case 'mcp':
      return <McpApp windowId={windowId} />;
    case 'channels':
      return <ChannelsApp windowId={windowId} />;
    default:
      return (
        <div className="flex items-center justify-center h-full text-desktop-muted text-sm">
          未知应用: {builtinId}
        </div>
      );
  }
}

export function AppContent({ appId, windowId, metadata }: Props) {
  const builtinId = resolveBuiltinId(appId);
  if (builtinId) {
    return <BuiltinAppContent builtinId={builtinId} windowId={windowId} metadata={metadata} />;
  }
  if (isMiniApp(appId)) {
    return <MiniAppView appId={appId} />;
  }
  return (
    <div className="flex items-center justify-center h-full text-desktop-muted text-sm">
      未知应用: {appId}
    </div>
  );
}
