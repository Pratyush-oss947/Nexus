import * as http from 'http';
import { OllamaService } from './dist-electron/ollamaService.js';

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

async function main() {
  console.log('Testing OllamaService API Key & Authorization Header Verification...\n');

  let receivedAuthHeader = null;
  const PORT = 38943;
  const server = http.createServer((req, res) => {
    receivedAuthHeader = req.headers['authorization'];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      models: [
        { name: 'qwen2.5:7b', modified_at: new Date().toISOString(), size: 4000000000 }
      ]
    }));
  });

  await new Promise((resolve) => server.listen(PORT, resolve));

  try {
    const testKey = '034a9bde63574a8096daeb8001caa16b.gfUZV3htqbKWy23e9D1cZkM8';
    const service = new OllamaService(`http://127.0.0.1:${PORT}`, testKey);

    assert(service.getApiKey() === testKey, 'OllamaService stores API key');
    assert(service.getHost() === `http://127.0.0.1:${PORT}`, 'OllamaService stores host URL');

    const result = await service.listModels();
    assert(result.success === true, 'listModels succeeded against mock server');
    assert(result.models.length === 1, 'Model list returned properly');
    assert(result.models[0].name === 'qwen2.5:7b', 'Model name parsed correctly');

    assert(receivedAuthHeader === `Bearer ${testKey}`, `Authorization header sent correctly: ${receivedAuthHeader}`);

    // Test environment variable fallback
    process.env.OLLAMA_API_KEY = testKey;
    const envService = new OllamaService(`http://127.0.0.1:${PORT}`);
    assert(envService.getApiKey() === testKey, 'OllamaService reads process.env.OLLAMA_API_KEY');

    receivedAuthHeader = null;
    await envService.listModels();
    assert(receivedAuthHeader === `Bearer ${testKey}`, 'Authorization header sent via process.env key');

  } finally {
    server.close();
  }

  console.log(`\n======================================================`);
  console.log(`TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log(`======================================================`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
