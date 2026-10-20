import { 
  GeminiStatus, 
  ElevenLabsStatus,
  SpeechSynthesisResult,
  ChatRequest, 
  ChatResponse, 
  TaskItem, 
  Conversation,
  AutomationProgressEvent,
  ApprovalRequest,
  DownloadItem 
} from '../types';

export const isElectron = () => typeof window !== 'undefined' && !!window.electronAPI;

// In-memory event listeners for browser preview mode
const previewEventListeners = new Set<(event: AutomationProgressEvent) => void>();
const previewApprovalListeners = new Set<(approval: ApprovalRequest) => void>();

export const apiBridge = {
  async getStatus(): Promise<GeminiStatus> {
    if (isElectron()) {
      return await window.electronAPI!.getGeminiStatus();
    }
    try {
      const res = await fetch('/api/nexus/status');
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      console.warn('API status check failed:', err);
    }
    return {
      hasApiKey: true,
      keySource: 'env',
      defaultModel: 'gemini-flash-lite-latest',
    };
  },

  async setKey(key: string): Promise<{ success: boolean; hasApiKey: boolean }> {
    if (isElectron()) {
      return await window.electronAPI!.setGeminiKey(key);
    }
    try {
      const res = await fetch('/api/nexus/set-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (res.ok) {
        return await res.json();
      }
    } catch {
      // fallback
    }
    localStorage.setItem('nexus_custom_key', key);
    return { success: true, hasApiKey: key.trim().length > 0 };
  },

  async testConnection(key?: string): Promise<{ success: boolean; error?: string; model?: string }> {
    if (isElectron()) {
      return await window.electronAPI!.testGeminiConnection(key);
    }
    try {
      const res = await fetch('/api/nexus/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (res.ok) {
        return await res.json();
      }
      const errText = await res.text();
      return { success: false, error: errText };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Server unreachable' };
    }
  },

  async sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
    if (isElectron()) {
      return await window.electronAPI!.sendChatMessage(request);
    }
    try {
      const res = await fetch('/api/nexus/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!res.ok) {
        const errorText = await res.text();
        return { text: '', error: `Server error (${res.status}): ${errorText}` };
      }
      return await res.json();
    } catch (err: any) {
      return { 
        text: '', 
        error: `Network error connecting to NEXUS backend: ${err?.message || String(err)}` 
      };
    }
  },

  async cancelChatMessage(): Promise<void> {
    if (isElectron()) {
      return await window.electronAPI!.cancelChatMessage();
    }
    try {
      await fetch('/api/nexus/cancel', { method: 'POST' });
    } catch {
      // ignore
    }
  },

  // ElevenLabs AI Voice
  async getElevenLabsStatus(): Promise<ElevenLabsStatus> {
    if (isElectron()) {
      return await window.electronAPI!.getElevenLabsStatus();
    }
    return {
      hasApiKey: false,
      hasVoiceId: false,
      voiceId: '',
      model: 'eleven_multilingual_v2',
      keySource: 'none',
    };
  },

  async setElevenLabsConfig(config: { apiKey?: string; voiceId?: string; model?: string }): Promise<{ success: boolean }> {
    if (isElectron()) {
      return await window.electronAPI!.setElevenLabsConfig(config);
    }
    return { success: true };
  },

  async testElevenLabsConnection(apiKey?: string, voiceId?: string): Promise<{ success: boolean; error?: string; message?: string }> {
    if (isElectron()) {
      return await window.electronAPI!.testElevenLabsConnection(apiKey, voiceId);
    }
    return { success: false, error: 'Voice testing requires Electron runtime.' };
  },

  async synthesizeSpeech(text: string, options?: { voiceId?: string; modelId?: string }): Promise<SpeechSynthesisResult> {
    if (isElectron()) {
      return await window.electronAPI!.synthesizeSpeech(text, options);
    }
    return { success: false, error: 'Speech synthesis requires Electron runtime.' };
  },

  async cancelSpeechSynthesis(): Promise<void> {
    if (isElectron()) {
      await window.electronAPI!.cancelSpeechSynthesis();
    }
  },

  // Task Persistence
  async loadTasks(): Promise<TaskItem[]> {
    if (isElectron()) {
      return await window.electronAPI!.loadTasks();
    }
    try {
      const local = localStorage.getItem('nexus_tasks');
      return local ? JSON.parse(local) : [];
    } catch {
      return [];
    }
  },

  async saveTasks(tasks: TaskItem[]): Promise<{ success: boolean }> {
    if (isElectron()) {
      return await window.electronAPI!.saveTasks(tasks);
    }
    try {
      localStorage.setItem('nexus_tasks', JSON.stringify(tasks));
      return { success: true };
    } catch {
      return { success: false };
    }
  },

  // Conversation Persistence
  async loadConversations(): Promise<Conversation[]> {
    if (isElectron()) {
      return await window.electronAPI!.loadConversations();
    }
    try {
      const local = localStorage.getItem('nexus_chat_history');
      if (local) {
        const msgs = JSON.parse(local);
        return [{
          id: 'session-main',
          title: msgs[0]?.text?.slice(0, 30) || 'Main Conversation',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          messages: msgs,
        }];
      }
    } catch {
      // fallback
    }
    return [];
  },

  async saveConversations(conversations: Conversation[]): Promise<{ success: boolean }> {
    if (isElectron()) {
      return await window.electronAPI!.saveConversations(conversations);
    }
    try {
      if (conversations[0]?.messages) {
        localStorage.setItem('nexus_chat_history', JSON.stringify(conversations[0].messages));
      }
      return { success: true };
    } catch {
      return { success: false };
    }
  },

  // Phase 3: Browser Automation & Action Center
  async startAutomation(goal: string): Promise<{ success: boolean; summary: string }> {
    if (isElectron()) {
      return await window.electronAPI!.startAutomation(goal);
    }
    // Browser preview mode simulated dispatch
    const startEvt: AutomationProgressEvent = {
      id: `evt-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      type: 'INFO',
      message: `Task initiated in preview: "${goal}"`,
    };
    previewEventListeners.forEach((cb) => cb(startEvt));

    try {
      const res = await fetch('/api/nexus/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', text: goal }],
        }),
      });
      const data = await res.json();
      if (data.steps && Array.isArray(data.steps)) {
        data.steps.forEach((s: any) => {
          const type = s.tool.includes('search') ? 'SEARCH' : s.tool.includes('read') ? 'READ' : s.tool.includes('click') ? 'CLICK' : s.tool.includes('fill') ? 'FILL' : s.tool.includes('download') ? 'DOWNLOAD' : 'NAVIGATE';
          const stepEvt: AutomationProgressEvent = {
            id: `evt-${Date.now()}-${s.step}`,
            timestamp: s.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            type,
            message: `Executed: ${s.tool}`,
            details: typeof s.result === 'object' && s.result?.title ? s.result.title : undefined,
            url: typeof s.result === 'object' && s.result?.url ? s.result.url : undefined,
            screenshotUrl: typeof s.result === 'object' && s.result?.screenshotBase64 ? s.result.screenshotBase64 : undefined,
          };
          previewEventListeners.forEach((cb) => cb(stepEvt));
        });
      }

      const endEvt: AutomationProgressEvent = {
        id: `evt-${Date.now()}-done`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        type: data.text ? 'SUCCESS' : 'ERROR',
        message: data.text || data.error || 'Action completed.',
      };
      previewEventListeners.forEach((cb) => cb(endEvt));
      return { success: !data.error, summary: data.text || data.error || 'Action completed.' };
    } catch (err: any) {
      return { success: false, summary: `Execution error: ${err.message}` };
    }
  },

  async stopAutomation(): Promise<void> {
    if (isElectron()) {
      return await window.electronAPI!.stopAutomation();
    }
  },

  async respondApproval(approvalId: string, approved: boolean): Promise<void> {
    if (isElectron()) {
      return await window.electronAPI!.respondApproval(approvalId, approved);
    }
  },

  onAutomationEvent(callback: (event: AutomationProgressEvent) => void): () => void {
    if (isElectron()) {
      return window.electronAPI!.onAutomationEvent(callback);
    }
    previewEventListeners.add(callback);
    return () => {
      previewEventListeners.delete(callback);
    };
  },

  onRequestApproval(callback: (approval: ApprovalRequest) => void): () => void {
    if (isElectron()) {
      return window.electronAPI!.onRequestApproval(callback);
    }
    previewApprovalListeners.add(callback);
    return () => {
      previewApprovalListeners.delete(callback);
    };
  },

  async listDownloads(): Promise<DownloadItem[]> {
    if (isElectron()) {
      return await window.electronAPI!.listDownloads();
    }
    return [];
  },

  async openDownloadsFolder(): Promise<void> {
    if (isElectron()) {
      return await window.electronAPI!.openDownloadsFolder();
    }
  },

  // Phase 3: Secure Credentials & Form Automation
  async storeSessionCredential(domain: string, username: string, password: string): Promise<{ success: boolean; error?: string }> {
    if (isElectron() && window.electronAPI?.storeSessionCredential) {
      return await window.electronAPI.storeSessionCredential(domain, username, password);
    }
    return { success: true };
  },

  async getCredentialStatus(domain: string): Promise<{ username: string; hasPassword: boolean; source: string } | null> {
    if (isElectron() && window.electronAPI?.getCredentialStatus) {
      return await window.electronAPI.getCredentialStatus(domain);
    }
    return null;
  },

  async clearSessionCredentials(domain?: string): Promise<{ success: boolean }> {
    if (isElectron() && window.electronAPI?.clearSessionCredentials) {
      return await window.electronAPI.clearSessionCredentials(domain);
    }
    return { success: true };
  },

  async inspectPageForms(): Promise<any> {
    if (isElectron() && window.electronAPI?.inspectPageForms) {
      return await window.electronAPI.inspectPageForms();
    }
    return { success: false, error: 'Not running in Electron' };
  },
};
