import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DATA } from './paths.js';

// All credential material stays in this process and Windows DPAPI. Never log it.
const filename = path.join(DATA, 'credentials.dpapi');
function protect(input, decrypt = false) {
  if (process.platform !== 'win32') throw new Error('凭据保险箱目前需要 Windows；其他系统可通过 DEEPSEEK_API_KEY 环境变量连接。');
  const operation = decrypt ? 'Unprotect' : 'Protect';
  const script = `Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $result=[Security.Cryptography.ProtectedData]::${operation}($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
  const proc = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
    input: Buffer.from(input).toString('base64'), encoding: 'utf8', windowsHide: true, timeout: 20000,
  });
  if (proc.status !== 0 || !proc.stdout?.trim()) throw new Error('Windows 凭据保险箱无法访问，请使用保存凭据时的 Windows 账号运行。');
  return Buffer.from(proc.stdout.trim(), 'base64');
}
export function readSecrets() {
  if (!fs.existsSync(filename)) return {};
  return JSON.parse(protect(fs.readFileSync(filename), true).toString('utf8'));
}
export function saveSecrets(update) {
  const current = readSecrets();
  for (const [key, value] of Object.entries(update)) {
    if (value === null) delete current[key];
    else if (value !== '') current[key] = value;
  }
  const encrypted = protect(Buffer.from(JSON.stringify(current)));
  const tmp = filename + '.tmp';
  fs.writeFileSync(tmp, encrypted, { mode: 0o600 });
  fs.renameSync(tmp, filename);
  return current;
}
