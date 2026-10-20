import { contextBridge, ipcRenderer } from 'electron';

export interface GeminiStatus {
  hasApiKey: boolean;
  keySource: 'env' | 'settings' | 'none';
  defaultModel: string;
}

export interface ChatRequest {
  messages: Array<{ role: 'user' | 'model'; text: string }>;
  model?: string;
  provider?: 'gemini' | 'ollama';
  temperature?: number;
  systemInstruction?: string;
}

export interface OllamaStatus {
  isRunning: boolean;
  host: string;
  hasApiKey?: boolean;
  models: string[];
  error?: string;
}

export interface ElevenLabsStatus {
  hasApiKey: boolean;
  hasVoiceId: boolean;
  voiceId: string;
  model: string;
  keySource: 'env' | 'settings' | 'none';
  maskedKey?: string;
  error?: string;
}

export interface AudioChunk {
  text: string;
  audioBase64: string;
  mimeType: string;
}

export interface SpeechSynthesisResult {
  success: boolean;
  audioChunks?: AudioChunk[];
  error?: string;
  status?: string;
}

export interface ChatResponse {
  text: string;
  error?: string;
  createdTasks?: Array<{ title: string; category?: string }>;
  sources?: string[];
  steps?: Array<{ step: number; tool: string; args: any; result: any; timestamp: string }>;
}

export interface TaskItem {
  id: string;
  title: string;
  description?: string;
  category?: string;
  completed: boolean;
  createdAt: string;
  completedAt?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Array<{
    id: string;
    role: 'user' | 'model' | 'system';
    text: string;
    timestamp: string;
    isError?: boolean;
    toolActionExecuted?: string;
  }>;
}

export interface AutomationProgressEvent {
  id: string;
  timestamp: string;
  type: 'NAVIGATE' | 'SEARCH' | 'READ' | 'CLICK' | 'FILL' | 'DOWNLOAD' | 'APPROVAL' | 'SCREENSHOT' | 'ERROR' | 'INFO' | 'SUCCESS';
  message: string;
  details?: string;
  url?: string;
  screenshotUrl?: string;
}

export interface ApprovalRequest {
  id: string;
  action: string;
  details: string;
  targetUrl: string;
  formData?: Record<string, string>;
  isConsequential: boolean;
}

export interface DownloadItem {
  filename: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  restoreWindow: () => void;
  focusWindow: () => void;
  bringBrowserToFront: () => Promise<{ success: boolean; error?: string }>;
  closeWindow: () => void;
  isMaximized: () => Promise<boolean>;
  onWindowStateChange: (callback: (isMaximized: boolean) => void) => () => void;

  // Gemini AI
  getGeminiStatus: () => Promise<GeminiStatus>;
  setGeminiKey: (key: string) => Promise<{ success: boolean; hasApiKey: boolean }>;
  testGeminiConnection: (key?: string) => Promise<{ success: boolean; error?: string; model?: string }>;
  sendChatMessage: (request: ChatRequest) => Promise<ChatResponse>;
  cancelChatMessage: () => Promise<void>;

  // Ollama Local AI
  getOllamaStatus: () => Promise<OllamaStatus>;
  setOllamaKey: (key: string) => Promise<{ success: boolean; hasApiKey: boolean }>;
  testOllamaConnection: (modelName?: string, customKey?: string) => Promise<{ success: boolean; models?: string[]; error?: string }>;

  // ElevenLabs AI Voice
  getElevenLabsStatus: () => Promise<ElevenLabsStatus>;
  setElevenLabsConfig: (config: { apiKey?: string; voiceId?: string; model?: string }) => Promise<{ success: boolean }>;
  testElevenLabsConnection: (apiKey?: string, voiceId?: string) => Promise<{ success: boolean; error?: string; message?: string }>;
  synthesizeSpeech: (text: string, options?: { voiceId?: string; modelId?: string }) => Promise<SpeechSynthesisResult>;
  cancelSpeechSynthesis: () => Promise<{ success: boolean }>;

  // Persistence
  loadTasks: () => Promise<TaskItem[]>;
  saveTasks: (tasks: TaskItem[]) => Promise<{ success: boolean }>;
  loadConversations: () => Promise<Conversation[]>;
  saveConversations: (conversations: Conversation[]) => Promise<{ success: boolean }>;

  // Phase 3: Browser Automation & Action Center
  startAutomation: (goal: string) => Promise<{ success: boolean; summary: string }>;
  stopAutomation: () => Promise<void>;
  respondApproval: (approvalId: string, approved: boolean) => Promise<void>;
  onAutomationEvent: (callback: (event: AutomationProgressEvent) => void) => () => void;
  onRequestApproval: (callback: (approval: ApprovalRequest) => void) => () => void;
  listDownloads: () => Promise<DownloadItem[]>;
  openDownloadsFolder: () => Promise<void>;

  // Windows Desktop Computer-Use
  listDesktopWindows: () => Promise<any>;
  getActiveDesktopWindow: () => Promise<any>;
  captureDesktopScreen: () => Promise<any>;
  launchDesktopApp: (appName: string, args?: string) => Promise<any>;

