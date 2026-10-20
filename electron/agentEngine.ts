import { GoogleGenAI } from '@google/genai';
import { BrowserService } from './browserService';
import { DesktopService } from './desktopService';
import { DownloadManager } from './downloadManager';
import { TaskManager, TaskRecord } from './taskManager';
import { ToolDispatcher, ToolExecutionContext } from './toolRegistry';
import { TaskPlanner, TaskPlan, TaskExecutionState, ActionOutcomeRecord } from './taskPlanner';
import { classifyGeminiError, calculateBackoffMs, ClassifiedApiError } from './geminiErrorClassifier';
import { OllamaService, OllamaMessage } from './ollamaService';

export interface AgentEvent {
  id: string;
  timestamp: string;
  type: 'NAVIGATE' | 'SEARCH' | 'READ' | 'CLICK' | 'FILL' | 'DOWNLOAD' | 'APPROVAL' | 'SCREENSHOT' | 'ERROR' | 'INFO' | 'SUCCESS';
  message: string;
  details?: string;
  url?: string;
  screenshotUrl?: string;
}

export interface AgentRunOptions {
  prompt: string;
  conversationHistory?: Array<{ role: 'user' | 'model'; text: string }>;
  apiKey?: string;
  provider?: 'gemini' | 'ollama';
  ollamaHost?: string;
  ollamaApiKey?: string;
  modelName?: string;
  temperature?: number;
  maxSteps?: number;
  stepTimeoutMs?: number;
  taskTimeoutMs?: number;
  modelTimeoutMs?: number;
  background?: boolean;
  systemInstruction?: string;
  onEvent?: (event: AgentEvent) => void;
  onRequestApproval?: (approval: {
    id: string;
    action: string;
    details: string;
    targetUrl: string;
    isConsequential: boolean;
  }) => Promise<boolean>;
}

/**
 * Detects whether the user explicitly requested background or headless execution.
 */
