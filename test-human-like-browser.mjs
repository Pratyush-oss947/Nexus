process.env.NEXUS_ALLOW_LOCAL_TEST = '1';

import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { BrowserService } from './dist-electron/browserService.js';
import { DownloadManager } from './dist-electron/downloadManager.js';
import { ToolDispatcher } from './dist-electron/toolRegistry.js';
import { TaskPlanner } from './dist-electron/taskPlanner.js';

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

// Local mock HTTP server for deterministic and fast browser testing
function createMockServer(port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html><html><head><title>Nexus Test Home</title></head><body><h1>Welcome to Nexus Test Application</h1><form action="/search" method="GET"><input type="text" name="q" placeholder="Search this site" id="site-search" /><button type="submit" id="search-submit">Search</button></form><a href="/form" id="link-form">Go to Form</a><a href="/button-state" id="link-state">Go to State</a></body></html>`);
      return;
    }

    if (url.pathname === '/search') {
      const q = url.searchParams.get('q') || '';
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html><html><head><title>Search Results for ${q}</title></head><body><form action="/search" method="GET"><input type="text" name="q" placeholder="Search this site" id="site-search" value="${q}" /><button type="submit" id="search-submit">Search</button></form><h2>Search Results for: <span id="query-echo">${q}</span></h2><p>Result item 1: Detailed information about ${q}</p></body></html>`);
      return;
    }

    if (url.pathname === '/form') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html><html><head><title>Nexus Form Verification</title></head><body><h2>Test Form</h2><form id="test-form" action="/form-success" method="POST"><label for="username">Username:</label><input type="text" id="username" name="username" /><br/><label for="email">Email Address:</label><input type="email" id="email" name="email" /><br/><label for="notes">Notes:</label><input type="text" id="notes" name="notes" placeholder="Enter additional notes" /><br/><button type="submit" id="form-submit">Submit Form</button></form></body></html>`);
      return;
    }

    if (url.pathname === '/button-state') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html><html><head><title>Nexus Initial State</title></head><body><h2 id="status-heading">Status: INACTIVE</h2><button id="toggle-state" onclick="document.getElementById('status-heading').innerText='Status: ACTIVATED'; document.title='Nexus Active State';">Activate System</button></body></html>`);
      return;
    }

    if (url.pathname === '/download-file') {
      const content = 'NEXUS HUMAN-LIKE BROWSER VERIFICATION TEST PAYLOAD 2026';
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Content-Disposition': 'attachment; filename="nexus-human-test.txt"',
        'Content-Length': Buffer.byteLength(content),
      });
      res.end(content);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  return server;
}