  // Phase 3 Secure Credentials & Form Automation
  storeSessionCredential: (domain: string, username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  getCredentialStatus: (domain: string) => Promise<{ username: string; hasPassword: boolean; source: string } | null>;
  clearSessionCredentials: (domain?: string) => Promise<{ success: boolean }>;
  inspectPageForms: () => Promise<any>;
}

const electronAPI: ElectronAPI = {
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  getPlatform: () => ipcRenderer.invoke('app:get-platform'),
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  restoreWindow: () => ipcRenderer.send('window:restore'),
  focusWindow: () => ipcRenderer.send('window:focus'),
  bringBrowserToFront: () => ipcRenderer.invoke('browser:bring-to-front'),
  closeWindow: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  onWindowStateChange: (callback: (isMaximized: boolean) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, isMaximized: boolean) => {
      callback(isMaximized);
    };
    ipcRenderer.on('window:state-changed', subscription);
    return () => {
      ipcRenderer.removeListener('window:state-changed', subscription);
    };
  },

  // Gemini API
  getGeminiStatus: () => ipcRenderer.invoke('gemini:get-status'),
  setGeminiKey: (key: string) => ipcRenderer.invoke('gemini:set-key', key),
  testGeminiConnection: (key?: string) => ipcRenderer.invoke('gemini:test-connection', key),
  sendChatMessage: (request: ChatRequest) => ipcRenderer.invoke('gemini:chat', request),
  cancelChatMessage: () => ipcRenderer.invoke('gemini:cancel-chat'),

  // Ollama Local AI
  getOllamaStatus: () => ipcRenderer.invoke('ollama:get-status'),
  setOllamaKey: (key: string) => ipcRenderer.invoke('ollama:set-key', key),
  testOllamaConnection: (modelName?: string, customKey?: string) => ipcRenderer.invoke('ollama:test-connection', modelName, customKey),

  // ElevenLabs AI Voice
  getElevenLabsStatus: () => ipcRenderer.invoke('elevenlabs:get-status'),
  setElevenLabsConfig: (config: { apiKey?: string; voiceId?: string; model?: string }) => ipcRenderer.invoke('elevenlabs:set-config', config),
  testElevenLabsConnection: (apiKey?: string, voiceId?: string) => ipcRenderer.invoke('elevenlabs:test-connection', apiKey, voiceId),
  synthesizeSpeech: (text: string, options?: { voiceId?: string; modelId?: string }) => ipcRenderer.invoke('elevenlabs:synthesize', { text, ...options }),
  cancelSpeechSynthesis: () => ipcRenderer.invoke('elevenlabs:cancel'),

  // Persistence
  loadTasks: () => ipcRenderer.invoke('tasks:load'),
  saveTasks: (tasks: TaskItem[]) => ipcRenderer.invoke('tasks:save', tasks),
  loadConversations: () => ipcRenderer.invoke('conversations:load'),
  saveConversations: (conversations: Conversation[]) => ipcRenderer.invoke('conversations:save', conversations),

  // Phase 3 Automation & Downloads
  startAutomation: (goal: string) => ipcRenderer.invoke('automation:start', goal),
  stopAutomation: () => ipcRenderer.invoke('automation:stop'),
  respondApproval: (approvalId: string, approved: boolean) => ipcRenderer.invoke('automation:respond-approval', { approvalId, approved }),
  onAutomationEvent: (callback: (event: AutomationProgressEvent) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, data: AutomationProgressEvent) => {
      callback(data);
    };
    ipcRenderer.on('automation:event', subscription);
    return () => {
      ipcRenderer.removeListener('automation:event', subscription);
    };
  },
  onRequestApproval: (callback: (approval: ApprovalRequest) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, data: ApprovalRequest) => {
      callback(data);
    };
    ipcRenderer.on('automation:request-approval', subscription);
    return () => {
      ipcRenderer.removeListener('automation:request-approval', subscription);
    };
  },
  listDownloads: () => ipcRenderer.invoke('downloads:list'),
  openDownloadsFolder: () => ipcRenderer.invoke('downloads:open-folder'),

  listDesktopWindows: () => ipcRenderer.invoke('desktop:list-windows'),
  getActiveDesktopWindow: () => ipcRenderer.invoke('desktop:get-active-window'),
  captureDesktopScreen: () => ipcRenderer.invoke('desktop:capture-screen'),
  launchDesktopApp: (appName: string, args?: string) => ipcRenderer.invoke('desktop:launch-app', { appName, args }),

  // Phase 3 Secure Credentials & Form Automation
  storeSessionCredential: (domain: string, username: string, password: string) => ipcRenderer.invoke('credentials:store-session', { domain, username, password }),
  getCredentialStatus: (domain: string) => ipcRenderer.invoke('credentials:get', { domain }),
  clearSessionCredentials: (domain?: string) => ipcRenderer.invoke('credentials:clear', { domain }),
  inspectPageForms: () => ipcRenderer.invoke('browser:inspect-forms'),
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
