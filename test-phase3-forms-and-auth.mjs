import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { BrowserService } from './dist-electron/browserService.js';
import { CredentialManager } from './dist-electron/credentialStore.js';
import { ToolDispatcher, isSensitiveField, isToolActionConsequential } from './dist-electron/toolRegistry.js';
import { TaskPlanner } from './dist-electron/taskPlanner.js';
import { redactSensitiveString } from './dist-electron/agentEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure local test hostnames are allowed for automated testing
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
    console.log(`  PASS: ${message}`);
  } else {
    failedTests++;
    console.error(`  FAIL: ${message}`);
  }
}

// ---------------------------------------------------------------------
// 1. Setup Local Mock HTTP Server with Login, Register, & Security Pages
// ---------------------------------------------------------------------
function startMockServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const url = req.url || '/';

      if (url === '/login' || url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>Secure NEXUS Portal - Sign In</title></head>
<body>
  <h1>Member Sign In</h1>
  <form id="login-form" method="POST" action="/submit-login">
    <div>
      <label for="user-id">Email or Username</label>
      <input id="user-id" name="username" type="text" placeholder="name@example.com" required />
    </div>
    <div style="margin-top: 10px;">
      <label for="pass-field">Secret Password</label>
      <input id="pass-field" name="password" type="password" placeholder="Enter password" required />
    </div>
    <div style="margin-top: 15px;">
      <button type="submit" id="btn-submit">Sign In</button>
    </div>
  </form>
</body>
</html>`);
      } else if (url === '/submit-login') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const params = new URLSearchParams(body);
          const u = params.get('username');
          const p = params.get('password');

          if (u === 'admin@nexus.ai' && p === 'NexusSecure2026!') {
            res.writeHead(302, { Location: '/dashboard' });
            res.end();
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<!DOCTYPE html>
<html>
<head><title>Sign In Failed</title></head>
<body>
  <h1>Member Sign In</h1>
  <div role="alert" class="error-message" style="color: red; font-weight: bold;">
    Invalid username or password. Authentication failed.
  </div>
  <form id="login-form" method="POST" action="/submit-login">
    <div>
      <label for="user-id">Email or Username</label>
      <input id="user-id" name="username" type="text" value="${u || ''}" />
    </div>
    <div>
      <label for="pass-field">Secret Password</label>
      <input id="pass-field" name="password" type="password" />
    </div>
    <button type="submit" id="btn-submit">Sign In</button>
  </form>
</body>
</html>`);
          }
        });
      } else if (url === '/dashboard') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>NEXUS User Dashboard</title></head>
<body>
  <h1>Welcome to your NEXUS Dashboard</h1>
  <p>System status: All services operational.</p>
  <button id="btn-logout">Log Out</button>
</body>
</html>`);
      } else if (url === '/register') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>Create Your NEXUS Account</title></head>
<body>
  <h1>New Member Registration</h1>
  <form id="register-form" method="POST" action="/submit-register">
    <div>
      <label for="full-name">Full Name</label>
      <input id="full-name" name="name" type="text" placeholder="John Doe" required />
    </div>
    <div>
      <label for="email-addr">Email Address</label>
      <input id="email-addr" name="email" type="email" placeholder="john@example.com" required />
    </div>
    <div>
      <label for="reg-pass">Create Password</label>
      <input id="reg-pass" name="password" type="password" placeholder="Min 8 chars" required />
    </div>
    <div>
      <label for="account-tier">Account Tier</label>
      <select id="account-tier" name="tier">
        <option value="basic">Basic User</option>
        <option value="developer">Developer</option>
        <option value="enterprise">Enterprise</option>
      </select>
    </div>
    <div style="margin-top: 8px;">
      <label>
        <input type="checkbox" id="terms-agree" name="terms" />
        I accept the Terms and Conditions
      </label>
    </div>
    <div style="margin-top: 15px;">
      <button type="submit" id="btn-register">Create Account</button>
    </div>
  </form>
</body>
</html>`);
      } else if (url === '/submit-register') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>Registration Complete</title></head>
<body>
  <h1>Account Created Successfully</h1>
  <p>Your registration is complete.</p>
</body>
</html>`);
      } else if (url === '/captcha') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>Protected Sign In</title></head>
<body>
  <h1>Protected Login</h1>
  <form id="captcha-form">
    <input type="text" name="user" placeholder="Username" />
    <input type="password" name="pass" placeholder="Password" />
    <div class="g-recaptcha" id="recaptcha"></div>
    <p>Please complete two-factor authentication verification code below:</p>
    <input type="text" autocomplete="one-time-code" name="otp" placeholder="6-digit verification code" />
    <button type="submit">Verify & Login</button>
  </form>
</body>
</html>`);
      } else if (url === '/ambiguous') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>Ambiguous Fields Form</title></head>
