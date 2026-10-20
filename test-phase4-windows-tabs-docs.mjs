import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { BrowserService } from './dist-electron/browserService.js';
import { DesktopService } from './dist-electron/desktopService.js';
import { ToolDispatcher } from './dist-electron/toolRegistry.js';
import { TaskPlanner } from './dist-electron/taskPlanner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Allow local test hostnames
process.env.NEXUS_ALLOW_LOCAL_TEST = '1';
process.env.NODE_ENV = 'test';

let server;
let port = 0;
let baseUrl = '';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${message}`);
  } else {
    failedTests++;
    console.error(`  [FAIL] ${message}`);
  }
}

// ---------------------------------------------------------------------
// 1. Setup Local Mock HTTP Server with Multiple Web Destinations
// ---------------------------------------------------------------------
function startMockServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const url = req.url || '/';

      if (url === '/wikipedia') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>Wikipedia - Free Encyclopedia</title></head>
<body>
  <h1>Wikipedia Main Page</h1>
  <p>Welcome to Wikipedia, the free encyclopedia that anyone can edit.</p>
  <form id="wiki-search" action="/wikipedia/search" method="GET">
    <input id="searchInput" name="search" type="search" placeholder="Search Wikipedia" />
    <button type="submit">Search</button>
  </form>
</body>
</html>`);
      } else if (url === '/amazon') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>Amazon.com: Online Shopping</title></head>
<body>
  <h1>Amazon Online Store</h1>
  <p>Spend less. Smile more. Fast delivery.</p>
  <form id="nav-search-bar-form" action="/amazon/search" method="GET">
    <input id="twotabsearchtextbox" name="field-keywords" type="text" placeholder="Search Amazon" />
    <button type="submit">Go</button>
  </form>
</body>
</html>`);
      } else if (url === '/product-page') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>NEXUS Retail Store</title></head>
<body>
  <h1>Welcome to Store</h1>
  <form id="site-search" action="/search-results" method="GET">
    <input type="search" name="q" placeholder="Search products on this site" />
    <button type="submit">Find</button>
  </form>
</body>
</html>`);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`Mock server listening on ${baseUrl}`);
      resolve();
    });
  });
}

