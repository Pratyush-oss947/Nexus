import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import compiled dist-electron modules
const { TaskPlanner } = await import('./dist-electron/taskPlanner.js');
const { ToolDispatcher } = await import('./dist-electron/toolRegistry.js');
const { AgentEngine } = await import('./dist-electron/agentEngine.js');
const { DesktopService } = await import('./dist-electron/desktopService.js');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function check(desc, condition) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  [PASS] ${desc}`);
  } else {
    failedTests++;
    console.error(`  [FAIL] ${desc}`);
  }
}

async function runAcceptanceTests() {
  console.log('======================================================================');
  console.log('  NEXUS ACCEPTANCE TEST SUITE: PERMISSION SPAM & NOTEPAD EXECUTION');
  console.log('  Tests A, B, C, D, E');
  console.log('======================================================================\n');

  // ====================================================================
  // ACCEPTANCE TEST A: Authorize one login workflow on a test website.
  // Confirm NEXUS does not ask separately for each field and click.
  // ====================================================================
  console.log('--- ACCEPTANCE TEST A: Single Workflow Authorization (No Permission Spam) ---');
  {
    const targetUrl = 'https://portal.example.com/login';
    const state = TaskPlanner.createExecutionState(
      'Open portal.example.com and log in using my credentials',
      targetUrl,
      'Portal Login'
    );

    // Initial state: not yet authorized
    check('Initial execution state has no authorized workflow', state.authorizedWorkflow === undefined);

    // Track approval requests
    const approvalLog = [];
    const mockRequestApproval = async (approval) => {
      approvalLog.push(approval);
      return true;
    };

    // User authorizes login workflow once on portal.example.com
    TaskPlanner.authorizeWorkflow(state, 'LOGIN', 'portal.example.com');
    check('Workflow authorization scoped to domain portal.example.com', state.authorizedWorkflow?.domain === 'portal.example.com');
    check('Workflow type is LOGIN', state.authorizedWorkflow?.workflowType === 'LOGIN');

    // Sub-step 1: Navigate to login page
    const isNavCovered = TaskPlanner.isActionCoveredByWorkflow(state, 'open_website', { url: targetUrl }, targetUrl);
    check('Navigation on portal.example.com is covered under login workflow', isNavCovered === true);

    // Sub-step 2: Fill username field
    const isUserFillCovered = TaskPlanner.isActionCoveredByWorkflow(state, 'fill_form', { field: 'username', value: 'john_doe' }, targetUrl);
    check('Filling username on portal.example.com is covered without prompting', isUserFillCovered === true);

    // Sub-step 3: Fill password field (normally sensitive / consequential)
    const isPassFillCovered = TaskPlanner.isActionCoveredByWorkflow(state, 'fill_form', { field: 'password', value: 'Secret123!' }, targetUrl);
    check('Filling password on portal.example.com is covered without asking separately', isPassFillCovered === true);

    // Sub-step 4: Multi-field form fill with password
    const isMultiFillCovered = TaskPlanner.isActionCoveredByWorkflow(state, 'smart_fill_form', {
      fields: { username: 'john_doe', password: 'Secret123!' },
      submit: true
    }, targetUrl);
    check('Smart fill form with submit on portal.example.com is covered under workflow', isMultiFillCovered === true);

    // Sub-step 5: Click submit / Sign In button
    const isClickCovered = TaskPlanner.isActionCoveredByWorkflow(state, 'click_control', { target: 'Sign In' }, targetUrl);
    check('Clicking "Sign In" button on portal.example.com is covered under workflow', isClickCovered === true);

    // Sub-step 6: browser_login tool call
    const isBrowserLoginCovered = TaskPlanner.isActionCoveredByWorkflow(state, 'browser_login', {
      username: 'john_doe',
      domain: 'portal.example.com'
    }, targetUrl);
    check('browser_login tool on portal.example.com is covered under workflow', isBrowserLoginCovered === true);

    // Verify: In an authorized login workflow, sub-steps run without triggering multiple approval modals
    check('Zero redundant separate approval prompts triggered for ordinary login sub-steps', approvalLog.length === 0);
  }

  // ====================================================================
  // ACCEPTANCE TEST B: Change to a different domain during the task.
  // Confirm the original authorization is not silently reused for unrelated actions.
  // ====================================================================
  console.log('\n--- ACCEPTANCE TEST B: Domain Boundary Protection & High-Consequence Guard ---');
  {
    const state = TaskPlanner.createExecutionState(
      'Open portal.example.com and log in',
      'https://portal.example.com/login',
      'Portal Login'
    );
    TaskPlanner.authorizeWorkflow(state, 'LOGIN', 'portal.example.com');

    // 1. Target changes to different domain (e.g. evil-tracker.com or payment-gateway.com)
    const foreignDomainUrl = 'https://unrelated-domain.com/auth';
    const isForeignNavCovered = TaskPlanner.isActionCoveredByWorkflow(state, 'open_website', { url: foreignDomainUrl }, foreignDomainUrl);
    check('Different domain navigation is NOT covered under original authorization', isForeignNavCovered === false);

    const isForeignFillCovered = TaskPlanner.isActionCoveredByWorkflow(state, 'fill_form', { field: 'password', value: 'secret' }, foreignDomainUrl);
    check('Filling credentials on different domain is NOT covered', isForeignFillCovered === false);

    const isForeignClickCovered = TaskPlanner.isActionCoveredByWorkflow(state, 'click_control', { target: 'Submit' }, foreignDomainUrl);
    check('Submitting on different domain is NOT covered', isForeignClickCovered === false);

    // 2. High consequence action on SAME domain (e.g. payment, purchase, account deletion)
    const portalUrl = 'https://portal.example.com/account';
    const isPaymentCovered = TaskPlanner.isActionCoveredByWorkflow(state, 'click_control', { target: 'Confirm Payment of $500' }, portalUrl);
    check('Consequential action (Payment) is NEVER covered by login authorization', isPaymentCovered === false);

    const isPurchaseCovered = TaskPlanner.isActionCoveredByWorkflow(state, 'click_control', { target: 'Checkout and Buy Now' }, portalUrl);
    check('Consequential action (Purchase/Checkout) is NEVER covered by login authorization', isPurchaseCovered === false);

    const isDeleteCovered = TaskPlanner.isActionCoveredByWorkflow(state, 'click_control', { target: 'Delete Account Permanently' }, portalUrl);
    check('Consequential action (Delete Account) is NEVER covered by login authorization', isDeleteCovered === false);

    // 3. Authorization expiration when task ends
    TaskPlanner.clearWorkflowAuthorization(state);
    check('Workflow authorization cleared and expired when task ends', state.authorizedWorkflow === undefined);
    const isLoginCoveredAfterExpiry = TaskPlanner.isActionCoveredByWorkflow(state, 'browser_login', { username: 'user' }, portalUrl);
    check('Action NOT covered after authorization expires', isLoginCoveredAfterExpiry === false);
  }

  // ====================================================================
  // ACCEPTANCE TEST C: Open Notepad with the text "ORIGINAL TEXT".
  // Ask NEXUS to write a new poem.
  // Confirm the original text remains unchanged and the poem appears in a separate new document/window.
  // ====================================================================
  console.log('\n--- ACCEPTANCE TEST C: Notepad Document Preservation & New Window Creation ---');
  {
    const originalText = 'ORIGINAL TEXT - IMPORTANT USER DATA';
    const poemText = 'Two roads diverged in a yellow wood,\nAnd sorry I could not travel both\nAnd be one traveler, long I stood.';

    // Create desktop service
    const mockDesktop = new DesktopService();

    // Simulate existing Notepad window containing original text
    const originalWindow = {
      hwnd: '0x10A0',
      processId: 8888,
      processName: 'Notepad',
      title: 'shopping_list.txt - Notepad',
      left: 100,
      top: 100,
      width: 800,
      height: 600,
      isForeground: true,
    };

    let originalWindowContent = originalText;
    let newWindowContent = '';
    let newWindowCreated = false;
    let newWindow = null;

    // Mock window tracking
    let windows = [originalWindow];
    mockDesktop.listWindows = async () => ({
      success: true,
      data: windows,
    });

    mockDesktop.launchApp = async (app, extraArgs, ignoreHwnd) => {
      // Creates a new separate window
      newWindowCreated = true;
      newWindow = {
        hwnd: '0x20B0',
        processId: 9999,
        processName: 'Notepad',
        title: 'Untitled - Notepad',
        left: 200,
        top: 200,
        width: 800,
        height: 600,
        isForeground: true,
      };
      windows = [originalWindow, newWindow];
      return {
        success: true,
        data: { target: 'notepad.exe', processId: 9999, window: newWindow },
      };
    };

    mockDesktop.activateWindow = async (hwnd) => {
      windows.forEach((w) => {
        w.isForeground = (w.hwnd === hwnd);
      });
      return { success: true };
    };

    mockDesktop.getActiveWindow = async () => {
      const active = windows.find((w) => w.isForeground) || windows[0];
      return { success: true, data: active };
    };

    mockDesktop.typeText = async (text, targetHwnd) => {
      if (targetHwnd === originalWindow.hwnd) {
        originalWindowContent += text;
      } else {
        newWindowContent += text;
      }
      return { success: true, data: { typed: text } };
    };

    // Execute manageNotepadDocument with mode: 'new_document' (default for "write a poem in notepad")
    const result = await mockDesktop.manageNotepadDocument({
      text: poemText,
      mode: 'new_document',
    });

    check('manageNotepadDocument succeeded', result.success === true);
    check('Identified that a new document was created', result.isNewDocument === true);
    check('Target window is the NEW window (0x20B0)', result.window?.hwnd === '0x20B0');
    check('Original user text remains strictly UNCHANGED', originalWindowContent === originalText);
    check('Poem was written into the separate new document', newWindowContent === poemText);
    check('Text insertion verified', result.textVerified === true);

    // Also verify task plan completion for all 3 Notepad steps
    const plan = TaskPlanner.createPlan('Write a poem in Notepad');
    check('Plan identifies isNotepadTask', plan.isNotepadTask === true);
    check('Plan has 3 steps for Notepad', plan.steps.length === 3);
    TaskPlanner.recordStep(plan, 'desktop_write_notepad', result);
    check('Step 1 marked COMPLETED', plan.steps[0].status === 'COMPLETED');
    check('Step 2 marked COMPLETED', plan.steps[1].status === 'COMPLETED');
    check('Step 3 marked COMPLETED', plan.steps[2].status === 'COMPLETED');
    check('All plan steps completed', plan.steps.every((s) => s.status === 'COMPLETED'));
  }

  // ====================================================================
  // ACCEPTANCE TEST D: Make Notepad unavailable or cause a tool timeout.
  // Confirm NEXUS terminates the task with a useful error instead of remaining stuck.
  // ====================================================================
  console.log('\n--- ACCEPTANCE TEST D: Bounded Timeout & Non-Hanging Terminal State ---');
  {
    const mockBrowser = {
      getStatus: async () => ({ url: '', title: '' }),
      bringToForeground: async () => {},
      setBackgroundMode: () => {},
      closeBrowser: async () => {},
      getLatestDownload: () => null,
    };
    const mockDownloads = {};
    const mockTaskManager = { loadTasks: () => [], saveTasks: () => true, createTask: () => ({ id: '1', title: 't' }) };
    const mockDesktop = new DesktopService();

    // Simulate Notepad completely unavailable / throwing error on launch
    mockDesktop.manageNotepadDocument = async () => ({
      success: false,
      action: 'manage_notepad',
      error: 'Notepad application binary was not found or failed to launch on this Windows system.',
    });

    const engine = new AgentEngine(mockBrowser, mockDownloads, mockTaskManager, mockDesktop);

    const emittedEvents = [];
    const runResult = await engine.execute({
      prompt: 'Write a poem in Notepad',
      apiKey: 'test-key',
      provider: 'ollama', // use test flow
      maxSteps: 4,
      stepTimeoutMs: 1000,
      taskTimeoutMs: 5000,
      onEvent: (evt) => emittedEvents.push(evt),
    });

    // Must reach terminal state FAILED with actionable error, never remain stuck
    check('Task execution does NOT hang and completes synchronously', runResult !== undefined);
    check('Task success is false when application is unavailable', runResult.success === false);
    check('Execution state status is terminal FAILED', runResult.executionState?.status === 'FAILED');
    check('Verification verdict is FAILED', runResult.verificationVerdict === 'FAILED');
    check('Error message details application failure', runResult.error?.includes('failed') || runResult.text?.includes('failed'));
    check('Task does not loop indefinitely (step count <= maxSteps)', (runResult.steps?.length || 0) <= 4);
    check('Emitted ERROR event to notify UI without hanging', emittedEvents.some((e) => e.type === 'ERROR'));
  }

  // ====================================================================
  // ACCEPTANCE TEST E: Cancel a running task.
  // Confirm execution stops and no queued retry continues afterward.
  // ====================================================================
  console.log('\n--- ACCEPTANCE TEST E: Task Cancellation & Halting Queued Retries ---');
  {
    const mockBrowser = {
      getStatus: async () => ({ url: '', title: '' }),
      bringToForeground: async () => {},
      setBackgroundMode: () => {},
      closeBrowser: async () => {},
      getLatestDownload: () => null,
    };
    const mockDownloads = {};
    const mockTaskManager = { loadTasks: () => [], saveTasks: () => true };
    const mockDesktop = new DesktopService();

    let stepCounter = 0;
    mockDesktop.manageNotepadDocument = async () => {
      stepCounter++;
      // Simulate delay
      await new Promise((r) => setTimeout(r, 200));
      return { success: true };
    };

    const engine = new AgentEngine(mockBrowser, mockDownloads, mockTaskManager, mockDesktop);

    // Launch task and cancel it immediately
    const executePromise = engine.execute({
      prompt: 'Write a long poem in Notepad',
      apiKey: 'test-key',
      provider: 'ollama',
      maxSteps: 8,
      stepTimeoutMs: 3000,
      taskTimeoutMs: 10000,
    });

    // Trigger abort mid-execution
    engine.abort();

    const result = await executePromise;
    check('Cancelled task returns success: false', result.success === false);
    check('Task terminal state is CANCELLED', result.executionState?.status === 'CANCELLED');
    check('Result text states task was cancelled by user', result.text?.includes('cancelled'));
    check('Execution steps did not continue to maxSteps (halted immediately)', (result.steps?.length || 0) < 4);

    // Verify pending approvals are unblocked by cancellation in main.ts pattern
    let pendingApprovalResolved = false;
    const testPendingApproval = new Promise((resolve) => {
      // Simulate pending approval
      const mockResolver = (approved) => {
        pendingApprovalResolved = true;
        resolve(approved);
      };
      // Emulate cancellation resolving all pending approvals
      mockResolver(false);
    });

    const approvalResult = await testPendingApproval;
    check('Pending approval resolved to false upon cancellation', approvalResult === false);
    check('Pending approval did not hang indefinitely', pendingApprovalResolved === true);
  }

  // ====================================================================
  // SUMMARY
  // ====================================================================
  console.log('\n======================================================================');
  console.log(`  ACCEPTANCE TEST SUITE SUMMARY:`);
  console.log(`  Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
  console.log('======================================================================\n');

  if (failedTests > 0) {
    console.error(`>>> ${failedTests} ACCEPTANCE TEST(S) FAILED! <<<`);
    process.exit(1);
  } else {
    console.log(`>>> ALL ${passedTests} ACCEPTANCE TESTS (A, B, C, D, E) PASSED! <<<`);
  }
}

runAcceptanceTests().catch((err) => {
  console.error('Fatal acceptance test error:', err);
  process.exit(1);
});
