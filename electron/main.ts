import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { BrowserService } from './browserService';
import { DesktopService } from './desktopService';
import { DownloadManager } from './downloadManager';
import { AutomationRunner, AutomationProgressEvent } from './automationRunner';
import { TaskManager } from './taskManager';
import { AgentEngine, AgentEvent } from './agentEngine';
import { OllamaService } from './ollamaService';
import { ElevenLabsService } from './elevenLabsService';

// Load environment variables from .env if present
dotenv.config();

// Ensure audio playback is never blocked by Chromium autoplay restrictions
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow: BrowserWindow | null = null;
let activeAbortController: AbortController | null = null;

// Persistent file storage paths in app's isolated userData directory
const getUserDataPath = (filename: string) => {
  return path.join(app.getPath('userData'), filename);
};

// Safe file storage helpers
async function readJsonFile<T>(filename: string, defaultValue: T): Promise<T> {
  try {
    const filePath = getUserDataPath(filename);
    if (!fs.existsSync(filePath)) {
      return defaultValue;
    }
    const data = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(data) as T;
  } catch (err) {
    console.error(`Error reading ${filename}:`, err);
    return defaultValue;
  }
}

async function writeJsonFile<T>(filename: string, data: T): Promise<boolean> {
  try {
    const filePath = getUserDataPath(filename);
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error(`Error writing ${filename}:`, err);
    return false;
  }
}

// In-memory / secure local config cache
let cachedApiKey = process.env.GEMINI_API_KEY || '';
let cachedOllamaApiKey = process.env.OLLAMA_API_KEY || '';

async function getEffectiveApiKey(): Promise<string> {
  if (cachedApiKey) return cachedApiKey;
  if (process.env.GEMINI_API_KEY) {
    cachedApiKey = process.env.GEMINI_API_KEY;
    return cachedApiKey;
  }
  const config = await readJsonFile<{ apiKey?: string }>('nexus_config.json', {});
  if (config.apiKey) {
    cachedApiKey = config.apiKey;
    return cachedApiKey;
  }
  return '';
}

async function getEffectiveOllamaApiKey(): Promise<string> {
  if (cachedOllamaApiKey) return cachedOllamaApiKey;
  if (process.env.OLLAMA_API_KEY) {
    cachedOllamaApiKey = process.env.OLLAMA_API_KEY;
    return cachedOllamaApiKey;
  }
  const config = await readJsonFile<{ ollamaApiKey?: string; apiKey?: string }>('nexus_config.json', {});
  if (config.ollamaApiKey) {
    cachedOllamaApiKey = config.ollamaApiKey;
    return cachedOllamaApiKey;
  }
  return '';
}

let cachedElevenLabsApiKey = process.env.ELEVENLABS_API_KEY || '';
let cachedElevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID || '';
let cachedElevenLabsModel = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';

async function getEffectiveElevenLabsConfig(): Promise<{ apiKey: string; voiceId: string; model: string }> {
  let apiKey = cachedElevenLabsApiKey || process.env.ELEVENLABS_API_KEY || '';
  let voiceId = cachedElevenLabsVoiceId || process.env.ELEVENLABS_VOICE_ID || '';
  let model = cachedElevenLabsModel || process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';

  if (!apiKey || !voiceId) {
    const config = await readJsonFile<Record<string, any>>('nexus_config.json', {});
    if (!apiKey && config.elevenLabsApiKey) apiKey = config.elevenLabsApiKey;
    if (!voiceId && config.elevenLabsVoiceId) voiceId = config.elevenLabsVoiceId;
    if (config.elevenLabsModel) model = config.elevenLabsModel;
  }
  return { apiKey, voiceId, model };
}

// Initialize Phase 3 services
let browserService: BrowserService;
let desktopService: DesktopService;
let downloadManager: DownloadManager;
let taskManager: TaskManager;
let agentEngine: AgentEngine;
let automationRunner: AutomationRunner;
let elevenLabsService: ElevenLabsService;
const pendingApprovals = new Map<string, (approved: boolean) => void>();

const isDev = process.env.NODE_ENV === 'development';

