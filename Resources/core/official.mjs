import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fail } from './errors.mjs';
import { executable, projectDirectory, email, text, absolutePath } from './validation.mjs';
import { privateDirectory } from './store.mjs';

export const LOGIN_ARGS = Object.freeze(['auth', 'login']);
export const STATUS_ARGS = Object.freeze(['auth', 'status', '--json']);
export const PROBE_ARGS = Object.freeze(['-p', 'Reply with exactly: OK', '--output-format', 'json', '--no-session-persistence']);

// Discovery locates the user-selected installation; it is not an authenticity
// signature check. No executable is run as part of discovery.
export function discoverClaude({ cliPath, env = process.env, homeDir = os.homedir() } = {}) {
  if (cliPath !== undefined) return { path: executable(cliPath), source: 'explicit' };
  if (Object.hasOwn(env, 'CLAUDE_CODE_CLI')) return { path: executable(env.CLAUDE_CODE_CLI), source: 'environment' };
  for (const directory of (env.PATH ?? '').split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    try { return { path: executable(path.join(directory, 'claude')), source: 'path' }; } catch { /* Try next installation. */ }
  }
  const common = [
    path.join(homeDir, '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    path.join(homeDir, '.npm-global', 'bin', 'claude'),
  ];
  for (const candidate of common) {
    try { return { path: executable(candidate), source: 'common' }; } catch { /* Try next installation. */ }
  }
  fail('CLI_NOT_FOUND', 'Install the official Claude Code CLI or configure its absolute path.');
}

// configDir null selects the Mac-wide default configuration (no CLAUDE_CONFIG_DIR).
export function cleanEnvironment(env, configDir) {
  if (configDir !== null) privateDirectory(configDir);
  const clean = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string' || value.includes('\0') || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    // All Claude overrides are removed so future provider/token switches cannot
    // silently opt this launcher into an alternate authentication route.
    if (/^(ANTHROPIC_|CLAUDE_|DYLD_)/i.test(key) ||
        /^(NODE_OPTIONS|NODE_PATH|NODE_REPL_EXTERNAL_MODULE|LD_PRELOAD|LD_LIBRARY_PATH|AWS_BEARER_TOKEN_BEDROCK)$/i.test(key)) continue;
    clean[key] = value;
  }
  if (configDir !== null) clean.CLAUDE_CONFIG_DIR = configDir;
  return clean;
}

// stderr is discarded, never captured or placed in error messages. stdout is
// bounded and remains private until the auth-status allowlist has parsed it.
export function runCaptured(file, args, { cwd, env, timeoutMs = 15_000, maxBytes = 65_536 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let timer;
    let size = 0;
    const chunks = [];
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const abort = code => {
      child?.kill('SIGKILL');
      try { fail(code, 'The official command did not return a usable response.'); }
      catch (error) { finish(error); }
    };
    try { child = spawn(file, args, { cwd, env, shell: false, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { abort('CLI_EXECUTION_FAILED'); return; }
    timer = setTimeout(() => abort('CLI_TIMEOUT'), timeoutMs);
    child.stdout.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) { abort('CLI_OUTPUT_LIMIT'); return; }
      chunks.push(chunk);
    });
    child.on('error', () => abort('CLI_EXECUTION_FAILED'));
    child.on('close', (code, signal) => {
      if (signal) { abort('CLI_EXECUTION_FAILED'); return; }
      finish(null, { code, stdout: Buffer.concat(chunks).toString('utf8') });
    });
  });
}

export function parseAuthStatus(stdout, expectedEmail = null, expectedConfigDir = null) {
  email(expectedEmail);
  let raw;
  try { raw = JSON.parse(stdout); } catch { fail('AUTH_STATUS_INVALID', 'The official authentication response is invalid.'); }
  try {
    const methods = ['none', 'claude.ai', 'oauth_token', 'api_key', 'api_key_helper', 'third_party'];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !methods.includes(raw.authMethod)) throw new Error();
    if (raw.configDirectory !== undefined && raw.configDirectory !== null) absolutePath(raw.configDirectory);
    if (raw.email !== undefined && raw.email !== null && typeof raw.email !== 'string') throw new Error();
    if (raw.apiProvider !== undefined && raw.apiProvider !== null) text(raw.apiProvider, 64);
    const loggedIn = raw.authMethod !== 'none';
    const identity = email(raw.email ?? null);
    const configDirectory = raw.configDirectory ?? null;
    const provider = raw.apiProvider == null ? 'unknown' : raw.apiProvider === 'firstParty' ? 'firstParty' : 'unsupported';
    const matchesExpectedEmail = expectedEmail === null || identity === null ? null :
      identity.toLowerCase() === expectedEmail.toLowerCase();
    const matchesConfigDirectory = expectedConfigDir === null || configDirectory === null ? null :
      configDirectory === expectedConfigDir;
    const issues = [];
    if (!loggedIn) issues.push('NOT_LOGGED_IN');
    if (raw.authMethod !== 'claude.ai') issues.push('UNSUPPORTED_AUTH_METHOD');
    if (provider === 'unsupported') issues.push('UNSUPPORTED_PROVIDER');
    if (matchesExpectedEmail === false) issues.push('EMAIL_MISMATCH');
    if (matchesConfigDirectory === false) issues.push('CONFIG_DIRECTORY_MISMATCH');
    return { loggedIn, authMethod: raw.authMethod, apiProvider: provider, email: identity,
      configDirectory, matchesExpectedEmail, matchesConfigDirectory, ready: issues.length === 0, issues };
  } catch {
    fail('AUTH_STATUS_INVALID', 'The official authentication response is invalid.');
  }
}

