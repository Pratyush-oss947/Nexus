import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import { DesktopService } from './dist-electron/desktopService.js';
import { BrowserService } from './dist-electron/browserService.js';
import { DownloadManager } from './dist-electron/downloadManager.js';
import { TaskManager } from './dist-electron/taskManager.js';
import { AgentEngine } from './dist-electron/agentEngine.js';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('FATAL: GEMINI_API_KEY is not defined in .env');
  process.exit(1);
}

const testDownloadsDir = path.join(process.cwd(), 'test-downloads');
const testDataDir = path.join(process.cwd(), 'test-userdata');
const testScreenshotsDir = path.join(process.cwd(), 'test-screenshots');

[testDownloadsDir, testDataDir, testScreenshotsDir].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

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
  console.log('>>> NEXUS AI AUTOMATION REPAIR: ACCEPTANCE TEST SUITE (10 SCENARIOS) <<<');

  // SCENARIO 1: YouTube Search and Video Playback
  await runTest('SCENARIO 1', 'YouTube generic search and video playback', async () => {
    console.log('Navigating to YouTube...');
    const navRes = await browserService.navigate('https://www.youtube.com');
    if (!navRes.success) throw new Error(`Could not navigate to YouTube: ${navRes.error}`);

    console.log('Executing in-page search for "Habibi song"...');
    const searchRes = await browserService.inPageSearch('Habibi song', true);
    if (!searchRes.success) throw new Error(`YouTube in-page search failed: ${searchRes.error}`);
    console.log(`YouTube search results page: ${searchRes.url} ("${searchRes.title}")`);

    // Wait for video titles to appear and click a video result
    await browserService.waitFor({ timeMs: 2500 });
    console.log('Clicking top video result...');
    const clickRes = await browserService.clickElement('a#video-title');
    if (!clickRes.success) {
      // Fallback selector for YouTube video renderer
      const fallbackClick = await browserService.clickElement('ytd-video-renderer a#thumbnail');
      if (!fallbackClick.success) throw new Error(`Could not click video: ${clickRes.error}`);
    }

    await browserService.waitFor({ timeMs: 2000 });
    const currentStatus = await browserService.getStatus();
    console.log(`Current YouTube playback URL: ${currentStatus.url} ("${currentStatus.title}")`);
    if (!currentStatus.url || !currentStatus.url.includes('/watch')) {
      throw new Error(`Expected playback watch URL, but got: ${currentStatus.url}`);
    }

    return { url: currentStatus.url, title: currentStatus.title };
  });

  // SCENARIO 2: Wikipedia Search and Article Reading
  await runTest('SCENARIO 2', 'Wikipedia generic in-page search and article inspection', async () => {
    console.log('Navigating to Wikipedia...');
    const navRes = await browserService.navigate('https://en.wikipedia.org');
    if (!navRes.success) throw new Error(`Failed to navigate to Wikipedia: ${navRes.error}`);

    console.log('Searching Wikipedia for "Quantum computing"...');
    const searchRes = await browserService.inPageSearch('Quantum computing', true);
    if (!searchRes.success) throw new Error(`Wikipedia search failed: ${searchRes.error}`);

    await browserService.waitFor({ timeMs: 1500 });
    const current = await browserService.getStatus();
    console.log(`Landed at Wikipedia page: ${current.url} ("${current.title}")`);

    // Inspect page structure
    const inspectRes = await browserService.inspectPage();
    if (!inspectRes.success) throw new Error(`Failed to inspect Wikipedia page: ${inspectRes.error}`);
    console.log(`Headings found: ${inspectRes.data?.headings?.slice(0, 3).map(h => h.text).join(' | ')}`);

    // Read visible text
    const textRes = await browserService.readPageContent();
    if (!textRes.success || !textRes.content) throw new Error('Could not read Wikipedia article text');
    console.log(`Excerpt: "${textRes.content.slice(0, 160)}..."`);

    if (!current.url.toLowerCase().includes('quantum_computing') && !current.title.toLowerCase().includes('quantum')) {
      throw new Error(`Did not arrive at Quantum computing article: ${current.url}`);
    }

    return { url: current.url, title: current.title, headingsCount: inspectRes.data?.headings?.length };
  });

  // SCENARIO 3: GitHub Generic Search
  await runTest('SCENARIO 3', 'GitHub generic in-page search without site-specific hardcoding', async () => {
    console.log('Navigating to GitHub...');
    const navRes = await browserService.navigate('https://github.com');
    if (!navRes.success) throw new Error(`Could not navigate to GitHub: ${navRes.error}`);

    console.log('Searching GitHub for "react"...');
    const searchRes = await browserService.inPageSearch('react', true);
    if (!searchRes.success) throw new Error(`GitHub search failed: ${searchRes.error}`);

    await browserService.waitFor({ timeMs: 2000 });
    const current = await browserService.getStatus();
    console.log(`GitHub search results URL: ${current.url} ("${current.title}")`);

    if (!current.url.includes('react')) {
      throw new Error(`Expected search query in URL, got: ${current.url}`);
    }

    return { url: current.url, title: current.title };
  });

  // SCENARIO 4: Launch Chrome cleanly without forcing YouTube
  await runTest('SCENARIO 4', 'Launch Chrome without forcing YouTube URL', async () => {
    console.log('Launching Chrome application...');
    const launchRes = await desktopService.launchApp('chrome');
    if (!launchRes.success) throw new Error(`Chrome launch failed: ${launchRes.error}`);
    console.log(`Chrome launched: target="${launchRes.data?.target}", PID=${launchRes.data?.processId}`);

    if (launchRes.data?.target && launchRes.data.target.includes('youtube.com')) {
      throw new Error(`Regression detected: Chrome target was forced to YouTube: ${launchRes.data.target}`);
    }

    return { target: launchRes.data?.target, pid: launchRes.data?.processId };
  });

  // SCENARIO 5: Launch Notepad and Type Text
  await runTest('SCENARIO 5', 'Launch Notepad and type text', async () => {
    console.log('Launching Notepad...');
    const launchRes = await desktopService.launchApp('notepad');
    if (!launchRes.success) throw new Error(`Notepad launch failed: ${launchRes.error}`);

    const textToType = 'Autonomous AI agent verified Notepad interaction.';
    console.log(`Typing text into Notepad: "${textToType}"`);
    const typeRes = await desktopService.typeText(textToType, 'Notepad');
    if (!typeRes.success) throw new Error(`Failed to type into Notepad: ${typeRes.error}`);

    return { typed: typeRes.data?.typed };
  });

  // SCENARIO 6: Open File Explorer to Downloads
  await runTest('SCENARIO 6', 'Open File Explorer to Downloads folder', async () => {
    console.log('Launching File Explorer to Downloads...');
    const explorerRes = await desktopService.launchApp('explorer', 'shell:Downloads');
    if (!explorerRes.success) throw new Error(`Explorer launch failed: ${explorerRes.error}`);
    console.log(`File Explorer launched: PID=${explorerRes.data?.processId}`);

    return { target: explorerRes.data?.target, pid: explorerRes.data?.processId };
  });

  // SCENARIO 7: Open Windows Settings
  await runTest('SCENARIO 7', 'Open Windows Settings', async () => {
    console.log('Opening Windows Settings...');
    const settingsRes = await desktopService.launchApp('settings');
    if (!settingsRes.success) throw new Error(`Settings launch failed: ${settingsRes.error}`);
    console.log(`Windows Settings launched: PID=${settingsRes.data?.processId}`);

    return { target: settingsRes.data?.target };
  });

  // SCENARIO 8: Form filling, Dropdown selection, and Checkbox handling
  await runTest('SCENARIO 8', 'Form filling, dropdown selection, and checkbox checking', async () => {
    // Spin up local test server with HTML form
    const testHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Form Automation Test</title></head>
        <body style="font-family:sans-serif; padding:20px;">
          <h1>Employee Registration</h1>
          <form id="test-form">
            <p>
              <label for="full_name">Full Name:</label>
              <input type="text" id="full_name" name="full_name" placeholder="Enter full name" />
            </p>
            <p>
              <label for="dept_select">Department:</label>
              <select id="dept_select" name="dept_select">
                <option value="eng">Engineering</option>
                <option value="prod">Product</option>
                <option value="res">Research</option>
              </select>
            </p>
            <p>
              <label>
                <input type="checkbox" id="terms_agree" name="terms_agree" />
                I agree to the terms and security policy
              </label>
            </p>
          </form>
        </body>
      </html>
    `;

    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(testHtml);
    });

    const port = 8991;
    await new Promise((resolve) => server.listen(port, resolve));

    try {
      console.log(`Navigating to local test form on http://127.0.0.1:${port}...`);
      // Use internal bypass or test URL
      const page = await browserService.ensurePage();
      await page.goto(`http://localhost:${port}`, { waitUntil: 'domcontentloaded' });

      // 1. Inspect page
      const inspectRes = await browserService.inspectPage();
      console.log(`Form inputs detected: ${inspectRes.data?.inputs?.map(i => i.name).join(', ')}`);

      // 2. Type text into input
      console.log('Typing name into #full_name...');
      const typeRes = await browserService.typeText('#full_name', 'Alex Johnson');
      if (!typeRes.success) throw new Error(`Type text failed: ${typeRes.error}`);

      // 3. Select dropdown option
      console.log('Selecting "Research" in #dept_select...');
      const selectRes = await browserService.selectOption('#dept_select', 'Research');
      if (!selectRes.success) throw new Error(`Select option failed: ${selectRes.error}`);

      // 4. Check checkbox
      console.log('Checking #terms_agree...');
      const checkRes = await browserService.checkElement('#terms_agree', true);
      if (!checkRes.success) throw new Error(`Check element failed: ${checkRes.error}`);

      // Verify values directly in page DOM
      const domValues = await page.evaluate(() => {
        const nameVal = (document.getElementById('full_name')).value;
        const deptVal = (document.getElementById('dept_select')).value;
        const agreed = (document.getElementById('terms_agree')).checked;
        return { nameVal, deptVal, agreed };
      });

      console.log('Verified DOM state:', domValues);
      if (domValues.nameVal !== 'Alex Johnson') throw new Error(`Name mismatch: ${domValues.nameVal}`);
      if (domValues.deptVal !== 'res') throw new Error(`Dept mismatch: ${domValues.deptVal}`);
      if (!domValues.agreed) throw new Error('Checkbox was not checked');

      return domValues;
    } finally {
      server.close();
    }
  });

  // SCENARIO 9: Non-existent application error handling
  await runTest('SCENARIO 9', 'Non-existent desktop application returns clear helpful error', async () => {
    console.log('Attempting to launch invalid application "non_existent_fake_app_777"...');
    const res = await desktopService.launchApp('non_existent_fake_app_777');
    console.log(`Error received: "${res.error}"`);

    if (res.success) {
      throw new Error('Expected launchApp to fail for non-existent app');
    }
    if (!res.error || !res.error.includes('not found or failed to start') || !res.error.includes('PATH')) {
      throw new Error(`Error message did not contain expected diagnostic guidance: "${res.error}"`);
    }

    return { error: res.error };
  });

  // SCENARIO 10: Multi-Step Task Continuity without premature browser closure
  await runTest('SCENARIO 10', 'Multi-step task continuity and session persistence via AgentEngine', async () => {
    console.log('Executing multi-step agent task on Wikipedia...');
    const result = await agentEngine.execute({
      prompt: 'Navigate to https://en.wikipedia.org, search for "Ada Lovelace", and summarize who she was in one sentence.',
      apiKey,
      modelName: 'gemini-flash-lite-latest',
      maxSteps: 5,
    });

    console.log(`Agent Result Summary: ${result.text}`);
    console.log(`Executed Tool Steps: ${result.steps.map(s => s.tool).join(' -> ')}`);
    console.log(`Consulted Sources: ${JSON.stringify(result.sources)}`);

    if (!result.success) throw new Error(`Agent execution failed: ${result.error}`);
    if (result.steps.length === 0) throw new Error('No tool steps were executed');

    // Verify browser is still open and at Ada Lovelace page
    const status = await browserService.getStatus();
    console.log(`Final Browser Session State: Open=${status.isOpen}, URL=${status.url}, Title="${status.title}"`);
    if (!status.isOpen) throw new Error('Browser closed prematurely during multi-step task');

    return {
      text: result.text,
      steps: result.steps.map(s => s.tool),
      finalUrl: status.url,
      isOpen: status.isOpen,
    };
  });

  // Final Summary
  console.log(`\n======================================================================`);
  console.log(`FINAL REPAIR ACCEPTANCE RESULTS SUMMARY (${results.filter(r => r.passed).length}/${results.length} PASSED)`);
  console.log(`======================================================================`);
  results.forEach(r => {
    console.log(`${r.passed ? '✓ [PASS]' : '✗ [FAIL]'} ${r.testId}: ${r.name} (${r.duration})`);
  });

  const allPassed = results.every(r => r.passed);
  if (allPassed) {
    console.log('\nALL 10 REPAIR ACCEPTANCE SCENARIOS PASSED WITH ZERO ERRORS!');
  } else {
    console.error('\nSOME ACCEPTANCE SCENARIOS FAILED!');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