function createWindow(): void {
  const downloadsDir = path.join(app.getPath('downloads'), 'NEXUS Downloads');
  const screenshotsDir = path.join(app.getPath('userData'), 'screenshots');
  desktopService = new DesktopService(screenshotsDir);
  browserService = new BrowserService(downloadsDir, desktopService);
  downloadManager = new DownloadManager(downloadsDir);
  taskManager = new TaskManager(app.getPath('userData'));
  agentEngine = new AgentEngine(browserService, downloadManager, taskManager, desktopService);
  automationRunner = new AutomationRunner(browserService, downloadManager);
  elevenLabsService = new ElevenLabsService(
    cachedElevenLabsApiKey,
    cachedElevenLabsVoiceId,
    cachedElevenLabsModel
  );

  const iconPath = path.join(__dirname, '../build/icon.png');
  const fallbackIconPath = path.join(process.cwd(), 'build', 'icon.png');
  const windowIcon = fs.existsSync(iconPath) ? iconPath : fallbackIconPath;

  mainWindow = new BrowserWindow({
    width: 1260,
    height: 860,
    minWidth: 920,
    minHeight: 640,
    backgroundColor: '#0B0D0F',
    icon: windowIcon,
    frame: false,
    titleBarStyle: 'hidden',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  // Secure navigation handlers
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devServerUrl = 'http://localhost:5173';
    if (isDev && url.startsWith(devServerUrl)) {
      return;
    }
    if (!url.startsWith('file://')) {
      event.preventDefault();
    }
  });

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:state-changed', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:state-changed', false);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      setTimeout(() => {
        mainWindow?.loadURL('http://localhost:5173');
      }, 1000);
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    browserService.closeBrowser().catch(() => {});
  });
}

// ==========================================
// IPC HANDLERS: APP & WINDOW
// ==========================================
ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('app:get-platform', () => process.platform);

ipcMain.on('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.on('window:maximize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});

ipcMain.handle('window:is-maximized', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow.isMaximized();
  }
  return false;
});

export function restoreAndFocusMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.focus();
  }
}

ipcMain.on('window:restore', () => {
  restoreAndFocusMainWindow();
});

ipcMain.on('window:focus', () => {
  restoreAndFocusMainWindow();
});

ipcMain.handle('window:focus', () => {
  restoreAndFocusMainWindow();
  return { success: true };
});

ipcMain.handle('browser:bring-to-front', async () => {
  if (browserService) {
    return await browserService.bringToForeground();
  }
  return { success: false, error: 'Browser service not initialized' };
});


// ==========================================
// IPC HANDLERS: GEMINI AI
// ==========================================
ipcMain.handle('gemini:get-status', async () => {
  const key = await getEffectiveApiKey();
  let keySource: 'env' | 'settings' | 'none' = 'none';
  if (process.env.GEMINI_API_KEY) {
    keySource = 'env';
  } else if (key) {
    keySource = 'settings';
  }

  return {
    hasApiKey: !!key && key.trim().length > 0,
    keySource,
    defaultModel: process.env.GEMINI_MODEL || 'gemini-flash-lite-latest',
  };
});

ipcMain.handle('gemini:set-key', async (_event, apiKey: string) => {
  if (typeof apiKey !== 'string') {
    return { success: false, hasApiKey: false };
  }
  const trimmed = apiKey.trim();
  cachedApiKey = trimmed;
  const currentConfig = await readJsonFile<Record<string, any>>('nexus_config.json', {});
  currentConfig.apiKey = trimmed;
  await writeJsonFile('nexus_config.json', currentConfig);
  return { success: true, hasApiKey: trimmed.length > 0 };
});

ipcMain.handle('gemini:test-connection', async (_event, testKey?: string) => {
  try {
    const keyToTest = (typeof testKey === 'string' && testKey.trim()) ? testKey.trim() : await getEffectiveApiKey();
    if (!keyToTest) {
      return { success: false, error: 'No API key provided or found in environment (.env).' };
    }

    const ai = new GoogleGenAI({ apiKey: keyToTest });
    const candidateModels = [process.env.GEMINI_MODEL || 'gemini-flash-lite-latest', 'gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-3.8-flash'].filter((v, i, a) => a.indexOf(v) === i);
    
    let lastErr: any = null;
    for (const m of candidateModels) {
      try {
        const res = await ai.models.generateContent({
          model: m,
          contents: 'Respond with the single word: "READY"',
        });

        if (res && res.text) {
          return { success: true, model: m };
        }
      } catch (err: any) {
        lastErr = err;
        const msg = err?.message || '';
        if (msg.includes('404') || msg.includes('503') || msg.includes('NOT_FOUND') || msg.includes('UNAVAILABLE')) {
          continue;
        }
        break;
      }
    }
    return { success: false, error: lastErr?.message || 'Empty response received from neural engine.' };
  } catch (error: any) {
    const msg = error?.message || String(error);
    return { success: false, error: msg };
  }
});

// ==========================================
// IPC HANDLERS: OLLAMA LOCAL AI
// ==========================================
ipcMain.handle('ollama:get-status', async () => {
  const apiKey = await getEffectiveOllamaApiKey();
  const service = new OllamaService(undefined, apiKey);
  const modelsRes = await service.listModels();
  return {
    isRunning: modelsRes.success,
    host: service.getHost(),
    hasApiKey: !!apiKey && apiKey.length > 0,
    models: modelsRes.models,
    error: modelsRes.error,
  };
});

