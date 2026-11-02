import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { configureUsage, usageSnapshot } from '../Resources/core/usage.mjs';
import { snapshotFromPayload } from '../Resources/core/usage-statusline.mjs';
import { shellQuote } from '../Resources/core/terminal.mjs';
import { fixture } from './helpers.mjs';

test('status-line configuration preserves settings and is idempotent', t => {
  const f = fixture(t);
  const store = f.store();
  const account = store.createAccount({ label: 'A' });
  const settingsFile = path.join(account.configDir, 'settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ theme: 'dark', nested: { keep: true } }), { mode: 0o600 });
  assert.deepEqual(configureUsage({ store, accountId: account.id }), { configured: true, alreadyConfigured: false });
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.equal(settings.theme, 'dark');
  assert.deepEqual(settings.nested, { keep: true });
  assert.equal(settings.statusLine.type, 'command');
  assert.match(settings.statusLine.command, /^'\/usr\/bin\/env' '-i' /);
  assert.equal(settings.statusLine.command.includes(account.id), true);
  assert.equal(settings.statusLine.command.includes(store.rootDir), true);
  assert.equal(fs.statSync(settingsFile).mode & 0o777, 0o600);
  assert.deepEqual(configureUsage({ store, accountId: account.id }), { configured: true, alreadyConfigured: true });
});

test('a different statusLine command is never overwritten', t => {
  const f = fixture(t);
  const store = f.store();
  const account = store.createAccount({ label: 'A' });
  const settingsFile = path.join(account.configDir, 'settings.json');
  const original = JSON.stringify({ theme: 'dark', statusLine: { type: 'command', command: 'my-own-command' } });
  fs.writeFileSync(settingsFile, original, { mode: 0o600 });
  assert.throws(() => configureUsage({ store, accountId: account.id }), { code: 'STATUSLINE_CONFLICT' });
  assert.equal(fs.readFileSync(settingsFile, 'utf8'), original);
});

test('a recorded old generated statusLine migrates when Node and app paths change', t => {
  const f = fixture(t);
  const store = f.store();
  const account = store.createAccount({ label: 'A' });
  const settingsFile = path.join(account.configDir, 'settings.json');
  configureUsage({ store, accountId: account.id });
  const historyFile = path.join(store.rootDir, 'usage', `${account.id}.statusline.json`);
  const history = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
  const oldRoot = path.join(f.root, "old app's Contents");
  const oldCommand = [
    '/usr/bin/env', '-i', path.join(oldRoot, 'old node'),
    path.join(oldRoot, 'Resources', 'core', 'usage-statusline.mjs'), account.id, store.rootDir,
  ].map(shellQuote).join(' ');
  history.commands = [oldCommand];
  fs.writeFileSync(historyFile, JSON.stringify(history), { mode: 0o600 });
  fs.writeFileSync(settingsFile, JSON.stringify({
    theme: 'dark', statusLine: { type: 'command', command: oldCommand, padding: 2 },
  }), { mode: 0o600 });
  assert.deepEqual(configureUsage({ store, accountId: account.id }), { configured: true, alreadyConfigured: false });
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.statusLine.padding, 2);
  assert.notEqual(settings.statusLine.command, oldCommand);
  assert.equal(settings.statusLine.command.includes(shellQuote(fs.realpathSync(process.execPath))), true);
  assert.deepEqual(configureUsage({ store, accountId: account.id }), { configured: true, alreadyConfigured: true });
});

test('a lookalike external statusLine command is rejected byte for byte', t => {
  const f = fixture(t);
  const store = f.store();
  const account = store.createAccount({ label: 'A' });
  const settingsFile = path.join(account.configDir, 'settings.json');
  configureUsage({ store, accountId: account.id });
  const externalCommand = [
    '/usr/bin/env', '-i', path.join(f.root, 'node'),
    path.join(f.root, 'Resources', 'core', 'usage-statusline.mjs'), account.id, store.rootDir,
  ].map(shellQuote).join(' ');
  const original = JSON.stringify({ statusLine: { type: 'command', command: externalCommand } });
  fs.writeFileSync(settingsFile, original, { mode: 0o600 });
  assert.throws(() => configureUsage({ store, accountId: account.id }), { code: 'STATUSLINE_CONFLICT' });
  assert.equal(fs.readFileSync(settingsFile, 'utf8'), original);
});

test('an external settings update after reading is preserved', t => {
  const f = fixture(t);
  const store = f.store();
  const account = store.createAccount({ label: 'A' });
  const settingsFile = path.join(account.configDir, 'settings.json');
  const original = JSON.stringify({ theme: 'dark' });
  const external = JSON.stringify({
    theme: 'light', statusLine: { type: 'command', command: 'new-external-command' },
  });
  fs.writeFileSync(settingsFile, original, { mode: 0o600 });
  let intercepted = false;
  const readFile = file => {
    const bytes = fs.readFileSync(file);
    if (file === settingsFile && !intercepted) {
      intercepted = true;
      fs.writeFileSync(settingsFile, external, { mode: 0o600 });
    }
    return bytes;
  };
  assert.throws(() => configureUsage({ store, accountId: account.id }, { readFile }), {
    code: 'SETTINGS_CHANGED',
    message: 'The official settings file changed. Retry to preserve the new changes.',
  });
  assert.equal(intercepted, true);
  assert.equal(fs.readFileSync(settingsFile, 'utf8'), external);
});

