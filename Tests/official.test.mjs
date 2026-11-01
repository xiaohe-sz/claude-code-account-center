import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { OfficialAdapter, cleanEnvironment, discoverClaude, parseAuthStatus, runCaptured } from '../Resources/core/official.mjs';
import { publicError } from '../Resources/core/errors.mjs';
import { fixture, validStatus } from './helpers.mjs';

test('discovery precedence is explicit, environment, PATH; bad explicit settings do not fall back', t => {
  const f = fixture(t); const explicit = f.fake('explicit'); const fromEnv = f.fake('environment'); const fromPath = f.fake();
  const options = { env: { PATH: f.root, CLAUDE_CODE_CLI: fromEnv }, homeDir: f.homeDir };
  assert.deepEqual(discoverClaude({ ...options, cliPath: explicit }), { path: explicit, source: 'explicit' });
  assert.deepEqual(discoverClaude(options), { path: fromEnv, source: 'environment' });
  assert.deepEqual(discoverClaude({ env: { PATH: `.:relative:${f.root}` }, homeDir: f.homeDir }), { path: fromPath, source: 'path' });
  assert.throws(() => discoverClaude({ ...options, cliPath: path.join(f.root, 'missing') }), { code: 'CLI_NOT_FOUND' });
  assert.throws(() => discoverClaude({ env: { PATH: f.root, CLAUDE_CODE_CLI: '' } }), { code: 'INVALID_INPUT' });
});

test('common user-local installation and installer symlinks are supported', t => {
  const f = fixture(t); const fake = f.fake('actual');
  const bin = path.join(f.homeDir, '.local', 'bin'); fs.mkdirSync(bin, { recursive: true });
  fs.symlinkSync(fake, path.join(bin, 'claude'));
  assert.deepEqual(discoverClaude({ env: { PATH: '' }, homeDir: f.homeDir }), { path: fake, source: 'common' });
});

test('environment scrub removes auth/provider overrides and keeps normal shell environment', t => {
  const f = fixture(t); const account = f.store().createAccount({ label: 'A' });
  const dirty = { ...f.env, ANTHROPIC_API_KEY: 'secret', ANTHROPIC_AUTH_TOKEN: 'secret', ANTHROPIC_BASE_URL: 'https://invalid',
    ANTHROPIC_CUSTOM_HEADERS: 'secret', CLAUDE_CODE_OAUTH_TOKEN: 'secret', CLAUDE_CODE_OAUTH_TOKEN_FILE: '/fake',
    CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_USE_FOUNDRY: '1', CLAUDE_CONFIG_DIR: '/fake',
    AWS_BEARER_TOKEN_BEDROCK: 'secret', NODE_OPTIONS: '--require=/fake', DYLD_INSERT_LIBRARIES: '/fake',
    HTTPS_PROXY: 'http://localhost:8888', SSH_AUTH_SOCK: '/normal/socket', EDITOR: 'vi', CUSTOM_NORMAL: 'kept' };
  const cleaned = cleanEnvironment(dirty, account.configDir);
  assert.equal(cleaned.CLAUDE_CONFIG_DIR, account.configDir);
  for (const key of Object.keys(dirty).filter(key => /^(ANTHROPIC_|CLAUDE_|DYLD_|AWS_BEARER|NODE_)/.test(key))) {
    if (key !== 'CLAUDE_CONFIG_DIR') assert.equal(cleaned[key], undefined, key);
  }
  for (const key of ['PATH', 'HOME', 'LANG', 'TERM', 'HTTPS_PROXY', 'SSH_AUTH_SOCK', 'EDITOR', 'CUSTOM_NORMAL']) assert.equal(cleaned[key], dirty[key]);
  assert.equal(dirty.ANTHROPIC_API_KEY, 'secret');
});