async function runAllTests() {
  console.log('======================================================================');
  console.log('  NEXUS PHASE 4 REGRESSION TEST SUITE');
  console.log('  Window, Tab, and Document Management Verification');
  console.log('======================================================================\n');

  await startMockServer();

  const testDownloadsDir = path.join(__dirname, 'test-downloads');
  const testScreenshotsDir = path.join(__dirname, 'test-screenshots');
  if (!fs.existsSync(testDownloadsDir)) fs.mkdirSync(testDownloadsDir, { recursive: true });
  if (!fs.existsSync(testScreenshotsDir)) fs.mkdirSync(testScreenshotsDir, { recursive: true });

  const browserService = new BrowserService(testDownloadsDir);
  const desktopService = new DesktopService(testScreenshotsDir);

  try {
    // -----------------------------------------------------------------
    // TEST 1: Notepad Document Management - Default creates new document / preserves original
    // -----------------------------------------------------------------
    console.log('--- TEST 1: Notepad document management preserves existing text by opening new document ---');
    {
      const planDefault = TaskPlanner.createPlan('Write a poem in Notepad');
      assert(planDefault.isNotepadTask === true, 'Task planner identifies "Write a poem in Notepad" as isNotepadTask');
      assert(planDefault.notepadMode === 'new_document', 'Task planner sets default notepadMode to "new_document" to preserve existing text');
      assert(planDefault.steps[0].targetApp === 'notepad', 'Step 1 targets app "notepad"');
      assert(planDefault.steps[0].targetDocument === 'New document', 'Step 1 specifies targetDocument "New document"');
      assert(planDefault.steps[1].targetWindow === 'Notepad', 'Step 2 explicitly confirms targetWindow "Notepad" before typing');

      // Test DesktopService manageNotepadDocument behavior when window already simulated
      // If we mock a running Notepad window with user text
      const originalDocTitle = 'MyImportantNotes.txt - Notepad';
      let listCalled = false;
      let launchCalled = false;
      const mockDesktop = new DesktopService(testScreenshotsDir);
      mockDesktop.listWindows = async () => {
        listCalled = true;
        return {
          success: true,
          data: [{ hwnd: '1001', title: originalDocTitle, processName: 'notepad.exe', isForeground: true }],
        };
      };
      mockDesktop.launchApp = async (app) => {
        launchCalled = true;
        return {
          success: true,
          data: { window: { hwnd: '1002', title: 'Untitled - Notepad', processName: 'notepad.exe', isForeground: true } },
        };
      };
      mockDesktop.activateWindow = async (hwnd) => ({ success: true, data: { hwnd, title: 'Untitled - Notepad' } });
      mockDesktop.getActiveWindow = async () => ({
        success: true,
        data: { hwnd: '1002', title: 'Untitled - Notepad', processName: 'notepad.exe', isForeground: true },
      });
      mockDesktop.typeText = async (text, target) => ({ success: true, data: { typed: text } });

      const res = await mockDesktop.manageNotepadDocument({ text: 'Roses are red\nViolets are blue', mode: 'new_document' });
      assert(res.success === true, 'manageNotepadDocument succeeds for new_document mode');
      assert(res.isNewDocument === true, 'manageNotepadDocument indicates new distinct document was created');
      assert(launchCalled === true, 'manageNotepadDocument launches a separate document rather than typing into existing doc');
      assert(res.window.hwnd === '1002', 'Target window is the newly created document window (1002), leaving 1001 intact');
    }

    // -----------------------------------------------------------------
    // TEST 2: Notepad Document Management - Explicit "continue in the current document"
    // -----------------------------------------------------------------
    console.log('\n--- TEST 2: Explicit "continue in current document" appends without creating new window ---');
    {
      const planContinue = TaskPlanner.createPlan('Write a note in Notepad and continue in the current document');
      assert(planContinue.isNotepadTask === true, 'Task planner recognizes prompt as isNotepadTask');
      assert(planContinue.notepadMode === 'continue_current', 'Task planner recognizes explicit continue_current mode');
      assert(planContinue.steps[0].targetDocument === 'Current document', 'Step specifies targetDocument "Current document"');

      let launchCalled = false;
      let keysPressed = [];
      const mockDesktop = new DesktopService(testScreenshotsDir);
      mockDesktop.listWindows = async () => ({
        success: true,
        data: [{ hwnd: '2001', title: 'ExistingDraft.txt - Notepad', processName: 'notepad.exe', isForeground: true }],
      });
      mockDesktop.launchApp = async () => { launchCalled = true; return { success: true }; };
      mockDesktop.activateWindow = async () => ({ success: true });
      mockDesktop.getActiveWindow = async () => ({
        success: true,
        data: { hwnd: '2001', title: 'ExistingDraft.txt - Notepad', processName: 'notepad.exe', isForeground: true },
      });
      mockDesktop.pressKey = async (key) => { keysPressed.push(key); return { success: true }; };
      mockDesktop.typeText = async (text) => ({ success: true, data: { typed: text } });

      const res = await mockDesktop.manageNotepadDocument({
        text: 'Continuing the poem here...',
        mode: 'continue_current',
      });
      assert(res.success === true, 'manageNotepadDocument succeeds for continue_current');
      assert(res.isNewDocument === false, 'manageNotepadDocument confirms existing document was reused (not new)');
      assert(launchCalled === false, 'No new application instance was launched');
      assert(keysPressed.includes('CTRL+END') && keysPressed.includes('ENTER'), 'Cursor was moved to document end (CTRL+END, ENTER) before typing to protect existing text');
      assert(res.window.hwnd === '2001', 'Target window matches the existing document hwnd (2001)');
    }

    // -----------------------------------------------------------------
    // TEST 3: Browser Tab Management - Open multiple URLs in separate tabs
    // -----------------------------------------------------------------
    console.log('\n--- TEST 3: Open Wikipedia and Amazon in separate tabs ---');
    {
      const planMulti = TaskPlanner.createPlan('Open Wikipedia and Amazon in separate tabs');
      assert(planMulti.isMultiTabTask === true, 'Task planner identifies "Open Wikipedia and Amazon in separate tabs" as isMultiTabTask');
      assert(planMulti.steps.length >= 3, 'Plan generates ordered steps for each distinct tab and verification');
      assert(planMulti.steps[0].targetTabId === 'tab-1', 'Step 1 targets tab-1');
      assert(planMulti.steps[1].targetTabId === 'tab-2', 'Step 2 targets tab-2');

      const url1 = `${baseUrl}/wikipedia`;
      const url2 = `${baseUrl}/amazon`;

      const multiRes = await browserService.openMultipleUrlsInTabs([url1, url2]);
      assert(multiRes.success === true, `openMultipleUrlsInTabs succeeded: ${multiRes.content}`);
      assert(multiRes.tabs && multiRes.tabs.length === 2, 'openMultipleUrlsInTabs returned exactly 2 tabs');
      assert(multiRes.tabs[0].url.includes('/wikipedia'), `Tab 1 URL is Wikipedia (${multiRes.tabs[0].url})`);
      assert(multiRes.tabs[1].url.includes('/amazon'), `Tab 2 URL is Amazon (${multiRes.tabs[1].url})`);
      assert(multiRes.tabs[0].id !== multiRes.tabs[1].id, `Tab IDs are distinct (${multiRes.tabs[0].id} vs ${multiRes.tabs[1].id})`);

      // Verify listBrowserTabs reports both
      const tabList = await browserService.listBrowserTabs();
      assert(tabList.success === true, 'listBrowserTabs succeeded');
      assert(tabList.totalTabs >= 2, `Total tabs listed: ${tabList.totalTabs}`);
    }

    // -----------------------------------------------------------------
    // TEST 4: Browser Tab Management - Open a new tab without modifying existing tab
    // -----------------------------------------------------------------
    console.log('\n--- TEST 4: Open a new tab without modifying URL of existing tab ---');
    {
      const initialTabList = await browserService.listBrowserTabs();
      const firstTabBefore = initialTabList.tabs[0];
      const initialUrl = firstTabBefore.url;

      // Create new tab with product page
      const productUrl = `${baseUrl}/product-page`;
      const newTabRes = await browserService.createBrowserTab(productUrl);
      assert(newTabRes.success === true, `createBrowserTab succeeded: ${newTabRes.content}`);
      assert(newTabRes.tabId !== undefined, `New tab assigned stable identifier: ${newTabRes.tabId}`);

      // Verify the new tab list
      const postTabList = await browserService.listBrowserTabs();
      assert(postTabList.totalTabs === initialTabList.totalTabs + 1, `Total tabs increased from ${initialTabList.totalTabs} to ${postTabList.totalTabs}`);

      // Crucial: check that the first tab STILL has its original URL unchanged
      const firstTabAfter = postTabList.tabs.find((t) => t.id === firstTabBefore.id);
      assert(firstTabAfter !== undefined, 'Original tab still exists');
      assert(firstTabAfter.url === initialUrl, `Original tab URL remained completely intact: ${firstTabAfter.url}`);
    }

    // -----------------------------------------------------------------
    // TEST 5: Browser Tab Management - Tab switching activates intended tab before actions
    // -----------------------------------------------------------------
    console.log('\n--- TEST 5: Tab switching activates intended tab before tab-specific actions ---');
    {
      const allTabs = await browserService.listBrowserTabs();
      const wikiTab = allTabs.tabs.find((t) => t.url.includes('/wikipedia'));
      const amazonTab = allTabs.tabs.find((t) => t.url.includes('/amazon'));
      assert(wikiTab && amazonTab, 'Both Wikipedia and Amazon tabs identified');

      // Switch to Wikipedia tab
      const activateWiki = await browserService.activateBrowserTab(wikiTab.id);
      assert(activateWiki.success === true, `Activated Wikipedia tab: ${activateWiki.content}`);
      const wikiStatus = await browserService.getStatus();
      assert(wikiStatus.url.includes('/wikipedia'), `Active browser URL is Wikipedia (${wikiStatus.url})`);
      const wikiText = await browserService.readVisibleText();
      assert(wikiText.content.includes('free encyclopedia'), 'Reading visible text reads from Wikipedia tab');

      // Switch to Amazon tab
      const activateAmazon = await browserService.activateBrowserTab(amazonTab.id);
      assert(activateAmazon.success === true, `Activated Amazon tab: ${activateAmazon.content}`);
      const amazonStatus = await browserService.getStatus();
      assert(amazonStatus.url.includes('/amazon'), `Active browser URL is Amazon (${amazonStatus.url})`);
      const amazonText = await browserService.readVisibleText();
      assert(amazonText.content.includes('Smile more'), 'Reading visible text reads from Amazon tab');
    }

    // -----------------------------------------------------------------
    // TEST 6: Ambiguous Targets Detection - Asks user rather than guessing
    // -----------------------------------------------------------------
    console.log('\n--- TEST 6: When multiple targets exist and ambiguous, system asks user ---');
    {
      const mockDesktop = new DesktopService(testScreenshotsDir);
      // Simulate multiple open Notepad windows with different titles
      mockDesktop.listWindows = async () => ({
        success: true,
        data: [
          { hwnd: '3001', title: 'Chapter1.txt - Notepad', processName: 'notepad.exe', isForeground: false },
          { hwnd: '3002', title: 'Chapter2.txt - Notepad', processName: 'notepad.exe', isForeground: true },
        ],
      });
      mockDesktop.getActiveWindow = async () => ({
        success: true,
        data: { hwnd: '3002', title: 'Chapter2.txt - Notepad', processName: 'notepad.exe', isForeground: true },
      });

      // User says "continue in the current document", but multiple exist and user didn't specify which one
      const ambigRes = await mockDesktop.manageNotepadDocument({
        text: 'Next paragraph...',
        mode: 'continue_current',
      });

      assert(ambigRes.success === false, 'manageNotepadDocument rejects ambiguous target rather than guessing');
      assert(ambigRes.error.includes('Multiple Notepad documents are open'), `Returns clear error: "${ambigRes.error}"`);
      assert(Array.isArray(ambigRes.ambiguousWindows) && ambigRes.ambiguousWindows.length === 2, 'Lists the ambiguous documents so user can be asked for clarification');
      assert(ambigRes.ambiguousWindows.includes('Chapter1.txt - Notepad') && ambigRes.ambiguousWindows.includes('Chapter2.txt - Notepad'), 'Ambiguous list contains all open candidate document titles');

      // But if a title filter IS provided, it resolves deterministically without ambiguity
      let targetActivated = '';
      mockDesktop.activateWindow = async (hwnd) => { targetActivated = hwnd; return { success: true }; };
      mockDesktop.pressKey = async () => ({ success: true });
      mockDesktop.typeText = async (text) => ({ success: true, data: { typed: text } });

      const resolvedRes = await mockDesktop.manageNotepadDocument({
        text: 'Resolved text',
        mode: 'continue_current',
        titleFilter: 'Chapter1',
      });
      assert(resolvedRes.success === true, 'manageNotepadDocument resolves cleanly when titleFilter is provided');
      assert(targetActivated === '3001', 'Activated the exact matched document hwnd (3001 for Chapter1)');
    }

    // -----------------------------------------------------------------
    // TEST 7: Truthful Reporting on Navigation Failure - Step & Task status marked FAILED
    // -----------------------------------------------------------------
    console.log('\n--- TEST 7: Navigation failure reports step and task as FAILED with factual reason ---');
    {
      const invalidUrl = 'http://invalid-nonexistent-domain-xyz-12345.test';
      const navRes = await browserService.navigateCurrentTab(invalidUrl);
      assert(navRes.success === false, 'navigateCurrentTab reports failure for invalid unreachable domain');
      assert(navRes.error !== undefined && navRes.error.length > 0, `Error reported factually: "${navRes.error}"`);

      // Verify TaskPlanner step & task status transitions
      const state = TaskPlanner.createExecutionState('Open invalid site and read data');
      assert(state.taskPlan.steps[0].status === 'PENDING', 'Initial step status is PENDING');

      // Record the failed action in TaskPlanner
      TaskPlanner.recordStep(state.taskPlan, 'navigate_current_tab', navRes);
      assert(state.taskPlan.steps[0].status === 'FAILED', 'Step status correctly transitioned to FAILED');
      assert(state.taskPlan.steps[0].verifiedDetail.includes('Failed:'), `Step verifiedDetail captures factual failure: "${state.taskPlan.steps[0].verifiedDetail}"`);
      assert(state.taskPlan.requirements[0].status === 'FAILED', 'Task requirement status transitioned to FAILED');

      // Add failed action to action history
      state.actionHistory.push({
        id: 'act-fail-1',
        toolName: 'navigate_current_tab',
        fingerprint: 'navigate_current_tab::fail',
        args: { url: invalidUrl },
        success: false,
        durationMs: 50,
        timestamp: Date.now(),
        error: navRes.error,
      });

      // Verify honest task completion verification
      const verifyOutcome = TaskPlanner.verifyTaskCompletion(state);
      assert(verifyOutcome.verified === false, 'Task completion verification is FALSE (never falsely marks verified)');
      assert(verifyOutcome.verdict === 'FAILED', `Task verdict is FAILED: ${verifyOutcome.reason}`);

      // Verify formatted response includes failure breakdown
      const formatted = TaskPlanner.validateAndFormatResponse(state, 'I opened the site successfully.');
      assert(formatted.failedCount > 0, `Formatted response reports failedCount > 0 (${formatted.failedCount})`);
      assert(formatted.finalAnswer.includes('[FAILED]'), 'Final answer explicitly includes [FAILED] marker rather than claiming success');
    }

    // -----------------------------------------------------------------
    // BONUS TEST 8: In-page search vs external search
    // -----------------------------------------------------------------
    console.log('\n--- TEST 8: In-page search stays on current website without external redirection ---');
    {
      const planInPage = TaskPlanner.createPlan('Search for shoes on the current website');
      assert(planInPage.isInPageSearchTask === true, 'Task planner identifies "Search for shoes on the current website" as isInPageSearchTask');
      assert(planInPage.searchQuery === 'shoes', `Task planner extracts search query "shoes" (${planInPage.searchQuery})`);
      assert(planInPage.steps[0].description.includes('current website'), 'Step specifies searching current website');

      // Test tool registry routing: web_search on active page routes to search_current_site
      let searchCurrentSiteCalled = false;
      const dummyCtx = {
        browserService: {
          getStatus: async () => ({ isOpen: true, url: `${baseUrl}/product-page`, title: 'Store' }),
          inPageSearch: async (q) => { searchCurrentSiteCalled = true; return { success: true, action: 'in_page_search', content: `Found ${q}` }; },
        },
        taskPlan: planInPage,
        onEmitEvent: () => {},
      };

      const dispatchRes = await ToolDispatcher.dispatch('web_search', { query: 'shoes' }, dummyCtx);
      assert(dispatchRes.success === true, 'ToolDispatcher dispatched search successfully');
      assert(searchCurrentSiteCalled === true, 'web_search safely routed to search_current_site to avoid leaving current website');
    }

    console.log('\n======================================================================');
    console.log(`  PHASE 4 REGRESSION TESTS SUMMARY:`);
    console.log(`  Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
    console.log('======================================================================');

    if (failedTests > 0) {
      console.error(`\n>>> TEST RUN FAILED with ${failedTests} assertion failures! <<<`);
      process.exit(1);
    } else {
      console.log(`\n>>> ALL ${passedTests} PHASE 4 TESTS PASSED ACCURATELY! <<<`);
    }
  } finally {
    await browserService.close().catch(() => {});
    if (server) {
      server.close();
    }
  }
}

runAllTests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