export function isBackgroundExecutionRequested(prompt: string, backgroundOption?: boolean): boolean {
  if (backgroundOption === true) return true;
  if (!prompt || typeof prompt !== 'string') return false;
  return /\b(in\s+the\s+background|run\s+in\s+background|background\s+mode|silently|quietly|hidden|headless|keep\s+minimized|do\s+not\s+focus|don'?t\s+focus|without\s+focusing)\b/i.test(prompt);
}


export interface AgentStepRecord {
  step: number;
  tool: string;
  args: Record<string, any>;
  result: any;
  timestamp: string;
}

export interface AgentRunResult {
  success: boolean;
  text: string;
  steps: AgentStepRecord[];
  sources: string[];
  createdTasks?: Array<{ title: string; category?: string }>;
  taskPlan?: TaskPlan;
  executionState?: TaskExecutionState;
  verificationVerdict?: 'VERIFIED' | 'INCOMPLETE' | 'FAILED';
  error?: string;
}

/**
 * Mask credentials, tokens, and secrets in strings.
 */
export function redactSensitiveString(str: string): string {
  if (!str || typeof str !== 'string') return str;
  return str
    .replace(/bearer\s+[a-zA-Z0-9_\-\.~+/=]+/gi, 'Bearer [REDACTED]')
    .replace(/("?(?:api[_-]?key|secret|password|passwd|token)[^":=\s]*"?\s*[:=]\s*\\?['"]?)[a-zA-Z0-9_\-\.~+/=]{6,}(\\?['"]?)/gi, '$1[REDACTED]$2')
    .replace(/\b[0-9a-f]{32}\.[0-9a-zA-Z]{24}\b/g, '[REDACTED_OLLAMA_KEY]')
    .replace(/\bAIza[0-9A-Za-z_-]{30,40}\b/g, '[REDACTED_GEMINI_KEY]')
    .replace(/\bsk_[0-9a-zA-Z]{30,64}\b/g, '[REDACTED_ELEVENLABS_KEY]');
}


/**
 * Sanitizes and bounds tool execution results before sending them to Gemini in conversation history.
 * - Strips out large binary payloads (screenshotBase64, base64 strings, data URLs).
 * - Strips out sensitive credentials, cookies, and authentication tokens.
 * - Bounds textual content to a strict maximum to prevent context bloat.
 * - Formats concise, structured summaries for the model.
 */
export function sanitizeToolResultForModel(result: any, maxTextLength = 2000): Record<string, any> {
  if (result === null || result === undefined) {
    return { success: false, error: 'No result returned from tool execution.' };
  }

  if (typeof result !== 'object') {
    return { result: String(result).slice(0, maxTextLength) };
  }

  const sanitized: Record<string, any> = {};

  // Sensitive or binary keys that must never enter model context
  const forbiddenKeyPatterns = [
    /screenshot/i,
    /base64/i,
    /imagedata/i,
    /^buffer$/i,
    /cookie/i,
    /password/i,
    /token/i,
    /auth/i,
    /secret/i,
    /apikey/i,
  ];

  for (const [key, value] of Object.entries(result)) {
    // Check if key is forbidden
    if (forbiddenKeyPatterns.some((pattern) => pattern.test(key))) {
      // Friendly flag if screenshot was captured so model knows visual proof exists
      if (/screenshot/i.test(key) && value) {
        sanitized.screenshotCaptured = true;
      }
      continue;
    }

    if (typeof value === 'string') {
      // Discard data URLs or massive base64 text disguised under other keys
      if (
        value.startsWith('data:image/') ||
        value.startsWith('data:application/') ||
        (key !== 'content' && key !== 'text' && key !== 'summary' && value.length > 500 && !value.includes(' ') && /^[A-Za-z0-9+/=\r\n]+$/.test(value.slice(0, 500)))
      ) {
        continue;
      }

      const masked = redactSensitiveString(value);
      // Bound text length
      if (masked.length > maxTextLength) {
        sanitized[key] = masked.slice(0, maxTextLength) + '\n... [content truncated for model context]';
      } else {
        sanitized[key] = masked;
      }
    } else if (Array.isArray(value)) {
      // Bound array lengths (e.g. lists of links or elements) to max 20 items
      sanitized[key] = value.slice(0, 20).map((item) => {
        if (typeof item === 'object' && item !== null) {
          return sanitizeToolResultForModel(item, 500);
        }
        if (typeof item === 'string') {
          if (
            item.startsWith('data:image/') ||
            (item.length > 500 && /^[A-Za-z0-9+/=\r\n]+$/.test(item.slice(0, 500)))
          ) {
            return '[binary data removed]';
          }
          const maskedItem = redactSensitiveString(item);
          if (maskedItem.length > 500) {
            return maskedItem.slice(0, 500) + '...';
          }
          return maskedItem;
        }
        return item;
      });
      if (value.length > 20) {
        sanitized[`${key}_totalCount`] = value.length;
      }
    } else if (typeof value === 'object' && value !== null) {
      // If data is DOM structure from inspectPage and content is already formatted, simplify data
      if (key === 'data' && sanitized.content && typeof sanitized.content === 'string') {
        // Redundant DOM clone data is not needed by the model since content already has headings/inputs/buttons
        continue;
      }
      sanitized[key] = sanitizeToolResultForModel(value, 500);
    } else {
      sanitized[key] = value;
    }
  }

  // Ensure standard structured fields exist for browser/action tools
  if (result.success !== undefined) {
    sanitized.success = Boolean(result.success);
  }
  if (result.action && typeof result.action === 'string') {
    sanitized.action = result.action;
  }
  if (result.url && typeof result.url === 'string') {
    sanitized.url = result.url;
  }
  if (result.title && typeof result.title === 'string') {
    sanitized.title = result.title;
  }
  if (result.error && typeof result.error === 'string') {
    sanitized.error = redactSensitiveString(result.error).slice(0, 500);
  }

  return sanitized;
}

export class AgentEngine {
  private browserService: BrowserService;
  private desktopService: DesktopService;
  private downloadManager: DownloadManager;
  private taskManager: TaskManager;
  private isAborted = false;

  constructor(
    browserService: BrowserService,
    downloadManager: DownloadManager,
    taskManager: TaskManager,
    desktopService?: DesktopService
  ) {
    this.browserService = browserService;
    this.downloadManager = downloadManager;
    this.taskManager = taskManager;
    this.desktopService = desktopService || new DesktopService();
  }

  public abort(): void {
    this.isAborted = true;
    this.browserService.closeBrowser().catch(() => {});
  }

  public async execute(options: AgentRunOptions): Promise<AgentRunResult> {
    this.isAborted = false;
    const {
      prompt,
      conversationHistory = [],
      apiKey = '',
      provider,
      ollamaHost,
      ollamaApiKey,
      modelName,
      temperature = 0.2,
      maxSteps = 8,
      stepTimeoutMs = 30000,
      taskTimeoutMs = 120000,
      modelTimeoutMs = 25000,
      systemInstruction,
      onEvent = () => {},
      onRequestApproval = async () => true,
    } = options;

    const emit = (
      type: AgentEvent['type'],
      message: string,
      details?: string,
      url?: string,
      screenshotUrl?: string
    ) => {
      onEvent({
        id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        type,
        message,
        details,
        url,
        screenshotUrl,
      });
    };

    const effectiveProvider: 'gemini' | 'ollama' =
      provider || (process.env.AI_PROVIDER === 'ollama' ? 'ollama' : 'gemini');

    if (effectiveProvider === 'gemini' && !apiKey) {
      const err = 'Gemini API key is not configured. Please set GEMINI_API_KEY in .env or Settings.';
      emit('ERROR', err);
      return { success: false, text: '', steps: [], sources: [], error: err };
    }

    const isBackground = isBackgroundExecutionRequested(prompt, options.background);
    this.browserService.setBackgroundMode(isBackground);

    // Inspect live browser status and initialize execution state
    const browserStatus = await this.browserService.getStatus();
    const executionState = TaskPlanner.createExecutionState(prompt, browserStatus.url, browserStatus.title, {
      stepTimeoutMs,
      taskTimeoutMs,
      maxSteps,
    });
    const taskPlan = executionState.taskPlan;

    if (taskPlan.targetWebsite && !isBackground) {
      this.browserService.bringToForeground().catch(() => {});
    }


    const logDiagnostic = (event: string, meta: Record<string, any> = {}) => {
      const sanitizedMeta: Record<string, any> = {};
      for (const [k, v] of Object.entries(meta)) {
        if (typeof v === 'string') {
          sanitizedMeta[k] = redactSensitiveString(v);
        } else if (typeof v === 'object' && v !== null) {
          try {
            sanitizedMeta[k] = JSON.parse(redactSensitiveString(JSON.stringify(v)));
          } catch {
            sanitizedMeta[k] = '[object]';
          }
        } else {
          sanitizedMeta[k] = v;
        }
      }
      console.log(`[NEXUS DIAGNOSTIC] [${event}]`, JSON.stringify(sanitizedMeta));
    };

    logDiagnostic('TASK_START', {
      taskId: executionState.taskId,
      prompt,
      provider: effectiveProvider,
      model: modelName,
      stepTimeoutMs,
      taskTimeoutMs,
      maxSteps,
    });

    emit('INFO', `Starting task: "${prompt}" [Engine: ${effectiveProvider.toUpperCase()}]`);
    if (taskPlan.targetWebsite) {
      emit('INFO', `Target website identified: ${taskPlan.targetWebsite} (${taskPlan.targetName || 'Requested Site'})`);
    }
    if (taskPlan.searchQuery) {
      emit('INFO', `Target search query: "${taskPlan.searchQuery}"`);
    }

    const ai = effectiveProvider === 'gemini' ? new GoogleGenAI({ apiKey }) : null;
    const effectiveOllamaKey = (ollamaApiKey || process.env.OLLAMA_API_KEY || '').trim();
    const ollamaService = effectiveProvider === 'ollama' ? new OllamaService(ollamaHost, effectiveOllamaKey) : null;
    const toolDeclarations = ToolDispatcher.getDeclarations();
    const ollamaTools = ollamaService ? ollamaService.formatToolsForOllama(ToolDispatcher.getToolDefinitionsMap()) : [];

    const defaultSystem = `You are NEXUS AI, an autonomous personal desktop AI agent and computer-use agent for Windows.
You possess real-world tools for Windows desktop automation, browser automation, web research, task management, and file downloads.

Core Execution Rules:
1. Intent-Based Browser Execution & Anti-Redundant Navigation:
   - For opening websites or navigating to URLs: ALWAYS use 'open_website' (or 'browser_open').
     If already on the target website or page, DO NOT call 'open_website' again.
   - For searching inside the currently open website: ALWAYS use 'search_current_site' (or 'browser_in_page_search') with the EXACT search query.
     NEVER call 'web_search' or DuckDuckGo when searching inside a specific website.
   - For general external internet search: Use 'web_search' ONLY when researching public information across the broader web.
   - For interacting with page buttons and links: Use 'click_control' (or 'browser_click'). Verify that real navigation or state change occurs.
   - For filling form inputs: Use 'fill_form' (or 'browser_fill'). Provide exact user values; never invent missing data.
   - For downloading files: Use 'download_result' (or 'download_file') and verify non-zero size.
   - NEVER call 'browser_close' while dependent actions or downloads are pending.
   - Reuse the active browser tab throughout the task. Do not open unnecessary tabs.

2. Windows Desktop Control:
   - For native Windows applications (Notepad, Calculator, Paint, File Explorer, Settings):
     Use 'computer_launch_app' (e.g. appName: 'notepad', 'calc', 'paint', 'explorer', 'settings') and native desktop tools.

3. Truthfulness & Completion:
   - Ground all factual statements in the observed results of executed tools.
   - For simple greetings, conversational questions, or explanations, provide a direct, helpful response without invoking tools.
   - Call 'finish_task' with your comprehensive answer and verified source links when your goal is achieved.

4. ElevenLabs AI Voice & Speech Capabilities:
   - You are equipped with an integrated ElevenLabs Text-to-Speech voice synthesis engine (Voice ID: hw70l6UiioXIpgpHCjP6, model: eleven_multilingual_v2).
   - Seamlessly support English and Hindi/Hinglish phrasing.
   - When the user asks you to speak, or asks "why you cant speak" or whether you can speak, confirm that you have ElevenLabs AI Voice integration configured.
   - Your responses are converted to speech automatically by the ElevenLabs voice engine when voice mode is enabled.
   - NEVER state that you are purely text-based or that you cannot speak. Reflect your actual ElevenLabs voice system status.`;

    // Initialize conversation history for Gemini
    const contents: any[] = [];
    for (const msg of conversationHistory) {
      contents.push({
        role: msg.role === 'model' ? 'model' : 'user',
        parts: [{ text: msg.text }],
      });
    }
    contents.push({
      role: 'user',
      parts: [{ text: prompt }],
    });

    // Initialize conversation history for Ollama
    const ollamaMessages: OllamaMessage[] = [];
    for (const msg of conversationHistory) {
      ollamaMessages.push({
        role: msg.role === 'model' ? 'assistant' : 'user',
        content: msg.text,
      });
    }
    ollamaMessages.push({
      role: 'user',
      content: prompt,
    });

    const executionSteps: AgentStepRecord[] = [];
    const consultedSources = new Set<string>();
    const createdTasks: Array<{ title: string; category?: string }> = [];

    const toolContext: ToolExecutionContext = {
      browserService: this.browserService,
      desktopService: this.desktopService,
      downloadManager: this.downloadManager,
      taskManager: this.taskManager,
      onRequestApproval,
      onEmitEvent: emit,
      taskPlan,
    };

    let finalAnswer = '';

    while (executionState.currentStepCount < maxSteps && !this.isAborted) {
      // 1. Task timeout check
      const elapsedTaskMs = Date.now() - executionState.startTime;
      if (elapsedTaskMs > taskTimeoutMs) {
        const timeoutMsg = `Total task timeout reached (${taskTimeoutMs}ms). Halting execution to preserve bounded resources.`;
        emit('ERROR', timeoutMsg);
        logDiagnostic('TASK_TIMEOUT', { taskId: executionState.taskId, elapsedMs: elapsedTaskMs });
        executionState.status = 'INCOMPLETE';
        executionState.verificationVerdict = 'INCOMPLETE';
        executionState.verificationDetails = timeoutMsg;
        const validation = TaskPlanner.validateAndFormatResponse(executionState, finalAnswer || timeoutMsg);
        return {
          success: false,
          text: validation.finalAnswer,
          steps: executionSteps,
          sources: Array.from(consultedSources),
          taskPlan,
          executionState,
          verificationVerdict: 'INCOMPLETE',
          error: timeoutMsg,
        };
      }

      if (this.isAborted) {
        emit('INFO', 'Execution cancelled by user.');
        logDiagnostic('TASK_CANCELLED', { taskId: executionState.taskId });
        executionState.status = 'CANCELLED';
        const validation = TaskPlanner.validateAndFormatResponse(executionState, 'Task was cancelled by the user.');
        return {
          success: false,
          text: validation.finalAnswer,
          steps: executionSteps,
          sources: Array.from(consultedSources),
          taskPlan,
          executionState,
          verificationVerdict: 'INCOMPLETE',
          error: 'Cancelled',
        };
      }

      executionState.currentStepCount++;

      // Refresh live browser status on EVERY step so the model has fresh state
      const liveBrowserStatus = await this.browserService.getStatus();
      TaskPlanner.updateBrowserState(taskPlan, liveBrowserStatus.url, liveBrowserStatus.title);
      const dynamicDirective = TaskPlanner.formatPromptDirective(taskPlan);
      const effectiveSystem = systemInstruction
        ? `${defaultSystem}\n\n${dynamicDirective}\n\nUser Context:\n${systemInstruction}`
        : `${defaultSystem}\n\n${dynamicDirective}`;

      type NormalizedCall = { name: string; args: Record<string, any>; id?: string };
      let normalizedCalls: NormalizedCall[] = [];
      let directTextAnswer = '';

      if (effectiveProvider === 'ollama') {
        const primaryOllamaModel = modelName || process.env.OLLAMA_MODEL || 'qwen2.5:7b';
        const messagesForOllama: OllamaMessage[] = [
          { role: 'system', content: effectiveSystem },
          ...ollamaMessages,
        ];

        const turnStart = Date.now();
        let ollamaTimer: NodeJS.Timeout | null = null;
        const ollamaTimeoutPromise = new Promise<{ success: false; model: string; error: string }>((resolve) => {
          ollamaTimer = setTimeout(() => {
            resolve({
              success: false,
              model: primaryOllamaModel,
              error: `Ollama model request timed out after ${modelTimeoutMs}ms`,
            });
          }, modelTimeoutMs);
        });

        let ollamaRes: any;
        try {
          ollamaRes = await Promise.race([
            ollamaService!.chat({
              model: primaryOllamaModel,
              messages: messagesForOllama,
              tools: ollamaTools,
              temperature,
              timeoutMs: modelTimeoutMs,
            }),
            ollamaTimeoutPromise,
          ]);
        } finally {
          if (ollamaTimer) clearTimeout(ollamaTimer);
        }

        logDiagnostic('MODEL_TURN_OLLAMA', {
          step: executionState.currentStepCount,
          durationMs: Date.now() - turnStart,
          success: ollamaRes.success,
          toolCallsCount: ollamaRes.toolCalls?.length || 0,
        });

        if (this.isAborted) {
          emit('INFO', 'Execution cancelled by user.');
          executionState.status = 'CANCELLED';
          const validation = TaskPlanner.validateAndFormatResponse(executionState, 'Task was cancelled by the user.');
          return {
            success: false,
            text: validation.finalAnswer,
            steps: executionSteps,
            sources: Array.from(consultedSources),
            taskPlan,
            executionState,
            verificationVerdict: 'INCOMPLETE',
            error: 'Cancelled',
          };
        }

        if (!ollamaRes.success) {
          emit('ERROR', ollamaRes.error || 'Ollama local execution error');
          executionState.status = 'FAILED';
          const validation = TaskPlanner.validateAndFormatResponse(executionState, finalAnswer);
          return {
            success: false,
            text: validation.finalAnswer,
            steps: executionSteps,
            sources: Array.from(consultedSources),
            taskPlan,
            executionState,
            verificationVerdict: 'FAILED',
            error: ollamaRes.error,
          };
        }

        if (ollamaRes.toolCalls && ollamaRes.toolCalls.length > 0) {
          normalizedCalls = ollamaRes.toolCalls.map((tc: any, idx: number) => ({
            name: tc.name,
            args: tc.args || {},
            id: tc.id || `call_${executionState.currentStepCount}_${idx}`,
          }));

          ollamaMessages.push({
            role: 'assistant',
            content: ollamaRes.text || '',
            tool_calls: normalizedCalls.map((c) => ({
              id: c.id,
              type: 'function',
              function: { name: c.name, arguments: c.args },
            })),
          });
        } else {
          directTextAnswer = ollamaRes.text || 'Task completed.';
        }
      } else {
        // Gemini Execution Path
        const primaryModel = modelName || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
        let aiResponse: any = null;
        let lastClassifiedError: ClassifiedApiError | null = null;
        const maxRetries = 2;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          if (this.isAborted) break;
          const turnStart = Date.now();
          let geminiTimer: NodeJS.Timeout | null = null;
          const geminiTimeoutPromise = new Promise<never>((_, reject) => {
            geminiTimer = setTimeout(() => {
              const err: any = new Error(`Gemini model request timed out after ${modelTimeoutMs}ms`);
              err.status = 408;
              reject(err);
            }, modelTimeoutMs);
          });

          try {
            aiResponse = await Promise.race([
              ai!.models.generateContent({
                model: primaryModel,
                contents,
                config: {
                  systemInstruction: effectiveSystem,
                  temperature,
                  tools: toolDeclarations as any,
                },
              }),
              geminiTimeoutPromise,
            ]);
            logDiagnostic('MODEL_TURN_GEMINI', {
              step: executionState.currentStepCount,
              durationMs: Date.now() - turnStart,
              attempt,
            });
            if (aiResponse) break;
          } catch (err: any) {
            const classified = classifyGeminiError(err);
            lastClassifiedError = classified;
            logDiagnostic('MODEL_ERROR_GEMINI', {
              step: executionState.currentStepCount,
              error: classified.userMessage,
              isRetryable: classified.isRetryable,
            });

            if (!classified.isRetryable) {
              emit('ERROR', classified.userMessage);
              break;
            }

            if (attempt < maxRetries) {
              const waitTime = classified.suggestedWaitMs || calculateBackoffMs(attempt);
              emit('INFO', `${classified.userMessage} (Retrying in ${(waitTime / 1000).toFixed(1)}s...)`);
              await new Promise((r) => setTimeout(r, waitTime));
            } else {
              emit('ERROR', classified.userMessage);
            }
          } finally {
            if (geminiTimer) clearTimeout(geminiTimer);
          }
        }

        if (this.isAborted) {
          emit('INFO', 'Execution cancelled by user.');
          executionState.status = 'CANCELLED';
          const validation = TaskPlanner.validateAndFormatResponse(executionState, 'Task was cancelled by the user.');
          return {
            success: false,
            text: validation.finalAnswer,
            steps: executionSteps,
            sources: Array.from(consultedSources),
            taskPlan,
            executionState,
            verificationVerdict: 'INCOMPLETE',
            error: 'Cancelled',
          };
        }

        if (!aiResponse) {
          if (lastClassifiedError && !lastClassifiedError.isRetryable) {
            executionState.status = 'FAILED';
            const validation = TaskPlanner.validateAndFormatResponse(executionState, finalAnswer);
            return {
              success: false,
              text: validation.finalAnswer,
              steps: executionSteps,
              sources: Array.from(consultedSources),
              taskPlan,
              executionState,
              verificationVerdict: 'FAILED',
              error: lastClassifiedError.userMessage,
            };
          }

          if (executionSteps.length > 0) {
            const lastStep = executionSteps[executionSteps.length - 1];
            const content = lastStep.result?.content || lastStep.result?.summary || lastStep.result?.title || '';
            finalAnswer = content ? `Task executed successfully. Summary: ${content.slice(0, 300)}` : 'Task actions completed successfully.';
            emit('SUCCESS', finalAnswer);
            break;
          }

          const errorMsg = lastClassifiedError?.userMessage || 'Empty response from Gemini API';
          emit('ERROR', errorMsg);
          executionState.status = 'FAILED';
          const validation = TaskPlanner.validateAndFormatResponse(executionState, finalAnswer);
          return {
            success: false,
            text: validation.finalAnswer,
            steps: executionSteps,
            sources: Array.from(consultedSources),
            taskPlan,
            executionState,
            verificationVerdict: 'FAILED',
            error: errorMsg,
          };
        }

        const functionCalls = aiResponse.functionCalls;
        if (!functionCalls || functionCalls.length === 0) {
          directTextAnswer = aiResponse.text || 'Task completed.';
        } else {
          normalizedCalls = functionCalls.map((fc: any, idx: number) => ({
            name: fc.name,
            args: (fc.args || {}) as Record<string, any>,
            id: fc.id || `call_${executionState.currentStepCount}_${idx}`,
          }));

          if (aiResponse.candidates && aiResponse.candidates[0] && aiResponse.candidates[0].content) {
            contents.push(aiResponse.candidates[0].content);
          } else {
            contents.push({
              role: 'model',
              parts: functionCalls.map((fc: any) => ({ functionCall: fc })),
            });
          }
        }
      }

      // If no tools called, treat as direct textual response
      if (normalizedCalls.length === 0) {
        finalAnswer = directTextAnswer || 'Task completed.';
        const verification = TaskPlanner.verifyTaskCompletion(executionState);
        emit(verification.verified ? 'SUCCESS' : 'INFO', finalAnswer);
        logDiagnostic('DIRECT_ANSWER', { text: finalAnswer, verification });
        break;
      }

      // Process ALL function/tool calls in this turn sequentially
      const turnResults: Array<{ toolName: string; callId?: string; result: any; sanitized: any }> = [];
      const cycleFingerprints = new Set<string>();
      let shouldBreakTurn = false;

      for (const call of normalizedCalls) {
        if (this.isAborted) {
          shouldBreakTurn = true;
          break;
        }

        // Check task timeout before each tool call
        if (Date.now() - executionState.startTime > taskTimeoutMs) {
          const timeoutMsg = `Total task timeout reached (${taskTimeoutMs}ms). Halting execution.`;
          emit('ERROR', timeoutMsg);
          logDiagnostic('TASK_TIMEOUT', { taskId: executionState.taskId });
          turnResults.push({
            toolName: call.name,
            callId: call.id,
            result: { success: false, error: timeoutMsg },
            sanitized: { success: false, error: timeoutMsg },
          });
          shouldBreakTurn = true;
          break;
        }

        const callFingerprint = TaskPlanner.computeActionFingerprint(call.name, call.args);

        // Within-cycle deduplication
        if (cycleFingerprints.has(callFingerprint)) {
          const dupMsg = `Duplicate action "${call.name}" skipped within the same turn cycle.`;
          logDiagnostic('DUPLICATE_CALL_SKIPPED', { tool: call.name, fingerprint: callFingerprint });
          const dupResult = { success: true, message: dupMsg, skipped: true };
          turnResults.push({
            toolName: call.name,
            callId: call.id,
            result: dupResult,
            sanitized: sanitizeToolResultForModel(dupResult),
          });
          continue;
        }
        cycleFingerprints.add(callFingerprint);

        // Check if outcome already occurred
        const outcomeCheck = TaskPlanner.hasOutcomeAlreadyOccurred(executionState, call.name, call.args);
        if (outcomeCheck.alreadyOccurred) {
          logDiagnostic('OUTCOME_ALREADY_OCCURRED', { tool: call.name, reason: outcomeCheck.reason });
          const earlyResult = { success: true, message: outcomeCheck.reason, noop: true };
          turnResults.push({
            toolName: call.name,
            callId: call.id,
            result: earlyResult,
            sanitized: sanitizeToolResultForModel(earlyResult),
          });
          continue;
        }

        // Consequential action protection
        const isConsequential = ToolDispatcher.isConsequentialAction(call.name, call.args);
        if (isConsequential) {
          if (executionState.consequentialActionsExecuted.has(callFingerprint)) {
            const blockMsg = `Consequential action "${call.name}" with identical arguments has already been executed in this task. Duplicate execution blocked for safety.`;
            logDiagnostic('CONSEQUENTIAL_DUPLICATE_BLOCKED', { tool: call.name, fingerprint: callFingerprint });
            const blockedResult = { success: false, error: blockMsg };
            turnResults.push({
              toolName: call.name,
              callId: call.id,
              result: blockedResult,
              sanitized: sanitizeToolResultForModel(blockedResult),
            });
            continue;
          }

          const approved = await onRequestApproval({
            id: `appr-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            action: call.name,
            details: JSON.stringify(call.args),
            targetUrl: taskPlan.currentBrowserUrl || '',
            isConsequential: true,
          });

          if (!approved) {
            const rejectMsg = `User declined approval for consequential action "${call.name}". Action cancelled.`;
            logDiagnostic('APPROVAL_DECLINED', { tool: call.name });
            const rejectedResult = { success: false, error: rejectMsg };
            turnResults.push({
              toolName: call.name,
              callId: call.id,
              result: rejectedResult,
              sanitized: sanitizeToolResultForModel(rejectedResult),
            });
            continue;
          }

          executionState.consequentialActionsExecuted.add(callFingerprint);
        }

        // Handle finish_task
        if (call.name === 'finish_task') {
          const verification = TaskPlanner.verifyTaskCompletion(executionState);
          if (!verification.verified && executionState.currentStepCount < maxSteps) {
            const verifyFailMsg = `Cannot complete task yet: ${verification.reason}. Please perform the missing actions first.`;
            logDiagnostic('FINISH_TASK_REJECTED', { reason: verification.reason });
            const notDoneResult = { success: false, error: verifyFailMsg };
            turnResults.push({
              toolName: call.name,
              callId: call.id,
              result: notDoneResult,
              sanitized: sanitizeToolResultForModel(notDoneResult),
            });
            continue;
          }

          finalAnswer = call.args.summary || directTextAnswer || 'Task completed successfully.';
          if (Array.isArray(call.args.sources)) {
            call.args.sources.forEach((s: string) => consultedSources.add(s));
          }
          taskPlan.completed = verification.verified;
          const finishResult = { success: verification.verified, summary: finalAnswer, verified: verification.verified };
          turnResults.push({
            toolName: call.name,
            callId: call.id,
            result: finishResult,
            sanitized: sanitizeToolResultForModel(finishResult),
          });
          shouldBreakTurn = true;
          break;
        }

        // Execute tool with step timeout
        const toolStartMs = Date.now();
        let dispatchResult: { success: boolean; result?: any; error?: string };

        let stepTimer: NodeJS.Timeout | null = null;
        try {
          const timeoutPromise = new Promise<{ success: boolean; error: string }>((resolve) => {
            stepTimer = setTimeout(() => resolve({ success: false, error: `Step timed out after ${stepTimeoutMs}ms` }), stepTimeoutMs);
          });
          dispatchResult = await Promise.race([
            ToolDispatcher.dispatch(call.name, call.args, toolContext),
            timeoutPromise,
          ]);
        } catch (err: any) {
          dispatchResult = { success: false, error: `Tool execution error in "${call.name}": ${err?.message || String(err)}` };
        } finally {
          if (stepTimer) clearTimeout(stepTimer);
        }

        const durationMs = Date.now() - toolStartMs;
        const toolResult = dispatchResult.result || { success: false, error: dispatchResult.error };

        logDiagnostic('TOOL_EXECUTED', {
          tool: call.name,
          args: call.args,
          durationMs,
          success: Boolean(dispatchResult.success && toolResult.success !== false),
          error: dispatchResult.error || toolResult.error,
        });

        // Record step in execution plan
        TaskPlanner.recordStep(taskPlan, call.name, toolResult);

        // Check if browser download occurred during this action
        const latestBrowserDl = this.browserService.getLatestDownload();
        if (latestBrowserDl && (!taskPlan.downloadedFile || taskPlan.downloadedFile.filePath !== latestBrowserDl.filePath)) {
          taskPlan.downloadedFile = {
            filename: latestBrowserDl.filename,
            filePath: latestBrowserDl.filePath,
            sizeBytes: latestBrowserDl.sizeBytes,
            verified: latestBrowserDl.sizeBytes > 0,
          };
          toolResult.downloadedFile = taskPlan.downloadedFile;
        }

        if (toolResult.url) {
          consultedSources.add(toolResult.url);
        }

        if ((call.name === 'task_create' || call.name === 'create_task') && toolResult.task) {
          createdTasks.push({
            title: toolResult.task.title,
            category: toolResult.task.category,
          });
        }

        // Record in execution state action history
        executionState.actionHistory.push({
          id: `act-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          toolName: call.name,
          fingerprint: callFingerprint,
          args: call.args,
          success: Boolean(dispatchResult.success && toolResult.success !== false),
          durationMs,
          timestamp: Date.now(),
          error: dispatchResult.error || toolResult.error,
          resultSummary: toolResult.title || toolResult.url || toolResult.summary,
        });

        executionSteps.push({
          step: executionState.currentStepCount,
          tool: call.name,
          args: call.args,
          result: toolResult,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        });

        const modelSafeResult = sanitizeToolResultForModel(toolResult);
        turnResults.push({
          toolName: call.name,
          callId: call.id,
          result: toolResult,
          sanitized: modelSafeResult,
        });
      }

      // Correlate 1:1 tool responses back to model conversation history
      if (effectiveProvider === 'ollama') {
        for (const res of turnResults) {
          ollamaMessages.push({
            role: 'tool',
            tool_call_id: res.callId,
            content: JSON.stringify(res.sanitized),
          });
        }
      } else {
        contents.push({
          role: 'user',
          parts: turnResults.map((res) => ({
            functionResponse: {
              name: res.toolName,
              response: res.sanitized,
            },
          })),
        });
      }

      if (shouldBreakTurn || taskPlan.completed) {
        break;
      }
    }

    if (this.isAborted) {
      emit('INFO', 'Execution cancelled by user.');
      executionState.status = 'CANCELLED';
      const validation = TaskPlanner.validateAndFormatResponse(executionState, 'Task was cancelled by the user.');
      return {
        success: false,
        text: validation.finalAnswer,
        steps: executionSteps,
        sources: Array.from(consultedSources),
        taskPlan,
        executionState,
        verificationVerdict: 'INCOMPLETE',
        error: 'Cancelled',
      };
    }

    // Programmatic validation of task completion against every original requirement.
    // Checks that every requirement has a recorded status, catches omissions, and supplements any missing points.
    const validation = TaskPlanner.validateAndFormatResponse(executionState, finalAnswer);
    finalAnswer = validation.finalAnswer;

    // Final honest empirical verification check
    const finalVerification = TaskPlanner.verifyTaskCompletion(executionState);
    executionState.isVerified = finalVerification.verified;
    executionState.verificationVerdict = finalVerification.verdict;
    executionState.verificationDetails = finalVerification.reason;

    if (finalVerification.verified) {
      executionState.status = 'COMPLETED';
      emit('SUCCESS', finalAnswer);
    } else {
      executionState.status = 'INCOMPLETE';
      emit('INFO', finalAnswer);
    }

    logDiagnostic('TASK_FINISH', {
      taskId: executionState.taskId,
      verdict: finalVerification.verdict,
      reason: finalVerification.reason,
      totalSteps: executionSteps.length,
      elapsedMs: Date.now() - executionState.startTime,
    });

    return {
      success: finalVerification.verified,
      text: finalAnswer,
      steps: executionSteps,
      sources: Array.from(consultedSources),
      createdTasks: createdTasks.length > 0 ? createdTasks : undefined,
      taskPlan,
      executionState,
      verificationVerdict: finalVerification.verdict,
      error: finalVerification.verified ? undefined : finalVerification.reason,
    };
  }
}

