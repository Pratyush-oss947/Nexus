import React, { useState, useRef, useEffect } from 'react';
import { 
  ArrowUp, 
  Search, 
  FileText, 
  SlidersHorizontal, 
  Download, 
  Sparkles,
  Key,
  Volume2,
  VolumeX
} from 'lucide-react';
import { ExamplePrompt, GeminiStatus } from '../types';
import { voiceService, VoiceState } from '../services/voiceService';

interface NewTaskViewProps {
  onStartAiTask: (prompt: string) => void;
  geminiStatus: GeminiStatus | null;
  onNavigateToSettings: () => void;
}

const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  {
    id: 'research',
    title: 'Research a topic',
    description: 'Synthesize findings and recent developments',
    category: 'Research',
    prompt: 'Research recent breakthroughs in solid-state batteries and summarize commercialization timelines.',
  },
  {
    id: 'form',
    title: 'Help fill out a form',
    description: 'Prepare accurate field values and check requirements',
    category: 'Form Filling',
    prompt: 'Guide and structure field inputs for filing an IRS quarterly estimated tax payment voucher.',
  },
  {
    id: 'compare',
    title: 'Compare products',
    description: 'Evaluate technical specifications and pricing',
    category: 'Comparison',
    prompt: 'Compare high-performance developer laptops under $1,500 based on RAM expansion, CPU thermal profiles, and battery life.',
  },
  {
    id: 'download',
    title: 'Find and download a document',
    description: 'Locate official publications and save to local drive',
    category: 'Document Retrieval',
    prompt: 'Find and download the official NIST AI Risk Management Framework (AI RMF 1.0) PDF documentation.',
  },
];

export const NewTaskView: React.FC<NewTaskViewProps> = ({
  onStartAiTask,
  geminiStatus,
  onNavigateToSettings,
}) => {
  const [prompt, setPrompt] = useState('');
  const [voiceState, setVoiceState] = useState<VoiceState>(voiceService.getState());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    return voiceService.subscribe(setVoiceState);
  }, []);

  const handleInputResize = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(Math.max(el.scrollHeight, 110), 260)}px`;
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setPrompt(e.target.value);
    handleInputResize();
  };

  const handleSubmit = () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    onStartAiTask(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSelectExample = (item: ExamplePrompt) => {
    setPrompt(item.prompt);
    if (textareaRef.current) {
      textareaRef.current.focus();
      setTimeout(() => {
        handleInputResize();
      }, 0);
    }
  };

  const getExampleIcon = (id: string) => {
    switch (id) {
      case 'research':
        return <Search className="w-3.5 h-3.5 text-blue-400" />;
      case 'form':
        return <FileText className="w-3.5 h-3.5 text-emerald-400" />;
      case 'compare':
        return <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />;
      case 'download':
        return <Download className="w-3.5 h-3.5 text-amber-400" />;
      default:
        return null;
    }
  };

  const hasApiKey = geminiStatus?.hasApiKey;

  return (
    <div className="h-full flex flex-col items-center justify-center max-w-3xl mx-auto px-6 py-8 overflow-y-auto w-full select-none">
      {/* Scope / Engine Status Pill */}
      <div className="mb-6 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-background-tertiary border border-border-subtle text-[11px] text-text-secondary select-none">
        <Sparkles className="w-3 h-3 text-blue-400" />
        <span>NEXUS AI Brain • Gemini 2.5 Active</span>
      </div>

      {/* Main Heading & Supporting Text */}
      <div className="text-center mb-8">
        <h1 className="text-3xl font-semibold text-text-primary tracking-tight mb-2">
          What can I do for you?
        </h1>
        <p className="text-sm text-text-secondary font-normal">
          Describe a task. I'll help you get it done.
        </p>
      </div>

      {/* Primary Multiline Prompt Input Box */}
      <div className="w-full relative group">
        <div className="w-full bg-background-secondary rounded-2xl border border-border transition-all duration-200 focus-within:border-blue-500/60 focus-within:ring-1 focus-within:ring-blue-500/40 shadow-lg shadow-black/40 p-4">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder="Describe any task, ask a question, or draft code..."
            rows={3}
            className="w-full bg-transparent text-text-primary placeholder:text-text-muted resize-none focus:outline-none text-sm leading-relaxed max-h-64"
            aria-label="Task Prompt Input"
          />

          <div className="flex items-center justify-between pt-3 border-t border-border-subtle/60 mt-1 select-none">
            {/* Input Hints */}
            <div className="flex items-center gap-2 text-[11px] text-text-dim">
              <span>
                <kbd className="px-1.5 py-0.5 rounded bg-background-tertiary border border-border-subtle font-mono text-[10px] text-text-muted">
                  Return
                </kbd>{' '}
                to start
              </span>
              <span>•</span>
              <span>
                <kbd className="px-1.5 py-0.5 rounded bg-background-tertiary border border-border-subtle font-mono text-[10px] text-text-muted">
                  Shift + Return
                </kbd>{' '}
                for newline
              </span>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => voiceService.toggle()}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  voiceState.isEnabled
                    ? 'bg-blue-600/15 border-blue-500/30 text-blue-400 hover:bg-blue-600/25'
                    : 'bg-background-tertiary border-border-subtle text-text-muted hover:text-text-secondary hover:bg-white/[0.04]'
                }`}
                title={voiceState.isEnabled ? 'Voice Mode Active: NEXUS will speak responses aloud' : 'Voice Mode Muted: Click to enable voice responses'}
              >
                {voiceState.isEnabled ? (
                  <Volume2 className="w-3.5 h-3.5 text-blue-400" />
                ) : (
                  <VolumeX className="w-3.5 h-3.5 text-text-dim" />
                )}
                <span>Voice {voiceState.isEnabled ? 'ON' : 'OFF'}</span>
              </button>

              <button
                onClick={() => handleSubmit()}
                disabled={!prompt.trim()}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  prompt.trim()
                    ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm shadow-blue-500/20 active:scale-95'
                    : 'bg-background-tertiary text-text-dim border border-border-subtle cursor-not-allowed opacity-60'
                }`}
                aria-label="Start Task"
              >
                <span>Start Task</span>
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Setup notification if API key not found */}
      {!hasApiKey && (
        <div className="w-full mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between gap-3 text-xs text-amber-300">
          <div className="flex items-center gap-2">
            <Key className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Gemini API key is not yet configured. Live model queries require a key in .env or Settings.</span>
          </div>
          <button
            onClick={onNavigateToSettings}
            className="text-[11px] text-amber-200 underline hover:text-white shrink-0"
          >
            Settings
          </button>
        </div>
      )}

      {/* Understated Example Prompts */}
      <div className="w-full mt-8">
        <div className="flex items-center justify-between mb-3 px-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-text-dim">
            Suggested starting points
          </span>
          <span className="text-[11px] text-text-dim">Click to populate</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {EXAMPLE_PROMPTS.map((item) => (
            <button
              key={item.id}
              onClick={() => handleSelectExample(item)}
              className="flex items-start gap-3 p-3 rounded-xl bg-background-secondary/70 hover:bg-background-tertiary border border-border-subtle hover:border-border transition-all text-left group"
            >
              <div className="p-2 rounded-lg bg-background-tertiary border border-border-subtle group-hover:border-border transition-colors shrink-0 mt-0.5">
                {getExampleIcon(item.id)}
              </div>
              <div className="min-w-0">
                <h2 className="text-xs font-medium text-text-primary group-hover:text-blue-400 transition-colors">
                  {item.title}
                </h2>
                <p className="text-[11px] text-text-muted mt-0.5 leading-normal line-clamp-2">
                  {item.description}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
