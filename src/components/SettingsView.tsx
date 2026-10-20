import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  Globe, 
  FileEdit, 
  HardDrive, 
  Monitor, 
  Sparkles, 
  Eye, 
  EyeOff, 
  Check, 
  AlertTriangle,
  Info,
  Lock,
  RefreshCw,
  AlertCircle,
  Volume2,
  Play,
  Square
} from 'lucide-react';
import { AppSettings, GeminiStatus, ElevenLabsStatus } from '../types';
import { SUGGESTED_MODELS, DEFAULT_SYSTEM_INSTRUCTION } from '../utils/personality';
import { apiBridge } from '../services/apiBridge';
import { voiceService } from '../services/voiceService';

interface SettingsViewProps {
  settings: AppSettings;
  geminiStatus: GeminiStatus | null;
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  onSaveApiKey: (key: string) => Promise<boolean>;
  onTestConnection: (key?: string) => Promise<{ success: boolean; error?: string; model?: string }>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  geminiStatus,
  onUpdateSettings,
  onSaveApiKey,
  onTestConnection,
}) => {
  const [activeSection, setActiveSection] = useState<'gemini' | 'voice' | 'personality' | 'permissions' | 'desktop' | 'about'>('gemini');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // ElevenLabs Voice configuration state
  const [elevenLabsStatus, setElevenLabsStatus] = useState<ElevenLabsStatus | null>(null);
  const [elevenLabsApiKeyInput, setElevenLabsApiKeyInput] = useState('');
  const [elevenLabsVoiceIdInput, setElevenLabsVoiceIdInput] = useState('');
  const [elevenLabsModelInput, setElevenLabsModelInput] = useState('eleven_multilingual_v2');
  const [showElevenLabsKey, setShowElevenLabsKey] = useState(false);
  const [isTestingVoice, setIsTestingVoice] = useState(false);
  const [voiceTestResult, setVoiceTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [voiceSaveStatus, setVoiceSaveStatus] = useState<string | null>(null);
  const [isPlayingTestVoice, setIsPlayingTestVoice] = useState(false);

  useEffect(() => {
    apiBridge.getElevenLabsStatus().then((status) => {
      setElevenLabsStatus(status);
      if (status.voiceId) setElevenLabsVoiceIdInput(status.voiceId);
      if (status.model) setElevenLabsModelInput(status.model);
    });
  }, []);

  const handleSaveKey = async () => {
    if (!apiKeyInput.trim()) return;
    const ok = await onSaveApiKey(apiKeyInput.trim());
    if (ok) {
      setSaveStatus('API key safely saved to backend vault');
      setApiKeyInput('');
      setTimeout(() => setSaveStatus(null), 3000);
    }
  };

  const handleRunTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    const result = await onTestConnection(apiKeyInput.trim() || undefined);
    setIsTesting(false);
    if (result.success) {
      setTestResult({
        success: true,
        message: `Success! Connection verified with model ${result.model || settings.model}.`,
      });
    } else {
      setTestResult({
        success: false,
        message: result.error || 'Connection failed. Please verify network and API key.',
      });
    }
  };

  const handleSaveElevenLabsConfig = async () => {
    const configToSave: { apiKey?: string; voiceId?: string; model?: string } = {};
    if (elevenLabsApiKeyInput.trim()) configToSave.apiKey = elevenLabsApiKeyInput.trim();
    if (elevenLabsVoiceIdInput.trim()) configToSave.voiceId = elevenLabsVoiceIdInput.trim();
    if (elevenLabsModelInput.trim()) configToSave.model = elevenLabsModelInput.trim();

    const res = await apiBridge.setElevenLabsConfig(configToSave);
    if (res.success) {
      setVoiceSaveStatus('ElevenLabs settings saved securely');
      setElevenLabsApiKeyInput('');
      const updated = await apiBridge.getElevenLabsStatus();
      setElevenLabsStatus(updated);
      setTimeout(() => setVoiceSaveStatus(null), 3500);
    }
  };

  const handleTestElevenLabs = async () => {
    setIsTestingVoice(true);
    setVoiceTestResult(null);
    const res = await apiBridge.testElevenLabsConnection(
      elevenLabsApiKeyInput.trim() || undefined,
      elevenLabsVoiceIdInput.trim() || undefined
    );
    setIsTestingVoice(false);
    if (res.success) {
      setVoiceTestResult({
        success: true,
        message: res.message || 'ElevenLabs voice connection verified successfully!',
      });
    } else {
      setVoiceTestResult({
        success: false,
        message: res.error || 'Connection failed.',
      });
    }
  };

  const handlePlayVoiceSample = async () => {
    if (isPlayingTestVoice) {
      voiceService.stop();
      setIsPlayingTestVoice(false);
      return;
    }
    setIsPlayingTestVoice(true);
    const spoken = await voiceService.speak('Hello! I am NEXUS, your autonomous AI desktop agent. My voice synthesis is operational.', 'test-sample');
    setIsPlayingTestVoice(false);
    if (!spoken && voiceService.getState().error) {
      setVoiceTestResult({
        success: false,
        message: voiceService.getState().error || 'Audio playback failed.',
      });
    }
  };

  return (
    <div className="h-full flex flex-col w-full overflow-hidden bg-background">
      {/* Header */}
      <header className="px-8 py-5 border-b border-border-subtle bg-background-secondary/30 flex items-center justify-between shrink-0 select-none">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">
            Settings & Security
          </h1>
          <p className="text-xs text-text-secondary mt-1">
            Configure Gemini AI brain, assistant personality, ElevenLabs voice, and sandbox parameters
          </p>
        </div>

        <div className="flex items-center gap-2">
          {saveStatus && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Check className="w-3.5 h-3.5" />
              <span>{saveStatus}</span>
            </div>
          )}
          {voiceSaveStatus && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Check className="w-3.5 h-3.5" />
              <span>{voiceSaveStatus}</span>
            </div>
          )}
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 flex overflow-hidden">
        {/* Settings Navigation Tabs */}
        <aside className="w-60 border-r border-border-subtle p-4 space-y-1 shrink-0 bg-background-secondary/20 select-none">
          <button
            onClick={() => setActiveSection('gemini')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
              activeSection === 'gemini'
                ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30'
                : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>Gemini Intelligence</span>
          </button>

          <button
            onClick={() => setActiveSection('voice')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
              activeSection === 'voice'
                ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30'
                : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
            }`}
          >
            <Volume2 className="w-4 h-4" />
            <span>ElevenLabs Voice</span>
          </button>

          <button
            onClick={() => setActiveSection('personality')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
              activeSection === 'personality'
                ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30'
                : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
            }`}
          >
            <FileEdit className="w-4 h-4" />
            <span>Personality & Prompt</span>
          </button>

          <button
            onClick={() => setActiveSection('permissions')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
              activeSection === 'permissions'
                ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30'
                : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
            }`}
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Security & Permissions</span>
          </button>

          <button
            onClick={() => setActiveSection('desktop')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
              activeSection === 'desktop'
                ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30'
                : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
            }`}
          >
            <Monitor className="w-4 h-4" />
            <span>Desktop Preferences</span>
          </button>

          <button
            onClick={() => setActiveSection('about')}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors text-left ${
              activeSection === 'about'
                ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30'
                : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.04]'
            }`}
          >
            <Info className="w-4 h-4" />
            <span>Diagnostics & About</span>
          </button>
        </aside>

        {/* Settings Detail Pane */}
        <div className="flex-1 overflow-y-auto p-8 max-w-2xl">
          {activeSection === 'gemini' && (
            <div className="space-y-6">
              {/* API Key Status Banner */}
              <div
                className={`p-4 rounded-xl border flex items-start gap-3.5 ${
                  geminiStatus?.hasApiKey
                    ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                    : 'bg-amber-500/10 border-amber-500/25 text-amber-300'
                }`}
              >
                {geminiStatus?.hasApiKey ? (
                  <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                )}
                <div className="text-xs space-y-1">
                  <div className="font-semibold text-text-primary">
                    {geminiStatus?.hasApiKey
                      ? `API Key Configured (${
                          geminiStatus.keySource === 'env'
                            ? 'Loaded from .env environment variable'
                            : 'Loaded from local secure vault'
                        })`
                      : 'Gemini API Key Missing'}
                  </div>
                  <p className="text-text-muted leading-relaxed">
                    {geminiStatus?.hasApiKey
                      ? 'The backend process has loaded a valid key. The key is kept strictly isolated on the backend.'
                      : 'Set GEMINI_API_KEY in your local .env file or enter a key below to save it securely.'}
                  </p>
                </div>
              </div>

              {/* API Key Input */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-primary flex items-center justify-between">
                  <span>Enter / Override Gemini API Key</span>
                  <span className="text-[11px] text-text-dim flex items-center gap-1 font-mono">
                    <Lock className="w-3 h-3 text-emerald-400" />
                    Isolated in Backend
                  </span>
                </label>
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder={
                      geminiStatus?.hasApiKey
                        ? '•••••••••••••••••••••••••••••• (Key is active)'
                        : 'Enter key (e.g., AIzaSy...)'
                    }
                    className="w-full bg-background-secondary border border-border rounded-xl px-3.5 py-2.5 text-xs text-text-primary placeholder:text-text-dim pr-10 focus:outline-none focus:border-blue-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-3 top-2.5 text-text-muted hover:text-text-primary"
                    aria-label={showApiKey ? 'Hide key' : 'Show key'}
                  >
                    {showApiKey ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-text-muted">
                    Keys are never exposed to browser bundles or version control.
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleRunTest}
                      disabled={isTesting}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-background-tertiary hover:bg-background-elevated text-text-primary border border-border-subtle transition-colors disabled:opacity-50"
                    >
                      {isTesting ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin text-blue-400" />
                          <span>Testing...</span>
                        </>
                      ) : (
                        <span>Test Connection</span>
                      )}
                    </button>
                    {apiKeyInput.trim() && (
                      <button
                        type="button"
                        onClick={handleSaveKey}
                        className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                      >
                        Save Key
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Test Connection Result Box */}
              {testResult && (
                <div
                  className={`p-3.5 rounded-xl border flex items-start gap-2.5 text-xs animate-in fade-in duration-150 ${
                    testResult.success
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                      : 'bg-red-500/10 border-red-500/30 text-red-200'
                  }`}
                >
                  {testResult.success ? (
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  )}
                  <span className="leading-relaxed">{testResult.message}</span>
                </div>
              )}

              {/* Model Selection */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-primary">
                  Foundation AI Model
                </label>
                <select
                  value={settings.model}
                  onChange={(e) => onUpdateSettings({ model: e.target.value })}
                  className="w-full bg-background-secondary border border-border rounded-xl px-3.5 py-2.5 text-xs text-text-primary focus:outline-none focus:border-blue-500 cursor-pointer"
                >
                  {SUGGESTED_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} — {m.description}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-text-muted">
                  NEXUS AI connects directly to high-performance neural intelligence models with low-latency streaming.
                </p>
              </div>

              {/* Temperature Slider */}
              <div className="space-y-2 p-4 rounded-xl bg-background-secondary/60 border border-border-subtle">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-medium text-text-primary">Response Temperature</span>
                  <span className="font-mono text-blue-400">{settings.temperature}</span>
                </div>
                <input
                  type="range"
                  min="0.0"
                  max="1.0"
                  step="0.05"
                  value={settings.temperature}
                  onChange={(e) => onUpdateSettings({ temperature: parseFloat(e.target.value) })}
                  className="w-full accent-blue-500 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-text-dim">
                  <span>0.0 (Deterministic / Coding)</span>
                  <span>1.0 (Creative / Brainstorming)</span>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'voice' && (
            <div className="space-y-6">
              {/* Status Banner */}
              <div
                className={`p-4 rounded-xl border flex items-start gap-3.5 ${
                  elevenLabsStatus?.hasApiKey && elevenLabsStatus?.hasVoiceId
                    ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300'
                    : 'bg-amber-500/10 border-amber-500/25 text-amber-300'
                }`}
              >
                {elevenLabsStatus?.hasApiKey && elevenLabsStatus?.hasVoiceId ? (
                  <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                )}
                <div className="text-xs space-y-1">
                  <div className="font-semibold text-text-primary">
                    {elevenLabsStatus?.hasApiKey && elevenLabsStatus?.hasVoiceId
                      ? `ElevenLabs Voice Configured (${
                          elevenLabsStatus.keySource === 'env'
                            ? 'Loaded from .env file'
                            : 'Loaded from local secure vault'
                        })`
                      : 'ElevenLabs Credentials Incomplete'}
                  </div>
                  <p className="text-text-muted leading-relaxed">
                    {elevenLabsStatus?.hasApiKey && elevenLabsStatus?.hasVoiceId
                      ? `Voice ID: ${elevenLabsStatus.voiceId} • Model: ${elevenLabsStatus.model || 'eleven_multilingual_v2'} (supports Hindi, English, and multilingual responses).`
                      : 'Configure ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID in your local .env file or save them below.'}
                  </p>
                </div>
              </div>

              {/* Voice ID Input */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-primary flex items-center justify-between">
                  <span>ElevenLabs Voice ID</span>
                  <span className="text-[11px] text-text-dim font-mono">
                    {elevenLabsStatus?.voiceId ? `Active: ${elevenLabsStatus.voiceId}` : 'e.g. hw70l6UiioXIpgpHCjP6'}
                  </span>
                </label>
                <input
                  type="text"
                  value={elevenLabsVoiceIdInput}
                  onChange={(e) => setElevenLabsVoiceIdInput(e.target.value)}
                  placeholder="Enter ElevenLabs Voice ID (e.g. hw70l6UiioXIpgpHCjP6)"
                  className="w-full bg-background-secondary border border-border rounded-xl px-3.5 py-2.5 text-xs text-text-primary placeholder:text-text-dim focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              {/* API Key Input */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-primary flex items-center justify-between">
                  <span>ElevenLabs API Key</span>
                  <span className="text-[11px] text-text-dim flex items-center gap-1 font-mono">
                    <Lock className="w-3 h-3 text-emerald-400" />
                    Isolated in Backend Vault
                  </span>
                </label>
                <div className="relative">
                  <input
                    type={showElevenLabsKey ? 'text' : 'password'}
                    value={elevenLabsApiKeyInput}
                    onChange={(e) => setElevenLabsApiKeyInput(e.target.value)}
                    placeholder={
                      elevenLabsStatus?.hasApiKey
                        ? `•••••••••••••••••••••••••••••• (${elevenLabsStatus.maskedKey || 'Key Active'})`
                        : 'Enter API key (e.g. sk_c131...)'
                    }
                    className="w-full bg-background-secondary border border-border rounded-xl px-3.5 py-2.5 text-xs text-text-primary placeholder:text-text-dim pr-10 focus:outline-none focus:border-blue-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowElevenLabsKey(!showElevenLabsKey)}
                    className="absolute right-3 top-2.5 text-text-muted hover:text-text-primary"
                    aria-label={showElevenLabsKey ? 'Hide key' : 'Show key'}
                  >
                    {showElevenLabsKey ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Model Selection */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-text-primary">
                  Voice Model
                </label>
                <select
                  value={elevenLabsModelInput}
                  onChange={(e) => setElevenLabsModelInput(e.target.value)}
                  className="w-full bg-background-secondary border border-border rounded-xl px-3.5 py-2.5 text-xs text-text-primary focus:outline-none focus:border-blue-500 cursor-pointer"
                >
                  <option value="eleven_multilingual_v2">
                    eleven_multilingual_v2 (Recommended: Hindi, English & 29 Languages)
                  </option>
                  <option value="eleven_turbo_v2_5">
                    eleven_turbo_v2_5 (Low-latency streaming English & Multilingual)
                  </option>
                  <option value="eleven_monolingual_v1">
                    eleven_monolingual_v1 (Standard English)
                  </option>
                </select>
              </div>

              {/* Buttons: Test, Play Sample, Save */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border-subtle/50">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleTestElevenLabs}
                    disabled={isTestingVoice}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-background-tertiary hover:bg-background-elevated text-text-primary border border-border-subtle transition-colors disabled:opacity-50"
                  >
                    {isTestingVoice ? (
                      <>
                        <RefreshCw className="w-3 h-3 animate-spin text-blue-400" />
                        <span>Verifying...</span>
                      </>
                    ) : (
                      <span>Test Connection</span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handlePlayVoiceSample}
                    disabled={!elevenLabsStatus?.hasApiKey || !elevenLabsStatus?.hasVoiceId}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-blue-600/15 hover:bg-blue-600/25 text-blue-400 border border-blue-500/30 transition-colors disabled:opacity-40"
                  >
                    {isPlayingTestVoice ? (
                      <>
                        <Square className="w-3 h-3 fill-current text-blue-400" />
                        <span>Stop Sample</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3 h-3 fill-current text-blue-400" />
                        <span>Play Test Voice</span>
                      </>
                    )}
                  </button>
                </div>

                {(elevenLabsApiKeyInput.trim() || elevenLabsVoiceIdInput.trim() !== (elevenLabsStatus?.voiceId || '') || elevenLabsModelInput !== (elevenLabsStatus?.model || '')) && (
                  <button
                    type="button"
                    onClick={handleSaveElevenLabsConfig}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
                  >
                    Save Voice Settings
                  </button>
                )}
              </div>

              {/* Test Result Message */}
              {voiceTestResult && (
                <div
                  className={`p-3.5 rounded-xl border flex items-start gap-2.5 text-xs animate-in fade-in duration-150 ${
                    voiceTestResult.success
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                      : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                  }`}
                >
                  {voiceTestResult.success ? (
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  )}
                  <span className="leading-relaxed">{voiceTestResult.message}</span>
                </div>
              )}
            </div>
          )}

          {activeSection === 'personality' && (
            <div className="space-y-5">
              <div className="p-3.5 rounded-xl bg-background-tertiary border border-border-subtle flex items-start gap-3">
                <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <p className="text-xs text-text-muted leading-relaxed">
                  Customize the system instruction governing NEXUS AI's behavior, tone, Hinglish fluency, and honesty boundaries.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-text-primary">System Instruction</span>
                  <button
                    type="button"
                    onClick={() => onUpdateSettings({ systemInstruction: DEFAULT_SYSTEM_INSTRUCTION })}
                    className="text-text-muted hover:text-blue-400 transition-colors"
                  >
                    Reset to Default
                  </button>
                </div>
                <textarea
                  rows={14}
                  value={settings.systemInstruction}
                  onChange={(e) => onUpdateSettings({ systemInstruction: e.target.value })}
                  className="w-full bg-background-secondary border border-border rounded-xl p-3.5 text-xs text-text-primary font-mono leading-relaxed focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          )}

          {activeSection === 'permissions' && (
            <div className="space-y-5">
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-200/90 space-y-1">
                  <span className="font-semibold text-amber-100">
                    Security Sandbox & Guardrails
                  </span>
                  <p>
                    Arbitrary shell execution and unconstrained filesystem operations are strictly disabled to protect your Windows system.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="p-4 rounded-xl bg-background-secondary/60 border border-border-subtle flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <Globe className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                    <div>
                      <div className="text-xs font-medium text-text-primary">
                        Autonomous Web Browsing
                      </div>
                      <p className="text-[11px] text-text-muted mt-0.5">
                        Restricted in Phase 2 to prevent unauthorized external network navigation.
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-text-dim px-2 py-0.5 rounded bg-background-tertiary border border-border-subtle shrink-0">
                    Disabled
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-background-secondary/60 border border-border-subtle flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <HardDrive className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
                    <div>
                      <div className="text-xs font-medium text-text-primary">
                        Filesystem Sandbox Access
                      </div>
                      <p className="text-[11px] text-text-muted mt-0.5">
                        Reads and writes are strictly confined to the application's isolated userData repository.
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-400/90 px-2 py-0.5 rounded bg-background-tertiary border border-border-subtle shrink-0">
                    Sandboxed
                  </span>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'desktop' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-background-secondary/60 border border-border-subtle flex items-center justify-between">
                <div className="space-y-0.5 pr-4">
                  <div className="text-xs font-medium text-text-primary">
                    Launch on Windows Startup
                  </div>
                  <div className="text-[11px] text-text-muted">
                    Automatically initialize the NEXUS AI shell upon system startup.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onUpdateSettings({ launchOnStartup: !settings.launchOnStartup })}
                  className={`w-10 h-6 rounded-full transition-colors relative shrink-0 ${
                    settings.launchOnStartup ? 'bg-blue-600' : 'bg-background-tertiary border border-border-subtle'
                  }`}
                >
                  <span
                    className={`block w-4 h-4 rounded-full bg-white transition-transform transform ${
                      settings.launchOnStartup ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="p-4 rounded-xl bg-background-secondary/60 border border-border-subtle flex items-center justify-between">
                <div className="space-y-0.5 pr-4">
                  <div className="text-xs font-medium text-text-primary">
                    Minimize to System Tray
                  </div>
                  <div className="text-[11px] text-text-muted">
                    Closing the window keeps the AI agent in standby.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onUpdateSettings({ minimizeToTray: !settings.minimizeToTray })}
                  className={`w-10 h-6 rounded-full transition-colors relative shrink-0 ${
                    settings.minimizeToTray ? 'bg-blue-600' : 'bg-background-tertiary border border-border-subtle'
                  }`}
                >
                  <span
                    className={`block w-4 h-4 rounded-full bg-white transition-transform transform ${
                      settings.minimizeToTray ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {activeSection === 'about' && (
            <div className="space-y-5">
              <div className="p-5 rounded-2xl bg-background-secondary border border-border-subtle space-y-3">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-base text-text-primary">
                    NEXUS AI
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded">
                    Phase 2 Real AI Brain
                  </span>
                </div>
                <p className="text-xs text-text-secondary leading-relaxed">
                  Personal desktop AI assistant engineered with Electron, React, Tailwind CSS, and low-latency neural intelligence.
                </p>
              </div>

              {/* Creator & Developer Attribution Card */}
              <div className="p-5 rounded-2xl bg-gradient-to-br from-blue-950/20 via-background-secondary to-purple-950/20 border border-blue-500/20 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-text-primary">
                      About the Developer
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded font-medium">
                      Creator
                    </span>
                  </div>
                  <span className="text-xs font-semibold text-blue-300">Pratyush</span>
                </div>
                <p className="text-xs text-text-secondary leading-relaxed">
                  NEXUS was conceptualized and developed by <strong className="text-text-primary font-medium">Pratyush</strong>, an independent creator passionate about artificial intelligence, mathematics, science, and technology. Driven by curiosity and a vision of building a more intelligent and capable digital assistant, he designed NEXUS to bring conversational AI, voice interaction, browser automation, and computer control together in one unified system. With a focus on continuous improvement, reliability, and innovation, Pratyush aims to evolve NEXUS into an intelligent assistant capable of understanding complex tasks and helping people accomplish them efficiently. NEXUS represents his journey of experimentation, creativity, and the belief that powerful technology begins with a curious mind.
                </p>
                <div className="pt-2 border-t border-border-subtle/50 text-[11px] text-text-muted flex items-center justify-between">
                  <span>Application Origin: Independent Creator Project</span>
                  <span>Developed by: Pratyush</span>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-background-secondary/60 border border-border-subtle space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-text-secondary">AI Core</span>
                  <span className="text-blue-400 font-mono">NEXUS Neural Engine</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-secondary">Context Isolation</span>
                  <span className="text-emerald-400 font-mono flex items-center gap-1">
                    <Check className="w-3 h-3" /> Enabled
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-secondary">Node Integration</span>
                  <span className="text-emerald-400 font-mono flex items-center gap-1">
                    <Check className="w-3 h-3" /> Disabled
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-secondary">Preload Sandboxing</span>
                  <span className="text-emerald-400 font-mono flex items-center gap-1">
                    <Check className="w-3 h-3" /> Active
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