<body>
  <h1>Ambiguous Contact Form</h1>
  <form id="ambig-form">
    <div>
      <input type="text" name="phone" placeholder="Phone Number" />
    </div>
    <div>
      <input type="text" name="phone" placeholder="Phone Number" />
    </div>
    <button type="submit">Submit</button>
  </form>
</body>
</html>`);
      } else if (url === '/dynamic') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html>
<html>
<head><title>Dynamic Form</title></head>
<body>
  <h1>Dynamic Form</h1>
  <div id="container">
    <label for="dyn-input">Dynamic Input</label>
    <input id="dyn-input" name="dyn" type="text" placeholder="Type here" />
  </div>
  <button id="btn-dyn">Submit</button>
  <script>
    // Simulate DOM re-render upon first focus
    let replaced = false;
    document.getElementById('dyn-input').addEventListener('focus', function() {
      if (!replaced) {
        replaced = true;
        const cont = document.getElementById('container');
        cont.innerHTML = '<label for="dyn-input">Dynamic Input</label><input id="dyn-input" name="dyn" type="text" placeholder="Type here" />';
      }
    });
  </script>
</body>
</html>`);
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

// ---------------------------------------------------------------------
// Main Test Runner
// ---------------------------------------------------------------------
async function runPhase3Tests() {
  console.log('\n======================================================');
  console.log('NEXUS Phase 3: Secure Login & Intelligent Form Automation');
  console.log('======================================================\n');

  await startMockServer();
  console.log(`Mock server running at ${baseUrl}`);

  const downloadsDir = path.join(__dirname, 'test-downloads');
  const browserService = new BrowserService(downloadsDir);
  browserService.setBackgroundMode(true); // Headless for test suite

  try {
    // -----------------------------------------------------------------
    // TEST 1: Intelligent Form & Input Inspection (inspectForms)
    // -----------------------------------------------------------------
    console.log('\nTEST 1: Form & Input Detection (inspectForms)');
    await browserService.navigate(`${baseUrl}/login`);
    const loginInspection = await browserService.inspectForms();

    assert(loginInspection.success === true, 'inspectForms succeeded on login page');
    assert(loginInspection.forms && loginInspection.forms.length === 1, 'Detected exactly 1 form on login page');
    const loginForm = loginInspection.forms[0];
    assert(loginForm.purpose === 'login', `Correctly identified form purpose as "login" (got "${loginForm.purpose}")`);
    assert(loginForm.fields.length === 2, `Detected 2 interactive input fields (got ${loginForm.fields.length})`);
    
    const userField = loginForm.fields.find(f => f.name === 'username' || f.type === 'text');
    const passField = loginForm.fields.find(f => f.type === 'password');
    assert(userField !== undefined, 'Detected username/email field');
    assert(userField.label === 'Email or Username', `Extracted accessible label: "${userField.label}"`);
    assert(passField !== undefined, 'Detected password field');
    assert(passField.label === 'Secret Password', `Extracted password label: "${passField.label}"`);
    assert(loginForm.submitButtons.length === 1, 'Detected submit button');
    assert(loginForm.submitButtons[0].text === 'Sign In', `Submit button text is "${loginForm.submitButtons[0].text}"`);

    // Inspect Registration Page
    await browserService.navigate(`${baseUrl}/register`);
    const regInspection = await browserService.inspectForms();
    assert(regInspection.success === true, 'inspectForms succeeded on registration page');
    const regForm = regInspection.forms[0];
    assert(regForm.purpose === 'registration', `Correctly identified purpose as "registration" (got "${regForm.purpose}")`);
    
    const selectField = regForm.fields.find(f => f.tag === 'select');
    assert(selectField !== undefined, 'Detected <select> dropdown field');
    assert(selectField.options && selectField.options.length === 3, 'Extracted dropdown options list (3 tiers)');
    
    const checkField = regForm.fields.find(f => f.type === 'checkbox');
    assert(checkField !== undefined, 'Detected checkbox element');
    assert(checkField.label.includes('Terms and Conditions'), 'Extracted checkbox label correctly');

    // -----------------------------------------------------------------
    // TEST 2: Authorized Login Success & Post-Authentication Verification
    // -----------------------------------------------------------------
    console.log('\nTEST 2: Authorized Login Success with Accurate Verification');
    await browserService.navigate(`${baseUrl}/login`);
    
    const validLoginResult = await browserService.executeLogin({
      username: 'admin@nexus.ai',
      password: 'NexusSecure2026!',
      submit: true,
    });

    assert(validLoginResult.success === true, 'executeLogin returned success: true');
    assert(validLoginResult.state === 'completed', `Task state is "completed" (got "${validLoginResult.state}")`);
    assert(validLoginResult.url.includes('/dashboard'), `Browser redirected to /dashboard (got "${validLoginResult.url}")`);
    assert(validLoginResult.content.includes('Login succeeded'), 'Reported grounded success message');

    // -----------------------------------------------------------------
    // TEST 3: Incorrect Credentials and Failed Login Verification
    // -----------------------------------------------------------------
    console.log('\nTEST 3: Incorrect Credentials and Failed Login Handling');
    await browserService.navigate(`${baseUrl}/login`);

    const failedLoginResult = await browserService.executeLogin({
      username: 'admin@nexus.ai',
      password: 'IncorrectPassword999!',
      submit: true,
    });

    assert(failedLoginResult.success === false, 'executeLogin returned success: false for invalid credentials');
    assert(failedLoginResult.state === 'failed', `Task state accurately set to "failed" (got "${failedLoginResult.state}")`);
    assert(failedLoginResult.error && failedLoginResult.error.includes('Invalid username or password'), 'Accurately detected site error message');
    assert(!failedLoginResult.url.includes('/dashboard'), 'Did not falsely claim success or redirect');

    // -----------------------------------------------------------------
    // TEST 4: General Form Filling (smartFillForm) with Dropdowns & Checkboxes
    // -----------------------------------------------------------------
    console.log('\nTEST 4: General Form Filling with Text, Select, and Checkbox');
    await browserService.navigate(`${baseUrl}/register`);

    const fillResult = await browserService.smartFillForm({
      fields: {
        'Full Name': 'Elena Vance',
        'Email Address': 'elena@nexus.ai',
        'Create Password': 'SuperSecretPassword2026!',
        'Account Tier': 'Developer',
        'terms-agree': true,
      },
      submit: true,
    });

    assert(fillResult.success === true, 'smartFillForm completed successfully');
    assert(fillResult.filledCount === 5, `Filled all 5 fields (got ${fillResult.filledCount})`);
    assert(fillResult.verifiedCount === 5, 'Verified all 5 fields entered accurately');
    assert(fillResult.url.includes('/submit-register'), `Form submitted and redirected to /submit-register (got "${fillResult.url}")`);

    // -----------------------------------------------------------------
    // TEST 5: Password Redaction and Secret-Safe Telemetry
    // -----------------------------------------------------------------
    console.log('\nTEST 5: Password Redaction and Secret Shielding');
    const secretLog = 'User entered password: "SuperSecretPassword2026!" for account admin@nexus.ai with api_key="sk_live_1234567890abcdef1234567890abcdef"';
    const redactedLog = redactSensitiveString(secretLog);

    assert(!redactedLog.includes('SuperSecretPassword2026!'), 'Plaintext password redacted from string');
    assert(redactedLog.includes('[REDACTED_PASSWORD]') || redactedLog.includes('[REDACTED]'), 'Password replaced with redaction token');
    assert(!redactedLog.includes('sk_live_1234567890abcdef'), 'API key redacted from string');

    // Check smartFillForm masked return values
    const passVerification = fillResult.verifications && fillResult.verifications['Create Password'];
    assert(passVerification !== undefined, 'Verification record exists for password field');
    assert(passVerification.actualValue === '••••••••', `Password value masked in verification payload (got "${passVerification.actualValue}")`);

    // -----------------------------------------------------------------
    // TEST 6: Consequential Action Approval Check
    // -----------------------------------------------------------------
    console.log('\nTEST 6: Consequential Action Approval Check');
    assert(isToolActionConsequential('browser_login') === true, 'browser_login classified as consequential');
    assert(isToolActionConsequential('smart_fill_form', { submit: true }) === true, 'smart_fill_form with submit:true classified as consequential');
    assert(isSensitiveField('password') === true, '"password" field identified as sensitive');
    assert(isSensitiveField('secret_code') === true, '"secret_code" identified as sensitive');
    assert(isSensitiveField('first_name') === false, '"first_name" field identified as non-sensitive');

    // -----------------------------------------------------------------
    // TEST 7: Security Challenges (CAPTCHA & MFA) Pause (BLOCKED State)
    // -----------------------------------------------------------------
    console.log('\nTEST 7: Security Challenges Detection (CAPTCHA / MFA)');
    await browserService.navigate(`${baseUrl}/captcha`);
    const challenge = await browserService.detectSecurityChallenges();

    assert(challenge.hasChallenge === true, 'Security challenge detected on protected page');
    assert(challenge.challengeType === 'CAPTCHA' || challenge.challengeType === 'MFA', `Challenge type identified as ${challenge.challengeType}`);

    // Verify executeLogin halts with 'blocked' state when challenge is present
    const blockedLogin = await browserService.executeLogin({
      username: 'admin@nexus.ai',
      password: 'password123',
    });
    assert(blockedLogin.success === false, 'executeLogin paused and returned false for security challenge');
    assert(blockedLogin.state === 'blocked', `Task state transitioned to "blocked" (got "${blockedLogin.state}")`);
    assert(blockedLogin.error && blockedLogin.error.includes('Security challenge detected'), 'Error contains clear guidance on manual interaction');

    // -----------------------------------------------------------------
    // TEST 8: Ambiguous Fields Detection
    // -----------------------------------------------------------------
    console.log('\nTEST 8: Ambiguous Fields Detection');
    await browserService.navigate(`${baseUrl}/ambiguous`);
    const ambigInspection = await browserService.inspectForms();
    const ambigField = ambigInspection.forms[0].fields.find(f => f.isAmbiguous === true);
    assert(ambigField !== undefined, 'Flagged duplicate field with same name/placeholder as ambiguous');

    // -----------------------------------------------------------------
    // TEST 9: Dynamic Forms and Stale Locator Resilience
    // -----------------------------------------------------------------
    console.log('\nTEST 9: Dynamic DOM Re-rendering Resilience');
    await browserService.navigate(`${baseUrl}/dynamic`);
    const dynResult = await browserService.smartFillForm({
      fields: {
        'Dynamic Input': 'Resilient Value Test',
      },
    });
    assert(dynResult.success === true, 'smartFillForm recovered and succeeded despite dynamic element replacement');
    assert(dynResult.filledCount === 1, 'Field filled after DOM re-render');

    // -----------------------------------------------------------------
    // TEST 10: Domain-Bound Secure Credential Manager
    // -----------------------------------------------------------------
    console.log('\nTEST 10: Domain-Bound Credential Vault');
    const credMgr = CredentialManager.getInstance();
    credMgr.setSessionCredential('portal.example.com', 'user_john', 'SuperSecurePass123!');

    const retrievedExact = credMgr.getSessionCredential('https://portal.example.com/login');
    assert(retrievedExact !== null, 'Session credential retrieved for target domain');
    assert(retrievedExact.username === 'user_john', 'Username matches stored value');
    assert(retrievedExact.password === 'SuperSecurePass123!', 'Password decrypted accurately in memory');

    const retrievedWrongDomain = credMgr.getSessionCredential('https://malicious-site.com/login');
    assert(retrievedWrongDomain === null, 'Credential retrieval strictly blocked on unauthorized domain');

    // Persistent encryption test
    credMgr.storePersistentCredential('vault.example.com', 'vault_user', 'PersistentEncryptedPass!');
    const persistentCred = credMgr.getPersistentCredential('vault.example.com');
    assert(persistentCred !== null, 'Persistent credential retrieved and decrypted');
    assert(persistentCred.password === 'PersistentEncryptedPass!', 'Decrypted persistent secret matches original');

    // -----------------------------------------------------------------
    // TEST 11: Task Planning & Explicit Status Tracking
    // -----------------------------------------------------------------
    console.log('\nTEST 11: Task Planning for Login & Form Workflows');
    const loginPlan = TaskPlanner.createPlan('Open https://example.com/login and log in using the credentials I provide');
    assert(loginPlan.requirements.length === 4, `Login task parsed into 4 explicit requirements (got ${loginPlan.requirements.length})`);
    assert(loginPlan.requirements[0].description.includes('inspect login form'), 'Req 1 tracks form & challenge inspection');
    assert(loginPlan.requirements[1].description.includes('Fill credentials'), 'Req 2 tracks secure credential filling');
    assert(loginPlan.requirements[2].description.includes('authorization'), 'Req 3 tracks authorization before submission');
    assert(loginPlan.requirements[3].description.includes('Verify login outcome'), 'Req 4 tracks outcome verification');

    const regPlan = TaskPlanner.createPlan('Open this registration form and fill it using these details');
    assert(regPlan.requirements.length === 4, `Registration task parsed into 4 explicit requirements (got ${regPlan.requirements.length})`);
    assert(regPlan.requirements[2].description.includes('confirmation'), 'Req 3 tracks confirmation before consequential submission');

  } finally {
    await browserService.close();
    server.close();
  }

  console.log('\n======================================================');
  console.log(`Phase 3 Test Suite Complete: ${passedTests} Passed, ${failedTests} Failed`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runPhase3Tests().catch((err) => {
  console.error('Fatal test runner error:', err);
  if (server) server.close();
  process.exit(1);
});
