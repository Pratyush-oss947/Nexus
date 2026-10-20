import { 
  GeminiStatus, 
  OllamaStatus,
  ElevenLabsStatus,
  SpeechSynthesisResult,
  ChatRequest, 
  ChatResponse, 
  TaskItem, 
  Conversation,
  AutomationProgressEvent,
  ApprovalRequest,
  DownloadItem
} from './index';

export interface ElectronAPI {
  getAppVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
  isMaximized: () => Promise<boolean>;
  onWindowStateChange: (callback: (isMaximized: boolean) => void) => () => void;

  // Phase 2: Gemini AI Integration
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

  // Phase 2: Local Persistence
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
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