test('real fake-CLI subprocess checks official arguments, isolation and status allowlist', async t => {
  const f = fixture(t); const store = f.store();
  const a = store.createAccount({ label: 'A', expectedEmail: 'PERSON@example.com' });
  const b = store.createAccount({ label: 'B', expectedEmail: 'different@example.com' });
  const capture = path.join(f.root, 'capture.json');
  const env = { ...f.env, FAKE_CAPTURE: capture, FAKE_STDERR: 'SECRET_STDERR', ANTHROPIC_API_KEY: 'SECRET_KEY',
    FAKE_STATUS: JSON.stringify({ ...validStatus, accessToken: 'SECRET_OUTPUT', organizationId: 'ignored' }) };
  const adapter = new OfficialAdapter({ cliPath: f.fake(), env });
  const status = await adapter.status(a);
  assert.equal(status.ready, true); assert.equal(status.matchesExpectedEmail, true);
  assert.equal(JSON.stringify(status).includes('SECRET'), false);
  let captured = JSON.parse(fs.readFileSync(capture));
  assert.deepEqual(captured.args, ['auth', 'status', '--json']);
  assert.equal(captured.cwd, a.configDir); assert.equal(captured.env.CLAUDE_CONFIG_DIR, a.configDir);
  assert.equal(captured.env.ANTHROPIC_API_KEY, undefined);
  assert.equal((await adapter.status(b)).ready, false);
  captured = JSON.parse(fs.readFileSync(capture));
  assert.equal(captured.env.CLAUDE_CONFIG_DIR, b.configDir);
  assert.deepEqual(adapter.invocation(a, { action: 'login' }).args, ['auth', 'login']);
  assert.deepEqual(adapter.invocation(a, { action: 'launch' }).args, []);
});

test('logged-out exit 1 is recognized; API-key and alternate-provider sessions are not ready', async t => {
  const f = fixture(t); const account = f.store().createAccount({ label: 'A' });
  const adapter = new OfficialAdapter({ cliPath: f.fake(), env: { ...f.env, FAKE_EXIT: '1',
    FAKE_STATUS: JSON.stringify({ authMethod: 'none' }) } });
  assert.equal((await adapter.status(account)).loggedIn, false);
  for (const altered of [{ authMethod: 'api_key' }, { apiProvider: 'bedrock' }]) {
    assert.equal(parseAuthStatus(JSON.stringify({ ...validStatus, ...altered })).ready, false);
  }
  const mismatch = parseAuthStatus(JSON.stringify(validStatus), 'other@example.com');
  assert.deepEqual(mismatch.issues, ['EMAIL_MISMATCH']);
});

test('documented-only status works without assuming email, provider or loggedIn fields', t => {
  const f = fixture(t); const account = f.store().createAccount({ label: 'A', expectedEmail: validStatus.email });
  const status = parseAuthStatus(JSON.stringify({ authMethod: 'claude.ai', configDirectory: account.configDir }),
    account.expectedEmail, account.configDir);
  assert.equal(status.loggedIn, true);
  assert.equal(status.ready, true);
  assert.equal(status.apiProvider, 'unknown');
  assert.equal(status.matchesExpectedEmail, null);
  assert.equal(status.matchesConfigDirectory, true);
  const mismatch = parseAuthStatus(JSON.stringify({ authMethod: 'claude.ai', configDirectory: f.root }),
    account.expectedEmail, account.configDir);
  assert.deepEqual(mismatch.issues, ['CONFIG_DIRECTORY_MISMATCH']);
});

test('malformed and failed auth output never appears in public errors', async t => {
  const f = fixture(t); const account = f.store().createAccount({ label: 'A' }); const cliPath = f.fake();
  for (const stdout of ['SECRET_RAW', '[]', '{}', JSON.stringify({ ...validStatus, authMethod: 'unknown' }),
    JSON.stringify({ ...validStatus, email: {} }), JSON.stringify({ ...validStatus, configDirectory: 'relative' })]) {
    const adapter = new OfficialAdapter({ cliPath, env: { ...f.env, FAKE_STATUS: stdout, FAKE_STDERR: 'SECRET_STDERR' } });
    await assert.rejects(() => adapter.status(account), error => {
      assert.equal(JSON.stringify(publicError(error)).includes('SECRET'), false);
      return error.code === 'AUTH_STATUS_INVALID';
    });
  }
  const failed = new OfficialAdapter({ cliPath, env: { ...f.env, FAKE_EXIT: '3' } });
  await assert.rejects(() => failed.status(account), { code: 'CLI_EXECUTION_FAILED' });
});

test('subprocess output limits and timeouts terminate unusable responses', async t => {
  const f = fixture(t); const file = f.fake();
  await assert.rejects(() => runCaptured(file, ['auth', 'status', '--json'], {
    env: { ...f.env, FAKE_STATUS: 'x'.repeat(2000) }, maxBytes: 100,
  }), { code: 'CLI_OUTPUT_LIMIT' });
  await assert.rejects(() => runCaptured(file, ['auth', 'status', '--json'], {
    env: { ...f.env, FAKE_SLEEP: '1000' }, timeoutMs: 50,
  }), { code: 'CLI_TIMEOUT' });
});
