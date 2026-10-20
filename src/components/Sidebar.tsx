import React from 'react';
import nexusLogo from '../assets/nexus-logo.png';
import { 
  PlusCircle, 
  MessageSquare,
  Globe,
  ListTodo, 
  FolderGit2, 
  Settings, 
  Activity,
  Volume2
} from 'lucide-react';
import { NavigationTab, GeminiStatus } from '../types';
import { voiceService, VoiceState } from '../services/voiceService';

interface SidebarProps {
  currentTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  taskCount: number;
  chatMessageCount: number;
  isAutomationRunning: boolean;
  geminiStatus: GeminiStatus | null;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  taskCount,
  chatMessageCount,
  isAutomationRunning,
  geminiStatus,
}) => {
  const [voiceState, setVoiceState] = React.useState<VoiceState>(voiceService.getState());

  React.useEffect(() => {
    return voiceService.subscribe(setVoiceState);
  }, []);

  const navItems = [
    {
      id: 'chat' as NavigationTab,
      label: 'AI Chat',
      icon: MessageSquare,
      badge: chatMessageCount > 0 ? chatMessageCount : null,
    },
    {
      id: 'actions' as NavigationTab,
      label: 'Action Center',
      icon: Globe,
      badge: isAutomationRunning ? 'LIVE' : null,
    },
    {
      id: 'tasks' as NavigationTab,
      label: 'Tasks',
      icon: ListTodo,
      badge: taskCount > 0 ? taskCount : null,
    },
    {
      id: 'files' as NavigationTab,
      label: 'Files',
      icon: FolderGit2,
      badge: null,
    },
    {
      id: 'settings' as NavigationTab,
      label: 'Settings',
      icon: Settings,
      badge: geminiStatus?.hasApiKey ? null : '!',
    },
  ];

  return (
    <aside className="w-56 h-full bg-background-secondary border-r border-border-subtle flex flex-col justify-between shrink-0 select-none">
      {/* Top Section */}
      <div className="flex flex-col p-3">
        {/* Logo and Wordmark */}
        <div className="flex items-center gap-2.5 px-3 py-3 mb-4 rounded-lg bg-background-tertiary/60 border border-border-subtle">
          <div className="w-8 h-8 rounded-full border border-red-500/40 shadow-sm shadow-red-500/30 overflow-hidden flex items-center justify-center shrink-0">
            <img src={nexusLogo} alt="NEXUS" className="w-full h-full object-cover" />
          </div>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-sm text-text-primary tracking-wider leading-none">
                NEXUS
              </span>
              <span className="text-[10px] font-mono px-1 py-0.2 bg-red-500/10 text-red-400 border border-red-500/20 rounded">
                AI
              </span>
            </div>
            <span className="text-[10px] text-text-muted truncate mt-0.5">
              Personal Desktop Agent
            </span>
          </div>
        </div>

        {/* Primary Action Button (New Task / New Chat) */}
        <button
          onClick={() => onSelectTab('new-task')}
          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg mb-4 text-xs font-medium transition-all ${
            currentTab === 'new-task'
              ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/20'
              : 'bg-background-tertiary hover:bg-background-elevated text-text-primary border border-border-subtle'
          }`}
        >
          <span className="flex items-center gap-2">
            <PlusCircle className="w-4 h-4" />
            <span>New Task</span>
          </span>
          <span className="text-[10px] opacity-75 font-mono">Alt+N</span>
        </button>

        {/* Navigation Links */}
        <nav className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors text-left ${
                  isActive
                    ? 'bg-white/10 text-text-primary font-medium border-l-2 border-blue-500'
                    : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-blue-400' : 'text-text-muted'}`} />
                  <span>{item.label}</span>
                </span>
                {item.badge !== null && (
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono font-medium border ${
                      item.badge === 'LIVE'
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 animate-pulse'
                        : item.badge === '!'
                        ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                        : 'bg-blue-500/15 text-blue-400 border-blue-500/20'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Section: Application Status Indicator */}
      <div className="p-3 border-t border-border-subtle">
        <div className="px-3 py-2.5 rounded-lg bg-background-tertiary border border-border-subtle">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span
                  className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    isAutomationRunning
                      ? 'bg-blue-400'
                      : geminiStatus?.hasApiKey
                      ? 'bg-emerald-400'
                      : 'bg-amber-400'
                  }`}
                ></span>
                <span
                  className={`relative inline-flex rounded-full h-2 w-2 ${
                    isAutomationRunning
                      ? 'bg-blue-500'
                      : geminiStatus?.hasApiKey
                      ? 'bg-emerald-500'
                      : 'bg-amber-500'
                  }`}
                ></span>
              </span>
              <span className="text-[11px] font-medium text-text-primary">
                {isAutomationRunning
                  ? 'Browser Active'
                  : geminiStatus?.hasApiKey
                  ? 'Neural Engine Live'
                  : 'Setup Required'}
              </span>
            </div>
            <Activity className="w-3 h-3 text-text-muted" />
          </div>
          <div className="flex items-center justify-between text-[10px] text-text-dim">
            <span>Shell v0.3.0</span>
            <span className="text-emerald-500/90 font-mono">
              {isAutomationRunning ? 'Automating' : 'Sandboxed'}
            </span>
          </div>

          {/* Voice AI Status Button */}
          <button
            type="button"
            onClick={() => voiceService.toggle()}
            className="w-full flex items-center justify-between text-[10px] mt-2 pt-2 border-t border-border-subtle/50 hover:bg-white/[0.03] rounded px-1 py-0.5 transition-colors"
            title="Click to toggle ElevenLabs Voice AI"
          >
            <span className="flex items-center gap-1.5 text-text-secondary">
              <Volume2 className={`w-3 h-3 ${voiceState.isEnabled ? 'text-blue-400' : 'text-text-muted'}`} />
              <span>Voice AI</span>
            </span>
            <span className={`font-mono text-[9px] px-1.5 py-0.2 rounded ${
              voiceState.isEnabled 
                ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' 
                : 'bg-background-secondary text-text-muted border border-border-subtle'
            }`}>
              {voiceState.isEnabled ? 'ON' : 'OFF'}
            </span>
          </button>
        </div>
      </div>
    </aside>
  );
};
