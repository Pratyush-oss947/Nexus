import * as path from 'path';
import * as fs from 'fs';
import { BrowserService } from './dist-electron/browserService.js';
import { DownloadManager } from './dist-electron/downloadManager.js';
import { ToolDispatcher } from './dist-electron/toolRegistry.js';
import { TaskPlanner } from './dist-electron/taskPlanner.js';
import { classifyGeminiError, calculateBackoffMs } from './dist-electron/geminiErrorClassifier.js';
import { sanitizeToolResultForModel } from './dist-electron/agentEngine.js';

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

async function main() {
  console.log('NEXUS - Multi-Step Task Continuity, Search Routing & API Error Test Suite\n');

  const testDownloadsDir = path.join(process.cwd(), 'test-downloads');
  if (!fs.existsSync(testDownloadsDir)) fs.mkdirSync(testDownloadsDir, { recursive: true });

  // TEST 1: TaskPlanner accurately extracts target website, search query, and desired result
  await runTest('TaskPlanner: Extract and stabilize multi-step target website, query, and result', async () => {
    const prompt = 'Open Wikipedia, search for Quantum Computing inside Wikipedia, and download the Quantum summary result.';
    const plan = TaskPlanner.createPlan(prompt);

    assert(plan.originalInstruction === prompt, 'Original instruction preserved verbatim');
    assert(plan.targetWebsite === 'https://en.wikipedia.org', 'Target website resolved to https://en.wikipedia.org');
    assert(plan.targetName === 'Wikipedia', 'Target name resolved to Wikipedia');
    assert(plan.searchQuery === 'Quantum Computing', 'Exact search query resolved to "Quantum Computing"');
    assert(plan.desiredResult === 'Quantum summary', 'Desired result resolved to "Quantum summary"');
    assert(plan.steps.length >= 4, `Constructed ${plan.steps.length} sequential dependency steps`);
    assert(plan.steps[0].description.includes('Open target website'), 'Step 1 is Open target website');
    assert(plan.steps[1].description.includes('Search for "Quantum Computing"'), 'Step 2 is Search for exact query');

    const promptContext = TaskPlanner.formatPromptDirective(plan);
    assert(promptContext.includes('https://en.wikipedia.org'), 'Prompt context contains target website');
    assert(promptContext.includes('Quantum Computing'), 'Prompt context contains exact search query');
    assert(promptContext.includes('DO NOT call \'browser_search\''), 'Prompt context contains strict anti-hijacking rule');
  });

  // TEST 2: TaskPlanner preserves user query and never replaces with inferred or generic query
  await runTest('TaskPlanner: Preservation of user intent across multiple prompt styles', async () => {
    const prompt1 = 'Go to https://github.com and search for "electron-builder"';
    const plan1 = TaskPlanner.createPlan(prompt1);
    assert(plan1.targetWebsite === 'https://github.com', 'GitHub URL detected');
    assert(plan1.searchQuery === 'electron-builder', 'Exact quoted query preserved');

    const prompt2 = 'Play Habibi song on YouTube';
    const plan2 = TaskPlanner.createPlan(prompt2);
    assert(plan2.targetWebsite === 'https://www.youtube.com', 'YouTube URL detected');
    assert(plan2.searchQuery === 'Habibi song', 'Media search query preserved');
  });

  // TEST 3: Search Routing Guardrail - browser_search redirects to in-page search on target site
  await runTest('Search Routing: browser_search prevents DuckDuckGo hijacking on active site', async () => {
    const browserService = new BrowserService(testDownloadsDir);
    // Navigate to example.com as target
    await browserService.navigate('https://example.com');

    const plan = TaskPlanner.createPlan('Open https://example.com and search for test', 'https://example.com', 'Example Domain');
    const events = [];
    const mockContext = {
      browserService,
      desktopService: null,
      downloadManager: null,
      taskManager: null,
      onRequestApproval: async () => true,
      onEmitEvent: (type, msg) => events.push({ type, msg }),
      taskPlan: plan,
    };

    try {
      // Model mistakenly calls browser_search instead of browser_in_page_search
      const res = await ToolDispatcher.dispatch('browser_search', { query: 'test' }, mockContext);
      
      const redirectedEvt = events.find(e => e.msg && e.msg.includes('Preserving target website'));
      assert(redirectedEvt !== undefined, 'ToolDispatcher emitted notification preserving target website');
      
      const status = await browserService.getStatus();
      assert(!status.url.includes('duckduckgo.com'), `Browser did NOT navigate away to DuckDuckGo (current URL: ${status.url})`);
    } finally {
      await browserService.closeBrowser();
    }
  });

  // TEST 4: Premature browser_close is blocked when dependent steps are pending
  await runTest('Continuity: Block premature browser_close while steps are pending', async () => {
    const browserService = new BrowserService(testDownloadsDir);
    await browserService.navigate('https://example.com');

    const plan = TaskPlanner.createPlan('Open https://example.com, search for data, and download file', 'https://example.com');
    // Steps 1, 2, 3 are pending
    const mockContext = {
      browserService,
      desktopService: null,
      downloadManager: null,
      taskManager: null,
      onRequestApproval: async () => true,
      onEmitEvent: () => {},
      taskPlan: plan,
    };

    try {
      const res = await ToolDispatcher.dispatch('browser_close', {}, mockContext);
      assert(res.result.success === false, 'browser_close was safely blocked');
      assert(res.result.error.includes('Browser cannot be closed mid-task'), 'Returned clear explanation for blocking closure');

      const status = await browserService.getStatus();
      assert(status.isOpen === true, 'Browser session remained open and active');
    } finally {
      await browserService.closeBrowser();
    }
  });

  // TEST 5: Verifiable Clicks - Static non-interactive text elements cannot report false click
  await runTest('Verifiable Clicks: Static paragraph click rejected when no state change occurs', async () => {
    const browserService = new BrowserService(testDownloadsDir);
    await browserService.navigate('https://example.com');

    try {
      // "This domain is for use in documentation..." is a static <p> tag on example.com
      const clickRes = await browserService.clickElement('This domain is for use in documentation');
      assert(clickRes.success === false, 'Clicking static paragraph was rejected');
      assert(clickRes.error.includes('Clicked static text element'), 'Clear error returned indicating static non-interactive text');

      // 2. Now test a REAL interactive link on Wikipedia
      await browserService.navigate('https://en.wikipedia.org');
      const linkRes = await browserService.clickElement('Main page');
      assert(linkRes.success === true, 'Clicking real interactive link succeeded');
      assert(linkRes.url.includes('wikipedia.org'), 'Navigation occurred as verified outcome');
    } finally {
      await browserService.closeBrowser();
    }
  });

  // TEST 6: Download Approval and Resumption
  await runTest('Download Lifecycle: Risky file requires approval; resuming proceeds cleanly', async () => {
    const downloadManager = new DownloadManager(testDownloadsDir);

    // 1. Initial attempt without bypass requires approval
    const testUrl = 'https://raw.githubusercontent.com/octocat/Hello-World/master/README';
    const riskyFilename = 'setup_script.bat';

    const initialRes = await downloadManager.downloadFile(testUrl, riskyFilename, false);
    assert(initialRes.needsApproval === true, 'Risky extension (.bat) correctly requires approval');
    assert(initialRes.success === false, 'Download is paused before approval');

    // 2. Resuming with approval bypass proceeds and saves file
    const resumedRes = await downloadManager.downloadFile(testUrl, riskyFilename, true);
    assert(resumedRes.success === true, 'Resumed download succeeded');
    assert(fs.existsSync(resumedRes.filePath), 'File exists on disk');
    assert(resumedRes.sizeBytes > 0, `File size is verified non-zero (${resumedRes.sizeBytes} bytes)`);

    // Clean up test file
    try { fs.unlinkSync(resumedRes.filePath); } catch {}
  });

  // TEST 7: Gemini Error Classifier
  await runTest('API Error Classifier: Distinguishes 429 quota, rate limits, invalid keys, and network errors', async () => {
    // 1. Quota Exhaustion (429 RESOURCE_EXHAUSTED)
    const quotaErr = new Error('Resource has been exhausted (e.g. check quota).');
    quotaErr.status = 429;
    const classifiedQuota = classifyGeminiError(quotaErr);
    assert(classifiedQuota.type === 'QUOTA_EXHAUSTED', 'Classified as QUOTA_EXHAUSTED');
    assert(classifiedQuota.isRetryable === false, 'Quota exhaustion is NOT retryable');
    assert(classifiedQuota.userMessage.includes('quota exhausted'), 'Provides helpful user message');

    // 2. Invalid API Key
    const keyErr = new Error('API_KEY_INVALID: API key not valid. Please pass a valid API key.');
    keyErr.status = 400;
    const classifiedKey = classifyGeminiError(keyErr);
    assert(classifiedKey.type === 'INVALID_API_KEY', 'Classified as INVALID_API_KEY');
    assert(classifiedKey.isRetryable === false, 'Invalid API key is NOT retryable');

    // 3. Network Error
    const netErr = new Error('TypeError: fetch failed (ECONNRESET)');
    const classifiedNet = classifyGeminiError(netErr);
    assert(classifiedNet.type === 'NETWORK_ERROR', 'Classified as NETWORK_ERROR');
    assert(classifiedNet.isRetryable === true, 'Network error is retryable');

    // 4. Backoff Calculation with jitter
    const backoff0 = calculateBackoffMs(0, 1000);
    const backoff1 = calculateBackoffMs(1, 1000);
    assert(backoff0 >= 1000 && backoff0 <= 1500, `Backoff 0 within range: ${backoff0}ms`);
    assert(backoff1 >= 2000 && backoff1 <= 2500, `Backoff 1 within range: ${backoff1}ms`);
  });

  // TEST 8: Phase 1 Screenshot Sanitization regression verification
  await runTest('Phase 1 Regression: Screenshot stripped from model context and bounded text preserved', async () => {
    const rawResult = {
      success: true,
      action: 'inspect_page',
      url: 'https://example.com',
      title: 'Example Domain',
      content: 'A'.repeat(5000),
      screenshotBase64: 'data:image/jpeg;base64,' + 'B'.repeat(50000),
    };

    const sanitized = sanitizeToolResultForModel(rawResult);
    assert(sanitized.screenshotBase64 === undefined, 'No screenshotBase64 in model payload');
    assert(sanitized.screenshotCaptured === true, 'screenshotCaptured is true');
    assert(sanitized.content.length <= 2060, 'Content bounded to <= 2060 chars');
    assert(sanitized.content.includes('[content truncated for model context]'), 'Truncation notice present');
  });

  console.log(`\n======================================================================`);
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`======================================================================\n`);

  if (failed > 0) process.exit(1);
}

main();