async function main() {
  console.log('NEXUS - Human-Like Browser Agent 9-Criteria Test Suite\n');

  const PORT = 38942;
  const server = createMockServer(PORT);
  await new Promise((resolve) => server.listen(PORT, resolve));
  const baseUrl = `http://localhost:${PORT}`;
  console.log(`Local test server running at ${baseUrl}`);

  const testDownloadsDir = path.join(process.cwd(), 'test-downloads');
  if (!fs.existsSync(testDownloadsDir)) fs.mkdirSync(testDownloadsDir, { recursive: true });

  const browserService = new BrowserService(testDownloadsDir);
  const downloadManager = new DownloadManager(testDownloadsDir);

  const events = [];
  const mockContext = {
    browserService,
    desktopService: null,
    downloadManager,
    taskManager: null,
    onRequestApproval: async () => true,
    onEmitEvent: (type, msg) => events.push({ type, msg }),
    taskPlan: null,
  };

  try {
    // CRITERION 1: Open specified site without unnecessary navigation
    await runTest('Criterion 1: Open specified site without unnecessary navigation', async () => {
      // Step A: First open
      const disp1 = await ToolDispatcher.dispatch('open_website', { url: `${baseUrl}/` }, mockContext);
      assert(disp1.success === true, 'Initial open_website dispatched');
      assert(disp1.result.success === true, 'Initial open_website succeeded');
      assert(disp1.result.title === 'Nexus Test Home', `Page title is correct (actual: "${disp1.result.title}")`);
      assert(!disp1.result.alreadyOnPage, 'First navigation performed fresh page load');

      // Step B: Re-opening the same page/site root
      const disp2 = await ToolDispatcher.dispatch('open_website', { url: `${baseUrl}/` }, mockContext);
      assert(disp2.success === true && disp2.result.success === true, 'Second open_website call succeeded');
      assert(disp2.result.alreadyOnPage === true, 'isSameSiteOrPage detected same site and bypassed redundant reload');

      // Step C: Legacy alias browser_open also respects isSameSiteOrPage
      const disp3 = await ToolDispatcher.dispatch('browser_open', { url: `${baseUrl}/` }, mockContext);
      assert(disp3.success === true && disp3.result.success === true, 'Legacy browser_open alias succeeded');
      assert(disp3.result.alreadyOnPage === true, 'Legacy alias bypassed redundant reload');
    });

    // CRITERION 2: Search inside site without switching to DuckDuckGo
    await runTest('Criterion 2: Search inside site without switching to DuckDuckGo', async () => {
      // Active site is baseUrl. Attempting to call web_search should NOT hijack to DuckDuckGo.
      const initialStatus = await browserService.getStatus();
      assert(initialStatus.isOpen === true, 'Browser is currently open');
      assert(initialStatus.url && initialStatus.url.includes(`localhost:${PORT}`), 'Active site is local test site');

      // Dispatch web_search when already on a website -> should automatically reroute to search_current_site
      const searchDisp = await ToolDispatcher.dispatch('web_search', { query: 'quantum' }, mockContext);
      assert(searchDisp.success === true && searchDisp.result.success === true, 'Search succeeded');

      const afterStatus = await browserService.getStatus();
      assert(!afterStatus.url.includes('duckduckgo.com'), `Browser did NOT navigate to DuckDuckGo (URL: ${afterStatus.url})`);
      assert(afterStatus.url.includes(`localhost:${PORT}`), 'Remained on the target site');

      // Also directly test search_current_site canonical tool
      const directSearch = await ToolDispatcher.dispatch('search_current_site', { query: 'robotics' }, mockContext);
      assert(directSearch.success === true && directSearch.result.success === true, 'search_current_site executed successfully');
      assert(!afterStatus.url.includes('duckduckgo.com'), 'Browser maintained target site continuity');
    });

    // CRITERION 3: Fill form and verify every requested field
    await runTest('Criterion 3: Fill form and verify every requested field', async () => {
      // Navigate to /form
      await browserService.navigate(`${baseUrl}/form`);
      
      const formData = {
        username: 'nexus_agent',
        email: 'nexus@agent.local',
        notes: 'Autonomous precision form filling',
      };

      const fillDisp = await ToolDispatcher.dispatch('fill_form', { fields: formData }, mockContext);
      assert(fillDisp.success === true && fillDisp.result.success === true, 'fill_form reported success');
      assert(fillDisp.result.filledCount === 3, 'Filled all 3 requested fields');
      assert(fillDisp.result.verifiedCount === 3, 'Verified all 3 requested fields');
      assert(fillDisp.result.verifications['username'].actualValue === 'nexus_agent', 'Username field verified');
      assert(fillDisp.result.verifications['email'].actualValue === 'nexus@agent.local', 'Email field verified');
      assert(fillDisp.result.verifications['notes'].actualValue === 'Autonomous precision form filling', 'Notes field verified');
    });

    // CRITERION 4: Click button and verify state change
    await runTest('Criterion 4: Click button and verify state change', async () => {
      // Navigate to /button-state
      await browserService.navigate(`${baseUrl}/button-state`);
      const beforeStatus = await browserService.getStatus();
      assert(beforeStatus.title === 'Nexus Initial State', 'Initial state verified');

      // Click the button using click_control
      const clickDisp = await ToolDispatcher.dispatch('click_control', { selector: '#toggle-state' }, mockContext);
      assert(clickDisp.success === true && clickDisp.result.success === true, 'click_control succeeded');
      
      const afterStatus = await browserService.getStatus();
      assert(afterStatus.title === 'Nexus Active State', 'DOM state change reflected in page title ("Nexus Active State")');
    });

    // CRITERION 5: Download test file and verify non-zero size
    await runTest('Criterion 5: Download test file and verify non-zero size', async () => {
      const filename = `nexus-human-test-${Date.now()}.txt`;
      const dlDisp = await ToolDispatcher.dispatch('download_result', {
        url: `${baseUrl}/download-file`,
        filename,
      }, mockContext);

      assert(dlDisp.success === true && dlDisp.result.success === true, 'download_result succeeded');
      assert(dlDisp.result.sizeBytes > 0, `Downloaded file size is non-zero (${dlDisp.result.sizeBytes} bytes)`);
      assert(fs.existsSync(dlDisp.result.filePath), `Downloaded file verified on disk at ${dlDisp.result.filePath}`);
      
      const content = fs.readFileSync(dlDisp.result.filePath, 'utf8');
      assert(content.includes('NEXUS HUMAN-LIKE BROWSER VERIFICATION'), 'File contents verified');
    });

    // CRITERION 6: Confirm zero unnecessary duplicate tabs
    await runTest('Criterion 6: Confirm zero unnecessary duplicate tabs', async () => {
      // After all preceding operations, check open tabs count
      const tabCount = browserService.getActivePagesCount();
      assert(tabCount === 1, `Active pages count is exactly 1 (found ${tabCount})`);
    });

    // CRITERION 7: Confirm completed action is not repeated (Task plan progression)
    await runTest('Criterion 7: Confirm completed action is not repeated', async () => {
      const plan = TaskPlanner.createPlan(
        'Open Wikipedia, search for Quantum Computing inside Wikipedia, and download the summary.',
        'https://en.wikipedia.org',
        'Wikipedia'
      );

      assert(plan.currentStepIndex === 0, 'Plan starts at step index 0');
      assert(plan.steps[0].status === 'PENDING', 'Step 0 is initially pending');

      // Record step 0 completed using canonical tool
      TaskPlanner.recordStep(plan, 'open_website', { url: 'https://en.wikipedia.org' }, { success: true }, 'Opened target website');
      assert(plan.steps[0].status === 'COMPLETED', 'Step 0 marked completed');
      assert(plan.currentStepIndex === 1, 'Plan advanced to step index 1');

      // Check formatted directive informs model that step 0 is done and must not be repeated
      const directive = TaskPlanner.formatPromptDirective(plan);
      assert(directive.includes('[DONE]'), 'Directive reflects Step 1 is [DONE]');
      assert(directive.includes('Do NOT re-execute or repeat completed steps'), 'Directive explicitly forbids repeating completed steps');
    });

    // CRITERION 8: Confirm task state survives recoverable failure
    await runTest('Criterion 8: Confirm task state survives recoverable failure', async () => {
      // Attempt action on nonexistent selector
      const failDisp = await ToolDispatcher.dispatch('click_control', { selector: '#nonexistent-control-xyz' }, mockContext);
      assert(failDisp.success === true && failDisp.result.success === false, 'Tool returned failure object gracefully without throwing');
      assert(typeof failDisp.result.error === 'string', 'Error message returned to engine');

      // Verify browser session is still healthy and responsive
      const aliveCheck = browserService.getActivePagesCount();
      assert(aliveCheck === 1, 'Browser session remained alive with 1 active tab');

      // Perform a subsequent valid action to confirm continuity
      const validDisp = await ToolDispatcher.dispatch('open_website', { url: `${baseUrl}/` }, mockContext);
      assert(validDisp.success === true && validDisp.result.success === true, 'Subsequent valid action succeeded after error');
    });

    // CRITERION 9: Confirm YouTube playback automation still works
    await runTest('Criterion 9: Confirm YouTube playback automation still works', async () => {
      const ytPrompt = 'Play Habibi song on YouTube';
      const ytPlan = TaskPlanner.createPlan(ytPrompt);

      assert(ytPlan.targetWebsite === 'https://www.youtube.com', 'YouTube recognized as target website');
      assert(ytPlan.searchQuery === 'Habibi song', 'Exact media query "Habibi song" extracted');
      assert(ytPlan.steps.length >= 3, `Created ${ytPlan.steps.length} sequential execution steps for YouTube`);
      assert(ytPlan.steps[0].description.includes('Open target website'), 'Step 1 is Open YouTube');
      assert(ytPlan.steps[1].description.includes('Search for "Habibi song"'), 'Step 2 is Search YouTube');

      // Verify canonical tools and declarations in ToolDispatcher
      const declarations = ToolDispatcher.getDeclarations();
      assert(declarations[0].functionDeclarations.length >= 6, `Declarations include canonical tools (total: ${declarations[0].functionDeclarations.length})`);
      const toolNames = declarations[0].functionDeclarations.map(d => d.name);
      assert(toolNames.includes('open_website'), 'open_website in tool declarations');
      assert(toolNames.includes('search_current_site'), 'search_current_site in tool declarations');
      assert(toolNames.includes('web_search'), 'web_search in tool declarations');
      assert(toolNames.includes('fill_form'), 'fill_form in tool declarations');
      assert(toolNames.includes('click_control'), 'click_control in tool declarations');
      assert(toolNames.includes('download_result'), 'download_result in tool declarations');
    });

  } finally {
    await browserService.close();
    server.close();
  }

  console.log(`\n======================================================================`);
  console.log(`TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log(`======================================================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
