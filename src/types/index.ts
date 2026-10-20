export type NavigationTab = 'new-task' | 'chat' | 'actions' | 'tasks' | 'files' | 'settings';

export interface TaskItem {
  id: string;
  title: string;
  description?: string;
  category?: string;
  completed: boolean;
  createdAt: string;
  completedAt?: string;
}

// Retained for backward compatibility
export interface DemoTask {
  id: string;
  prompt: string;
  createdAt: string;
  category?: string;
  status: 'ui-demo-not-executed';
  notes?: string;
}

export interface ExamplePrompt {
  id: string;
  title: string;
  description: string;
  category: string;
  prompt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: string;
  isError?: boolean;
  toolActionExecuted?: string;
  sources?: string[];
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface GeminiStatus {
  hasApiKey: boolean;
  keySource: 'env' | 'settings' | 'none';
  defaultModel: string;
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

export interface ChatRequest {
  messages: Array<{ role: 'user' | 'model'; text: string }>;
  model?: string;
  provider?: 'gemini' | 'ollama';
  temperature?: number;
  systemInstruction?: string;
}

export interface ChatResponse {
  text: string;
  error?: string;
  createdTasks?: Array<{ title: string; category?: string }>;
  sources?: string[];
  steps?: Array<{ step: number; tool: string; args: any; result: any; timestamp: string }>;
}

export interface AppSettings {
  geminiApiKey?: string;
  model: string;
  temperature: number;
  systemInstruction: string;
  enableThinking: boolean;
  permissionWebBrowsing: boolean;
  permissionFormFilling: boolean;
  permissionFileDownloads: boolean;
  permissionClipboard: boolean;
  launchOnStartup: boolean;
  minimizeToTray: boolean;
  hardwareAcceleration: boolean;
  soundNotifications: boolean;
  voiceEnabled?: boolean;
  elevenLabsVoiceId?: string;
  elevenLabsModel?: string;
}

// ==========================================
// Phase 3: Browser Automation & Action Center
// ==========================================
export type ActionEventType = 
  | 'NAVIGATE' 
  | 'SEARCH' 
  | 'READ' 
  | 'CLICK' 
  | 'FILL' 
  | 'DOWNLOAD' 
  | 'APPROVAL' 
  | 'SCREENSHOT' 
  | 'ERROR' 
  | 'INFO' 
  | 'SUCCESS';

export interface AutomationEvent {
  id: string;
  timestamp: string;
  type: ActionEventType;
  message: string;
  details?: string;
  url?: string;
  screenshotUrl?: string;
}

export type AutomationProgressEvent = AutomationEvent;

export interface ApprovalRequest {
  id: string;
  action: string;
  details: string;
  targetUrl: string;
  formData?: Record<string, string>;
  isConsequential: boolean;
}

export interface DownloadItem {
  id?: string;
  filename: string;
  url?: string;
  path: string;
  sizeBytes?: number;
  status?: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  timestamp?: string;
  createdAt?: string;
  error?: string;
}

export interface AutomationState {
  status: 'idle' | 'running' | 'waiting_approval' | 'completed' | 'stopped' | 'error';
  goal: string;
  currentUrl?: string;
  currentTitle?: string;
  latestScreenshot?: string;
  events: AutomationEvent[];
  pendingApproval?: ApprovalRequest;
  finalResult?: string;
  downloadedFiles?: DownloadItem[];
}
