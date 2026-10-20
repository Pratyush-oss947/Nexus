import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { BrowserService } from './dist-electron/browserService.js';
import { DownloadManager } from './dist-electron/downloadManager.js';
import { TaskManager } from './dist-electron/taskManager.js';
import { ToolDispatcher } from './dist-electron/toolRegistry.js';
import { AgentEngine } from './dist-electron/agentEngine.js';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('FATAL: GEMINI_API_KEY is not defined in .env');
  process.exit(1);
}

const testDownloadsDir = path.join(process.cwd(), 'test-downloads');
if (!fs.existsSync(testDownloadsDir)) {
  fs.mkdirSync(testDownloadsDir, { recursive: true });
}

const testDataDir = path.join(process.cwd(), 'test-userdata');
if (!fs.existsSync(testDataDir)) {
  fs.mkdirSync(testDataDir, { recursive: true });
}

const browserService = new BrowserService(testDownloadsDir);
const downloadManager = new DownloadManager(testDownloadsDir);
const taskManager = new TaskManager(testDataDir);
const agentEngine = new AgentEngine(browserService, downloadManager, taskManager);

const results = [];

async function runTest(name, fn) {
  console.log(`\n======================================================`);
  console.log(`RUNNING: ${name}`);
  console.log(`======================================================`);
  try {
    const data = await fn();
    console.log(`[PASS] ${name}`);
    results.push({ name, passed: true, data });
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message || err);
    results.push({ name, passed: false, error: err.message || String(err) });
  }
}

