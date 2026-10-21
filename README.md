# NEXUS AI — Personal Desktop AI Agent for Windows

**NEXUS AI** is a personal desktop AI assistant engineered for Windows. Built with Electron, React 18, TypeScript, Tailwind CSS, and Google's official `@google/genai` SDK.

---

## Phase 2: Real AI Brain & Task Management

### Features Implemented
1. **Google Gemini Integration**:
   - Powered by Google's official `@google/genai` SDK (`@google/genai@2.30.0`).
   - The API key is securely handled **only in the trusted Electron main/backend process**.
   - Keys are **never exposed to frontend renderer code, browser bundles, logs, or version control**.
   - Dual-source key resolution: Loads from `.env` (`GEMINI_API_KEY`) or from local secure storage (`userData/nexus_config.json`).
   - `.env.example` provided; `.env` is ignored by Git in `.gitignore`.
   - Setup notification banner displayed when the API key is not configured.
   - Live Connection Testing tool in Settings with instant feedback.
   - Configurable model selection (`gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-1.5-flash`, `gemini-1.5-pro`).

2. **Conversational Assistant & Interface**:
   - Chat bubbles with user messages and AI responses.
   - Multiline input (`Return` to send, `Shift+Return` for newline).
   - Real-time animated loading state while the model is thinking.
   - Duplicate submissions blocked while a request is in-flight.
   - Stop / Cancel button to abort in-flight requests.
   - Markdown rendering with syntax-styled code blocks and one-click copy buttons.
   - Copy response buttons on assistant messages.
   - Graceful error handling for invalid keys, rate limits (quota), network errors, and unavailable models.
   - "New Chat" and "Clear Chat" controls with persistent local conversation history.

3. **Assistant Personality & Multilingual Fluency**:
   - Configurable System Instruction in Settings.
   - Default persona: helpful, concise, step-by-step explainer.
   - Full support for both normal English and Hinglish (Hindi in Latin script).
   - Scope honesty: Never claims to have performed external actions (e.g. form submission, web browsing) that were not executed.

4. **Local Task Manager**:
   - Create, list, toggle completion, and delete tasks.
   - Attributes: Title, optional description, category tag, created timestamp, completed timestamp.
   - Filter tabs: All, Active, Completed.
   - Confirmation dialog before destructive bulk deletions (Clear Done, Clear All).
   - Natural language task creation via Gemini tool calling (`create_task` function declaration with strict parameter validation).
   - Persistent storage in `userData/nexus_tasks.json`.

5. **Desktop Security**:
   - Electron `contextIsolation: true` and `nodeIntegration: false`.
   - Narrow, validated IPC surface via `contextBridge`.
   - Popups denied via `setWindowOpenHandler` and unauthorized external navigation prevented.
   - Strict Content Security Policy (CSP).

---

## Quick Setup & Running

### 1. Configure Gemini API Key
Obtain a key from [Google AI Studio](https://aistudio.google.com/app/apikey).

Option A (Recommended): Create a `.env` file in the project root:
```bash
cp .env.example .env
```
Edit `.env` and set:
```ini

```

Option B: Launch the app and enter the key in **Settings > Gemini Intelligence > Enter / Override Gemini API Key**, then click **Save Key** and **Test Connection**.

### 2. Available Commands
```bash
# Run full desktop application in development mode:
npm run dev

# Run Vite renderer dev server only (http://localhost:5173/):
npm run dev:renderer

# Type-check TypeScript (both renderer and electron):
npm run typecheck

# Build production bundle:
npm run build

# Launch production desktop shell:
npm run preview
```

---

## Keyboard Shortcuts
- `Return`: Send chat message / task prompt.
- `Shift + Return`: Add newline.
- `Alt + N`: New Task / Home screen.
- `Alt + C`: AI Chat conversation.
- `Alt + T`: Task Manager.
- `Alt + F`: Files & Artifacts.
- `Alt + S`: Settings & Security.
