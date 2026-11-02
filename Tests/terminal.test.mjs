import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { OfficialAdapter } from '../Resources/core/official.mjs';
import { APPLE_SCRIPT, TERMINAL_DISPATCH_TIMEOUT_MS, createTerminalPlan, openTerminal, shellQuote, validateRunnerRequest } from '../Resources/core/terminal.mjs';
import { fixture, validStatus } from './helpers.mjs';

function setup(t, name = 'project') {
  const f = fixture(t); const store = f.store();
  const account = store.createAccount({ label: 'A', expectedEmail: validStatus.email });
  const directory = path.join(f.root, name); fs.mkdirSync(directory, { recursive: true });
  const project = store.addProject({ path: directory });
  const cliPath = f.fake("claude ' ; $(touch CLI_INJECTED) `touch CLI_INJECTED2`");
  const adapter = new OfficialAdapter({ cliPath, env: f.env });
  return { ...f, store, account, project, adapter, options: { store, adapter, accountId: account.id, projectId: project.id } };
}

test('shell quoting round-trips literal metacharacters and rejects controls', () => {
  for (const value of ['', "one'two", '$(exit 19); `exit 20` " quoted \\ 中文']) {
    const result = spawnSync('/bin/sh', ['-c', `printf '%s' ${shellQuote(value)}`], { encoding: 'utf8' });
    assert.equal(result.status, 0); assert.equal(result.stdout, value);
  }
  assert.throws(() => shellQuote('bad\ncommand'));
  assert.throws(() => shellQuote('bad\0command'));
});

