import React, { useEffect, useState } from 'react';
import { Minus, Square, Copy, X, ShieldCheck, Volume2, VolumeX, AlertCircle } from 'lucide-react';
import nexusLogo from '../assets/nexus-logo.png';
import { voiceService, VoiceState } from '../services/voiceService';

export const TitleBar: React.FC = () => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isElectron, setIsElectron] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>(voiceService.getState());

  useEffect(() => {
    const unsubVoice = voiceService.subscribe(setVoiceState);

    if (window.electronAPI) {
      setIsElectron(true);
      window.electronAPI.isMaximized().then(setIsMaximized);
      const unsubscribe = window.electronAPI.onWindowStateChange((maximized) => {
        setIsMaximized(maximized);
      });
      return () => {
        unsubVoice();
        unsubscribe();
      };
    }
    return unsubVoice;
  }, []);

  const handleMinimize = () => {
    window.electronAPI?.minimizeWindow();
  };

  const handleMaximize = () => {
    window.electronAPI?.maximizeWindow();
  };

  const handleClose = () => {
    window.electronAPI?.closeWindow();
  };

  return (
    <header className="h-9 w-full bg-background border-b border-border-subtle flex items-center justify-between select-none titlebar-drag z-50 text-xs">
      {/* Left: Brand / Title */}
      <div className="flex items-center space-x-2.5 px-3">
        <img
          src={nexusLogo}
          alt="NEXUS"
          className="w-5 h-5 rounded-full object-cover border border-red-500/40 shadow-sm shadow-red-500/20"
        />
        <span className="font-semibold text-text-primary tracking-wide text-xs">
          NEXUS AI
        </span>
        <span className="text-text-dim text-[11px]">•</span>
        <span className="text-text-muted text-[11px] font-normal flex items-center gap-1">
          <ShieldCheck className="w-3 h-3 text-red-500/80" />
          Autonomous Desktop Agent
        </span>
      </div>

      {/* Center: Global Voice AI Controls & Status */}
      <div className="flex items-center gap-2 titlebar-nodrag">
        {voiceState.isSpeaking && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-500/15 border border-blue-500/30 text-blue-400 text-[11px]">
            <span className="flex items-center gap-0.5 h-2.5">
              <span className="w-0.5 h-1.5 bg-blue-400 animate-pulse"></span>
              <span className="w-0.5 h-2.5 bg-blue-400 animate-pulse delay-75"></span>
              <span className="w-0.5 h-1.5 bg-blue-400 animate-pulse delay-150"></span>
            </span>
            <span className="font-medium">Speaking</span>
            <button
              type="button"
              onClick={() => voiceService.stop()}
              className="ml-1 text-red-300 hover:text-white px-1.5 py-0.2 rounded bg-red-500/20 hover:bg-red-500/40 text-[10px] font-medium transition-colors"
              title="Stop Speaking"
            >
              Stop
            </button>
          </div>
        )}

        {/* Global Voice Toggle */}
        <button
          type="button"
          onClick={() => voiceService.toggle()}
          className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-medium border transition-colors ${
            voiceState.isEnabled
              ? 'bg-blue-600/20 border-blue-500/40 text-blue-400 hover:bg-blue-600/30'
              : 'bg-background-tertiary border-border-subtle text-text-muted hover:text-text-primary hover:bg-white/[0.04]'
          }`}
          title={voiceState.isEnabled ? 'ElevenLabs Voice AI: ON (Click to mute)' : 'ElevenLabs Voice AI: OFF (Click to unmute)'}
        >
          {voiceState.isEnabled ? (
            <Volume2 className="w-3 h-3 text-blue-400" />
          ) : (
            <VolumeX className="w-3 h-3 text-text-dim" />
          )}
          <span>Voice {voiceState.isEnabled ? 'ON' : 'OFF'}</span>
        </button>

        {/* Voice Error Notice */}
        {voiceState.error && (
          <div
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] max-w-[260px] truncate"
            title={voiceState.error}
          >
            <AlertCircle className="w-3 h-3 text-amber-400 flex-shrink-0" />
            <span className="truncate">{voiceState.error.includes('permission') ? 'Voice Key: Missing text_to_speech permission' : 'Voice Error'}</span>
          </div>
        )}
      </div>

      {/* Right: Window Controls */}
      {isElectron ? (
        <div className="flex items-center h-full titlebar-nodrag">
          <button
            onClick={handleMinimize}
            className="h-full px-3 text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors flex items-center justify-center focus:outline-none"
            aria-label="Minimize"
            title="Minimize"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleMaximize}
            className="h-full px-3 text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors flex items-center justify-center focus:outline-none"
            aria-label={isMaximized ? "Restore" : "Maximize"}
            title={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? (
              <Copy className="w-3 h-3 transform rotate-90" />
            ) : (
              <Square className="w-3 h-3" />
            )}
          </button>
          <button
            onClick={handleClose}
            className="h-full px-3 text-text-secondary hover:text-white hover:bg-red-600 transition-colors flex items-center justify-center focus:outline-none"
            aria-label="Close"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div className="px-3 text-text-dim text-[10px]">Browser Preview Mode</div>
      )}
    </header>
  );
};