test('the configured command stores only allowlisted usage fields', t => {
  const f = fixture(t);
  const store = f.store();
  const account = store.createAccount({ label: 'A' });
  configureUsage({ store, accountId: account.id });
  const settings = JSON.parse(fs.readFileSync(path.join(account.configDir, 'settings.json'), 'utf8'));
  const future = Math.floor(Date.now() / 1000) + 3600;
  const payload = {
    session_id: 'DO_NOT_STORE_SESSION',
    transcript_path: '/private/DO_NOT_STORE_TRANSCRIPT',
    workspace: { current_dir: '/private/DO_NOT_STORE_WORKSPACE' },
    cost: { total_cost_usd: 99 },
    email: 'DO_NOT_STORE_EMAIL@example.com',
    access_token: 'DO_NOT_STORE_TOKEN',
    rate_limits: {
      five_hour: { used_percentage: 12.5, resets_at: future },
      seven_day: { used_percentage: 40 },
    },
  };
  const child = spawnSync('/bin/sh', ['-c', settings.statusLine.command], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 3000,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, '');
  assert.match(child.stdout, /5h 12\.5% used/);
  const file = path.join(store.rootDir, 'usage', `${account.id}.json`);
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw.includes('DO_NOT_STORE'), false);
  const snapshot = JSON.parse(raw);
  assert.deepEqual(Object.keys(snapshot).sort(), ['observedAt', 'reason', 'schema', 'status', 'windows']);
  assert.equal(snapshot.status, 'available');
  assert.deepEqual(snapshot.windows.fiveHour, { usedPercentage: 12.5, resetsAt: future });
  assert.equal(snapshot.windows.sevenDay, null);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  const current = usageSnapshot({ store, accountId: account.id });
  assert.equal(current.status, 'available');
  assert.equal(current.windows.fiveHour.usedPercentage, 12.5);
  const expired = usageSnapshot({ store, accountId: account.id, now: () => new Date((future + 1) * 1000) });
  assert.equal(expired.status, 'unknown');
  assert.equal(expired.reason, 'WINDOWS_RESET');
  assert.deepEqual(expired.windows, { fiveHour: null, sevenDay: null });
});

test('missing, malformed and oversized input produce an unknown snapshot without raw payload', t => {
  const f = fixture(t);
  const store = f.store();
  const account = store.createAccount({ label: 'A' });
  assert.equal(usageSnapshot({ store, accountId: account.id }).reason, 'NO_SNAPSHOT');
  configureUsage({ store, accountId: account.id });
  const command = JSON.parse(fs.readFileSync(path.join(account.configDir, 'settings.json'), 'utf8')).statusLine.command;
  for (const [input, reason] of [
    ['{"session_id":"DO_NOT_STORE"', 'INVALID_PAYLOAD'],
    [`{"padding":"${'x'.repeat(16_385)}"}`, 'INPUT_LIMIT'],
  ]) {
    const child = spawnSync('/bin/sh', ['-c', command], { input, encoding: 'utf8', timeout: 3000 });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, 'CCAC usage unknown\n');
    const file = path.join(store.rootDir, 'usage', `${account.id}.json`);
    const raw = fs.readFileSync(file, 'utf8');
    assert.equal(JSON.parse(raw).reason, reason);
    assert.equal(raw.includes('DO_NOT_STORE'), false);
  }
});

test('windows are independently validated and expiration never invents a balance', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const payload = {
    rate_limits: {
      five_hour: { used_percentage: 0, resets_at: 1_800_000_000 },
      seven_day: { used_percentage: 101, resets_at: 1_800_000_000 },
    },
  };
  const snapshot = snapshotFromPayload(payload, now);
  assert.equal(snapshot.status, 'available');
  assert.deepEqual(snapshot.windows.fiveHour, { usedPercentage: 0, resetsAt: 1_800_000_000 });
  assert.equal(snapshot.windows.sevenDay, null);
  assert.equal(snapshotFromPayload({ rate_limits: {} }, now).status, 'unknown');
});

test('tampered snapshots fail closed instead of returning extra fields', t => {
  const f = fixture(t);
  const store = f.store();
  const account = store.createAccount({ label: 'A' });
  const usageDir = path.join(store.rootDir, 'usage');
  fs.mkdirSync(usageDir, { mode: 0o700 });
  fs.writeFileSync(path.join(usageDir, `${account.id}.json`), JSON.stringify({
    schema: 1, status: 'unknown', windows: { fiveHour: null, sevenDay: null },
    observedAt: new Date().toISOString(), reason: 'NO_RATE_LIMIT_WINDOWS', token: 'DO_NOT_RETURN',
  }), { mode: 0o600 });
  assert.throws(() => usageSnapshot({ store, accountId: account.id }), { code: 'INVALID_STATE' });
});

test('a session-start status line without windows keeps an earlier open observation', async () => {
  const { __testables } = await import('../Resources/core/usage-statusline.mjs');
  const now = new Date('2026-11-01T10:00:00Z');
  const open = { status: 'available', windows: { fiveHour: { usedPercentage: 20, resetsAt: now.getTime() / 1000 + 600 }, sevenDay: null } };
  const expired = { status: 'available', windows: { fiveHour: { usedPercentage: 20, resetsAt: now.getTime() / 1000 - 1 }, sevenDay: null } };
  const unknown = { status: 'unknown', windows: { fiveHour: null, sevenDay: null } };
  assert.equal(__testables.keepsExisting(open, unknown, now), true);
  assert.equal(__testables.keepsExisting(expired, unknown, now), false);
  assert.equal(__testables.keepsExisting(null, unknown, now), false);
  assert.equal(__testables.keepsExisting(open, { ...open }, now), false);
  assert.equal(__testables.statusLineText({ status: 'available', windows: { fiveHour: { usedPercentage: 'x' } } }), 'CCAC usage unknown');
});