ipcMain.handle('ollama:set-key', async (_event, apiKey: string) => {
  if (typeof apiKey !== 'string') {
    return { success: false, hasApiKey: false };
  }
  const trimmed = apiKey.trim();
  cachedOllamaApiKey = trimmed;
  const config = await readJsonFile<Record<string, any>>('nexus_config.json', {});
  config.ollamaApiKey = trimmed;
  await writeJsonFile('nexus_config.json', config);
  return { success: true, hasApiKey: trimmed.length > 0 };
});

ipcMain.handle('ollama:test-connection', async (_event, modelName?: string, customKey?: string) => {
  const apiKey = (typeof customKey === 'string' && customKey.trim()) ? customKey.trim() : await getEffectiveOllamaApiKey();
  const service = new OllamaService(undefined, apiKey);
  return await service.testConnection(modelName);
});

// ==========================================
// IPC HANDLERS: ELEVENLABS AI VOICE
// ==========================================
ipcMain.handle('elevenlabs:get-status', async () => {
  const cfg = await getEffectiveElevenLabsConfig();
  if (elevenLabsService) {
    elevenLabsService.setCredentials(cfg.apiKey, cfg.voiceId, cfg.model);
    return elevenLabsService.getStatus();
  }
  const tempService = new ElevenLabsService(cfg.apiKey, cfg.voiceId, cfg.model);
  return tempService.getStatus();
});

ipcMain.handle('elevenlabs:set-config', async (_event, config: { apiKey?: string; voiceId?: string; model?: string }) => {
  const currentConfig = await readJsonFile<Record<string, any>>('nexus_config.json', {});
  if (config && typeof config.apiKey === 'string') {
    cachedElevenLabsApiKey = config.apiKey.trim();
    currentConfig.elevenLabsApiKey = cachedElevenLabsApiKey;
  }
  if (config && typeof config.voiceId === 'string') {
    cachedElevenLabsVoiceId = config.voiceId.trim();
    currentConfig.elevenLabsVoiceId = cachedElevenLabsVoiceId;
  }
  if (config && typeof config.model === 'string' && config.model.trim()) {
    cachedElevenLabsModel = config.model.trim();
    currentConfig.elevenLabsModel = cachedElevenLabsModel;
  }
  await writeJsonFile('nexus_config.json', currentConfig);
  if (elevenLabsService) {
    elevenLabsService.setCredentials(cachedElevenLabsApiKey, cachedElevenLabsVoiceId, cachedElevenLabsModel);
  }
  return { success: true };
});

ipcMain.handle('elevenlabs:test-connection', async (_event, customKey?: string, customVoiceId?: string) => {
  const cfg = await getEffectiveElevenLabsConfig();
  const testService = new ElevenLabsService(customKey || cfg.apiKey, customVoiceId || cfg.voiceId, cfg.model);
  return await testService.testConnection(customKey, customVoiceId);
});

ipcMain.handle('elevenlabs:synthesize', async (_event, { text, voiceId, modelId }: { text: string; voiceId?: string; modelId?: string }) => {
  const cfg = await getEffectiveElevenLabsConfig();
  if (!elevenLabsService) {
    elevenLabsService = new ElevenLabsService(cfg.apiKey, cfg.voiceId, cfg.model);
  } else {
    elevenLabsService.setCredentials(cfg.apiKey, cfg.voiceId, cfg.model);
  }
  return await elevenLabsService.synthesizeSpeech(text, {
    voiceId: voiceId || cfg.voiceId,
    modelId: modelId || cfg.model,
  });
});

ipcMain.handle('elevenlabs:cancel', async () => {
  if (elevenLabsService) {
    elevenLabsService.cancel();
  }
  return { success: true };
});

ipcMain.handle('gemini:chat', async (_event, request: {
  messages: Array<{ role: 'user' | 'model'; text: string }>;
  model?: string;
  provider?: 'gemini' | 'ollama';
  temperature?: number;
  systemInstruction?: string;
}) => {
  try {
    const apiKey = await getEffectiveApiKey();
    const ollamaApiKey = await getEffectiveOllamaApiKey();
    const effectiveProvider: 'gemini' | 'ollama' =
      request.provider || (process.env.AI_PROVIDER === 'ollama' ? 'ollama' : (apiKey ? 'gemini' : 'ollama'));

    if (effectiveProvider === 'gemini' && !apiKey) {
      return {
        text: '',
        error: 'Gemini API Key is missing. Please set GEMINI_API_KEY in your .env file or configure it in Settings, or use local Ollama.',
      };
    }

    if (!request.messages || request.messages.length === 0) {
      return { text: '', error: 'Message history is empty.' };
    }

    const lastMsg = request.messages[request.messages.length - 1];
    const history = request.messages.slice(0, request.messages.length - 1);

    const result = await agentEngine.execute({
      prompt: lastMsg.text,
      conversationHistory: history,
      apiKey,
      provider: effectiveProvider,
      ollamaApiKey,
      modelName: request.model || (effectiveProvider === 'ollama' ? (process.env.OLLAMA_MODEL || 'qwen2.5:7b') : (process.env.GEMINI_MODEL || 'gemini-flash-lite-latest')),
      temperature: request.temperature,
      systemInstruction: request.systemInstruction,
      onEvent: (event: AgentEvent) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('automation:event', event);
        }
      },
      onRequestApproval: (approvalData) => {
        return new Promise<boolean>((resolve) => {
          pendingApprovals.set(approvalData.id, resolve);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('automation:request-approval', approvalData);
          }
        });
      },
    });

    if (!result.success && result.error && !result.text) {
      return { text: '', error: result.error };
    }

    return {
      text: result.text,
      createdTasks: result.createdTasks,
      sources: result.sources,
      steps: result.steps,
    };
  } catch (error: any) {
    const msg = error?.message || String(error);
    if (msg.includes('aborted') || msg.includes('AbortError')) {
      return { text: '', error: 'Generation stopped by user.' };
    }
    return { text: '', error: `Agent Engine Error: ${msg}` };
  }
});

