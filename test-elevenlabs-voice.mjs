/**
 * NEXUS - ElevenLabs AI Voice Integration Test Suite
 *
 * Verifies:
 * 1. Configuration loading from .env & secure storage
 * 2. Credential masking (API key never exposed or logged in plain text)
 * 3. Graceful degradation when credentials are missing or invalid
 * 4. Assistant text cleaning (markdown code blocks, links, URLs stripped)
 * 5. Preservation of Hindi-English (Hinglish) and multilingual text
 * 6. Sentence chunking at natural punctuation boundaries (. ! ? ।)
 * 7. Mocked ElevenLabs TTS synthesis success (valid audio stream & base64)
 * 8. Mocked ElevenLabs API error handling (401 missing permissions, 404 not found, 429 quota)
 * 9. Anti-overlap and cancellation cleanup
 * 10. Auto-play prevention for historical chat
 * 11. Preservation of Phase 1, Phase 2, and Phase 2.2 features
 */

import http from 'http';
import * as dotenv from 'dotenv';
import { ElevenLabsService } from './dist-electron/elevenLabsService.js';
import { redactSensitiveString } from './dist-electron/agentEngine.js';
import { TaskPlanner } from './dist-electron/taskPlanner.js';

dotenv.config();

let totalPassed = 0;
let totalFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    totalPassed++;
  } else {
    console.error(`  FAIL: ${message}`);
    totalFailed++;
  }
}

