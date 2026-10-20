import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { BrowserService } from './dist-electron/browserService.js';
import { ToolDispatcher } from './dist-electron/toolRegistry.js';
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
  console.log('NEXUS - Phase 1 Regression Test Suite: Eliminate Screenshot Context Bloat\n');

  // TEST 1: Unit Test - sanitizeToolResultForModel strips base64 screenshot
  await runTest('Unit Test: Strip base64 screenshot and retain structured metadata', async () => {
    const dummyBase64 = 'data:image/jpeg;base64,' + 'A'.repeat(80000);
    const rawResult = {
      success: true,
      action: 'navigate',
      url: 'https://example.com',
      title: 'Example Domain',
      content: 'Navigated to https://example.com',
      screenshotBase64: dummyBase64,
    };

    const sanitized = sanitizeToolResultForModel(rawResult);

    assert(sanitized.success === true, 'Result retains success: true');
    assert(sanitized.action === 'navigate', 'Result retains action');
    assert(sanitized.url === 'https://example.com', 'Result retains current URL');
    assert(sanitized.title === 'Example Domain', 'Result retains page title');
    assert(sanitized.screenshotBase64 === undefined, 'screenshotBase64 is completely removed');
    assert(sanitized.screenshotCaptured === true, 'screenshotCaptured flag is set to true');
    assert(!JSON.stringify(sanitized).includes('data:image/'), 'No data:image/ string exists in model payload');
    assert(!JSON.stringify(sanitized).includes(dummyBase64.slice(0, 100)), 'No base64 substring exists in model payload');
    assert(JSON.stringify(sanitized).length < 500, `Model payload is ultra-compact (${JSON.stringify(sanitized).length} chars)`);
  });

  // TEST 2: Unit Test - Bound large text content
  await runTest('Unit Test: Bound large text content to max limit', async () => {
    const hugeText = 'Paragraph of extracted page content. '.repeat(200); // ~7400 chars
    const rawResult = {
      success: true,
      action: 'read_page',
      url: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
      title: 'Artificial intelligence - Wikipedia',
      content: hugeText,
    };

    const sanitized = sanitizeToolResultForModel(rawResult, 2000);

    assert(sanitized.content.length <= 2060, `Content length (${sanitized.content.length}) is within bound (<= 2060)`);
    assert(sanitized.content.includes('[content truncated for model context]'), 'Content includes truncation notice');
  });

  // TEST 3: Unit Test - Strip credentials, tokens, cookies, passwords, auth headers
  await runTest('Unit Test: Strip security-sensitive fields (cookies, tokens, passwords, auth)', async () => {
    const rawResult = {
      success: true,
      action: 'browser_status',
      url: 'https://app.example.com/dashboard',
      cookies: [{ name: 'session', value: 'secret_session_token_123' }],
      authToken: 'Bearer eyJhbGciOiJIUzI1Ni...',
      passwordValue: 'P@ssw0rd123!',
      apiKey: 'AIzaSySecretApiKey',
      clientSecret: 'secret_456',
    };

    const sanitized = sanitizeToolResultForModel(rawResult);

    assert(sanitized.cookies === undefined, 'cookies field is stripped');
    assert(sanitized.authToken === undefined, 'authToken field is stripped');
    assert(sanitized.passwordValue === undefined, 'passwordValue field is stripped');
    assert(sanitized.apiKey === undefined, 'apiKey field is stripped');
    assert(sanitized.clientSecret === undefined, 'clientSecret field is stripped');
    assert(!JSON.stringify(sanitized).includes('secret_session_token_123'), 'Secret value does not appear in payload');
    assert(sanitized.url === 'https://app.example.com/dashboard', 'Safe URL is preserved');
  });

  // TEST 4: Unit Test - Omit redundant DOM tree when formatted text content exists
  await runTest('Unit Test: Omit redundant DOM tree when content already provides formatted structure', async () => {
    const rawResult = {
      success: true,
      action: 'inspect_page',
      url: 'https://example.com',
      title: 'Example Domain',
      content: 'Page Structure:\nHeadings:\n- [h1] Example Domain\nKey Links:\n- More info (https://iana.org)',
      data: {
        headings: [{ level: 'h1', text: 'Example Domain' }],
        inputs: [],
        buttons: [],
        links: [{ text: 'More information...', href: 'https://www.iana.org/domains/example' }],
      },
      screenshotBase64: 'data:image/jpeg;base64,1234567890',
    };

    const sanitized = sanitizeToolResultForModel(rawResult);

    assert(sanitized.content.includes('Example Domain'), 'Formatted structure in content is preserved');
    assert(sanitized.data === undefined, 'Redundant raw DOM data object is omitted from model context');
    assert(sanitized.screenshotBase64 === undefined, 'Screenshot base64 is stripped');
  });

  // TEST 5: End-to-End Integration Test with Real Browser & Tool Dispatcher
  await runTest('E2E Integration: UI receives live screenshot while Gemini receives clean payload', async () => {
    const testUrl = 'https://example.com';
    console.log(`  Navigating to public test target: ${testUrl}`);

    const testDownloadsDir = path.join(process.cwd(), 'test-downloads');
    if (!fs.existsSync(testDownloadsDir)) fs.mkdirSync(testDownloadsDir, { recursive: true });

    const browserService = new BrowserService(testDownloadsDir);

    // Track events sent to UI
    const emittedEvents = [];
    const mockContext = {
      browserService,
      desktopService: null,
      downloadManager: null,
      taskManager: null,
      onRequestApproval: async () => true,
      onEmitEvent: (type, message, details, url, screenshotUrl) => {
        emittedEvents.push({ type, message, details, url, screenshotUrl });
      },
    };

    try {
      // Execute browser_open via ToolDispatcher
      const dispatchResult = await ToolDispatcher.dispatch('browser_open', { url: testUrl }, mockContext);
      assert(dispatchResult.success, 'ToolDispatcher dispatched browser_open successfully');

      const toolResult = dispatchResult.result;
      assert(toolResult.success, 'BrowserService navigated to test URL successfully');

      // Check UI Event emission
      const lastEvent = emittedEvents[emittedEvents.length - 1];
      assert(lastEvent !== undefined, 'At least one progress event was emitted to UI');
      assert(typeof lastEvent.screenshotUrl === 'string', 'UI received a screenshotUrl in event payload');
      assert(lastEvent.screenshotUrl.startsWith('data:image/jpeg;base64,'), 'UI screenshotUrl is a valid data:image/jpeg;base64 URL');
      assert(lastEvent.screenshotUrl.length > 1000, `UI screenshot is full fidelity (${lastEvent.screenshotUrl.length} characters)`);

      // Check Model Context Payload
      const modelPayload = sanitizeToolResultForModel(toolResult);
      assert(modelPayload.screenshotBase64 === undefined, 'Model payload does NOT contain screenshotBase64');
      assert(modelPayload.screenshotCaptured === true, 'Model payload informs model that screenshotCaptured is true');
      assert(modelPayload.success === true, 'Model payload retains success: true');
      assert(modelPayload.title.includes('Example Domain'), 'Model payload retains accurate page title');
      assert(!JSON.stringify(modelPayload).includes('data:image/'), 'Model payload has ZERO occurrences of data:image/');
      assert(JSON.stringify(modelPayload).length < 500, `Model payload is ultra-compact (${JSON.stringify(modelPayload).length} characters)`);

      console.log('\n  Comparison:');
      console.log(`    UI Event Screenshot Size:    ${lastEvent.screenshotUrl.length} characters`);
      console.log(`    Model Context Payload Size:  ${JSON.stringify(modelPayload).length} characters`);
      console.log(`    Token Savings for Turn:      ~${Math.round((lastEvent.screenshotUrl.length - JSON.stringify(modelPayload).length) / 4)} tokens!`);

    } finally {
      await browserService.closeBrowser();
    }
  });

  console.log(`\n======================================================================`);
  console.log(`PHASE 1 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`======================================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main();
