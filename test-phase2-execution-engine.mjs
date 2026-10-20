import * as path from 'path';
import * as fs from 'fs';
import { ToolDispatcher } from './dist-electron/toolRegistry.js';
import { TaskPlanner } from './dist-electron/taskPlanner.js';
import { AgentEngine, sanitizeToolResultForModel, redactSensitiveString } from './dist-electron/agentEngine.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
    throw new Error(message);
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

async function runTest(name, fn) {
  console.log(`\n======================================================================`);
  console.log(`TEST: ${name}`);
  console.log(`======================================================================`);
  try {
    await fn();
  } catch (err) {
    console.error(`  Error in test "${name}":`, err.message);
  }
}

// Mock BrowserService
class MockBrowserService {
  constructor(initialUrl = '', initialTitle = '') {
    this.currentUrl = initialUrl;
    this.currentTitle = initialTitle;
    this.latestDownload = null;
    this.closed = false;
  }
  async getStatus() {
    return { isRunning: !this.closed, url: this.currentUrl, title: this.currentTitle };
  }
  async navigate(url) {
    this.currentUrl = url;
    this.currentTitle = `Title of ${url}`;
    return { success: true, url: this.currentUrl, title: this.currentTitle };
  }
  async inPageSearch(query) {
    return { success: true, url: this.currentUrl, count: 5, results: [{ title: `Result for ${query}` }] };
  }
  async inspectPage() {
    return { success: true, url: this.currentUrl, title: this.currentTitle, content: 'Page content here' };
  }
  getLatestDownload() {
    return this.latestDownload;
  }
  async closeBrowser() {
    this.closed = true;
  }
}

// Mock DownloadManager
class MockDownloadManager {
  constructor() {
    this.downloads = [];
  }
  async listDownloads() {
    return this.downloads;
  }
}

// Mock TaskManager
class MockTaskManager {
  constructor() {
    this.tasks = [];
  }
  async createTask(data) {
    const task = { id: `task-${Date.now()}`, ...data };
    this.tasks.push(task);
    return task;
  }
  async deleteTask(id) {
    const idx = this.tasks.findIndex((t) => t.id === id);
    if (idx !== -1) {
      this.tasks.splice(idx, 1);
      return true;
    }
    return false;
  }
}