export class OfficialAdapter {
  constructor({ cliPath, env = process.env, homeDir, run = runCaptured } = {}) {
    this.installation = discoverClaude({ cliPath, env, homeDir });
    this.env = { ...env };
    this.run = run;
  }

  invocation(account, { cwd = account.configDir, action = 'launch' } = {}) {
    if (!['launch', 'login', 'status'].includes(action)) fail('INVALID_INPUT', 'Unsupported official command.');
    privateDirectory(account.configDir);
    const directory = projectDirectory(cwd);
    const args = action === 'login' ? [...LOGIN_ARGS] : action === 'status' ? [...STATUS_ARGS] : [];
    return { file: executable(this.installation.path), args, cwd: directory, env: cleanEnvironment(this.env, account.configDir) };
  }

  // A wrapper script named claude can drop CLAUDE_CONFIG_DIR and silently use
  // the Mac-wide login. Refuse before an account login could overwrite it.
  async assertHonorsConfigDir(account) {
    const status = await this.status(account);
    // A CLI that does not report its folder is still caught when it claims a
    // login for a folder in which no login has ever completed.
    let ownLogin = false;
    try {
      const own = JSON.parse(fs.readFileSync(path.join(account.configDir, '.claude.json'), 'utf8'));
      ownLogin = typeof own?.oauthAccount?.emailAddress === 'string';
    } catch { ownLogin = false; }
    if (status.matchesConfigDirectory === false || (status.configDirectory === null && status.loggedIn && !ownLogin)) {
      fail('CLI_IGNORES_CONFIG_DIR', 'The claude command ignores the account folder. Point the app at the official binary.');
    }
    return status;
  }

  globalInvocation(args, cwd) {
    const home = this.env.HOME && path.isAbsolute(this.env.HOME) ? this.env.HOME : os.homedir();
    return { file: executable(this.installation.path), args: [...args], cwd: projectDirectory(cwd ?? home), env: cleanEnvironment(this.env, null) };
  }

  async globalStatus() {
    const { file, args, ...options } = this.globalInvocation(STATUS_ARGS);
    const result = await this.run(file, args, options);
    const status = parseAuthStatus(result.stdout);
    if (result.code !== 0 && !(result.code === 1 && !status.loggedIn)) {
      fail('CLI_EXECUTION_FAILED', 'The official authentication check failed.');
    }
    return status;
  }

  // One real, minimal request through the default login, from an empty private
  // folder so no project instructions are loaded. Only success is reported.
  async probeGlobal() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ccac-probe-'));
    try {
      const { file, args, ...options } = this.globalInvocation(PROBE_ARGS, fs.realpathSync(directory));
      let result;
      try { result = await this.run(file, args, { ...options, timeoutMs: 120_000, maxBytes: 1_048_576 }); }
      catch { return false; }
      if (result.code !== 0) return false;
      try {
        const reply = JSON.parse(result.stdout);
        return reply?.is_error === false && typeof reply.result === 'string' && reply.result.length > 0;
      } catch { return false; }
    } finally {
      // Only the private temporary folder created above is removed.
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  async status(account) {
    const { file, args, ...options } = this.invocation(account, { action: 'status' });
    const result = await this.run(file, args, options);
    const status = parseAuthStatus(result.stdout, account.expectedEmail, account.configDir);
    // The official CLI may exit 1 for a valid logged-out status.
    if (result.code !== 0 && !(result.code === 1 && !status.loggedIn)) {
      fail('CLI_EXECUTION_FAILED', 'The official authentication check failed.');
    }
    return status;
  }
}
