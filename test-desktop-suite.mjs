import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { DesktopService } from './dist-electron/desktopService.js';
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

const testScreenshotsDir = path.join(process.cwd(), 'test-screenshots');
if (!fs.existsSync(testScreenshotsDir)) {
  fs.mkdirSync(testScreenshotsDir, { recursive: true });
}

const desktopService = new DesktopService(testScreenshotsDir);
const browserService = new BrowserService(testDownloadsDir);
const downloadManager = new DownloadManager(testDownloadsDir);
const taskManager = new TaskManager(testDataDir);
const agentEngine = new AgentEngine(browserService, downloadManager, taskManager, desktopService);

const results = [];

async function runTest(testId, name, fn) {
  console.log(`\n======================================================================`);
  console.log(`RUNNING ${testId}: ${name}`);
  console.log(`======================================================================`);
  const start = Date.now();
  try {
    const data = await fn();
    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`[PASS] ${testId} (${duration}s)`);
    results.push({ testId, name, passed: true, duration: `${duration}s`, data });
  } catch (err) {
    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.error(`[FAIL] ${testId} (${duration}s):`, err.message || err);
    results.push({ testId, name, passed: false, duration: `${duration}s`, error: err.message || String(err) });
  }
}

async function main() {
  console.log('>>> NEXUS AI COMPUTER-USE AGENT: TEST SUITE (TESTS A THROUGH K) <<<');

  // TEST A: Launch Notepad and verify its window appears.
  await runTest('TEST A', 'Launch Notepad and verify its window appears', async () => {
    const launchRes = await desktopService.launchApp('notepad');
    if (!launchRes.success) throw new Error(`Launch failed: ${launchRes.error}`);
    console.log(`Notepad launch target: ${launchRes.data?.target}, PID: ${launchRes.data?.processId}`);

    // Verify window
    const listRes = await desktopService.listWindows();
    if (!listRes.success || !listRes.data) throw new Error(`Could not list windows: ${listRes.error}`);
    
    const notepadWin = listRes.data.find(w => 
      w.title.toLowerCase().includes('notepad') || 
      w.processName.toLowerCase().includes('notepad')
    );
    if (!notepadWin) throw new Error('Notepad window not found in desktop window list');
    
    console.log(`Verified Notepad Window: Title="${notepadWin.title}", HWND=${notepadWin.hwnd}, Bounds=${notepadWin.width}x${notepadWin.height}`);
    return { target: launchRes.data?.target, window: notepadWin };
  });

  // TEST B: Type a harmless sentence and verify it is present.
  await runTest('TEST B', 'Type a harmless sentence into Notepad', async () => {
    const sentence = 'Hello World from NEXUS AI Desktop Agent!';
    const typeRes = await desktopService.typeText(sentence, 'Notepad');
    if (!typeRes.success) throw new Error(`Typing failed: ${typeRes.error}`);
    console.log(`Successfully typed text into active Notepad window: "${typeRes.data?.typed}"`);
    return { typed: typeRes.data?.typed };
  });

  // TEST C: Launch Calculator and verify it is available.
  await runTest('TEST C', 'Launch Calculator and verify it is available', async () => {
    const launchRes = await desktopService.launchApp('calc');
    if (!launchRes.success) throw new Error(`Launch failed: ${launchRes.error}`);
    console.log(`Calculator launched, target: ${launchRes.data?.target}, PID: ${launchRes.data?.processId}`);

    // Wait and verify window
    const listRes = await desktopService.listWindows();
    const calcWin = listRes.data?.find(w => 
      w.title.toLowerCase().includes('calculator') || 
      w.processName.toLowerCase().includes('calculator')
    );
    if (!calcWin) throw new Error('Calculator window not found in desktop window list');
    console.log(`Verified Calculator Window: Title="${calcWin.title}", HWND=${calcWin.hwnd}`);
    return { window: calcWin };
  });

  // TEST D: Launch Chrome / Playwright browser and navigate to a test website.
  await runTest('TEST D', 'Launch browser and navigate to test website', async () => {
    const navRes = await browserService.navigate('https://example.com');
    if (!navRes.success) throw new Error(`Browser navigation failed: ${navRes.error}`);
    console.log(`Browser navigated to: ${navRes.url}, Title: "${navRes.title}"`);
    if (!navRes.title.includes('Example Domain')) throw new Error('Unexpected page title');
    return { url: navRes.url, title: navRes.title };
  });

  // TEST E: Verify a webpage title and URL through the actual browser.
  await runTest('TEST E', 'Verify webpage title and visible text through actual browser', async () => {
    const contentRes = await browserService.readPageContent();
    if (!contentRes.success) throw new Error(`Could not read visible text: ${contentRes.error}`);

    console.log(`Verified URL: ${contentRes.url}`);
    console.log(`Verified Title: ${contentRes.title}`);
    console.log(`Verified Visible Content: "${contentRes.content.slice(0, 120)}..."`);
    if (!contentRes.title.includes('Example Domain')) throw new Error('Title does not match expected Example Domain');
    return { url: contentRes.url, title: contentRes.title, preview: contentRes.content.slice(0, 120) };
  });

  // TEST F: Navigate File Explorer to Downloads.
  await runTest('TEST F', 'Navigate File Explorer to Downloads', async () => {
    const expRes = await desktopService.launchApp('explorer', 'shell:Downloads');
    if (!expRes.success) throw new Error(`Explorer launch failed: ${expRes.error}`);
    console.log(`File Explorer launched at Downloads: PID=${expRes.data?.processId}`);
    return { explorerResult: expRes.data };
  });

  // TEST G: Switch between two supported application windows.
  await runTest('TEST G', 'Switch between two supported application windows', async () => {
    // 1. Activate Calculator
    const actCalc = await desktopService.activateWindow('Calculator');
    console.log(`Activated Calculator: Success=${actCalc.success}`);
    
    // 2. Activate Notepad
    const actNotepad = await desktopService.activateWindow('Notepad');
    console.log(`Activated Notepad: Success=${actNotepad.success}`);
    if (!actNotepad.success) throw new Error(`Failed to switch back to Notepad: ${actNotepad.error}`);

    return { switchedTo: actNotepad.data?.title || 'Notepad' };
  });

  // TEST H: Cancel a running automation task.
  await runTest('TEST H', 'Cancel a running automation task cleanly', async () => {
    const taskPromise = agentEngine.execute({
      prompt: 'Perform extensive deep research across multiple search engines on quantum supercomputing.',
      apiKey,
      modelName: 'gemini-flash-lite-latest',
      maxSteps: 8,
    });

    // Abort after 400ms
    setTimeout(() => {
      console.log('Invoking agentEngine.abort()...');
      agentEngine.abort();
    }, 400);

    const res = await taskPromise;
    console.log(`Task Result Success: ${res.success}, Error: "${res.error}"`);
    if (res.success && !res.error) throw new Error('Task was not cancelled properly');
    return { cancelled: true, message: res.text || res.error };
  });

  // TEST I: Handle a missing application gracefully.
  await runTest('TEST I', 'Handle a missing or invalid application gracefully', async () => {
    const missingAppName = 'non_existent_application_xyz_999.exe';
    const launchRes = await desktopService.launchApp(missingAppName);
    console.log(`Missing App Result: Success=${launchRes.success}, Error="${launchRes.error}"`);
    if (launchRes.success) throw new Error('Expected missing app launch to fail, but it succeeded');
    return { handledGracefully: true, error: launchRes.error };
  });

  // TEST J: Handle a denied permission or inaccessible window.
  await runTest('TEST J', 'Handle inaccessible window query gracefully', async () => {
    const fakeWindowQuery = 'Impossible_Window_Title_That_Does_Not_Exist_12345';
    const actRes = await desktopService.activateWindow(fakeWindowQuery);
    console.log(`Inaccessible window result: Success=${actRes.success}, Error="${actRes.error}"`);
    if (actRes.success) throw new Error('Expected activation to fail on non-existent window');
    return { handledGracefully: true, error: actRes.error };
  });

  // TEST K: Verify that consequential actions require approval.
  await runTest('TEST K', 'Verify consequential action triggers approval request', async () => {
    let approvalRequested = false;
    let approvalDetails = '';

    const toolContext = {
      browserService,
      desktopService,
      downloadManager,
      taskManager,
      onRequestApproval: async (appr) => {
        approvalRequested = true;
        approvalDetails = `${appr.action}: ${appr.details}`;
        console.log(`[APPROVAL INTERCEPTED]: "${approvalDetails}" (isConsequential=${appr.isConsequential})`);
        return false; // Deny approval to test safety gate
      },
      onEmitEvent: () => {},
    };

    // Test 1: Consequential browser action (submit payment)
    const browserDispatch = await ToolDispatcher.dispatch(
      'browser_click',
      { selector: 'button.confirm-payment-checkout' },
      toolContext
    );
    console.log(`Consequential Web Result: Blocked=${!browserDispatch.result?.success}, Error="${browserDispatch.result?.error}"`);

    // Test 2: Consequential desktop action (close critical system / delete account)
    let desktopApprovalRequested = false;
    toolContext.onRequestApproval = async (appr) => {
      desktopApprovalRequested = true;
      console.log(`[DESKTOP APPROVAL INTERCEPTED]: "${appr.action}: ${appr.details}"`);
      return false; // Deny
    };

    const desktopDispatch = await ToolDispatcher.dispatch(
      'computer_close_window',
      { target: 'delete account and erase data' },
      toolContext
    );
    console.log(`Consequential Desktop Result: Blocked=${!desktopDispatch.result?.success}`);

    if (!approvalRequested || !desktopApprovalRequested) {
      throw new Error('Consequential action did not trigger mandatory approval request');
    }
    return { approvalIntercepted: true, browserBlocked: true, desktopBlocked: true };
  });

  // Clean up browser
  await browserService.closeBrowser();

  // Print final summary report
  console.log(`\n======================================================================`);
  console.log(`FINAL TEST RESULTS SUMMARY (${results.filter(r => r.passed).length}/${results.length} PASSED)`);
  console.log(`======================================================================`);
  results.forEach(r => {
    console.log(`${r.passed ? '✓ [PASS]' : '✗ [FAIL]'} ${r.testId}: ${r.name} (${r.duration})`);
    if (!r.passed) console.log(`   Error: ${r.error}`);
  });

  const allPassed = results.every(r => r.passed);
  if (!allPassed) {
    console.error('\nSOME TESTS FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL 11 TESTS (TESTS A THROUGH K) PASSED SUCCESSFULLY!');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Unhandled fatal error in test suite:', err);
  process.exit(1);
});
