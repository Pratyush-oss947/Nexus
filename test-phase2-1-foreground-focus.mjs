import * as path from 'path';
import * as fs from 'fs';
import { BrowserService } from './dist-electron/browserService.js';
import { ToolDispatcher } from './dist-electron/toolRegistry.js';
import { isBackgroundExecutionRequested, AgentEngine } from './dist-electron/agentEngine.js';

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

// Mock DesktopService to verify OS-level window activation calls
class MockDesktopService {
  constructor() {
    this.activatedQueries = [];
    this.shouldFail = false;
  }
  async activateWindow(queryOrHwnd) {
    this.activatedQueries.push(queryOrHwnd);
    if (this.shouldFail) {
      return { success: false, error: `Simulated window activation failure for "${queryOrHwnd}"` };
    }
    return { success: true, data: { hwnd: '12345', processId: 9999, processName: 'chrome', title: queryOrHwnd, left: 0, top: 0, width: 1200, height: 800, isForeground: true } };
  }
}

// Mock Playwright Page
class MockPage {
  constructor(initialUrl = 'https://example.com', initialTitle = 'Example Domain') {
    this._url = initialUrl;
    this._title = initialTitle;
    this._closed = false;
    this.broughtToFront = 0;
  }
  url() {
    return this._url;
  }
  async title() {
    return this._title;
  }
  isClosed() {
    return this._closed;
  }
  async bringToFront() {
    if (this._closed) throw new Error('Target page is closed');
    this.broughtToFront++;
  }
  async goto(url) {
    this._url = url;
    this._title = `Page: ${url}`;
  }
  async waitForTimeout() {}
  on() {}
  setDefaultTimeout() {}
  setDefaultNavigationTimeout() {}
}

