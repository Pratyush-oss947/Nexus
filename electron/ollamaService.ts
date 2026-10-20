import * as http from 'http';
import * as https from 'https';

export interface OllamaModelInfo {
  name: string;
  modifiedAt?: string;
  size?: number;
  digest?: string;
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function: {
      name: string;
      arguments: Record<string, any>;
    };
  }>;
}

export interface OllamaToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

export interface OllamaChatResponse {
  success: boolean;
  model: string;
  message?: OllamaMessage;
  toolCalls?: Array<{ name: string; args: Record<string, any>; id?: string }>;
  text?: string;
  error?: string;
}

export class OllamaService {
  private host: string;
  private apiKey: string;

  constructor(host?: string, apiKey?: string) {
    this.host = (host || process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/+$/, '');
    this.apiKey = (apiKey || process.env.OLLAMA_API_KEY || '').trim();
  }

  public getHost(): string {
    return this.host;
  }

  public getApiKey(): string {
    return this.apiKey;
  }

  // Basic HTTP POST/GET helper with JSON parsing and reliable timeout
  private async requestJson<T>(
    endpoint: string,
    method = 'GET',
    body?: any,
    timeoutMs = 60000
  ): Promise<{ status: number; data?: T; error?: string }> {
    return new Promise((resolve) => {
      try {
        const fullUrl = new URL(this.host + endpoint);
        const isHttps = fullUrl.protocol === 'https:';
        const client = isHttps ? https : http;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        };

        if (this.apiKey) {
          headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        const options = {
          hostname: fullUrl.hostname,
          port: fullUrl.port || (isHttps ? 443 : 80),
          path: fullUrl.pathname + fullUrl.search,
          method,
          headers,
          timeout: timeoutMs,
        };

        const req = client.request(options, (res) => {
          let chunks = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            chunks += chunk;
          });
          res.on('end', () => {
            try {
              const parsed = chunks ? JSON.parse(chunks) : {};
              resolve({ status: res.statusCode || 200, data: parsed as T });
            } catch (err: any) {
              resolve({
                status: res.statusCode || 500,
                error: `Malformed JSON response from Ollama: ${err?.message || String(err)}`,
              });
            }
          });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({ status: 504, error: `Ollama request timed out after ${timeoutMs}ms.` });
        });

        req.on('error', (err: any) => {
          const isConnRefused = err?.code === 'ECONNREFUSED';
          const msg = isConnRefused
            ? `Ollama is not running at ${this.host}. Please start Ollama locally ('ollama serve' or launch the Ollama app).`
            : `Network error connecting to Ollama at ${this.host}: ${err?.message || String(err)}`;
          resolve({ status: 503, error: msg });
        });

        if (body && (method === 'POST' || method === 'PUT')) {
          req.write(JSON.stringify(body));
        }
        req.end();
      } catch (err: any) {
        resolve({ status: 500, error: `Failed to prepare Ollama request: ${err?.message || String(err)}` });
      }
    });
  }

  // Ping Ollama and list installed models
  public async listModels(): Promise<{ success: boolean; models: OllamaModelInfo[]; error?: string }> {
    const res = await this.requestJson<{ models: Array<{ name: string; modified_at?: string; size?: number; digest?: string }> }>(
      '/api/tags',
      'GET',
      undefined,
      4000
    );

    if (res.error || !res.data) {
      return { success: false, models: [], error: res.error || 'Failed to retrieve models from Ollama.' };
    }

    const models: OllamaModelInfo[] = (res.data.models || []).map((m) => ({
      name: m.name,
      modifiedAt: m.modified_at,
      size: m.size,
      digest: m.digest,
    }));

    return { success: true, models };
  }

  // Check connection status
  public async testConnection(modelName?: string): Promise<{ success: boolean; model?: string; error?: string }> {
    const listRes = await this.listModels();
    if (!listRes.success) {
      return { success: false, error: listRes.error };
    }

    if (listRes.models.length === 0) {
      return {
        success: false,
        error: `Ollama is active at ${this.host}, but no local models are installed. Run 'ollama pull qwen2.5:7b' or 'ollama pull llama3.1' in terminal.`,
      };
    }

    const target = modelName || listRes.models[0].name;
    const modelExists = listRes.models.some((m) => m.name === target || m.name.startsWith(target + ':'));
    if (!modelExists && modelName) {
      return {
        success: false,
        error: `Model "${modelName}" is not installed in local Ollama. Available: ${listRes.models.map((m) => m.name).join(', ')}`,
      };
    }

    return { success: true, model: target };
  }

  // Extract structured tool calls from raw model text if tool_calls array was not populated
  public extractStructuredToolCalls(content: string): Array<{ name: string; args: Record<string, any> }> {
    const calls: Array<{ name: string; args: Record<string, any> }> = [];
    if (!content) return calls;

    // Pattern 1: JSON markdown fence ```json { "action" / "tool": ..., "args" / "parameters": ... } ```
    const fenceRegex = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/gi;
    let match;
    while ((match = fenceRegex.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        const toolName = parsed.action || parsed.tool || parsed.name || parsed.function;
        const toolArgs = parsed.args || parsed.parameters || parsed.arguments || {};
        if (toolName && typeof toolName === 'string') {
          calls.push({ name: toolName, args: typeof toolArgs === 'object' ? toolArgs : {} });
        }
      } catch {}
    }

    // Pattern 2: <tool_call>...</tool_call> or <action>...</action>
    if (calls.length === 0) {
      const tagRegex = /<(?:tool_call|action)>([\s\S]*?)<\/(?:tool_call|action)>/gi;
      while ((match = tagRegex.exec(content)) !== null) {
        try {
          const parsed = JSON.parse(match[1].trim());
          const toolName = parsed.name || parsed.action || parsed.tool;
          const toolArgs = parsed.arguments || parsed.args || parsed.parameters || {};
          if (toolName && typeof toolName === 'string') {
            calls.push({ name: toolName, args: typeof toolArgs === 'object' ? toolArgs : {} });
          }
        } catch {}
      }
    }

    // Pattern 3: Bare JSON object with "action" or "tool" key
    if (calls.length === 0) {
      const bareJsonRegex = /\{\s*"(?:action|tool|name)"\s*:\s*"([^"]+)"[\s\S]*?\}/g;
      while ((match = bareJsonRegex.exec(content)) !== null) {
        try {
          const parsed = JSON.parse(match[0]);
          const toolName = parsed.action || parsed.tool || parsed.name;
          const toolArgs = parsed.args || parsed.parameters || parsed.arguments || {};
          if (toolName && typeof toolName === 'string') {
            calls.push({ name: toolName, args: typeof toolArgs === 'object' ? toolArgs : {} });
          }
        } catch {}
      }
    }

    return calls;
  }

  // Convert NEXUS tool definitions into OpenAI/Ollama tool calling format
  public formatToolsForOllama(tools: Record<string, any>): OllamaToolDefinition[] {
    const formatted: OllamaToolDefinition[] = [];

    for (const [name, def] of Object.entries(tools)) {
      formatted.push({
        type: 'function',
        function: {
          name,
          description: def.description || `Tool: ${name}`,
          parameters: {
            type: 'object',
            properties: def.parameters?.properties || {},
            required: def.parameters?.required || [],
          },
        },
      });
    }

    return formatted;
  }

  // Send a chat turn to Ollama
  public async chat(options: {
    model: string;
    messages: OllamaMessage[];
    tools?: OllamaToolDefinition[];
    temperature?: number;
    timeoutMs?: number;
  }): Promise<OllamaChatResponse> {
    const { model, messages, tools, temperature = 0.2, timeoutMs = 60000 } = options;

    const payload: any = {
      model,
      messages,
      stream: false,
      options: {
        temperature,
      },
    };

    if (tools && tools.length > 0) {
      payload.tools = tools;
    }

    const res = await this.requestJson<any>('/api/chat', 'POST', payload, timeoutMs);

    if (res.error || !res.data) {
      return {
        success: false,
        model,
        error: res.error || 'Empty response received from Ollama local server.',
      };
    }

    const msg = res.data.message as OllamaMessage | undefined;
    const content = msg?.content || '';
    const rawToolCalls = msg?.tool_calls;

    let normalizedCalls: Array<{ name: string; args: Record<string, any>; id?: string }> = [];

    // Check if model returned native tool_calls
    if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
      for (const call of rawToolCalls) {
        if (call?.function?.name) {
          let args = call.function.arguments;
          if (typeof args === 'string') {
            try {
              args = JSON.parse(args);
            } catch {
              args = {};
            }
          }
          normalizedCalls.push({
            name: call.function.name,
            args: args || {},
            id: (call as any).id,
          });
        }
      }
    }

    // Fallback: Check if model generated structured JSON action in its content
    if (normalizedCalls.length === 0 && content) {
      normalizedCalls = this.extractStructuredToolCalls(content);
    }

    return {
      success: true,
      model: res.data.model || model,
      message: msg,
      toolCalls: normalizedCalls.length > 0 ? normalizedCalls : undefined,
      text: content,
    };
  }
}
