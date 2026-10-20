const { spawn } = require('child_process');

const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'electron/test_win.ps1']);

let stdout = '';
let stderr = '';

ps.stdout.on('data', d => stdout += d.toString());
ps.stderr.on('data', d => stderr += d.toString());

ps.on('close', code => {
  console.log('EXIT CODE:', code);
  console.log('STDOUT:\n', stdout);
  if (stderr) console.error('STDERR:\n', stderr);
});
