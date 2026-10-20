import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { ToolDispatcher } from './dist-electron/toolRegistry.js';
import { TaskPlanner } from './dist-electron/taskPlanner.js';
import { AgentEngine, sanitizeToolResultForModel, redactSensitiveString, isBackgroundExecutionRequested } from './dist-electron/agentEngine.js';

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
    this.isBackground = false;
  }
  async getStatus() {
    return { isOpen: !this.closed, isRunning: !this.closed, url: this.currentUrl, title: this.currentTitle };
  }
  setBackgroundMode(bg) {
    this.isBackground = bg;
  }
  async bringToForeground() {
    return { success: true };
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
  async recoverUnresponsivePage() {
    this.currentUrl = 'about:blank';
    return { success: true, url: this.currentUrl };
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
  console.log('NEXUS - Phase 2.2 Complete Every Task Point & Prevent Stuck Execution Test Suite\n');

  // =========================================================================
  // SCENARIO 1: A request with three questions: all three receive answers
  // =========================================================================
  await runTest('Scenario 1: Three questions in a single request are parsed and all receive answers', async () => {
    const prompt = '1. What is Node.js? 2. What is Electron? 3. What is Playwright?';
    const reqs = TaskPlanner.parseRequirements(prompt);
    assert(reqs.length === 3, `Expected 3 requirements, parsed ${reqs.length}`);
    assert(reqs[0].description.includes('Node.js'), 'Req 1 includes Node.js');
    assert(reqs[1].description.includes('Electron'), 'Req 2 includes Electron');
    assert(reqs[2].description.includes('Playwright'), 'Req 3 includes Playwright');

    // Create execution state and simulate answers for all 3
    const state = TaskPlanner.createExecutionState(prompt);
    TaskPlanner.updateRequirement(state.taskPlan, 1, {
      status: 'COMPLETED',
      answerOrEvidence: 'Node.js is an open-source, cross-platform JavaScript runtime environment.',
    });
    TaskPlanner.updateRequirement(state.taskPlan, 2, {
      status: 'COMPLETED',
      answerOrEvidence: 'Electron is a framework for building cross-platform desktop applications using web technologies.',
    });
    TaskPlanner.updateRequirement(state.taskPlan, 3, {
      status: 'COMPLETED',
      answerOrEvidence: 'Playwright is an end-to-end testing and browser automation framework for modern web apps.',
    });

    const validation = TaskPlanner.validateAndFormatResponse(state);
    assert(validation.valid === true, 'All 3 requirements validated successfully');
    assert(validation.completedCount === 3, 'All 3 requirements counted as completed');
    assert(validation.finalAnswer.includes('Node.js') && validation.finalAnswer.includes('Electron') && validation.finalAnswer.includes('Playwright'),
      'Final validated response includes answers to all 3 questions');
  });

  // =========================================================================
  // SCENARIO 2: Multi-step browser request: completed steps are preserved
  // =========================================================================
  await runTest('Scenario 2: Multi-step browser request preserves completed steps and evidence', async () => {
    const prompt = 'Open wikipedia.org, search for Quantum Computing, and download the article.';
    const plan = TaskPlanner.createPlan(prompt);
    assert(plan.requirements.length >= 3, `Requirements parsed for multi-step browser request: ${plan.requirements.length}`);
    
    // Simulate step 1 navigation
    TaskPlanner.recordStep(plan, 'open_website', { success: true, url: 'https://en.wikipedia.org', title: 'Wikipedia' });
    assert(plan.requirements[0].status === 'COMPLETED', 'Step 1 requirement marked COMPLETED');
    assert(plan.requirements[0].answerOrEvidence.includes('wikipedia.org'), 'Step 1 evidence contains navigation URL');

    // Simulate step 2 in-page search
    TaskPlanner.recordStep(plan, 'search_current_site', { success: true, url: 'https://en.wikipedia.org/wiki/Quantum_computing', title: 'Quantum Computing' });
    assert(plan.requirements[1].status === 'COMPLETED', 'Step 2 requirement marked COMPLETED');

    // Check that step 1 is still preserved as COMPLETED
    assert(plan.requirements[0].status === 'COMPLETED', 'Step 1 remains preserved as COMPLETED after Step 2');

    // Simulate step 3 locate result
    TaskPlanner.recordStep(plan, 'click_control', { success: true, title: 'Quantum Computing Article', url: 'https://en.wikipedia.org/wiki/Quantum_computing' });
    assert(plan.requirements[2].status === 'COMPLETED', 'Step 3 locate requirement marked COMPLETED');

    // Simulate step 4 download
    TaskPlanner.recordStep(plan, 'download_result', { success: true, filename: 'quantum_computing.pdf', sizeBytes: 204800 });
    const lastReq = plan.requirements[plan.requirements.length - 1];
    assert(lastReq.status === 'COMPLETED', 'Download requirement marked COMPLETED');
    assert(plan.downloadedFile && plan.downloadedFile.verified, 'Downloaded file verified in task plan');
  });

  // =========================================================================
  // SCENARIO 3: One failed step among successful steps: successful results retained
  // =========================================================================
  await runTest('Scenario 3: Failed step does not discard previously obtained successful results', async () => {
    const prompt = '1. Check the weather in Paris. 2. Find flights to Paris. 3. Download the PDF brochure.';
    const state = TaskPlanner.createExecutionState(prompt);
    assert(state.taskPlan.requirements.length === 3, 'Parsed 3 distinct requirements');

    // Step 1: Succeeded
    TaskPlanner.updateRequirement(state.taskPlan, 1, {
      status: 'COMPLETED',
      answerOrEvidence: 'Current weather in Paris: 18°C, Partly Cloudy.',
    });

    // Step 2: Succeeded
    TaskPlanner.updateRequirement(state.taskPlan, 2, {
      status: 'COMPLETED',
      answerOrEvidence: 'Flights to Paris start from $450 direct.',
    });

    // Step 3: Tool encounters error (e.g. 404 or network error)
    TaskPlanner.recordStep(state.taskPlan, 'download_file', {
      success: false,
      error: 'Download link returned 404 Not Found from server',
    });

    // Verify step 3 is marked FAILED with blocker reason
    assert(state.taskPlan.requirements[2].status === 'FAILED', 'Step 3 requirement marked FAILED');
    assert(state.taskPlan.requirements[2].blockerReason.includes('404 Not Found'), 'Step 3 blocker reason preserved');

    // Verify step 1 and 2 answers are NOT lost
    const validation = TaskPlanner.validateAndFormatResponse(state);
    assert(validation.completedCount === 2, '2 requirements completed');
    assert(validation.failedCount === 1, '1 requirement failed');
    assert(validation.finalAnswer.includes('18°C'), 'Paris weather answer preserved in final output');
    assert(validation.finalAnswer.includes('$450'), 'Paris flights answer preserved in final output');
    assert(validation.finalAnswer.includes('404 Not Found'), 'Explicit failure reason documented for requirement 3');
  });

  // =========================================================================
  // SCENARIO 4: Navigation timeout terminates safely and explains failure
  // =========================================================================
  await runTest('Scenario 4: Navigation timeout terminates safely and provides clear diagnostic', async () => {
    const mockBrowser = new MockBrowserService();
    // Simulate navigation timeout failure
    mockBrowser.navigate = async () => {
      return { success: false, action: 'navigate', error: 'Navigation timed out after 12000ms' };
    };
    const mockDownloads = new MockDownloadManager();
    const mockTasks = new MockTaskManager();
    const engine = new AgentEngine(mockBrowser, mockDownloads, mockTasks);

    const prompt = 'Open https://unresponsive-domain-stuck.com';
    const state = TaskPlanner.createExecutionState(prompt);

    const navRes = await mockBrowser.navigate('https://unresponsive-domain-stuck.com');
    assert(navRes.success === false, 'Navigation reported failure');
    assert(navRes.error.includes('timed out'), 'Error explicitly reports navigation timeout');

    TaskPlanner.recordStep(state.taskPlan, 'open_website', navRes);
    assert(state.taskPlan.requirements[0].status === 'FAILED', 'Requirement marked FAILED due to navigation timeout');
    assert(state.taskPlan.requirements[0].blockerReason.includes('timed out'), 'Blocker reason contains timeout detail');

    const validation = TaskPlanner.validateAndFormatResponse(state);
    assert(validation.finalAnswer.includes('timed out'), 'Final answer explains the navigation timeout');
  });

  // =========================================================================
  // SCENARIO 5: Provider timeout prevents indefinite hang
  // =========================================================================
  await runTest('Scenario 5: Provider timeout prevents application hanging indefinitely', async () => {
    // Start a mock hanging HTTP server that deliberately delays responding
    const hangingServer = http.createServer((req, res) => {
      // Do nothing, leave request hanging
    });
    await new Promise((resolve) => hangingServer.listen(0, '127.0.0.1', resolve));
    const port = hangingServer.address().port;

    const mockBrowser = new MockBrowserService();
    const mockDownloads = new MockDownloadManager();
    const mockTasks = new MockTaskManager();
    const engine = new AgentEngine(mockBrowser, mockDownloads, mockTasks);

    const start = Date.now();
    const result = await engine.execute({
      prompt: 'Test provider timeout prevention',
      provider: 'ollama',
      ollamaHost: `http://127.0.0.1:${port}`,
      modelTimeoutMs: 300, // Short timeout for automated test
      maxSteps: 1,
    });
    const elapsed = Date.now() - start;

    await new Promise((resolve) => hangingServer.close(resolve));

    assert(elapsed < 2000, `Execution halted promptly (${elapsed}ms < 2000ms)`);
    assert(result.success === false, 'Result marked as failed due to provider timeout');
    assert(result.error && (result.error.includes('timed out') || result.error.includes('timeout')), 'Result error explains provider timeout');
  });

  // =========================================================================
  // SCENARIO 6: Iteration limit: agent stops safely
  // =========================================================================
  await runTest('Scenario 6: Iteration limit halts execution safely and marks pending steps as blocked', async () => {
    const prompt = '1. Step one 2. Step two 3. Step three 4. Step four 5. Step five';
    const state = TaskPlanner.createExecutionState(prompt, undefined, undefined, { maxSteps: 2 });
    assert(state.taskPlan.requirements.length === 5, 'Parsed 5 requirements');

    // Simulate completion of steps 1 and 2
    state.currentStepCount = 2; // Hit maxSteps
    TaskPlanner.updateRequirement(state.taskPlan, 1, { status: 'COMPLETED', answerOrEvidence: 'Completed step 1' });
    TaskPlanner.updateRequirement(state.taskPlan, 2, { status: 'COMPLETED', answerOrEvidence: 'Completed step 2' });

    const validation = TaskPlanner.validateAndFormatResponse(state);
    assert(validation.completedCount === 2, 'Steps 1 and 2 completed');
    assert(validation.blockedCount === 3, 'Steps 3, 4, 5 blocked due to iteration limit');
    assert(validation.finalAnswer.includes('Iteration limit'), 'Final answer documents iteration limit blocker');
    assert(validation.finalAnswer.includes('Completed step 1'), 'Step 1 answer preserved in final output');
  });

  // =========================================================================
  // SCENARIO 7: Cancellation cleanup
  // =========================================================================
  await runTest('Scenario 7: Cancellation immediately closes browser resources and reports cancelled state', async () => {
    const mockBrowser = new MockBrowserService('https://example.com', 'Example');
    const mockDownloads = new MockDownloadManager();
    const mockTasks = new MockTaskManager();
    const engine = new AgentEngine(mockBrowser, mockDownloads, mockTasks);

    // Start execution and immediately abort
    const execPromise = engine.execute({
      prompt: 'Perform cancellation test',
      provider: 'ollama',
      maxSteps: 5,
    });
    engine.abort();
    const result = await execPromise;

    assert(mockBrowser.closed === true, 'BrowserService.closeBrowser() called on cancellation');
    assert(result.success === false, 'Cancelled execution returned success: false');
    assert(result.error === 'Cancelled' || result.text.toLowerCase().includes('cancel'), 'Result states task was cancelled');
    assert(result.executionState.status === 'CANCELLED', 'Execution state status is CANCELLED');
  });

  // =========================================================================
  // SCENARIO 8: Final response validation catches omitted requirements
  // =========================================================================
  await runTest('Scenario 8: Final response validation detects omissions and supplements answer', async () => {
    const prompt = '1. Explain What is TypeScript? 2. Explain What is Docker? 3. Explain What is Kubernetes?';
    const state = TaskPlanner.createExecutionState(prompt);
    assert(state.taskPlan.requirements.length === 3, '3 requirements initialized');

    // Set evidence for requirement 1 and 2
    TaskPlanner.updateRequirement(state.taskPlan, 1, {
      status: 'COMPLETED',
      answerOrEvidence: 'TypeScript is a typed superset of JavaScript.',
    });
    TaskPlanner.updateRequirement(state.taskPlan, 2, {
      status: 'COMPLETED',
      answerOrEvidence: 'Docker is a containerization platform.',
    });

    // Model proposes an answer that only mentions TypeScript and Docker, completely omitting Kubernetes
    const proposedModelAnswer = 'TypeScript adds static typing to JavaScript. Docker containerizes apps.';
    const validation = TaskPlanner.validateAndFormatResponse(state, proposedModelAnswer);

    // Validation must catch that Kubernetes was not mentioned or completed
    assert(validation.missingRequirements.length >= 1, 'Validation caught missing requirement for Kubernetes');
    assert(validation.missingRequirements.some((r) => r.description.includes('Kubernetes')), 'Missing requirement is Kubernetes');
    assert(validation.finalAnswer.includes('Kubernetes'), 'Final supplemented answer contains the omitted requirement');
  });

  // =========================================================================
  // SCENARIO 9: Preservation of Phase 1 screenshot sanitization & features
  // =========================================================================
  await runTest('Scenario 9: Preservation of Phase 1 screenshot sanitization, secrets masking, and foreground options', async () => {
    // 1. Screenshot base64 sanitization
    const bloatedResult = {
      success: true,
      action: 'inspect_page',
      title: 'Dashboard',
      url: 'https://example.com/dash',
      screenshotBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA...',
      data: {
        token: 'secret_jwt_token_123456789',
        apiKey: 'AIzaSyD-TEST-GEMINI-KEY-987654321',
      },
    };

    const sanitized = sanitizeToolResultForModel(bloatedResult);
    assert(sanitized.screenshotBase64 === undefined, 'Raw screenshotBase64 stripped from model history');
    assert(sanitized.screenshotCaptured === true, 'screenshotCaptured friendly flag preserved');
    assert(sanitized.data?.token === undefined || sanitized.data?.token.includes('[REDACTED]'), 'Sensitive token redacted');

    // 2. Secret redactor tests
    const maskedText = redactSensitiveString('My key is 034a9bde63574a8096daeb8001caa16b.gfUZV3htqbKWy23e9D1cZkM8 and Bearer eyJhbGciOi...');
    assert(!maskedText.includes('034a9bde63574a8096daeb8001caa16b'), 'Ollama API key masked');
    assert(maskedText.includes('[REDACTED_OLLAMA_KEY]'), 'Ollama redact marker present');
    assert(!maskedText.includes('eyJhbGciOi'), 'Bearer token masked');

    // 3. Background execution option detection
    assert(isBackgroundExecutionRequested('run in background silently', false) === true, 'Background prompt detected');
    assert(isBackgroundExecutionRequested('open youtube', false) === false, 'Foreground visible prompt detected');
  });

  console.log(`\n======================================================================`);
  console.log(`Phase 2.2 Test Suite Complete: ${passed} Passed, ${failed} Failed`);
  console.log(`======================================================================\n`);

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main();