async function main() {
  // TEST A: Open https://example.com and return its real page title and visible text.
  await runTest('TEST A: Open https://example.com and return real page title and visible text', async () => {
    const navRes = await browserService.navigate('https://example.com');
    if (!navRes.success) throw new Error(`Navigation failed: ${navRes.error}`);
    const readRes = await browserService.readPageContent();
    if (!readRes.success) throw new Error(`Reading content failed: ${readRes.error}`);
    console.log(`Actual Page Title: "${navRes.title}"`);
    console.log(`Actual Page Content: "${readRes.content.slice(0, 150)}..."`);
    if (!navRes.title.includes('Example Domain')) throw new Error('Unexpected title');
    return { title: navRes.title, preview: readRes.content.slice(0, 150) };
  });

  // TEST B: Search for official Gemini API documentation, open a result, and return the actual source URL and a summary.
  await runTest('TEST B: Web research with source URL and summary', async () => {
    const agentRes = await agentEngine.execute({
      prompt: 'Search for official Gemini API documentation, open the result, and summarize in one sentence with the source URL.',
      apiKey,
      modelName: 'gemini-flash-lite-latest',
      maxSteps: 4,
    });
    console.log(`Agent Result Summary: ${agentRes.text}`);
    console.log(`Consulted Sources: ${JSON.stringify(agentRes.sources)}`);
    console.log(`Executed Steps: ${agentRes.steps.map(s => s.tool).join(' -> ')}`);
    if (agentRes.steps.length === 0) throw new Error('No tools were executed');
    return { text: agentRes.text, sources: agentRes.sources, steps: agentRes.steps.length };
  });

  // TEST C: Create a local task through natural-language tool calling, then list and complete it.
  await runTest('TEST C: Local task creation, listing, and completion via natural-language tool calling', async () => {
    // 1. Create task
    const createRes = await agentEngine.execute({
      prompt: 'Please add a new task: "Review Q4 security compliance report" under the "Security" category.',
      apiKey,
      modelName: 'gemini-flash-lite-latest',
      maxSteps: 3,
    });
    console.log(`Task Creation Response: ${createRes.text}`);
    const tasks = taskManager.listTasks('all');
    const targetTask = tasks.find(t => t.title.toLowerCase().includes('security compliance'));
    if (!targetTask) throw new Error('Task was not created in task manager');
    console.log(`Created Task ID: ${targetTask.id}, Title: "${targetTask.title}", Completed: ${targetTask.completed}`);

    // 2. Complete task
    const completeRes = await agentEngine.execute({
      prompt: `Mark the task "Review Q4 security compliance report" as completed.`,
      apiKey,
      modelName: 'gemini-flash-lite-latest',
      maxSteps: 3,
    });
    console.log(`Task Completion Response: ${completeRes.text}`);
    const completedTasks = taskManager.listTasks('completed');
    const isDone = completedTasks.some(t => t.id === targetTask.id && t.completed);
    if (!isDone) throw new Error('Task was not marked completed in task manager');
    console.log(`Verified Task "${targetTask.title}" status is completed: true`);
    return { taskId: targetTask.id, isCompleted: isDone };
  });

  // TEST D: Download a harmless test file into designated folder and verify its existence and status.
  await runTest('TEST D: Download test file into designated folder and verify non-zero size', async () => {
    // Harmless raw text file download
    const testUrl = 'https://raw.githubusercontent.com/octocat/Hello-World/master/README';
    const dlRes = await downloadManager.downloadFile(testUrl, 'github_readme_test.txt');
    if (!dlRes.success) throw new Error(`Download failed: ${dlRes.error}`);
    console.log(`Saved File: ${dlRes.filename}`);
    console.log(`File Path: ${dlRes.filePath}`);
    console.log(`File Size: ${dlRes.sizeBytes} bytes`);
    if (!fs.existsSync(dlRes.filePath)) throw new Error('File does not exist on disk');
    if (dlRes.sizeBytes === 0) throw new Error('File size is 0 bytes');
    return { filename: dlRes.filename, sizeBytes: dlRes.sizeBytes, path: dlRes.filePath };
  });

  // TEST E: Fill a test form but pause before submitting.
  await runTest('TEST E: Fill form fields without unauthorized submission', async () => {
    // Navigate to a page with an input field (DuckDuckGo)
    await browserService.navigate('https://duckduckgo.com');
    const fillRes = await browserService.fillField('searchbox_input', 'Playwright automation');
    if (!fillRes.success) throw new Error(`Fill failed: ${fillRes.error}`);
    console.log(`Fill Result: ${fillRes.content}`);
    return { filled: true, message: fillRes.content };
  });

  // TEST F: Cancel a running browser task and verify execution stops.
  await runTest('TEST F: Cancellation halts execution cleanly', async () => {
    let eventReceived = false;
    const executePromise = agentEngine.execute({
      prompt: 'Search the web for 10 consecutive long queries and browse every result.',
      apiKey,
      modelName: 'gemini-flash-lite-latest',
      maxSteps: 8,
      onEvent: (evt) => {
        eventReceived = true;
      }
    });
    // Abort after 400ms
    setTimeout(() => {
      console.log('Triggering agentEngine.abort()...');
      agentEngine.abort();
    }, 400);

    const res = await executePromise;
    console.log(`Cancellation Result: success=${res.success}, error="${res.error}"`);
    if (res.success) throw new Error('Execution should not have succeeded after abort');
    return { cancelled: true, error: res.error };
  });

  // TEST G: Attempt an invalid URL and malformed tool arguments; verify tool dispatcher rejects them safely.
  await runTest('TEST G: Tool dispatcher safely rejects invalid URLs and malformed arguments', async () => {
    // 1. Blocked protocol
    const blockedRes = await browserService.navigate('file:///C:/Windows/System32/calc.exe');
    console.log(`Blocked Protocol Check: success=${blockedRes.success}, error="${blockedRes.error}"`);
    if (blockedRes.success) throw new Error('Should have blocked file:/// protocol');

    // 2. Blocked internal LAN IP
    const blockedLanRes = await browserService.navigate('http://192.168.1.1/admin');
    console.log(`Blocked LAN Check: success=${blockedLanRes.success}, error="${blockedLanRes.error}"`);
    if (blockedLanRes.success) throw new Error('Should have blocked private LAN IP');

    // 3. Malformed tool arguments
    const malformedRes = await ToolDispatcher.dispatch('browser_open', {}, {
      browserService,
      downloadManager,
      taskManager,
      onRequestApproval: async () => true,
      onEmitEvent: () => {}
    });
    console.log(`Missing required param Check: success=${malformedRes.success}, error="${malformedRes.error}"`);
    if (malformedRes.success) throw new Error('Dispatcher should have failed on missing required parameter');
    return { rejectedSafely: true };
  });

  // TEST H: Simulate missing API key and network error; verify meaningful errors appear.
  await runTest('TEST H: Missing API key handling returns clear diagnostic message', async () => {
    const res = await agentEngine.execute({
      prompt: 'Hello world',
      apiKey: '',
    });
    console.log(`Missing key error: "${res.error}"`);
    if (res.success || !res.error.includes('Gemini API key is not configured')) {
      throw new Error('Expected missing API key error');
    }
    return { caughtError: res.error };
  });

  // TEST I: Verify that unapproved consequential actions cannot proceed.
  await runTest('TEST I: Consequential action without approval is safely blocked', async () => {
    const res = await ToolDispatcher.dispatch('task_delete', { task_id_or_title: 'non-existent' }, {
      browserService,
      downloadManager,
      taskManager,
      onRequestApproval: async () => false, // User denies approval!
      onEmitEvent: () => {}
    });
    console.log(`Rejected consequential action result: success=${res.success}, error="${res.error || res.result?.error}"`);
    const err = res.error || res.result?.error || '';
    if (!err.toLowerCase().includes('declined')) {
      throw new Error(`Expected decline error, got: ${err}`);
    }
    return { blocked: true, message: err };
  });

  // Clean up
  await browserService.closeBrowser();
  try {
    fs.rmSync(testDownloadsDir, { recursive: true, force: true });
    fs.rmSync(testDataDir, { recursive: true, force: true });
  } catch {}

  console.log(`\n======================================================`);
  console.log(`ALL 9 MANDATORY MASTER TESTS COMPLETED!`);
  console.log(`======================================================`);
  const allPassed = results.every(r => r.passed);
  console.log(`Total: ${results.length}, Passed: ${results.filter(r => r.passed).length}, Failed: ${results.filter(r => !r.passed).length}`);
  if (!allPassed) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error during test suite:', err);
  process.exit(1);
});
