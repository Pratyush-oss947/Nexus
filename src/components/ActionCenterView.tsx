import React, { useState } from 'react';
import { 
  Play, 
  Square, 
  Globe, 
  Search, 
  FileText, 
  MousePointerClick, 
  Edit3, 
  Download, 
  ShieldAlert, 
  CheckCircle2, 
  AlertCircle, 
  Camera, 
  FolderOpen, 
  ExternalLink,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  HardDrive
} from 'lucide-react';
import { 
  AutomationState, 
  AutomationEvent, 
  DownloadItem 
} from '../types';

interface ActionCenterViewProps {
  state: AutomationState;
  onStartAutomation: (goal: string) => void;
  onStopAutomation: () => void;
  onRespondApproval: (approvalId: string, approved: boolean) => void;
  downloads: DownloadItem[];
  onOpenDownloadsFolder: () => void;
  onRefreshDownloads: () => void;
}

const EXAMPLE_ACTIONS = [
  'Search DuckDuckGo for latest developer laptops under $1500 and summarize findings',
  'Open https://example.com and read the full page text',
  'Search for Python 3.12 release notes and extract key features',
  'Download the public sample data file from https://raw.githubusercontent.com/datasets/gdp/master/data/gdp.csv',
];

export const ActionCenterView: React.FC<ActionCenterViewProps> = ({
  state,
  onStartAutomation,
  onStopAutomation,
  onRespondApproval,
  downloads,
  onOpenDownloadsFolder,
  onRefreshDownloads,
}) => {
  const [goalInput, setGoalInput] = useState('');
  const [expandedScreenshots, setExpandedScreenshots] = useState<Record<string, boolean>>({});

  const handleStart = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = goalInput.trim();
    if (!trimmed || state.status === 'running') return;
    onStartAutomation(trimmed);
  };

  const toggleScreenshot = (id: string) => {
    setExpandedScreenshots((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const getEventIcon = (type: AutomationEvent['type']) => {
    switch (type) {
      case 'NAVIGATE':
        return <Globe className="w-3.5 h-3.5 text-blue-400" />;
      case 'SEARCH':
        return <Search className="w-3.5 h-3.5 text-indigo-400" />;
      case 'READ':
        return <FileText className="w-3.5 h-3.5 text-cyan-400" />;
      case 'CLICK':
        return <MousePointerClick className="w-3.5 h-3.5 text-amber-400" />;
      case 'FILL':
        return <Edit3 className="w-3.5 h-3.5 text-emerald-400" />;
      case 'DOWNLOAD':
        return <Download className="w-3.5 h-3.5 text-purple-400" />;
      case 'APPROVAL':
        return <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />;
      case 'SUCCESS':
        return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />;
      case 'ERROR':
        return <AlertCircle className="w-3.5 h-3.5 text-red-400" />;
      default:
        return <Camera className="w-3.5 h-3.5 text-text-dim" />;
    }
  };

  return (
    <div className="h-full flex flex-col w-full overflow-hidden bg-background">
      {/* Header */}
      <header className="px-8 py-5 border-b border-border-subtle bg-background-secondary/30 flex items-center justify-between shrink-0 select-none">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-text-primary">
              Action Center
            </h1>
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-mono border ${
                state.status === 'running'
                  ? 'bg-blue-500/15 text-blue-400 border-blue-500/30 animate-pulse'
                  : state.status === 'waiting_approval'
                  ? 'bg-amber-500/15 text-amber-400 border-amber-500/30 animate-bounce'
                  : state.status === 'completed'
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : state.status === 'error'
                  ? 'bg-red-500/15 text-red-400 border-red-500/30'
                  : 'bg-background-tertiary text-text-secondary border-border-subtle'
              }`}
            >
              {state.status.toUpperCase().replace('_', ' ')}
            </span>
          </div>
          <p className="text-xs text-text-secondary mt-1">
            Real visible Chromium browser automation, search execution, and sandboxed downloads
          </p>
        </div>

        <div className="flex items-center gap-2">
          {state.status === 'running' && (
            <button
              onClick={onStopAutomation}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/40 rounded-lg transition-colors shadow-sm"
            >
              <Square className="w-3.5 h-3.5 fill-red-400" />
              <span>Stop Action</span>
            </button>
          )}

          <button
            onClick={onOpenDownloadsFolder}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary hover:bg-white/[0.04] rounded-lg border border-border-subtle transition-colors"
            title="Open NEXUS Downloads folder"
          >
            <FolderOpen className="w-3.5 h-3.5 text-blue-400" />
            <span>Downloads</span>
          </button>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto w-full space-y-6">
        {/* Goal Execution Input */}
        <form onSubmit={handleStart} className="space-y-3">
          <div className="relative rounded-2xl bg-background-secondary border border-border focus-within:border-blue-500/60 focus-within:ring-1 focus-within:ring-blue-500/40 p-3 shadow-md shadow-black/20">
            <textarea
              rows={2}
              value={goalInput}
              onChange={(e) => setGoalInput(e.target.value)}
              placeholder="Give NEXUS AI a real-world task (e.g., 'Search for latest space discoveries and summarize', 'Open https://example.com')..."
              disabled={state.status === 'running'}
              className="w-full bg-transparent text-text-primary placeholder:text-text-muted resize-none focus:outline-none text-xs leading-relaxed disabled:opacity-50"
            />
            <div className="flex items-center justify-between pt-2 border-t border-border-subtle/50 text-[11px] select-none">
              <span className="text-text-dim">
                Chromium browser launches visibly on your desktop during execution
              </span>
              <button
                type="submit"
                disabled={!goalInput.trim() || state.status === 'running'}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
              >
                {state.status === 'running' ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Executing...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-white" />
                    <span>Run in Browser</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Quick Action Suggestion Pills */}
          <div className="flex flex-wrap gap-2 pt-1">
            {EXAMPLE_ACTIONS.map((ex, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setGoalInput(ex)}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-background-secondary/60 hover:bg-background-tertiary border border-border-subtle text-text-secondary hover:text-text-primary transition-colors text-left"
              >
                {ex.length > 55 ? ex.slice(0, 55) + '...' : ex}
              </button>
            ))}
          </div>
        </form>

        {/* Mandatory Approval Gateway Modal / Banner */}
        {state.pendingApproval && (
          <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-500/40 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-300 shrink-0">
                <ShieldAlert className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-amber-100">
                    Consequential Action Requires Confirmation
                  </h3>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Human Review Gate
                  </span>
                </div>
                <p className="text-xs text-amber-200/90 leading-relaxed font-mono">
                  {state.pendingApproval.action}
                </p>
                <p className="text-[11px] text-amber-200/70">
                  {state.pendingApproval.details}
                </p>
                {state.pendingApproval.targetUrl && (
                  <div className="text-[11px] text-text-dim truncate">
                    Target URL: <span className="text-amber-300/80">{state.pendingApproval.targetUrl}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => onRespondApproval(state.pendingApproval!.id, false)}
                className="px-4 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:text-white hover:bg-white/[0.06] transition-colors"
              >
                Reject Action
              </button>
              <button
                type="button"
                onClick={() => onRespondApproval(state.pendingApproval!.id, true)}
                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-amber-500 hover:bg-amber-400 text-black font-semibold transition-colors shadow-md"
              >
                Approve & Execute
              </button>
            </div>
          </div>
        )}

        {/* Active Browser Info Strip */}
        {(state.currentUrl || state.currentTitle) && (
          <div className="p-3.5 rounded-xl bg-background-secondary border border-border-subtle flex items-center justify-between text-xs">
            <div className="flex items-center gap-2.5 min-w-0 pr-4">
              <Globe className="w-4 h-4 text-blue-400 shrink-0" />
              <div className="truncate">
                <span className="font-medium text-text-primary mr-2">
                  {state.currentTitle || 'Webpage'}
                </span>
                <span className="text-text-muted font-mono text-[11px]">
                  {state.currentUrl}
                </span>
              </div>
            </div>
            {state.currentUrl && (
              <a
                href={state.currentUrl}
                target="_blank"
                rel="noreferrer"
                className="text-text-dim hover:text-blue-400 shrink-0 p-1"
                title="Open in external browser"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        )}

        {/* Final Result Card */}
        {state.finalResult && (
          <div className="p-5 rounded-2xl bg-background-secondary border border-emerald-500/40 shadow-lg space-y-2 animate-in fade-in duration-200">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              <span>Execution Summary</span>
            </div>
            <div className="text-xs text-text-primary leading-relaxed whitespace-pre-wrap select-text font-normal">
              {state.finalResult}
            </div>
          </div>
        )}

        {/* Chronological Activity Log */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs select-none">
            <span className="font-semibold text-text-primary tracking-wide">
              Live Activity Stream ({state.events.length})
            </span>
            <span className="text-[11px] text-text-dim">
              Real-time verifiable actions
            </span>
          </div>

          {state.events.length === 0 ? (
            <div className="p-12 text-center rounded-2xl bg-background-secondary/40 border border-border-subtle text-text-muted space-y-2">
              <Globe className="w-8 h-8 mx-auto text-text-dim" />
              <div className="text-xs font-medium text-text-secondary">
                No active automation tasks
              </div>
              <p className="text-[11px] max-w-sm mx-auto leading-relaxed">
                Enter a task above to watch NEXUS AI autonomously search the web, navigate pages, interact with forms, and download documents.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {state.events.map((evt) => {
                const hasScreenshot = !!evt.screenshotUrl;
                const isExpanded = !!expandedScreenshots[evt.id];

                return (
                  <div
                    key={evt.id}
                    className="p-3.5 rounded-xl bg-background-secondary border border-border-subtle space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="p-1.5 rounded-lg bg-background-tertiary border border-border-subtle shrink-0">
                          {getEventIcon(evt.type)}
                        </div>
                        <span className="font-medium text-text-primary truncate">
                          {evt.message}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 text-[10px] text-text-dim">
                        <span>{evt.timestamp}</span>
                        {hasScreenshot && (
                          <button
                            type="button"
                            onClick={() => toggleScreenshot(evt.id)}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-background-tertiary hover:bg-background-elevated border border-border-subtle text-text-muted hover:text-text-primary transition-colors"
                          >
                            <Camera className="w-2.5 h-2.5" />
                            <span>Proof</span>
                            {isExpanded ? (
                              <ChevronUp className="w-2.5 h-2.5" />
                            ) : (
                              <ChevronDown className="w-2.5 h-2.5" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {evt.details && (
                      <div className="text-[11px] text-text-secondary bg-background-tertiary p-2 rounded-lg font-mono leading-relaxed whitespace-pre-wrap select-text">
                        {evt.details}
                      </div>
                    )}

                    {/* Screenshot Evidence Proof Drawer */}
                    {hasScreenshot && isExpanded && (
                      <div className="pt-2 animate-in fade-in duration-150">
                        <img
                          src={evt.screenshotUrl}
                          alt="Browser verification evidence"
                          className="w-full max-h-96 object-contain rounded-lg border border-border-subtle bg-black/40"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Sandboxed Downloads Section */}
        <div className="pt-4 border-t border-border-subtle space-y-3">
          <div className="flex items-center justify-between text-xs select-none">
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-purple-400" />
              <span className="font-semibold text-text-primary">
                NEXUS Downloads ({downloads.length})
              </span>
            </div>
            <button
              onClick={onRefreshDownloads}
              className="text-[11px] text-text-muted hover:text-text-primary flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Refresh</span>
            </button>
          </div>

          {downloads.length === 0 ? (
            <div className="p-4 rounded-xl bg-background-secondary/40 border border-border-subtle text-[11px] text-text-dim text-center">
              Files downloaded during tasks are safely stored in <span className="font-mono text-text-muted">Downloads/NEXUS Downloads</span>.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {downloads.map((item, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl bg-background-secondary border border-border-subtle flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-text-primary truncate">
                      {item.filename}
                    </div>
                    <div className="text-[10px] text-text-dim">
                      {((item.sizeBytes || 0) / 1024).toFixed(1)} KB • {item.createdAt || item.timestamp || 'Ready'}
                    </div>
                  </div>
                  <button
                    onClick={onOpenDownloadsFolder}
                    className="p-1.5 rounded-lg bg-background-tertiary hover:bg-background-elevated text-text-muted hover:text-text-primary border border-border-subtle transition-colors shrink-0"
                    title="Reveal in File Explorer"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
