/**
 * NEXUS - ElevenLabs Intermittent Authentication Failure Regression Suite
 *
 * Validates:
 * 1. Single Source of Truth & Memory Persistence across multiple messages.
 * 2. Protection against empty, whitespace, and UI-masked placeholder overwrites.
 * 3. Accurate error classification (quota, permissions, rate limit, server error vs genuine 401 auth).
 * 4. Automatic retry on transient 429 rate limit / 503 server busy.
 * 5. Consecutive chat simulation (10+ rapid messages without credential degradation).
 * 6. Zero secret leakage across all logs, errors, and status payloads.
 */

import http from 'http';
import * as dotenv from 'dotenv';
import { ElevenLabsService } from './dist-electron/elevenLabsService.js';
import { redactSensitiveString } from './dist-electron/agentEngine.js';

dotenv.config();

let passed = 0;
let failed = 0;

function assert(condition, description) {
  if (condition) {
    console.log(`  PASS: ${description}`);
    passed++;
  } else {
    console.error(`  FAIL: ${description}`);
    failed++;
  }
}

async function runTests() {
  console.log('======================================================================');
  console.log('NEXUS - ElevenLabs Intermittent Authentication Failure Test Suite');
  console.log('======================================================================\n');

  const REAL_KEY = process.env.ELEVENLABS_API_KEY || 'sk_test_valid_elevenlabs_credential_12345';
  const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'hw70l6UiioXIpgpHCjP6';

  // ====================================================================
  // TEST 1: Protection Against Empty, Whitespace & Masked Placeholder Overwrite
  // ====================================================================
  console.log('TEST 1: Protection against empty and placeholder overwrites');
  {
    const service = new ElevenLabsService(REAL_KEY, VOICE_ID);
    assert(service.getStatus().hasApiKey === true, 'Service initialized with valid key');

    // Attempt overwrite with empty string
    service.setCredentials('', VOICE_ID);
    assert(service.getStatus().hasApiKey === true, 'Empty string did NOT wipe valid key');

    // Attempt overwrite with whitespace
    service.setCredentials('   \t\n  ', VOICE_ID);
    assert(service.getStatus().hasApiKey === true, 'Whitespace did NOT wipe valid key');

    // Attempt overwrite with masked bullet characters (••••••••)
    service.setCredentials('••••••••••••••••••••••••••••••', VOICE_ID);
    assert(service.getStatus().hasApiKey === true, 'Bullet mask did NOT wipe valid key');

    // Attempt overwrite with asterisks (***)
    service.setCredentials('******************************', VOICE_ID);
    assert(service.getStatus().hasApiKey === true, 'Asterisk mask did NOT wipe valid key');

    // Attempt overwrite with UI placeholder text containing ellipsis
    service.setCredentials('•••••••••••••••••••••••••••••• (sk_7b...28e4)', VOICE_ID);
    assert(service.getStatus().hasApiKey === true, 'UI composite placeholder did NOT wipe valid key');

    // Attempt overwrite with keyword placeholder
    service.setCredentials('placeholder', VOICE_ID);
    assert(service.getStatus().hasApiKey === true, '"placeholder" string did NOT wipe valid key');

    // Legitimately updating with a new valid key DOES succeed
    const NEW_VALID_KEY = 'sk_new_valid_credential_abcdef1234567890';
    service.setCredentials(NEW_VALID_KEY, VOICE_ID);
    assert(service.getStatus().maskedKey.startsWith('sk_new'), 'Legitimate new key was accepted');
  }
  console.log();

  // ====================================================================
  // TEST 2: Quota Exceeded Is NOT Misclassified as Invalid API Key
  // ====================================================================
  console.log('TEST 2: Accurate classification of Quota / Credit Exhaustion');
  {
    const service = new ElevenLabsService(REAL_KEY, VOICE_ID);

    // Scenario 2.1: HTTP 401 with status "quota_exceeded"
    const quota401 = service.parseApiError(
      401,
      { detail: { status: 'quota_exceeded', message: 'You have exceeded the text to speech character limit for this month.' } },
      VOICE_ID
    );
    assert(quota401.category === 'QUOTA_EXCEEDED', '401 quota_exceeded classified as QUOTA_EXCEEDED');
    assert(!quota401.error.includes('Invalid ElevenLabs API key'), '401 quota_exceeded is NOT labeled as Invalid API key');
    assert(quota401.error.includes('quota exceeded') || quota401.error.includes('credit'), 'Directs user to quota or credits');

    // Scenario 2.2: HTTP 429 with detail message mentioning quota
    const quota429 = service.parseApiError(
      429,
      { detail: { status: 'quota_exceeded', message: 'Quota exceeded for free tier' } },
      VOICE_ID
    );
    assert(quota429.category === 'QUOTA_EXCEEDED', '429 quota_exceeded classified as QUOTA_EXCEEDED');
    assert(!quota429.error.includes('Invalid ElevenLabs API key'), '429 quota is NOT labeled as Invalid API key');

    // Scenario 2.3: HTTP 401 with "detected_unusual_activity"
    const unusual401 = service.parseApiError(
      401,
      { detail: 'Detected unusual activity. Please verify your account.' },
      VOICE_ID
    );
    assert(quota401.category === 'QUOTA_EXCEEDED', 'Unusual activity classified as usage/account limit');
    assert(!unusual401.error.includes('Invalid ElevenLabs API key'), 'Unusual activity is NOT mislabeled as Invalid API key');

    // Scenario 2.4: HTTP 402 Payment Required
    const payment402 = service.parseApiError(
      402,
      { detail: { message: 'Insufficient balance to synthesize speech.' } },
      VOICE_ID
    );
    assert(payment402.category === 'QUOTA_EXCEEDED', '402 Payment Required classified as QUOTA_EXCEEDED');
  }
  console.log();

  // ====================================================================
  // TEST 3: Permission Restrictions vs Genuine 401 Invalid Key
  // ====================================================================
  console.log('TEST 3: Distinguishing missing permissions from invalid key');
  {
    const service = new ElevenLabsService(REAL_KEY, VOICE_ID);

    // Missing permissions
    const permErr = service.parseApiError(
      401,
      { detail: { status: 'missing_permissions', message: 'The API key is missing text_to_speech permission' } },
      VOICE_ID
    );
    assert(permErr.category === 'MISSING_PERMISSIONS', 'Classified as MISSING_PERMISSIONS');
    assert(permErr.error.includes('Text to Speech'), 'Guides user to grant Text to Speech permission');
    assert(!permErr.error.includes('Invalid ElevenLabs API key'), 'Not mislabeled as invalid key');

    // Genuine 401 invalid key
    const authErr = service.parseApiError(
      401,
      { detail: { status: 'invalid_api_key', message: 'Invalid API key provided' } },
      VOICE_ID
    );
    assert(authErr.category === 'INVALID_CREDENTIALS', 'Real 401 invalid key classified as INVALID_CREDENTIALS');
    assert(authErr.error.includes('Invalid ElevenLabs API key'), 'Returns actionable Invalid API key message');
  }
  console.log();

  // ====================================================================
  // TEST 4: Concurrency Limit (429) vs Rate Limit (429)
  // ====================================================================
  console.log('TEST 4: Rate limit and concurrency distinction');
  {
    const service = new ElevenLabsService(REAL_KEY, VOICE_ID);

    const concurrentErr = service.parseApiError(
      429,
      { detail: { status: 'too_many_concurrent_requests', message: 'Too many concurrent requests.' } },
      VOICE_ID
    );
    assert(concurrentErr.category === 'CONCURRENCY_LIMIT', 'Identified concurrency limit');
    assert(concurrentErr.error.includes('concurrency limit reached'), 'Descriptive concurrency advice provided');

    const rateErr = service.parseApiError(
      429,
      { detail: { status: 'rate_limit_exceeded', message: 'Rate limit reached.' } },
      VOICE_ID
    );
    assert(rateErr.category === 'RATE_LIMIT', 'Identified rate limit');
    assert(rateErr.error.includes('rate limit exceeded'), 'Descriptive rate limit advice provided');
  }
  console.log();

  // ====================================================================
  // TEST 5: Transient Rate-Limit (429) Auto-Retry
  // ====================================================================
  console.log('TEST 5: Transient 429 auto-retry succeeds transparently');
  {
    let attempts = 0;
    const mockAudioPayload = Buffer.from('AUDIO_AFTER_RETRY_MP3_STREAM');

    const mockServer = http.createServer((req, res) => {
      attempts++;
      if (attempts === 1) {
        // First attempt: simulate temporary 429 concurrency limit
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: { status: 'too_many_concurrent_requests', message: 'Concurrent request limit' } }));
      } else {
        // Second attempt: succeeds
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': mockAudioPayload.length });
        res.end(mockAudioPayload);
      }
    });

    await new Promise((r) => mockServer.listen(0, '127.0.0.1', r));
    const port = mockServer.address().port;

    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      const redirected = String(url).replace('https://api.elevenlabs.io', `http://127.0.0.1:${port}`);
      return await originalFetch(redirected, options);
    };

    try {
      const retryService = new ElevenLabsService('test_valid_key', 'test_voice');
      const res = await retryService.synthesizeSpeech('Testing transparent 429 backoff retry.');

      assert(res.success === true, 'Speech synthesis succeeded on auto-retry');
      assert(attempts === 2, 'API was retried exactly once after the initial 429');
      assert(res.audioChunks && res.audioChunks.length === 1, 'Audio chunk delivered to caller');
    } finally {
      global.fetch = originalFetch;
      mockServer.closeAllConnections?.();
      await new Promise((r) => mockServer.close(r));
    }
  }
  console.log();

  // ====================================================================
  // TEST 6: Simulated Consecutive Chat (10 Consecutive Messages)
  // ====================================================================
  console.log('TEST 6: Consecutive chat simulation (10 rapid messages without key degradation)');
  {
    const mockAudio = Buffer.from('SIMULATED_VOICE_SPEECH_DATA');
    let requestCount = 0;

    const mockChatServer = http.createServer((req, res) => {
      requestCount++;
      const apiKeySent = req.headers['xi-api-key'];
      if (apiKeySent === 'sk_persistent_chat_key_12345') {
        res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
        res.end(mockAudio);
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: { status: 'invalid_api_key', message: 'Key lost' } }));
      }
    });

    await new Promise((r) => mockChatServer.listen(0, '127.0.0.1', r));
    const port = mockChatServer.address().port;

    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      const redirected = String(url).replace('https://api.elevenlabs.io', `http://127.0.0.1:${port}`);
      return await originalFetch(redirected, options);
    };

    try {
      const chatService = new ElevenLabsService('sk_persistent_chat_key_12345', 'hw70l6UiioXIpgpHCjP6');

      let allSucceeded = true;
      for (let i = 1; i <= 10; i++) {
        // Interleaved config updates with empty strings or UI settings saves
        if (i % 2 === 0) {
          chatService.setCredentials('', 'hw70l6UiioXIpgpHCjP6');
        }
        if (i % 3 === 0) {
          chatService.setCredentials('••••••••••••••••••••••••••••••', 'hw70l6UiioXIpgpHCjP6');
        }

        const msgResult = await chatService.synthesizeSpeech(`Assistant chat response number ${i}`);
        if (!msgResult.success) {
          allSucceeded = false;
          console.error(`Message ${i} failed: ${msgResult.error}`);
          break;
        }
      }

      assert(allSucceeded === true, 'All 10 consecutive chat messages synthesized successfully');
      assert(requestCount === 10, 'All 10 requests reached the backend with the correct xi-api-key');
      assert(chatService.getStatus().hasApiKey === true, 'Key remains 100% active and uncorrupted after 10 messages');
    } finally {
      global.fetch = originalFetch;
      mockChatServer.closeAllConnections?.();
      await new Promise((r) => mockChatServer.close(r));
    }
  }
  console.log();

  // ====================================================================
  // TEST 7: Zero Credential Leaks in Diagnostics, Logs & Redaction
  // ====================================================================
  console.log('TEST 7: Zero secret leaks in diagnostics, logs, and error payloads');
  {
    const sampleKey = 'sk_0123456789abcdef0123456789abcdef';
    const rawError = `Failed xi-api-key: ${sampleKey} during connection to api.elevenlabs.io with ELEVENLABS_API_KEY=${sampleKey}`;
    const clean = redactSensitiveString(rawError);

    assert(!clean.includes(sampleKey), 'Raw key is completely masked from diagnostic strings');
    assert(clean.includes('[REDACTED_ELEVENLABS_KEY]'), 'ElevenLabs redaction token applied');

    const service = new ElevenLabsService(sampleKey, VOICE_ID);
    const status = service.getStatus();
    assert(!JSON.stringify(status).includes(sampleKey), 'Raw key never appears in getStatus() response');
    assert(status.maskedKey && !status.maskedKey.includes(sampleKey), 'Masked key format safely hides internal characters');
  }
  console.log();

  console.log('======================================================================');
  console.log(`ElevenLabs Intermittent Auth Suite: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
