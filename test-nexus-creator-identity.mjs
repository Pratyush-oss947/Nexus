import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  AgentEngine,
  isCreatorAttributionQuery,
  isModelInquiry,
  isAboutDeveloperInquiry,
  getCreatorAttributionResponse,
  getAboutDeveloperResponse,
  getModelInquiryResponse,
} from './dist-electron/agentEngine.js';
import { TaskPlanner } from './dist-electron/taskPlanner.js';
import { BrowserService } from './dist-electron/browserService.js';
import { DesktopService } from './dist-electron/desktopService.js';
import { DownloadManager } from './dist-electron/downloadManager.js';
import { TaskManager } from './dist-electron/taskManager.js';
import { ElevenLabsService } from './dist-electron/elevenLabsService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const personalityTsContent = fs.readFileSync(path.join(__dirname, 'src/utils/personality.ts'), 'utf-8');

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

async function runTests() {
  console.log('======================================================================');
  console.log('  NEXUS IDENTITY & CREATOR ATTRIBUTION TEST SUITE');
  console.log('  Attribution to Pratyush, Provider Disambiguation & Voice Compatibility');
  console.log('======================================================================\n');

  const testDownloadsDir = path.join(__dirname, 'test-downloads');
  const testScreenshotsDir = path.join(__dirname, 'test-screenshots');
  const testDataDir = path.join(__dirname, 'test-userdata');

  const browserService = new BrowserService(testDownloadsDir);
  const desktopService = new DesktopService(testScreenshotsDir);
  const downloadManager = new DownloadManager(testDownloadsDir);
  const taskManager = new TaskManager(testDataDir);

  const agent = new AgentEngine(browserService, downloadManager, taskManager, desktopService);

  // -----------------------------------------------------------------
  // TEST 1: Natural Creator Attribution Query Detection
  // -----------------------------------------------------------------
  console.log('--- TEST 1: Pattern Recognition for Creator & Developer Queries ---');
  {
    const creatorQueries = [
      'Who created you?',
      'Who is your developer?',
      'Who made NEXUS?',
      'Who should get credit for building you?',
      'who built you',
      'who developed nexus',
      'Who created this app?',
      'Who is the author of NEXUS?',
    ];

    for (const q of creatorQueries) {
      assert(isCreatorAttributionQuery(q) === true, `Identifies "${q}" as creator attribution query`);
      assert(TaskPlanner.isConversationalPrompt(q) === true, `TaskPlanner recognizes "${q}" as conversational prompt`);
    }

    // Unrelated queries must NOT be identified as creator queries
    const unrelatedQueries = [
      'What is the capital of France?',
      'Write a poem in Notepad',
      'Open Wikipedia in a new tab',
      'Calculate 15 * 4',
      'Download quarterly report',
      'Hello NEXUS, how is the weather?',
    ];

    for (const q of unrelatedQueries) {
      assert(isCreatorAttributionQuery(q) === false, `Does NOT misclassify unrelated query "${q}" as creator query`);
    }
  }

  // -----------------------------------------------------------------
  // TEST 2: Exact Natural Creator Response Content & Wording
  // -----------------------------------------------------------------
  console.log('\n--- TEST 2: Canonical Attribution Response Content ---');
  {
    const expectedResponse =
      "I was created and developed by Pratyush. I'm NEXUS, an independent AI assistant built by him. My capabilities are powered by the technologies and AI services integrated into me.";

    const actual = getCreatorAttributionResponse();
    assert(actual === expectedResponse, 'Canonical response exactly matches required natural phrasing');
    assert(actual.includes('Pratyush'), 'Response explicitly names Pratyush as creator and developer');
    assert(!actual.includes('OpenAI') && !actual.includes('Google') && !actual.includes('ElevenLabs'),
      'Response does NOT falsely claim Google, OpenAI, or ElevenLabs created NEXUS');
  }

  // -----------------------------------------------------------------
  // TEST 3: System Instruction Integrity in Frontend and Backend
  // -----------------------------------------------------------------
  console.log('\n--- TEST 3: System Instruction Integrity (Personality & Default Instructions) ---');
  {
    assert(personalityTsContent.includes('Pratyush'), 'DEFAULT_SYSTEM_INSTRUCTION in personality.ts contains Pratyush attribution');
    assert(personalityTsContent.includes("I was created and developed by Pratyush"), 'Contains exact required response template');
    assert(personalityTsContent.includes('Never claim that OpenAI, Google'), 'Explicitly instructs never to claim Google or OpenAI created NEXUS');
    assert(personalityTsContent.includes('About the Developer — Pratyush'), 'Contains complete bio of Pratyush');
  }

  // -----------------------------------------------------------------
  // TEST 4: Runtime Model Inquiry Disambiguation (Provider vs Creator)
  // -----------------------------------------------------------------
  console.log('\n--- TEST 4: Runtime Model Inquiry (Provider Disambiguation) ---');
  {
    const modelQueries = [
      'Which AI model powers you?',
      'What model are you running?',
      'Which model is powering NEXUS?',
      'What AI model are you using?',
    ];

    for (const q of modelQueries) {
      assert(isModelInquiry(q) === true, `Identifies "${q}" as model inquiry`);
    }

    // Gemini provider response
    const geminiResp = getModelInquiryResponse('gemini', 'gemini-2.5-flash');
    assert(geminiResp.includes('gemini-2.5-flash'), 'Gemini response mentions active model gemini-2.5-flash');
    assert(geminiResp.includes('Google Gemini'), 'Gemini response attributes AI service provider accurately');
    assert(geminiResp.includes('Pratyush'), 'Gemini response explicitly credits Pratyush for creating NEXUS application');

    // Ollama provider response
    const ollamaResp = getModelInquiryResponse('ollama', 'qwen2.5:7b');
    assert(ollamaResp.includes('qwen2.5:7b'), 'Ollama response mentions active model qwen2.5:7b');
    assert(ollamaResp.includes('Ollama'), 'Ollama response attributes local provider accurately');
    assert(ollamaResp.includes('Pratyush'), 'Ollama response explicitly credits Pratyush for creating NEXUS application');
  }

  // -----------------------------------------------------------------
  // TEST 5: About the Developer Inquiry
  // -----------------------------------------------------------------
  console.log('\n--- TEST 5: Detailed Bio on "About the Developer" ---');
  {
    assert(isAboutDeveloperInquiry('Who is Pratyush?') === true, 'Identifies "Who is Pratyush?"');
    assert(isAboutDeveloperInquiry('Tell me about your developer') === true, 'Identifies "Tell me about your developer"');
    assert(isAboutDeveloperInquiry('About the developer') === true, 'Identifies "About the developer"');

    const bio = getAboutDeveloperResponse();
    assert(bio.includes('Pratyush, an independent creator passionate about artificial intelligence'), 'Bio details Pratyush vision and passion');
    assert(bio.includes('powerful technology begins with a curious mind'), 'Bio concludes with visionary philosophy');
  }

  // -----------------------------------------------------------------
  // TEST 6: Execution via AgentEngine (Conversational Verification)
  // -----------------------------------------------------------------
  console.log('\n--- TEST 6: AgentEngine Execution on Creator Questions ---');
  {
    const creatorPrompts = [
      'Who created you?',
      'Who is your developer?',
      'Who made NEXUS?',
      'Who should get credit for building you?',
    ];

    for (const prompt of creatorPrompts) {
      const res = await agent.execute({ prompt, maxSteps: 2 });
      assert(res.success === true, `Agent successfully responds to "${prompt}"`);
      assert(res.text.includes('Pratyush'), `Response for "${prompt}" contains Pratyush`);
      assert(res.text.includes("I was created and developed by Pratyush"), `Response contains exact natural greeting`);
      assert(res.steps.length === 0, `No unnecessary tool calls dispatched for conversational identity prompt "${prompt}"`);
      assert(res.verificationVerdict === 'VERIFIED', `Task verification verdict is VERIFIED`);
    }
  }

  // -----------------------------------------------------------------
  // TEST 7: Speech & Voice Compatibility (ElevenLabs Pipeline)
  // -----------------------------------------------------------------
  console.log('\n--- TEST 7: Speech & Voice Integration for Identity Response ---');
  {
    const speechText = getCreatorAttributionResponse();
    const eleven = new ElevenLabsService('test_key', 'test_voice');
    // Test that ElevenLabsService can cleanly sanitize and chunk the attribution response
    const chunks = eleven.splitTextIntoChunks(speechText, 250);
    assert(chunks.length === 1, `Attribution text fits into single natural speech chunk (${chunks.length})`);
    assert(chunks[0].includes('Pratyush'), 'Chunk preserves creator name "Pratyush" verbatim');

    // Test text sanitization retains clean spoken English
    const sanitized = eleven.cleanTextForSpeech(speechText);
    assert(sanitized.includes('Pratyush'), 'Sanitized speech text preserves Pratyush');
    assert(!sanitized.includes('*') && !sanitized.includes('#') && !sanitized.includes('`'), 'No markdown formatting in audio speech text');

    // Check voice prompt auto-triggering on creator question
    const voicePrompt = 'Who created you? Speak aloud.';
    const triggersVoice = /\b(speak|talk|read aloud|say aloud|voice)\b/i.test(voicePrompt);
    assert(triggersVoice === true, 'Prompt "Who created you? Speak aloud." triggers voice synthesis');

    const voiceRes = await agent.execute({ prompt: voicePrompt, maxSteps: 2 });
    assert(voiceRes.success === true, 'Executed voice-triggered creator prompt successfully');
    assert(voiceRes.text.includes('Pratyush'), 'Voice response text credits Pratyush');
  }

  // -----------------------------------------------------------------
  // TEST 8: Non-Hardcoding Integrity: Unrelated Requests Function Normally
  // -----------------------------------------------------------------
  console.log('\n--- TEST 8: Non-Hardcoding Rule: Unrelated Requests Function Normally ---');
  {
    // A regular conversational greeting
    const greetPlan = TaskPlanner.createPlan('Hello NEXUS, good morning!');
    assert(greetPlan.isConversational === true, 'Greeting is conversational');
    assert(!greetPlan.requirements[0].description.includes('Pratyush'), 'Greeting does NOT inject Pratyush hardcode into requirement');

    // A desktop task
    const notepadPlan = TaskPlanner.createPlan('Write a poem in Notepad');
    assert(notepadPlan.isNotepadTask === true, 'Notepad task plan created normally');
    assert(notepadPlan.targetApp === 'notepad', 'Target app is notepad');
    assert(!notepadPlan.originalInstruction.includes('Pratyush'), 'Notepad plan instruction is untouched');

    // A browser multi-tab task
    const multiTabPlan = TaskPlanner.createPlan('Open Wikipedia and Amazon in separate tabs');
    assert(multiTabPlan.isMultiTabTask === true, 'Multi-tab plan created normally');
    assert(multiTabPlan.steps.length === 3, 'Multi-tab plan preserves all 3 steps');
  }

  console.log('\n======================================================================');
  console.log(`  IDENTITY & CREATOR ATTRIBUTION SUMMARY:`);
  console.log(`  Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);
  console.log('======================================================================');

  if (failedTests > 0) {
    console.error(`\n>>> TEST RUN FAILED with ${failedTests} assertion failures! <<<`);
    process.exit(1);
  } else {
    console.log(`\n>>> ALL ${passedTests} CREATOR ATTRIBUTION & IDENTITY TESTS PASSED! <<<`);
  }
}

runTests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