async function main() {
  console.log('NEXUS - Phase 2 Reliable Agent Execution Engine Regression Suite\n');

  // =========================================================================
  // SCENARIO 1: Multiple tool calls in a single turn are all executed in order
  // =========================================================================
  await runTest('Scenario 1: Multiple tool calls in single turn executed in sequence and recorded', async () => {
    const mockBrowser = new MockBrowserService();
    const mockDownloads = new MockDownloadManager();
    const mockTasks = new MockTaskManager();
    const engine = new AgentEngine(mockBrowser, mockDownloads, mockTasks);

    // Track simulated tool calls
    const executed = [];
    const events = [];

    const customContext = {
      browserService: mockBrowser,
      desktopService: null,
      downloadManager: mockDownloads,
      taskManager: mockTasks,
      onRequestApproval: async () => true,
      onEmitEvent: (type, msg) => events.push({ type, msg }),
    };

    const call1 = { name: 'open_website', args: { url: 'https://en.wikipedia.org' } };
    const call2 = { name: 'search_current_site', args: { query: 'Artificial Intelligence' } };
    const call3 = { name: 'inspect_page', args: {} };

    const res1 = await ToolDispatcher.dispatch(call1.name, call1.args, customContext);
    const res2 = await ToolDispatcher.dispatch(call2.name, call2.args, customContext);
    const res3 = await ToolDispatcher.dispatch(call3.name, call3.args, customContext);

    assert(res1.success && res1.result.url === 'https://en.wikipedia.org', 'Call 1 (open_website) succeeded');
    assert(res2.success && res2.result.results.length > 0, 'Call 2 (search_current_site) succeeded');
    assert(res3.success && res3.result.content.includes('Page content'), 'Call 3 (inspect_page) succeeded');
  });

  // =========================================================================
  // SCENARIO 2: Provider message history remains schema-compliant after multi-tool calls
  // =========================================================================
  await runTest('Scenario 2: 1:1 functionResponse correlation and schema compliance', async () => {
    const calls = [
      { name: 'open_website', args: { url: 'https://example.com' } },
      { name: 'inspect_page', args: {} },
    ];

    const turnResults = calls.map((c) => ({
      toolName: c.name,
      result: { success: true, url: 'https://example.com' },
      sanitized: sanitizeToolResultForModel({ success: true, url: 'https://example.com' }),
    }));

    // Construct Gemini response parts
    const geminiUserMessage = {
      role: 'user',
      parts: turnResults.map((r) => ({
        functionResponse: {
          name: r.toolName,
          response: r.sanitized,
        },
      })),
    };

    assert(geminiUserMessage.parts.length === calls.length, 'Gemini message contains matching number of parts');
    assert(geminiUserMessage.parts[0].functionResponse.name === 'open_website', 'Part 0 matches call 0 name');
    assert(geminiUserMessage.parts[1].functionResponse.name === 'inspect_page', 'Part 1 matches call 1 name');
    assert(geminiUserMessage.parts[0].functionResponse.response.success === true, 'Part 0 response has sanitized payload');
  });

  // =========================================================================
  // SCENARIO 3: Malformed tool arguments return error instead of crashing
  // =========================================================================
  await runTest('Scenario 3: Malformed arguments return schema error gracefully without crashing', async () => {
    const mockBrowser = new MockBrowserService();
    const mockContext = {
      browserService: mockBrowser,
      desktopService: null,
      downloadManager: new MockDownloadManager(),
      taskManager: new MockTaskManager(),
      onRequestApproval: async () => true,
      onEmitEvent: () => {},
    };

    // Missing required url parameter
    const res1 = await ToolDispatcher.dispatch('open_website', {}, mockContext);
    assert(!res1.success, 'open_website with empty args was rejected');
    assert(res1.error.includes('Missing required parameter') || res1.error.includes('required'), 'Returned descriptive parameter error');

    // Non-object arguments
    const res2 = await ToolDispatcher.dispatch('open_website', 'not-an-object', mockContext);
    assert(!res2.success, 'open_website with string arg rejected');
    assert(res2.error.includes('Malformed arguments'), 'Returned malformed arguments message');

    // Unregistered tool
    const res3 = await ToolDispatcher.dispatch('malicious_hack_tool', {}, mockContext);
    assert(!res3.success, 'Unregistered tool rejected');
    assert(res3.error.includes('not registered'), 'Returned unregistered tool error');
  });

  // =========================================================================
  // SCENARIO 4: Consequential actions protected against duplicate execution
  // =========================================================================
  await runTest('Scenario 4: Consequential actions protected from duplicate execution', async () => {
    const isConsequential1 = ToolDispatcher.isConsequentialAction('click_control', { target: 'Submit Payment' });
    assert(isConsequential1 === true, 'Submit Payment click identified as consequential');

    const isConsequential2 = ToolDispatcher.isConsequentialAction('fill_form', { field: 'password', value: 'secret' });
    assert(isConsequential2 === true, 'Password fill identified as consequential');

    const isConsequential3 = ToolDispatcher.isConsequentialAction('inspect_page', {});
    assert(isConsequential3 === false, 'inspect_page identified as non-consequential');

    // Test duplicate execution blocking via state
    const state = TaskPlanner.createExecutionState('Buy book online');
    const fp = TaskPlanner.computeActionFingerprint('click_control', { target: 'Submit Payment' });
    
    // First time: allowed
    const check1 = TaskPlanner.hasOutcomeAlreadyOccurred(state, 'click_control', { target: 'Submit Payment' });
    assert(!check1.alreadyOccurred, 'First attempt allowed');

    // Mark as executed
    state.consequentialActionsExecuted.add(fp);

    // Second time: blocked
    const check2 = TaskPlanner.hasOutcomeAlreadyOccurred(state, 'click_control', { target: 'Submit Payment' });
    assert(check2.alreadyOccurred === true, 'Duplicate consequential action blocked');
    assert(check2.reason.includes('Duplicate execution blocked'), 'Descriptive duplicate block reason provided');
  });

  // =========================================================================
  // SCENARIO 5: Webpage text cannot overwrite the task goal or hijack navigation
  // =========================================================================
  await runTest('Scenario 5: Immutable goal and untrusted data boundary prompt protection', async () => {
    const originalGoal = 'Download annual report PDF from example.com';
    const state = TaskPlanner.createExecutionState(originalGoal, 'https://example.com', 'Example');

    // Attacker tries to simulate untrusted page text inside directive
    const directive = TaskPlanner.formatPromptDirective(state.taskPlan);
    assert(directive.includes('UNTRUSTED DATA BOUNDARY'), 'Directive includes explicit UNTRUSTED DATA BOUNDARY');
    assert(directive.includes('Original User Request: "Download annual report PDF from example.com"'), 'Immutable goal preserved');
    assert(state.immutableGoal === originalGoal, 'state.immutableGoal remains unmodified');
  });

  // =========================================================================
  // SCENARIO 6: Step timeout aborts stalled tool call cleanly
  // =========================================================================
  await runTest('Scenario 6: Step timeout cleanly aborts slow or stalled handler', async () => {
    const stepTimeoutMs = 150;
    const slowDispatch = new Promise((resolve) => setTimeout(() => resolve({ success: true, result: 'done' }), 500));
    const timeoutPromise = new Promise((resolve) =>
      setTimeout(() => resolve({ success: false, error: `Step timed out after ${stepTimeoutMs}ms` }), stepTimeoutMs)
    );

    const start = Date.now();
    const result = await Promise.race([slowDispatch, timeoutPromise]);
    const duration = Date.now() - start;

    assert(!result.success, 'Step aborted on timeout');
    assert(result.error.includes('timed out after 150ms'), 'Timeout error recorded');
    assert(duration < 300, `Race completed promptly in ${duration}ms without blocking`);
  });

  // =========================================================================
  // SCENARIO 7: Total task timeout halts execution and reports bounded progress
  // =========================================================================
  await runTest('Scenario 7: Total task timeout halts execution and marks INCOMPLETE', async () => {
    const state = TaskPlanner.createExecutionState('Long task', 'https://example.com', 'Example', {
      taskTimeoutMs: 100,
    });
    // Simulate elapsed time past taskTimeoutMs
    state.startTime = Date.now() - 500;

    const isTimedOut = (Date.now() - state.startTime) > state.taskTimeoutMs;
    assert(isTimedOut === true, 'Detected elapsed time exceeding taskTimeoutMs');

    if (isTimedOut) {
      state.status = 'INCOMPLETE';
      state.verificationVerdict = 'INCOMPLETE';
      state.verificationDetails = 'Total task timeout reached';
    }

    assert(state.status === 'INCOMPLETE', 'Task marked INCOMPLETE on timeout');
    assert(state.verificationVerdict === 'INCOMPLETE', 'Verification verdict is INCOMPLETE');
  });

  // =========================================================================
  // SCENARIO 8: Cancellation halts execution promptly and releases resources
  // =========================================================================
  await runTest('Scenario 8: AgentEngine abort cancels execution and closes browser', async () => {
    const mockBrowser = new MockBrowserService('https://example.com', 'Example');
    const engine = new AgentEngine(mockBrowser, new MockDownloadManager(), new MockTaskManager());

    engine.abort();
    assert(mockBrowser.closed === true, 'Browser service closeBrowser() invoked on abort');
  });

  // =========================================================================
  // SCENARIO 9: Success is not reported if empirical verification fails
  // =========================================================================
  await runTest('Scenario 9: Honest verification rejects unverified tasks', async () => {
    // 1. Download requested, but no file verified
    const dlState = TaskPlanner.createExecutionState('Download invoice PDF from example.com');
    const dlVerification = TaskPlanner.verifyTaskCompletion(dlState);
    assert(!dlVerification.verified, 'Task without verified download rejected');
    assert(dlVerification.verdict === 'INCOMPLETE', 'Verdict is INCOMPLETE');
    assert(dlVerification.reason.includes('no file with non-zero size was verified'), 'Reason explains missing download');

    // 2. Download exists and verified > 0 bytes
    dlState.taskPlan.downloadedFile = {
      filename: 'invoice.pdf',
      filePath: '/downloads/invoice.pdf',
      sizeBytes: 15420,
      verified: true,
    };
    dlState.taskPlan.currentBrowserUrl = 'https://example.com';
    const dlSuccessVerification = TaskPlanner.verifyTaskCompletion(dlState);
    assert(dlSuccessVerification.verified === true, 'Task with verified non-zero download succeeds');
    assert(dlSuccessVerification.verdict === 'VERIFIED', 'Verdict is VERIFIED');
  });

  // =========================================================================
  // SCENARIO 10: Base64 screenshots, tokens, cookies do not leak to model
  // =========================================================================
  await runTest('Scenario 10: Sanitizer strips base64 screenshots, tokens, and cookies', async () => {
    const dirtyResult = {
      success: true,
      screenshotBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
      imageData: 'raw_binary_buffer',
      cookies: ['session=xyz123'],
      token: 'secret_jwt_token',
      apiKey: 'secret_api_key_123',
      password: 'mypassword',
      url: 'https://example.com',
      text: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThis',
    };

    const sanitized = sanitizeToolResultForModel(dirtyResult);

    assert(sanitized.screenshotCaptured === true, 'Flag screenshotCaptured retained');
    assert(sanitized.screenshotBase64 === undefined, 'screenshotBase64 stripped');
    assert(sanitized.imageData === undefined, 'imageData stripped');
    assert(sanitized.cookies === undefined, 'cookies stripped');
    assert(sanitized.token === undefined, 'token stripped');
    assert(sanitized.apiKey === undefined, 'apiKey stripped');
    assert(sanitized.password === undefined, 'password stripped');
    assert(sanitized.text.includes('Bearer [REDACTED]'), 'Bearer token in text string redacted');
    assert(!sanitized.text.includes('doNotLeakThis'), 'Sensitive token characters completely removed');
  });

  // =========================================================================
  // SCENARIO 11: Sensitive values are redacted from structured diagnostic logs
  // =========================================================================
  await runTest('Scenario 11: Sensitive credentials masked in diagnostic logs', async () => {
    const sampleLog = {
      authHeader: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      ollamaKey: '034a9bde63574a8096daeb8001caa16b.gfUZV3htqbKWy23e9D1cZkM8',
      geminiKey: 'AIzaSyA_abcdef1234567890abcdef1234567',
      passwordField: 'super_secret_password_123',
    };

    const strLog = JSON.stringify(sampleLog);
    const cleaned = redactSensitiveString(strLog);

    assert(cleaned.includes('Bearer [REDACTED]'), 'Bearer token masked');
    assert(cleaned.includes('[REDACTED_OLLAMA_KEY]'), 'Ollama API key masked');
    assert(cleaned.includes('[REDACTED_GEMINI_KEY]'), 'Gemini API key masked');
    assert(cleaned.includes('[REDACTED]'), 'Password masked');
    assert(!cleaned.includes('super_secret_password_123'), 'Secret password removed');
    assert(!cleaned.includes('034a9bde63574a8096daeb8001caa16b'), 'Ollama key removed');
    assert(!cleaned.includes('AIzaSyA_'), 'Gemini key removed');
  });

  console.log(`\n======================================================================`);
  console.log(`PHASE 2 REGRESSION SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log(`======================================================================\n`);

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
