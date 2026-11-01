import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { response } from '../Resources/core/cli.mjs';
import { fixture, cliFile, repository } from './helpers.mjs';

test('JSON control entry round-trips account, project, plan, auth, doctor and last project', t => {
  const f = fixture(t); const cliPath = f.fake();
  const call = request => {
    const child = spawnSync(process.execPath, [cliFile], { env: f.env, input: JSON.stringify(request), encoding: 'utf8' });
    assert.equal(child.stderr, ''); assert.equal(child.status, 0, child.stdout);
    const result = JSON.parse(child.stdout); assert.equal(result.ok, true); return result.data;
  };
  assert.deepEqual(call({ command: 'snapshot' }).accounts, []);
  const account = call({ command: 'account.create', args: { label: 'Test', expectedEmail: 'person@example.com' } });
  const project = call({ command: 'project.add', args: { path: f.projectDir, label: 'Demo' } });
  assert.equal(call({ command: 'project.select', args: { accountId: account.id, projectId: project.id } }).lastProjectId, project.id);
  const plan = call({ command: 'terminal.plan', args: { accountId: account.id, cliPath } });
  assert.equal(plan.projectId, project.id);
  assert.equal(call({ command: 'auth.status', args: { accountId: account.id, cliPath } }).ready, true);
  const doctor = call({ command: 'doctor', args: { cliPath } });
  assert.equal(doctor.storage, 'ok'); assert.equal(doctor.cli.available, true); assert.equal(doctor.nodeSupported, true);
  const missing = call({ command: 'doctor', args: { cliPath: `${f.root}/missing` } });
  assert.equal(missing.cli.available, false);
});

test('all command entry points resolve symbolic link paths', t => {
  const f = fixture(t);
  const linkedCLI = path.join(f.root, 'linked-cli.mjs');
  fs.symlinkSync(cliFile, linkedCLI);
  const cli = spawnSync(process.execPath, [linkedCLI], {
    env: f.env, input: '{"command":"snapshot"}', encoding: 'utf8',
  });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).ok, true);

  const account = f.store().createAccount({ label: 'A' });
  const linkedStatusLine = path.join(f.root, 'linked-statusline.mjs');
  fs.symlinkSync(path.join(repository, 'Resources/core/usage-statusline.mjs'), linkedStatusLine);
  const statusLine = spawnSync(process.execPath, [linkedStatusLine, account.id, f.stateDir], {
    input: '{}', encoding: 'utf8',
  });
  assert.equal(statusLine.status, 0, statusLine.stderr);
  assert.equal(statusLine.stdout, 'CCAC usage unknown\n');

  const linkedRunner = path.join(f.root, 'linked-runner.mjs');
  fs.symlinkSync(path.join(repository, 'Resources/core/terminal-runner.mjs'), linkedRunner);
  const runner = spawnSync(process.execPath, [linkedRunner, 'not-json'], { encoding: 'utf8' });
  assert.equal(runner.status, 1);
  assert.match(runner.stderr, /^CCAC: INVALID_INPUT:/);
});

test('invalid CLI requests return one bounded JSON error without echoing input or stderr', t => {
  const f = fixture(t);
  for (const input of ['{SECRET', '{}\n{}', '[]', JSON.stringify({ command: 'unknown-secret' }),
    JSON.stringify({ command: 'snapshot', args: null }),
    JSON.stringify({ command: 'snapshot', args: { token: 'SECRET' } }), ' '.repeat(16_385), Buffer.from([0xff, 0xfe])]) {
    const child = spawnSync(process.execPath, [cliFile], { env: f.env, input, encoding: 'utf8' });
    assert.equal(child.status, 1); assert.equal(child.stderr, '');
    const result = JSON.parse(child.stdout); assert.equal(result.ok, false);
    assert.equal(child.stdout.includes('SECRET'), false); assert.ok(child.stdout.length < 512);
  }
});

test('JSON auth.login and terminal.open pass validated options to the terminal adapter', async t => {
  const f = fixture(t); const store = f.store(); const account = store.createAccount({ label: 'A' }); const cliPath = f.fake();
  const result = await response({ command: 'auth.login', args: { accountId: account.id, cliPath } }, {
    env: f.env, open: async options => {
      assert.equal(options.action, 'login'); assert.equal(options.accountId, account.id);
      return { opened: true, execution: 'unconfirmed' };
    },
  });
  assert.equal(result.ok, true); assert.equal(result.data.opened, true);
  const rejected = await response({ command: 'terminal.open', args: { accountId: account.id, cliPath, command: 'arbitrary' } }, { env: f.env });
  assert.equal(rejected.ok, false);
  const nullAction = await response({ command: 'terminal.plan', args: { accountId: account.id, cliPath, action: null } }, { env: f.env });
  assert.equal(nullAction.ok, false);
});

test('usage and network commands stay on the public JSON contract', async t => {
  const f = fixture(t); const account = f.store().createAccount({ label: 'A' });
  const missing = await response({ command: 'usage.snapshot', args: { accountId: account.id } }, { env: f.env });
  assert.equal(missing.ok, true); assert.equal(missing.data.status, 'unknown');
  const configured = await response({ command: 'usage.configure', args: { accountId: account.id } }, { env: f.env });
  assert.equal(configured.ok, true);
  const page = await response({ command: 'network.webrtcPage' }, { env: f.env });
  assert.equal(page.ok, true); assert.match(page.data.path, /Resources\/network\/webrtc\.html$/);
  const report = { egress: { status: 'pass' }, routeIpv6: { status: 'unverified' },
    dns: { status: 'issue' }, browserWebRTC: { status: 'unverified' } };
  const network = await response({ command: 'network.check' }, { env: f.env, networkCheck: async () => report });
  assert.equal(network.ok, true); assert.deepEqual(network.data, report);
});