ipcMain.handle('gemini:cancel-chat', async () => {
  if (agentEngine) {
    agentEngine.abort();
  }
  return;
});

// ==========================================
// IPC HANDLERS: PHASE 3 AUTOMATION & TOOLS
// ==========================================
ipcMain.handle('automation:start', async (_event, goal: string) => {
  try {
    const apiKey = await getEffectiveApiKey();
    if (!apiKey) {
      return { success: false, summary: 'API Key missing. Please configure GEMINI_API_KEY in .env or Settings.' };
    }

    const modelName = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';

    const result = await agentEngine.execute({
      prompt: goal,
      apiKey,
      modelName,
      onEvent: (event: AgentEvent) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('automation:event', event);
        }
      },
      onRequestApproval: (approvalData) => {
        return new Promise<boolean>((resolve) => {
          pendingApprovals.set(approvalData.id, resolve);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('automation:request-approval', approvalData);
          }
        });
      },
    });

    return {
      success: result.success,
      summary: result.text || (result.success ? 'Task completed successfully.' : result.error || 'Task failed.'),
    };
  } catch (err: any) {
    return { success: false, summary: `Automation error: ${err?.message || String(err)}` };
  }
});

ipcMain.handle('automation:stop', async () => {
  if (agentEngine) {
    agentEngine.abort();
  }
  return;
});

ipcMain.handle('automation:respond-approval', async (_event, { approvalId, approved }: { approvalId: string; approved: boolean }) => {
  const resolver = pendingApprovals.get(approvalId);
  if (resolver) {
    resolver(approved);
    pendingApprovals.delete(approvalId);
  }
  return;
});

ipcMain.handle('downloads:list', async () => {
  return downloadManager.listDownloadedFiles();
});

ipcMain.handle('downloads:open-folder', async () => {
  shell.openPath(downloadManager.getDownloadDir());
});

// ==========================================
// IPC HANDLERS: DESKTOP AUTOMATION
// ==========================================
ipcMain.handle('desktop:list-windows', async () => {
  return desktopService ? desktopService.listWindows() : { success: false, error: 'Desktop service not initialized' };
});

ipcMain.handle('desktop:get-active-window', async () => {
  return desktopService ? desktopService.getActiveWindow() : { success: false, error: 'Desktop service not initialized' };
});

ipcMain.handle('desktop:capture-screen', async () => {
  return desktopService ? desktopService.captureScreen() : { success: false, error: 'Desktop service not initialized' };
});

ipcMain.handle('desktop:launch-app', async (_event, { appName, args }: { appName: string; args?: string }) => {
  return desktopService ? desktopService.launchApp(appName, args) : { success: false, error: 'Desktop service not initialized' };
});

// ==========================================
// IPC HANDLERS: LOCAL PERSISTENCE
// ==========================================
ipcMain.handle('tasks:load', async () => {
  return taskManager ? taskManager.loadTasks() : await readJsonFile('nexus_tasks.json', []);
});

ipcMain.handle('tasks:save', async (_event, tasks: any[]) => {
  if (!Array.isArray(tasks)) return { success: false };
  if (taskManager) {
    taskManager.saveTasks(tasks);
    return { success: true };
  }
  const ok = await writeJsonFile('nexus_tasks.json', tasks);
  return { success: ok };
});

ipcMain.handle('conversations:load', async () => {
  return await readJsonFile('nexus_conversations.json', []);
});

ipcMain.handle('conversations:save', async (_event, conversations: any[]) => {
  if (!Array.isArray(conversations)) return { success: false };
  const ok = await writeJsonFile('nexus_conversations.json', conversations);
  return { success: ok };
});

// App Lifecycle
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  browserService?.closeBrowser().catch(() => {});
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