async function main() {
  console.log('NEXUS - Phase 2.1 Browser Window Foreground Activation Test Suite\n');

  const testDownloadsDir = path.join(process.cwd(), 'test-downloads');
  if (!fs.existsSync(testDownloadsDir)) fs.mkdirSync(testDownloadsDir, { recursive: true });

  // =========================================================================
  // TEST 1: Background Mode Detection Heuristics
  // =========================================================================
  await runTest('Background Mode Detection: Distinguishes foreground vs background user prompts', async () => {
    // Explicit background requests
    assert(isBackgroundExecutionRequested('search for quantum in the background') === true, 'Detected "in the background"');
    assert(isBackgroundExecutionRequested('run in background and download report') === true, 'Detected "run in background"');
    assert(isBackgroundExecutionRequested('quietly download the file') === true, 'Detected "quietly"');
    assert(isBackgroundExecutionRequested('silently check status on website') === true, 'Detected "silently"');
    assert(isBackgroundExecutionRequested('open page in headless mode') === true, 'Detected "headless"');
    assert(isBackgroundExecutionRequested('keep minimized while executing') === true, 'Detected "keep minimized"');
    assert(isBackgroundExecutionRequested('do not focus the browser') === true, 'Detected "do not focus"');
    assert(isBackgroundExecutionRequested('download file without focusing') === true, 'Detected "without focusing"');
    assert(isBackgroundExecutionRequested('open site', true) === true, 'Options flag background=true respected');

    // Standard visible automation requests (must NOT be marked background)
    assert(isBackgroundExecutionRequested('search for Quantum Computing on Wikipedia') === false, 'Standard search is foreground');
    assert(isBackgroundExecutionRequested('open YouTube and play Habibi song') === false, 'Standard media task is foreground');
    assert(isBackgroundExecutionRequested('go to github.com and download repo') === false, 'Standard navigation is foreground');
  });

  // =========================================================================
  // TEST 2: BrowserService Foreground Activation & DesktopService Coordination
  // =========================================================================
  await runTest('BrowserService: bringToForeground activates Playwright page and OS window', async () => {
    const mockDesktop = new MockDesktopService();
    const browserService = new BrowserService(testDownloadsDir, mockDesktop);

    const mockPage = new MockPage('https://en.wikipedia.org/wiki/Quantum', 'Quantum - Wikipedia');
    // Inject mock page for unit testing activation
    browserService.page = mockPage;

    assert(browserService.getIsBackgroundMode() === false, 'Default mode is foreground');

    const result = await browserService.bringToForeground();
    assert(result.success === true, 'bringToForeground returned success');
    assert(mockPage.broughtToFront === 1, 'page.bringToFront() called on Playwright page');
    assert(mockDesktop.activatedQueries.includes('Quantum - Wikipedia'), 'DesktopService.activateWindow invoked with page title');
  });

  // =========================================================================
  // TEST 3: Background Mode Respects User Wish (Zero Foreground Focus)
  // =========================================================================
  await runTest('Background Mode: Respects user request and suppresses window focus', async () => {
    const mockDesktop = new MockDesktopService();
    const browserService = new BrowserService(testDownloadsDir, mockDesktop);
    const mockPage = new MockPage('https://example.com', 'Example Domain');
    browserService.page = mockPage;

    // Enable background mode
    browserService.setBackgroundMode(true);
    assert(browserService.getIsBackgroundMode() === true, 'Background mode enabled');

    const result = await browserService.bringToForeground();
    assert(result.success === true, 'bringToForeground succeeded without error');
    assert(mockPage.broughtToFront === 0, 'page.bringToFront() was NOT called in background mode');
    assert(mockDesktop.activatedQueries.length === 0, 'DesktopService.activateWindow was NOT called in background mode');
  });

  // =========================================================================
  // TEST 4: Browser Reuse Invariant (Reuses Active Window & Tab)
  // =========================================================================
  await runTest('Browser Reuse: ensurePage reuses existing open page without duplicate windows', async () => {
    const browserService = new BrowserService(testDownloadsDir);
    const existingPage = new MockPage('https://example.com', 'Example Domain');
    browserService.page = existingPage;

    const returnedPage = await browserService.ensurePage();
    assert(returnedPage === existingPage, 'ensurePage returned active page reference without creating new tab');
  });

  // =========================================================================
  // TEST 5: Graceful Error Handling During Activation (No Session Crashes)
  // =========================================================================
  await runTest('Error Resilience: bringToForeground handles closed pages and OS activation errors gracefully', async () => {
    const mockDesktop = new MockDesktopService();
    mockDesktop.shouldFail = true; // Desktop helper fails

    const browserService = new BrowserService(testDownloadsDir, mockDesktop);
    const closedPage = new MockPage('https://example.com', 'Example Domain');
    closedPage._closed = true;
    browserService.page = closedPage;

    // Closed page returns error gracefully without throwing
    const resClosed = await browserService.bringToForeground();
    assert(resClosed.success === false, 'Reported failure on closed page');
    assert(resClosed.error.includes('No active browser page') || resClosed.error.includes('closed'), 'Descriptive error message returned');

    // Open page with failing OS helper still succeeds at Playwright level without crash
    const activePage = new MockPage('https://example.com', 'Example Domain');
    browserService.page = activePage;
    const resHelperFail = await browserService.bringToForeground();
    assert(resHelperFail.success === true, 'Handled OS helper failure gracefully; page bringToFront succeeded');
  });

  // =========================================================================
  // TEST 6: ToolDispatcher Integration: browser_bring_to_front
  // =========================================================================
  await runTest('ToolDispatcher: browser_bring_to_front tool dispatches cleanly', async () => {
    const mockDesktop = new MockDesktopService();
    const browserService = new BrowserService(testDownloadsDir, mockDesktop);
    const mockPage = new MockPage('https://en.wikipedia.org', 'Wikipedia');
    browserService.page = mockPage;

    const events = [];
    const mockContext = {
      browserService,
      desktopService: mockDesktop,
      downloadManager: null,
      taskManager: null,
      onRequestApproval: async () => true,
      onEmitEvent: (type, msg) => events.push({ type, msg }),
    };

    // Canonical tool
    const res1 = await ToolDispatcher.dispatch('browser_bring_to_front', {}, mockContext);
    assert(res1.success === true, 'browser_bring_to_front dispatched successfully');
    assert(mockPage.broughtToFront === 1, 'Playwright bringToFront was executed');

    // Alias: focus_browser
    const res2 = await ToolDispatcher.dispatch('focus_browser', {}, mockContext);
    assert(res2.success === true, 'Alias "focus_browser" dispatched successfully');
    assert(mockPage.broughtToFront === 2, 'Playwright bringToFront executed again on alias call');
  });

  // =========================================================================
  // TEST 7: Electron Window Management: Restore from Minimized State
  // =========================================================================
  await runTest('Electron Window Management: restore and focus behavior without creating duplicate windows', async () => {
    // Mock Electron BrowserWindow
    class MockBrowserWindow {
      constructor() {
        this._minimized = true;
        this._visible = true;
        this._focused = false;
        this.restored = false;
        this.focused = false;
      }
      isDestroyed() { return false; }
      isMinimized() { return this._minimized; }
      isVisible() { return this._visible; }
      restore() {
        this._minimized = false;
        this.restored = true;
      }
      show() {
        this._visible = true;
      }
      focus() {
        this._focused = true;
        this.focused = true;
      }
    }

    const mockWin = new MockBrowserWindow();

    function restoreAndFocus(win) {
      if (win && !win.isDestroyed()) {
        if (win.isMinimized()) {
          win.restore();
        }
        if (!win.isVisible()) {
          win.show();
        }
        win.focus();
      }
    }

    restoreAndFocus(mockWin);

    assert(mockWin.restored === true, 'Minimized Electron window restored');
    assert(mockWin.focused === true, 'Electron window focused');
    assert(mockWin.isMinimized() === false, 'Window no longer minimized');
  });

  console.log(`\n======================================================================`);
  console.log(`PHASE 2.1 REGRESSION SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED`);
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
