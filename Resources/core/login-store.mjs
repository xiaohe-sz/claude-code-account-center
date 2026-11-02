import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fail } from './errors.mjs';

// Mirrors the official CLI's macOS storage naming: the default configuration
// uses "Claude Code-credentials"; a CLAUDE_CONFIG_DIR adds the first eight hex
// digits of SHA-256 over the NFC-normalized directory string.
export const GLOBAL_SERVICE = 'Claude Code-credentials';
const SECURITY = '/usr/bin/security';
const NOT_FOUND = 44;
const ACCOUNT_NAME = /^[a-zA-Z0-9._-]+$/;
const STDIN_LIMIT = 4_032;

export function serviceName(configDir = null) {
  if (configDir === null) return GLOBAL_SERVICE;
  return `${GLOBAL_SERVICE}-${createHash('sha256').update(configDir.normalize('NFC')).digest('hex').slice(0, 8)}`;
}

export function keychainAccount(env = process.env) {
  let name;
  try { name = env.USER || os.userInfo().username; } catch { name = 'claude-code-user'; }
  return ACCOUNT_NAME.test(name) ? name : 'claude-code-user';
}

// Secrets travel only through stdin and a bounded stdout buffer. Nothing from
// security's stderr or stdout is ever placed in an error message.
export function runSecurity(args, { input = null, timeoutMs = 15_000, maxBytes = 65_536 } = {}) {
  return new Promise(resolve => {
    let child;
    let settled = false;
    let size = 0;
    const chunks = [];
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => { child?.kill('SIGKILL'); finish({ code: null, stdout: '' }); }, timeoutMs);
    try {
      child = spawn(SECURITY, args, { shell: false, stdio: [input === null ? 'ignore' : 'pipe', 'pipe', 'ignore'] });
    } catch { finish({ code: null, stdout: '' }); return; }
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { child.kill('SIGKILL'); finish({ code: null, stdout: '' }); return; }
      chunks.push(chunk);
    });
    child.on('error', () => finish({ code: null, stdout: '' }));
    child.on('close', code => finish({ code, stdout: Buffer.concat(chunks).toString('utf8') }));
    if (input !== null) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
  });
}

function validCredential(value) {
  const oauth = value?.claudeAiOauth;
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    oauth !== null && typeof oauth === 'object' && !Array.isArray(oauth) &&
    typeof oauth.accessToken === 'string' && oauth.accessToken.length > 0 &&
    typeof oauth.refreshToken === 'string' && oauth.refreshToken.length > 0;
}

export function fingerprint(credential) {
  const oauth = credential?.claudeAiOauth ?? {};
  return createHash('sha256')
    .update(`${oauth.accessToken ?? ''}\0${oauth.refreshToken ?? ''}\0${oauth.expiresAt ?? ''}`)
    .digest('hex').slice(0, 16);
}

export function expiresAt(credential) {
  const value = Number(credential?.claudeAiOauth?.expiresAt);
  return Number.isFinite(value) ? value : 0;
}

export class Keychain {
  constructor({ env = process.env, run = runSecurity } = {}) {
    this.account = keychainAccount(env);
    this.run = run;
  }

  // Returns null when the item is absent. A present item that is not an
  // official claude.ai login is reported as unusable, never returned.
  async read(service) {
    const result = await this.run(['find-generic-password', '-a', this.account, '-w', '-s', service]);
    if (result.code === NOT_FOUND) return null;
    if (result.code !== 0) fail('KEYCHAIN_UNAVAILABLE', 'The macOS keychain could not be read.');
    let value;
    try { value = JSON.parse(result.stdout.trim()); } catch { fail('CREDENTIAL_UNUSABLE', 'A stored login is not a usable claude.ai login.'); }
    if (!validCredential(value)) fail('CREDENTIAL_UNUSABLE', 'A stored login is not a usable claude.ai login.');
    return value;
  }

  // Same command shape as the official CLI: hex payload on security's stdin,
  // -U updates in place and keeps the item's existing access list. Like the
  // official CLI, a payload beyond security's interactive line limit (large
  // MCP token sets) falls back to an argument, briefly visible to this user's
  // own processes; the official CLI does the same on each renewal of it.
  async write(service, credential) {
    if (!validCredential(credential)) fail('CREDENTIAL_UNUSABLE', 'A stored login is not a usable claude.ai login.');
    const hex = Buffer.from(JSON.stringify(credential), 'utf8').toString('hex');
    const command = `add-generic-password -U -a "${this.account}" -s "${service}" -X "${hex}"\n`;
    const result = command.length <= STDIN_LIMIT
      ? await this.run(['-i'], { input: command })
      : await this.run(['add-generic-password', '-U', '-a', this.account, '-s', service, '-X', hex]);
    if (result.code !== 0) fail('KEYCHAIN_WRITE_FAILED', 'The macOS keychain did not accept the login.');
    const stored = await this.read(service);
    if (!stored || fingerprint(stored) !== fingerprint(credential)) {
      fail('KEYCHAIN_WRITE_FAILED', 'The macOS keychain did not keep the login that was written.');
    }
  }

  async remove(service) {
    const result = await this.run(['delete-generic-password', '-a', this.account, '-s', service]);
    if (result.code !== 0 && result.code !== NOT_FOUND) fail('KEYCHAIN_UNAVAILABLE', 'The macOS keychain could not be updated.');
    return result.code === 0;
  }
}
