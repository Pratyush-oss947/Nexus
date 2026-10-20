import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 600,
    height: 400,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });

  // Call ElevenLabs
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  console.log('Testing ElevenLabs synthesis for voice:', voiceId);

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg'
    },
    body: JSON.stringify({
      text: 'Testing audio playback.',
      model_id: 'eleven_multilingual_v2'
    })
  });

  if (!res.ok) {
    console.error('API failed:', res.status, await res.text());
    app.quit();
    return;
  }

  const arrayBuffer = await res.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString('base64');
  console.log('Got audio bytes:', arrayBuffer.byteLength);

  const html = `<!DOCTYPE html>
<html>
<body>
  <h1>Audio Test</h1>
  <div id="status">Testing...</div>
  <script>
    const base64 = "${base64}";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    console.log('[RENDERER] Testing AudioContext...');
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctx.decodeAudioData(bytes.buffer.slice(0))
      .then(buffer => {
        console.log('[RENDERER] AudioContext decoded successfully! Duration:', buffer.duration, 'channels:', buffer.numberOfChannels);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = () => {
          console.log('[RENDERER] AudioContext playback finished!');
          document.getElementById('status').innerText = 'AudioContext SUCCESS';
        };
        source.start(0);
        console.log('[RENDERER] AudioContext playback started!');
      })
      .catch(err => {
        console.error('[RENDERER] AudioContext decode failed:', err);
      });

    console.log('[RENDERER] Testing HTMLAudioElement...');
    const blob = new Blob([bytes], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onplay = () => console.log('[RENDERER] HTMLAudioElement playing!');
    audio.onended = () => console.log('[RENDERER] HTMLAudioElement ended!');
    audio.onerror = (e) => console.error('[RENDERER] HTMLAudioElement error:', e);
    audio.play().catch(err => console.error('[RENDERER] HTMLAudioElement play error:', err));
  </script>
</body>
</html>`;

  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  win.webContents.on('console-message', (e, level, message) => {
    console.log(message);
    if (message.includes('playback finished') || message.includes('HTMLAudioElement ended')) {
      setTimeout(() => app.quit(), 1000);
    }
  });

  setTimeout(() => {
    console.log('Timeout reached, exiting test.');
    app.quit();
  }, 10000);
});