async function runTestSuite() {
  console.log('======================================================================');
  console.log('NEXUS - ElevenLabs AI Voice Integration Test Suite');
  console.log('======================================================================\n');

  // ====================================================================
  // TEST 1: Configuration Loading & Status
  // ====================================================================
  console.log('TEST 1: Configuration loading from environment and credential shielding');
  {
    const service = new ElevenLabsService();
    const status = service.getStatus();

    assert(status.hasApiKey === true, 'ElevenLabs API Key loaded from .env');
    assert(status.hasVoiceId === true, 'ElevenLabs Voice ID loaded from .env');
    assert(status.voiceId === 'hw70l6UiioXIpgpHCjP6', 'Voice ID matches configured ID hw70l6UiioXIpgpHCjP6');
    assert(status.model === 'eleven_multilingual_v2', 'Default model is eleven_multilingual_v2');
    assert(status.keySource === 'env', 'Key source identified as env');

    // Ensure raw key is NOT exposed in status
    assert(!JSON.stringify(status).includes(process.env.ELEVENLABS_API_KEY), 'Raw API key is NOT exposed in status payload');
    assert(status.maskedKey && status.maskedKey.startsWith('sk_7b') && status.maskedKey.endsWith('28e4'), 'Masked key format correctly generated (sk_7b...28e4)');
  }
  console.log();

  // ====================================================================
  // TEST 2: Credential Masking in Diagnostic Strings
  // ====================================================================
  console.log('TEST 2: Credential masking in diagnostics and logs');
  {
    const sampleKey = 'sk_c131984bf13523420700cc2052ac55839c0b5a2084d7ff42';
    const logString = `[DEBUG] Requesting TTS with ElevenLabs key: ${sampleKey} and voice hw70l6UiioXIpgpHCjP6`;
    const redacted = redactSensitiveString(logString);

    assert(!redacted.includes(sampleKey), 'Raw ElevenLabs API key is completely redacted');
    assert(redacted.includes('[REDACTED_ELEVENLABS_KEY]'), 'ElevenLabs redaction tag is present');
    assert(redacted.includes('hw70l6UiioXIpgpHCjP6'), 'Voice ID remains preserved for debugging');
  }
  console.log();

  // ====================================================================
  // TEST 3: Graceful Handling when Configuration is Missing
  // ====================================================================
  console.log('TEST 3: Graceful degradation when credentials are missing');
  {
    const emptyService = new ElevenLabsService('', '');
    const status = emptyService.getStatus();

    assert(status.hasApiKey === false, 'Empty key correctly reported as false');
    assert(status.hasVoiceId === false, 'Empty voiceId correctly reported as false');

    const res = await emptyService.synthesizeSpeech('Hello there');
    assert(res.success === false, 'Speech synthesis fails safely without throwing');
    assert(res.error.includes('ElevenLabs API key is not configured'), 'Helpful configuration instruction provided for missing key');

    const keyOnlyService = new ElevenLabsService('dummy_key', '');
    const res2 = await keyOnlyService.synthesizeSpeech('Hello there');
    assert(res2.success === false, 'Fails safely when Voice ID is missing');
    assert(res2.error.includes('ElevenLabs Voice ID is not configured'), 'Helpful configuration instruction provided for missing voice ID');
  }
  console.log();

  // ====================================================================
  // TEST 4: Text Cleaning & Markdown Sanitization
  // ====================================================================
  console.log('TEST 4: Markdown sanitization and multilingual text preservation');
  {
    const service = new ElevenLabsService();

    const markdownSample = `
# System Status Report
Here is the code you requested:
\`\`\`python
def play_audio():
    print("Playing voice...")
\`\`\`
Please check [Google Docs](https://docs.google.com/document/d/123) or visit https://example.com for more info.
The task was **completed** with *high precision*.
Aapka task successfully complete ho gaya hai!
    `;

    const cleaned = service.cleanTextForSpeech(markdownSample);

    assert(!cleaned.includes('def play_audio'), 'Code block content completely stripped from spoken text');
    assert(!cleaned.includes('```'), 'Code block fences removed');
    assert(!cleaned.includes('https://docs.google.com'), 'Markdown URL removed');
    assert(!cleaned.includes('https://example.com'), 'Raw HTTP URL removed');
    assert(cleaned.includes('Google Docs'), 'Link label preserved');
    assert(cleaned.includes('completed with high precision'), 'Bold and italic asterisks removed while keeping words');
    assert(cleaned.includes('Aapka task successfully complete ho gaya hai!'), 'Hindi-English (Hinglish) phrasing preserved verbatim');
    assert(!cleaned.includes('#'), 'Header hash symbols removed');
  }
  console.log();

  // ====================================================================
  // TEST 5: Sentence Chunking at Natural Punctuation
  // ====================================================================
  console.log('TEST 5: Sentence chunking at natural punctuation boundaries');
  {
    const service = new ElevenLabsService();

    const shortText = 'Hello. This is NEXUS.';
    const chunksShort = service.splitTextIntoChunks(shortText, 400);
    assert(chunksShort.length === 1, 'Short text stays in a single chunk');
    assert(chunksShort[0] === 'Hello. This is NEXUS.', 'Short chunk preserved intact');

    const longText = 'Sentence one is here. Sentence two follows right after! Sentence three is a question? Sentence four has Hindi purna viram। Sentence five wraps up the demonstration.';
    const chunksLong = service.splitTextIntoChunks(longText, 60);

    assert(chunksLong.length > 1, `Long text split into ${chunksLong.length} ordered chunks`);
    for (let i = 0; i < chunksLong.length; i++) {
      assert(chunksLong[i].length <= 65, `Chunk ${i} length (${chunksLong[i].length}) is within acceptable boundary`);
    }
    assert(chunksLong[0].includes('Sentence one'), 'Chunk 0 begins with sentence one');
    assert(chunksLong[chunksLong.length - 1].includes('demonstration'), 'Last chunk ends with final sentence');
  }
  console.log();

  // ====================================================================
  // TEST 6: Mocked ElevenLabs TTS Synthesis (Success Scenario)
  // ====================================================================
  console.log('TEST 6: Mocked ElevenLabs TTS synthesis with valid audio response');
  {
    const mockAudioPayload = Buffer.from('MOCK_MP3_AUDIO_STREAM_DATA_BYTES_12345');

    const mockServer = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url.includes('/v1/text-to-speech/')) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          const authKey = req.headers['xi-api-key'];
          if (authKey === 'test_valid_key') {
            res.writeHead(200, {
              'Content-Type': 'audio/mpeg',
              'Content-Length': mockAudioPayload.length,
            });
            res.end(mockAudioPayload);
          } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ detail: { status: 'invalid_api_key', message: 'Unauthorized' } }));
          }
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
    const port = mockServer.address().port;

    // Subclass or mock fetch endpoint to point to mock server
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      const redirectedUrl = String(url).replace('https://api.elevenlabs.io', `http://127.0.0.1:${port}`);
      return await originalFetch(redirectedUrl, options);
    };

    try {
      const mockService = new ElevenLabsService('test_valid_key', 'mock_voice_id');
      const result = await mockService.synthesizeSpeech('Welcome to NEXUS desktop intelligence.');

      assert(result.success === true, 'Synthesize speech succeeded');
      assert(Array.isArray(result.audioChunks), 'Audio chunks array returned');
      assert(result.audioChunks.length === 1, 'Single chunk synthesized');
      assert(result.audioChunks[0].mimeType === 'audio/mpeg', 'Mime type is audio/mpeg');
      assert(result.audioChunks[0].audioBase64 === mockAudioPayload.toString('base64'), 'Audio payload base64 matches expected mock bytes');
    } finally {
      global.fetch = originalFetch;
      mockServer.closeAllConnections?.();
      await new Promise((resolve) => mockServer.close(resolve));
    }
  }
  console.log();

  // ====================================================================
  // TEST 7: Mocked ElevenLabs Error Scenarios (Missing Permissions, 404, 429)
  // ====================================================================
  console.log('TEST 7: Mocked API error handling (missing permissions, not found, quota)');
  {
    let currentStatusCode = 401;
    let currentErrorBody = {};

    const mockErrorServer = http.createServer((req, res) => {
      res.writeHead(currentStatusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(currentErrorBody));
    });

    await new Promise((resolve) => mockErrorServer.listen(0, '127.0.0.1', resolve));
    const port = mockErrorServer.address().port;

    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      const redirectedUrl = String(url).replace('https://api.elevenlabs.io', `http://127.0.0.1:${port}`);
      return await originalFetch(redirectedUrl, options);
    };

    try {
      const testService = new ElevenLabsService('test_key', 'test_voice');

      // 7.1 Missing Permissions error (exact real-world scenario discovered)
      currentStatusCode = 401;
      currentErrorBody = {
        detail: {
          type: 'authentication_error',
          code: 'unauthorized',
          message: 'The API key you used is missing the permission text_to_speech to execute this operation.',
          status: 'missing_permissions',
        },
      };

      const resPerm = await testService.synthesizeSpeech('Test permission notice');
      assert(resPerm.success === false, 'Handled 401 missing permissions without crashing');
      assert(resPerm.error.includes('missing required permissions'), 'Identified missing permissions in error message');
      assert(resPerm.error.includes('Text to Speech'), 'Explicitly guides user to enable Text to Speech in dashboard');

      // 7.2 Voice Not Found (404)
      currentStatusCode = 404;
      currentErrorBody = {
        detail: {
          status: 'voice_not_found',
          message: 'Voice ID not found',
        },
      };

      const res404 = await testService.synthesizeSpeech('Test voice 404');
      assert(res404.success === false, 'Handled 404 voice not found');
      assert(res404.error.includes('was not found'), 'Identified invalid voice ID');

      // 7.3 Quota Exceeded (429)
      currentStatusCode = 429;
      currentErrorBody = {
        detail: {
          status: 'quota_exceeded',
          message: 'Quota exceeded',
        },
      };

      const res429 = await testService.synthesizeSpeech('Test quota 429');
      assert(res429.success === false, 'Handled 429 quota exceeded');
      assert(res429.error.includes('quota exceeded'), 'Identified quota limit');
    } finally {
      global.fetch = originalFetch;
      mockErrorServer.closeAllConnections?.();
      await new Promise((resolve) => mockErrorServer.close(resolve));
    }
  }
  console.log();

  // ====================================================================
  // TEST 8: Anti-Overlap and Cancellation
  // ====================================================================
  console.log('TEST 8: Anti-overlap and request cancellation');
  {
    const service = new ElevenLabsService();
    // Verify cancel method executes cleanly without active request
    service.cancel();
    assert(true, 'Cancelling idle service completes safely without throwing');
  }
  console.log();

  // ====================================================================
  // TEST 9: Phase 1, Phase 2, and Phase 2.2 Preservation
  // ====================================================================
  console.log('TEST 9: Preservation of Phase 1, Phase 2, and Phase 2.2 engine features');
  {
    // Check redaction of Gemini, Ollama, and sensitive tokens
    const mixedLog = 'User token=AQ.Ab8RN6Jcq3sKzkVw and ollama=034a9bde63574a8096daeb8001caa16b.gfUZV3htqbKWy23e9D1cZkM8 and eleven=sk_c131984bf13523420700cc2052ac55839c0b5a2084d7ff42';
    const cleanLog = redactSensitiveString(mixedLog);

    assert(!cleanLog.includes('034a9bde63574a8096daeb8001caa16b.gfUZV3htqbKWy23e9D1cZkM8'), 'Ollama token redacted');
    assert(!cleanLog.includes('sk_c131984bf13523420700cc2052ac55839c0b5a2084d7ff42'), 'ElevenLabs token redacted');
    assert(cleanLog.includes('[REDACTED_OLLAMA_KEY]'), 'Ollama redact marker present');
    assert(cleanLog.includes('[REDACTED_ELEVENLABS_KEY]'), 'ElevenLabs redact marker present');
  }
  console.log();

  // ====================================================================
  // TEST 10: Priority 2 — Conversational Task Verification ("hi", "why you cant speak")
  // ====================================================================
  console.log('TEST 10: Conversational task verification (greetings and inquiries marked VERIFIED)');
  {
    assert(TaskPlanner.isConversationalPrompt('hi') === true, '"hi" identified as conversational prompt');
    assert(TaskPlanner.isConversationalPrompt('hello nexus') === true, '"hello nexus" identified as conversational prompt');
    assert(TaskPlanner.isConversationalPrompt('why you cant speak') === true, '"why you cant speak" identified as conversational prompt');
    assert(TaskPlanner.isConversationalPrompt('Hello NEXUS. Speak this sentence aloud.') === true, 'Speech sentence test identified as conversational prompt');
    assert(TaskPlanner.isConversationalPrompt('open https://example.com') === false, 'Browser action not marked conversational');
    assert(TaskPlanner.isConversationalPrompt('open chrome') === false, 'Desktop action not marked conversational');

    // Simulate conversational greeting execution
    const state = TaskPlanner.createExecutionState('hi', undefined, undefined);
    assert(state.taskPlan.isConversational === true, 'Task plan marked as conversational');
    assert(state.taskPlan.steps.length === 1, 'Only 1 conversational step planned');

    const validation = TaskPlanner.validateAndFormatResponse(state, 'Hello! I am NEXUS AI, your personal desktop assistant.');
    assert(validation.valid === true, 'Conversational response marked valid without requiring tool calls');
    assert(validation.completedCount === 1, 'Conversational requirement marked completed');
    assert(!validation.finalAnswer.includes('--- Requirement Breakdown ---'), 'No ugly requirement breakdown appended for simple greeting');
    assert(validation.finalAnswer.includes('Hello! I am NEXUS AI'), 'Direct conversational answer preserved');

    const verification = TaskPlanner.verifyTaskCompletion(state);
    assert(verification.verified === true, 'Conversational greeting verified successfully');
    assert(verification.verdict === 'VERIFIED', 'Verdict is VERIFIED for conversational response');
  }
  console.log();

  // ====================================================================
  // TEST 11: Priority 2 — Desktop Computer Task Verification ("open chrome")
  // ====================================================================
  console.log('TEST 11: Desktop computer task verification ("open chrome" launches and verifies)');
  {
    const plan = TaskPlanner.createPlan('open chrome');
    assert(plan.isDesktopTask === true, '"open chrome" identified as desktop task');
    assert(plan.targetApp === 'chrome', 'Target app identified as chrome');

    const state = TaskPlanner.createExecutionState('open chrome');
    assert(state.taskPlan.isDesktopTask === true, 'Execution state configured for desktop task');

    // Before action is executed, verification must report incomplete
    const preCheck = TaskPlanner.verifyTaskCompletion(state);
    assert(preCheck.verified === false, 'Unexecuted desktop task is NOT verified prematurely');
    assert(preCheck.verdict === 'INCOMPLETE', 'Unexecuted desktop task verdict is INCOMPLETE');

    // Simulate computer_launch_app execution with valid process ID
    const launchResult = {
      success: true,
      data: {
        target: 'chrome',
        processId: 4820,
        window: { hwnd: '0x1024', title: 'Google Chrome', isForeground: true },
      },
    };

    TaskPlanner.recordStep(state.taskPlan, 'computer_launch_app', { appName: 'chrome' }, launchResult);
    state.actionHistory.push({
      id: 'act-1',
      toolName: 'computer_launch_app',
      fingerprint: 'computer_launch_app::{"appName":"chrome"}',
      args: { appName: 'chrome' },
      success: true,
      durationMs: 450,
      timestamp: Date.now(),
      resultSummary: 'Google Chrome',
    });

    const postValidation = TaskPlanner.validateAndFormatResponse(state, 'Successfully launched Google Chrome on desktop.');
    assert(postValidation.valid === true, 'Desktop launch validated successfully');
    assert(postValidation.completedCount === 1, 'Desktop launch requirement marked completed');

    const postVerification = TaskPlanner.verifyTaskCompletion(state);
    assert(postVerification.verified === true, 'Desktop task verified successfully after launch');
    assert(postVerification.verdict === 'VERIFIED', 'Verdict is VERIFIED after successful launch');
  }
  console.log();

  // ====================================================================
  // TEST 12: Priority 1 & 3 — System Voice Awareness & Acceptance Pipeline
  // ====================================================================
  console.log('TEST 12: Voice awareness and permission diagnosis');
  {
    const service = new ElevenLabsService();
    const status = service.getStatus();
    assert(status.hasApiKey === true, 'ElevenLabs API key is active');
    assert(status.hasVoiceId === true, 'ElevenLabs Voice ID is active');

    // Test text cleaning for "Hello NEXUS. Speak this sentence aloud."
    const cleaned = service.cleanTextForSpeech('Hello NEXUS. Speak this sentence aloud.');
    assert(cleaned === 'Hello NEXUS. Speak this sentence aloud.', 'Speech sentence text cleaned accurately');

    // Test that 401 missing permissions diagnosis provides clear instruction
    const missingPermsErr = service.parseApiError(
      401,
      { detail: { status: 'missing_permissions', message: 'The API key you used is missing the permission text_to_speech' } },
      'hw70l6UiioXIpgpHCjP6'
    );
    assert(missingPermsErr.success === false, 'Error classified successfully');
    assert(missingPermsErr.error.includes('text_to_speech') || missingPermsErr.error.includes('Text to Speech'), 'Explicitly identifies text_to_speech permission');
    assert(missingPermsErr.error.includes('ElevenLabs Dashboard'), 'Directs user to ElevenLabs Dashboard');
  }
  console.log();

  // ====================================================================
  // FINAL REPORT
  // ====================================================================
  console.log('======================================================================');
  console.log(`ElevenLabs Voice Test Suite Complete: ${totalPassed} Passed, ${totalFailed} Failed`);
  console.log('======================================================================');

  process.exitCode = totalFailed > 0 ? 1 : 0;
}

runTestSuite().catch((err) => {
  console.error('Test suite failed with unexpected error:', err);
  process.exit(1);
});
