import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import * as dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

function parseBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: any) => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { BrowserService } = require('./dist-electron/browserService.js');
const { DesktopService } = require('./dist-electron/desktopService.js');
const { DownloadManager } = require('./dist-electron/downloadManager.js');
const { TaskManager } = require('./dist-electron/taskManager.js');
const { AgentEngine } = require('./dist-electron/agentEngine.js');

function nexusBackendPlugin(): Plugin {
  const userHome = process.env.USERPROFILE || process.env.HOME || '';
  const downloadsDir = path.join(userHome, 'Downloads', 'NEXUS Downloads');
  const browserService = new BrowserService(downloadsDir);
  const desktopService = new DesktopService();
  const downloadManager = new DownloadManager(downloadsDir);
  const taskManager = new TaskManager();
  const agentEngine = new AgentEngine(browserService, downloadManager, taskManager, desktopService);

  return {
    name: 'nexus-backend-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0];

        // 1. Status endpoint
        if (url === '/api/nexus/status' && req.method === 'GET') {
          const apiKey = process.env.GEMINI_API_KEY || '';
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({
            hasApiKey: apiKey.trim().length > 0,
            keySource: apiKey ? 'env' : 'none',
            defaultModel: process.env.GEMINI_MODEL || 'gemini-flash-lite-latest',
          }));
        }

        // 2. Test connection endpoint
        if (url === '/api/nexus/test' && req.method === 'POST') {
          try {
            const body = await parseBody(req);
            const apiKey = body.key || process.env.GEMINI_API_KEY || '';
            if (!apiKey) {
              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify({ success: false, error: 'API key is missing.' }));
            }
            const ai = new GoogleGenAI({ apiKey });
            const candidateModels = [process.env.GEMINI_MODEL || 'gemini-flash-lite-latest', 'gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-3.8-flash'];
            let lastErr: any = null;
            for (const m of candidateModels) {
              try {
                const testRes = await ai.models.generateContent({
                  model: m,
                  contents: 'Respond with the single word: "READY"',
                });
                if (testRes && testRes.text) {
                  res.setHeader('Content-Type', 'application/json');
                  return res.end(JSON.stringify({ success: true, model: m }));
                }
              } catch (e: any) {
                lastErr = e;
              }
            }
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ success: false, error: lastErr?.message || 'Empty response' }));
          } catch (err: any) {
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ success: false, error: err?.message || String(err) }));
          }
        }

        // 3. Chat & Autonomous Agent Tool Endpoint
        if (url === '/api/nexus/chat' && req.method === 'POST') {
          try {
            const body = await parseBody(req);
            const apiKey = process.env.GEMINI_API_KEY || '';
            if (!apiKey) {
              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify({ text: '', error: 'Gemini API Key is missing from .env configuration.' }));
            }

            const messages = body.messages || [];
            const lastMsg = messages[messages.length - 1];
            const history = messages.slice(0, messages.length - 1);

            const result = await agentEngine.execute({
              prompt: lastMsg ? lastMsg.text : '',
              conversationHistory: history,
              apiKey,
              modelName: body.model || process.env.GEMINI_MODEL || 'gemini-flash-lite-latest',
              temperature: body.temperature ?? 0.2,
              systemInstruction: body.systemInstruction,
            });

            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({
              text: result.text,
              createdTasks: result.createdTasks,
              sources: result.sources,
              steps: result.steps,
            }));
          } catch (err: any) {
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({
              text: '',
              error: err?.message || String(err),
            }));
          }
        }

        // 4. Cancel endpoint
        if (url === '/api/nexus/cancel' && req.method === 'POST') {
          agentEngine.abort();
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify({ success: true }));
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), nexusBackendPlugin()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/electron/**', '**/dist-electron/**', '**/test-*', '**/build/**', '**/release/**', '**/*.tmp', '**/*.TMP'],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