test('complete terminal command is injection-safe and cleans the fresh shell environment', t => {
  const f = setup(t, "project ' ; touch PWNED ; $(touch PWNED2) `touch PWNED3` \" 中文");
  const plan = createTerminalPlan(f.options);
  const capture = path.join(f.root, 'capture.json');
  assert.equal(plan.executable, '/usr/bin/osascript');
  assert.equal(plan.args[1], APPLE_SCRIPT);
  assert.equal(APPLE_SCRIPT.includes(f.project.path), false);
  assert.deepEqual(plan.cliArgs, []);
  const result = spawnSync('/bin/zsh', ['-f', '-c', plan.command], {
    env: { ...f.env, FAKE_CAPTURE: capture, NODE_OPTIONS: '--require=/not-a-real-module', NODE_PATH: '/invalid',
      ANTHROPIC_AUTH_TOKEN: 'SECRET', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CONFIG_DIR: '/wrong' }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const captured = JSON.parse(fs.readFileSync(capture));
  assert.equal(captured.cwd, f.project.path); assert.deepEqual(captured.args, []);
  assert.equal(captured.env.CLAUDE_CONFIG_DIR, f.account.configDir);
  assert.equal(captured.env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(captured.env.CLAUDE_CODE_USE_VERTEX, undefined);
  assert.equal(captured.env.NODE_OPTIONS, undefined);
  assert.equal(f.store.getAccount(f.account.id).lastProjectId, f.project.id);
  for (const marker of ['PWNED', 'PWNED2', 'PWNED3', 'CLI_INJECTED', 'CLI_INJECTED2']) {
    assert.equal(fs.existsSync(path.join(f.project.path, marker)), false, marker);
    assert.equal(fs.existsSync(path.join(f.root, marker)), false, marker);
  }
});

test('terminal runner refuses mismatched identity before launching and does not update last project', t => {
  const f = setup(t); const plan = createTerminalPlan(f.options); const capture = path.join(f.root, 'capture.json');
  const result = spawnSync('/bin/zsh', ['-f', '-c', plan.command], { env: { ...f.env, FAKE_CAPTURE: capture,
    FAKE_STATUS: JSON.stringify({ ...validStatus, email: 'other@example.com' }) }, encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /AUTH_NOT_READY/);
  assert.deepEqual(JSON.parse(fs.readFileSync(capture)).args, ['auth', 'status', '--json']);
  assert.equal(f.store.getAccount(f.account.id).lastProjectId, null);
});

test('login uses only official login arguments and needs no project', t => {
  const f = setup(t); const capture = path.join(f.root, 'capture.json');
  const plan = createTerminalPlan({ ...f.options, projectId: undefined, action: 'login' });
  assert.equal(plan.cwd, f.account.configDir);
  // A fresh folder: an honest CLI reports it logged out, in this folder.
  const fresh = JSON.stringify({ loggedIn: false, authMethod: 'none', apiProvider: 'firstParty', configDirectory: f.account.configDir });
  const result = spawnSync('/bin/sh', ['-c', plan.command], { env: { ...f.env, FAKE_CAPTURE: capture, FAKE_STATUS: fresh, FAKE_EXIT: '1' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(capture)).args, ['auth', 'login']);
  // A CLI that omits its folder yet claims a login for a never-used folder is a wrapper.
  const wrapper = spawnSync('/bin/sh', ['-c', plan.command], { env: { ...f.env, FAKE_CAPTURE: capture }, encoding: 'utf8' });
  assert.equal(wrapper.status, 1);
  assert.match(wrapper.stderr, /CLI_IGNORES_CONFIG_DIR/);
  assert.equal(f.store.getAccount(f.account.id).lastProjectId, null);
});

test('openTerminal dispatches static AppleScript with a separate argument and reports only dispatch', async t => {
  const f = setup(t); let called = 0;
  const result = await openTerminal(f.options, { platform: 'darwin', run: async (file, args, options) => {
    called += 1; assert.equal(file, '/usr/bin/osascript');
    assert.equal(args[1], APPLE_SCRIPT); assert.equal(args[2], '--');
    assert.equal(args[3], createTerminalPlan(f.options).command);
    assert.equal(options.timeoutMs, TERMINAL_DISPATCH_TIMEOUT_MS);
    return { code: 0, stdout: 'tab id 1' };
  } });
  assert.equal(called, 1); assert.equal(result.opened, true); assert.equal(result.execution, 'unconfirmed');
  assert.equal(f.store.getAccount(f.account.id).lastProjectId, null);
  await assert.rejects(() => openTerminal(f.options, { platform: 'linux' }), { code: 'UNSUPPORTED_PLATFORM' });
  await assert.rejects(() => openTerminal(f.options, { platform: 'darwin', run: async () => ({ code: 1, stdout: 'SECRET' }) }),
    error => error.code === 'TERMINAL_OPEN_FAILED' && !error.message.includes('SECRET'));
});

test('plans reject arbitrary actions, invalid IDs, removed projects and linked account paths', t => {
  const f = setup(t);
  assert.throws(() => createTerminalPlan({ ...f.options, action: 'shell' }));
  assert.throws(() => createTerminalPlan({ ...f.options, action: 'login' }));
  assert.throws(() => createTerminalPlan({ ...f.options, accountId: '../' }));
  fs.renameSync(f.project.path, `${f.project.path}-moved`);
  assert.throws(() => createTerminalPlan(f.options), { code: 'INVALID_DIRECTORY' });
  fs.renameSync(f.account.configDir, `${f.account.configDir}-moved`);
  fs.symlinkSync(`${f.account.configDir}-moved`, f.account.configDir);
  assert.throws(() => createTerminalPlan({ ...f.options, action: 'login', projectId: undefined }), { code: 'UNSAFE_STORAGE' });
});

test('runner rejects null roots and arbitrary request fields before accessing storage', () => {
  const base = { stateDir: '/example/state', accountId: '00000000-0000-4000-8000-000000000000', action: 'login', cliPath: '/example/claude' };
  for (const change of [{ stateDir: null }, { cliPath: null }, { stateDir: '../state' }, { command: 'injected' }, { action: 'launch' }]) {
    assert.throws(() => validateRunnerRequest({ ...base, ...change }));
  }
});
