import React, { useState, useRef, useEffect } from 'react';
import { 
  ArrowUp, 
  Square, 
  Trash2, 
  Plus, 
  Copy, 
  Check, 
  AlertCircle, 
  Bot, 
  User, 
  Sparkles, 
  Key, 
  CheckCircle2, 
  ArrowRight,
  Globe,
  ExternalLink,
  Volume2,
  VolumeX,
  Loader2
} from 'lucide-react';
import { ChatMessage, GeminiStatus } from '../types';
import { MarkdownView } from './MarkdownView';
import { voiceService, VoiceState } from '../services/voiceService';

interface ChatViewProps {
  messages: ChatMessage[];
  isGenerating: boolean;
  geminiStatus: GeminiStatus | null;
  onSendMessage: (text: string) => void;
  onStopGeneration: () => void;
  onNewChat: () => void;
  onClearChat: () => void;
  onNavigateToSettings: () => void;
  onNavigateToTasks: () => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  isGenerating,
  geminiStatus,
  onSendMessage,
  onStopGeneration,
  onNewChat,
  onClearChat,
  onNavigateToSettings,
  onNavigateToTasks,
}) => {
  const [inputText, setInputText] = useState('');
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>(voiceService.getState());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    return voiceService.subscribe((state) => {
      setVoiceState(state);
    });
  }, []);

  // Auto-scroll to bottom of conversation
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isGenerating]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleInputResize = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(Math.max(el.scrollHeight, 56), 180)}px`;
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    handleInputResize();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    const trimmed = inputText.trim();
    if (!trimmed || isGenerating) return;
    onSendMessage(trimmed);
    setInputText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleCopyMessage = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMsgId(id);
    setTimeout(() => setCopiedMsgId(null), 2000);
  };

  const hasApiKey = geminiStatus?.hasApiKey;

  return (
    <div className="h-full flex flex-col w-full overflow-hidden bg-background">
      {/* Top Conversation Header */}
      <header className="px-6 py-3.5 border-b border-border-subtle bg-background-secondary/40 flex items-center justify-between shrink-0 select-none">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-semibold text-text-primary tracking-wide">
                NEXUS Conversation
              </h2>
              <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-background-tertiary border border-border-subtle text-text-muted">
                {geminiStatus?.defaultModel || 'gemini-2.5-flash'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Speaking Indicator & Stop Button */}
          {voiceState.isSpeaking && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <span className="flex items-center gap-0.5 h-3">
                <span className="w-0.5 h-2 bg-blue-400 animate-pulse"></span>
                <span className="w-0.5 h-3 bg-blue-400 animate-pulse delay-75"></span>
                <span className="w-0.5 h-2 bg-blue-400 animate-pulse delay-150"></span>
                <span className="w-0.5 h-1.5 bg-blue-400 animate-pulse delay-200"></span>
              </span>
              <span className="text-[11px] font-medium hidden sm:inline">Speaking</span>
              <button
                type="button"
                onClick={() => voiceService.stop()}
                className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-red-300 hover:text-white bg-red-500/20 hover:bg-red-500/30 rounded border border-red-500/30 transition-colors"
                title="Stop Speaking"
              >
                <Square className="w-2.5 h-2.5 fill-current" />
                <span>Stop</span>
              </button>
            </div>
          )}

          {voiceState.isSynthesizing && !voiceState.isSpeaking && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-background-tertiary border border-border-subtle text-text-muted text-[11px]">
              <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
              <span className="hidden sm:inline">Generating Voice...</span>
            </div>
          )}

          {/* Voice Mode Toggle */}
          <button
            type="button"
            onClick={() => voiceService.toggle()}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border transition-all ${
              voiceState.isEnabled
                ? 'bg-blue-600/15 border-blue-500/30 text-blue-400 hover:bg-blue-600/25'
                : 'border-border-subtle text-text-muted hover:text-text-secondary hover:bg-white/[0.04]'
            }`}
            title={voiceState.isEnabled ? 'Voice Mode Active: Responses are spoken aloud (Click to mute)' : 'Voice Mode Muted: Text only responses (Click to enable)'}
          >
            {voiceState.isEnabled ? (
              <Volume2 className="w-3.5 h-3.5 text-blue-400" />
            ) : (
              <VolumeX className="w-3.5 h-3.5 text-text-dim" />
            )}
            <span className="hidden sm:inline">Voice {voiceState.isEnabled ? 'ON' : 'OFF'}</span>
          </button>

          <button
            onClick={onNewChat}
            disabled={isGenerating}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-text-secondary hover:text-text-primary hover:bg-white/[0.04] rounded-lg border border-border-subtle transition-colors disabled:opacity-50"
            title="Start fresh conversation"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Chat</span>
          </button>

          {messages.length > 0 && (
            <button
              onClick={onClearChat}
              disabled={isGenerating}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-lg border border-border-subtle transition-colors disabled:opacity-50"
              title="Clear current chat"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear</span>
            </button>
          )}
        </div>
      </header>

      {/* Missing API Key Alert Banner if not configured */}
      {!hasApiKey && (
        <div className="mx-6 mt-4 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-start justify-between gap-3 shrink-0 animate-in fade-in duration-200">
          <div className="flex items-start gap-2.5">
            <Key className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5 text-xs text-amber-200/90">
              <span className="font-semibold text-amber-100">
                Gemini API Key Required
              </span>
              <p className="text-[11px] text-amber-200/75 leading-relaxed">
                To enable live AI responses, configure your Gemini API key in the <code className="font-mono text-amber-300">.env</code> file or through the Settings panel.
              </p>
            </div>
          </div>
          <button
            onClick={onNavigateToSettings}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 transition-colors shrink-0"
          >
            <span>Configure Key</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Voice Warning Banner if TTS encountered an error */}
      {voiceState.error && (
        <div className="mx-6 mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start justify-between gap-3 shrink-0 animate-in fade-in duration-200">
          <div className="flex items-start gap-2.5">
            <VolumeX className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5 text-xs text-amber-200/90">
              <span className="font-semibold text-amber-100 flex items-center gap-1.5">
                ElevenLabs Voice Notice
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-normal">Audio fallback active</span>
              </span>
              <p className="text-[11px] text-amber-200/80 leading-relaxed">
                {voiceState.error}
              </p>
            </div>
          </div>
          <button
            onClick={onNavigateToSettings}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 transition-colors shrink-0"
          >
            <span>Voice Settings</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Messages Stream Container */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {messages.length === 0 ? (
          /* Empty Chat Prompt State */
          <div className="h-full flex flex-col items-center justify-center max-w-md mx-auto text-center my-auto py-12">
            <div className="w-12 h-12 rounded-2xl bg-background-tertiary border border-border-subtle flex items-center justify-center text-text-muted mb-4 shadow-sm">
              <Bot className="w-6 h-6 text-blue-400" />
            </div>
            <h3 className="text-sm font-semibold text-text-primary mb-1">
              Active Conversation
            </h3>
            <p className="text-xs text-text-muted leading-relaxed max-w-sm mb-4">
              Ask questions, brainstorm solutions, analyze code, or structure tasks in English or Hinglish.
            </p>
            <div className="flex items-center gap-2 text-[11px] text-text-dim">
              <span>Enter to send</span>
              <span>•</span>
              <span>Shift+Enter for newline</span>
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === 'user';
            const isCopied = copiedMsgId === msg.id;

            return (
              <div
                key={msg.id}
                className={`flex gap-3.5 max-w-3xl mx-auto w-full ${
                  isUser ? 'justify-end' : 'justify-start'
                }`}
              >
                {!isUser && (
                  <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/25 flex items-center justify-center text-blue-400 shrink-0 mt-0.5">
                    <Bot className="w-4 h-4" />
                  </div>
                )}

                <div
                  className={`group relative max-w-[85%] rounded-2xl px-4 py-3 text-xs shadow-sm transition-all ${
                    isUser
                      ? 'bg-blue-600 text-white rounded-tr-sm'
                      : msg.isError
                      ? 'bg-red-500/10 border border-red-500/30 text-red-200 rounded-tl-sm'
                      : 'bg-background-secondary border border-border-subtle text-text-primary rounded-tl-sm'
                  }`}
                >
                  {/* Tool Action Badge if task created */}
                  {msg.toolActionExecuted && (
                    <div className="mb-2 flex items-center justify-between gap-2 px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-[10px] text-emerald-300 font-medium">
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        <span>{msg.toolActionExecuted}</span>
                      </div>
                      <button
                        type="button"
                        onClick={onNavigateToTasks}
                        className="text-[10px] text-emerald-200 underline hover:text-white shrink-0"
                      >
                        View Tasks
                      </button>
                    </div>
                  )}

                  {/* Message Content */}
                  {isUser ? (
                    <div className="whitespace-pre-wrap leading-relaxed select-text font-normal">
                      {msg.text}
                    </div>
                  ) : msg.isError ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 font-medium text-red-300">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>Execution Notice</span>
                      </div>
                      <p className="leading-relaxed select-text">{msg.text}</p>
                    </div>
                  ) : (
                    <>
                      <MarkdownView content={msg.text} />
                      {msg.sources && msg.sources.length > 0 && (
                        <div className="mt-3 pt-2.5 border-t border-border-subtle/60 space-y-1.5">
                          <div className="text-[10px] uppercase font-semibold tracking-wider text-text-dim flex items-center gap-1.5">
                            <Globe className="w-3 h-3 text-blue-400" />
                            <span>Verified Sources Consulted</span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.sources.map((s, idx) => (
                              <a
                                key={idx}
                                href={s}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-background-tertiary hover:bg-background-elevated border border-border-subtle text-[11px] text-text-secondary hover:text-blue-300 transition-colors max-w-xs truncate"
                                title={s}
                              >
                                <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                                <span className="truncate">{s.replace(/^https?:\/\/(www\.)?/, '')}</span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Message Footer & Copy Button */}
                  <div
                    className={`flex items-center justify-between gap-3 mt-2 pt-1 text-[10px] opacity-70 ${
                      isUser ? 'text-blue-100/70' : 'text-text-dim'
                    }`}
                  >
                    <span>{msg.timestamp}</span>

                    {!isUser && !msg.isError && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (voiceState.isSpeaking && voiceState.activeMessageId === msg.id) {
                              voiceService.stop();
                            } else {
                              voiceService.speak(msg.text, msg.id);
                            }
                          }}
                          className={`transition-opacity flex items-center gap-1 ${
                            voiceState.isSpeaking && voiceState.activeMessageId === msg.id
                              ? 'text-blue-400 opacity-100'
                              : 'opacity-0 group-hover:opacity-100 hover:text-text-primary'
                          }`}
                          title={voiceState.isSpeaking && voiceState.activeMessageId === msg.id ? 'Stop speaking' : 'Listen aloud'}
                        >
                          {voiceState.isSpeaking && voiceState.activeMessageId === msg.id ? (
                            <>
                              <span className="flex items-center gap-0.5">
                                <span className="w-0.5 h-2 bg-blue-400 animate-pulse"></span>
                                <span className="w-0.5 h-3 bg-blue-400 animate-pulse delay-75"></span>
                                <span className="w-0.5 h-2 bg-blue-400 animate-pulse delay-150"></span>
                              </span>
                              <span className="text-blue-400">Speaking</span>
                            </>
                          ) : (
                            <>
                              <Volume2 className="w-3 h-3" />
                              <span>Listen</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleCopyMessage(msg.id, msg.text)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity hover:text-text-primary flex items-center gap-1 focus:opacity-100"
                          aria-label="Copy response"
                        >
                          {isCopied ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span className="text-emerald-400">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {isUser && (
                  <div className="w-7 h-7 rounded-lg bg-background-tertiary border border-border-subtle flex items-center justify-center text-text-secondary shrink-0 mt-0.5">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Live Loading Indicator while Gemini is thinking */}
        {isGenerating && (
          <div className="flex gap-3.5 max-w-3xl mx-auto w-full justify-start animate-in fade-in duration-150">
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/25 flex items-center justify-center text-blue-400 shrink-0 mt-0.5">
              <Bot className="w-4 h-4 animate-pulse" />
            </div>
            <div className="bg-background-secondary border border-border-subtle rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-3 text-xs text-text-secondary shadow-sm">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '300ms' }}></span>
              </span>
              <span className="text-[11px] text-text-muted">NEXUS is formulating response...</span>
              <button
                onClick={onStopGeneration}
                className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-background-tertiary hover:bg-background-elevated text-red-400 border border-border-subtle transition-colors"
                title="Cancel request"
              >
                <Square className="w-2.5 h-2.5 fill-red-400" />
                <span>Stop</span>
              </button>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Bottom Prompt Input Dock */}
      <div className="p-4 border-t border-border-subtle bg-background-secondary/30 shrink-0">
        <div className="max-w-3xl mx-auto relative group">
          <div className="w-full bg-background-secondary rounded-2xl border border-border transition-all duration-200 focus-within:border-blue-500/60 focus-within:ring-1 focus-within:ring-blue-500/40 p-3 shadow-md shadow-black/20">
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={handleTextChange}
              onKeyDown={handleKeyDown}
              placeholder={hasApiKey ? "Ask anything, discuss code, or plan a task..." : "Enter message (requires API key to generate response)..."}
              rows={1}
              disabled={isGenerating}
              className="w-full bg-transparent text-text-primary placeholder:text-text-muted resize-none focus:outline-none text-xs leading-relaxed max-h-44 disabled:opacity-50"
              aria-label="Chat input"
            />

            <div className="flex items-center justify-between pt-2 border-t border-border-subtle/50 mt-1 select-none text-[11px]">
              <div className="text-text-dim text-[10px]">
                <span>Shift + Return for newline</span>
              </div>

              <div className="flex items-center gap-2">
                {isGenerating ? (
                  <button
                    onClick={onStopGeneration}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-red-600/15 hover:bg-red-600/25 text-red-400 border border-red-500/30 transition-colors"
                  >
                    <Square className="w-3 h-3 fill-red-400" />
                    <span>Stop</span>
                  </button>
                ) : (
                  <button
                    onClick={handleSubmit}
                    disabled={!inputText.trim()}
                    className={`inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                      inputText.trim()
                        ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm shadow-blue-500/20 active:scale-95'
                        : 'bg-background-tertiary text-text-dim border border-border-subtle cursor-not-allowed opacity-50'
                    }`}
                    aria-label="Send message"
                  >
                    <span>Send</span>
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
