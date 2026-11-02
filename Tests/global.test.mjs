import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { GLOBAL_SERVICE, Keychain, fingerprint, keychainAccount, serviceName } from '../Resources/core/login-store.mjs';
import { accountInUse, globalStatus, importGlobal, switchGlobal, writeOAuthAccount } from '../Resources/core/global.mjs';
import { createTerminalPlan } from '../Resources/core/terminal.mjs';
import { OfficialAdapter } from '../Resources/core/official.mjs';
import { response } from '../Resources/core/cli.mjs';
import { fixture } from './helpers.mjs';

const LATER = Date.now() + 8 * 3_600_000;
const credential = (name, expiresAt = LATER) => ({
  claudeAiOauth: { accessToken: `access-${name}`, refreshToken: `refresh-${name}`, expiresAt, scopes: ['user:inference'] },
});
const oauth = name => ({ accountUuid: `uuid-${name}`, emailAddress: `${name}@example.com`, displayName: name });

// In-memory stand-in with the same contract as Keychain: write verifies by reading back.
class FakeKeychain {
  constructor() { this.items = new Map(); this.writes = []; this.failWrites = new Set(); this.afterWrite = null; }
  async read(service) { const value = this.items.get(service); return value ? structuredClone(value) : null; }
  async write(service, value) {
    this.writes.push(service);
    if (this.failWrites.has(service)) { const error = new Error('fail'); error.code = 'KEYCHAIN_WRITE_FAILED'; throw error; }
    this.items.set(service, structuredClone(value));
    if (this.afterWrite) await this.afterWrite(service, value);
  }
  async remove(service) { return this.items.delete(service); }
}

function setup(t) {
  const f = fixture(t);
  const store = f.store();
  const keychain = new FakeKeychain();
  const globalFile = path.join(f.homeDir, '.claude.json');
  const signIn = (label, name) => {
    const account = store.createAccount({ label });
    keychain.items.set(serviceName(account.configDir), credential(name));
    fs.writeFileSync(path.join(account.configDir, '.claude.json'), JSON.stringify({ oauthAccount: oauth(name) }), { mode: 0o600 });
    return account;
  };
  const setGlobal = name => {
    keychain.items.set(GLOBAL_SERVICE, credential(name));
    fs.writeFileSync(globalFile, JSON.stringify({ oauthAccount: oauth(name), projects: { '/keep': { kept: true } } }), { mode: 0o600 });
  };
  const globalEmail = () => JSON.parse(fs.readFileSync(globalFile, 'utf8')).oauthAccount?.emailAddress ?? null;
  const adapter = (probe = true) => ({
    globalStatus: async () => ({ loggedIn: globalEmail() !== null, authMethod: 'claude.ai', email: globalEmail() }),
    probeGlobal: async () => probe,
  });
  return { ...f, store, keychain, globalFile, signIn, setGlobal, globalEmail, adapter,
    run: (accountId, extra = {}) => switchGlobal({ store, adapter: adapter(), accountId, home: f.homeDir, keychain,
      listProcesses: async () => '', ...extra }) };
}

test('service names and keychain account follow the official CLI formula', () => {
  assert.equal(serviceName(), 'Claude Code-credentials');
  const dir = '/Users/demo/Library/Application Support/ClaudeCodeAccountCenter/accounts/x/config';
  assert.equal(serviceName(dir), `Claude Code-credentials-${createHash('sha256').update(dir).digest('hex').slice(0, 8)}`);
  assert.equal(keychainAccount({ USER: 'demo.user' }), 'demo.user');
  assert.equal(keychainAccount({ USER: 'bad name;' }), 'claude-code-user');
});

test('keychain writes travel as hex on stdin, are verified, and never surface output', async () => {
  const items = new Map();
  const calls = [];
  const run = async (args, { input = null } = {}) => {
    calls.push({ args, input });
    if (args[0] === '-i') {
      const match = /^add-generic-password -U -a "([^"]+)" -s "([^"]+)" -X "([0-9a-f]+)"\n$/.exec(input);
      assert.ok(match);
      items.set(`${match[1]}|${match[2]}`, Buffer.from(match[3], 'hex').toString('utf8'));
      return { code: 0, stdout: 'security> ' };
    }
    if (args[0] === 'find-generic-password') {
      const value = items.get(`${args[2]}|${args[5]}`);
      return value === undefined ? { code: 44, stdout: '' } : { code: 0, stdout: `${value}\n` };
    }
    if (args[0] === 'delete-generic-password') return { code: items.delete(`${args[2]}|${args[4]}`) ? 0 : 44, stdout: '' };
    return { code: 1, stdout: 'SECRET' };
  };
  const keychain = new Keychain({ env: { USER: 'demo' }, run });
  assert.equal(await keychain.read('svc'), null);
  await keychain.write('svc', credential('a'));
  assert.equal(calls.some(call => call.args.join(' ').includes('access-a')), false);
  assert.equal(fingerprint(await keychain.read('svc')), fingerprint(credential('a')));
  items.set('demo|svc', '{"apiKey":"SECRET"}');
  await assert.rejects(() => keychain.read('svc'), error => error.code === 'CREDENTIAL_UNUSABLE' && !error.message.includes('SECRET'));
  await assert.rejects(() => keychain.write('svc', { claudeAiOauth: {} }), { code: 'CREDENTIAL_UNUSABLE' });
  assert.equal(await keychain.remove('svc'), true);
  const broken = new Keychain({ env: { USER: 'demo' }, run: async () => ({ code: 51, stdout: 'SECRET' }) });
  await assert.rejects(() => broken.read('svc'), error => error.code === 'KEYCHAIN_UNAVAILABLE' && !error.message.includes('SECRET'));
});

test('switching saves the outgoing login, installs the target and keeps other config fields', async t => {
  const f = setup(t);
  const a = f.signIn('A', 'a'); const b = f.signIn('B', 'b');
  f.setGlobal('a');
  f.keychain.items.set(GLOBAL_SERVICE, credential('a-renewed'));
  const result = await f.run(b.id);
  assert.equal(result.switched, true); assert.equal(result.fromAccountId, a.id); assert.equal(result.probe, 'passed');
  assert.equal(fingerprint(f.keychain.items.get(GLOBAL_SERVICE)), fingerprint(credential('b')));
  assert.equal(fingerprint(f.keychain.items.get(serviceName(a.configDir))), fingerprint(credential('a-renewed')));
  const saved = JSON.parse(fs.readFileSync(f.globalFile, 'utf8'));
  assert.deepEqual(saved.oauthAccount, oauth('b'));
  assert.deepEqual(saved.projects, { '/keep': { kept: true } });
  assert.equal(f.store.snapshot().globalAccountId, b.id);
  assert.deepEqual(globalStatus({ store: f.store, home: f.homeDir }), { signedIn: true, email: 'b@example.com', accountId: b.id, switchedByApp: true });
  // The switched account is now a shared copy and cannot also run on its own.
  const project = f.store.addProject({ path: f.projectDir });
  const adapter = new OfficialAdapter({ cliPath: f.fake(), env: f.env });
  assert.throws(() => createTerminalPlan({ store: f.store, adapter, accountId: b.id, projectId: project.id }), { code: 'ACCOUNT_IS_GLOBAL' });
  // Switching back restores A and frees B.
  const back = await f.run(a.id);
  assert.equal(back.switched, true);
  assert.equal(fingerprint(f.keychain.items.get(GLOBAL_SERVICE)), fingerprint(credential('a-renewed')));
  assert.equal(createTerminalPlan({ store: f.store, adapter, accountId: b.id, projectId: project.id }).action, 'launch');
});

test('a failed confirmation restores the previous global login and keeps a renewed target login', async t => {
  const f = setup(t);
  const a = f.signIn('A', 'a'); const b = f.signIn('B', 'b');
  f.setGlobal('a');
  const before = fs.readFileSync(f.globalFile, 'utf8');
  f.keychain.afterWrite = async service => {
    if (service === GLOBAL_SERVICE && f.keychain.items.get(GLOBAL_SERVICE).claudeAiOauth.accessToken === 'access-b') {
      f.keychain.afterWrite = null;
      f.keychain.items.set(GLOBAL_SERVICE, credential('b-renewed-by-window'));
    }
  };
  await assert.rejects(() => switchGlobal({ store: f.store, adapter: f.adapter(false), accountId: b.id, home: f.homeDir,
    keychain: f.keychain, listProcesses: async () => '' }), { code: 'SWITCH_ROLLED_BACK' });
  assert.equal(fingerprint(f.keychain.items.get(GLOBAL_SERVICE)), fingerprint(credential('a')));
  assert.equal(fingerprint(f.keychain.items.get(serviceName(b.configDir))), fingerprint(credential('b-renewed-by-window')));
  assert.deepEqual(JSON.parse(fs.readFileSync(f.globalFile, 'utf8')), JSON.parse(before));
  // A now holds the same login as the restored global slot, so it is marked as the global copy.
  assert.equal(f.store.snapshot().globalAccountId, a.id);
  assert.equal(fingerprint(f.keychain.items.get(serviceName(a.configDir))), fingerprint(credential('a')));
  assert.equal(globalStatus({ store: f.store, home: f.homeDir }).accountId, a.id);
});

test('switching is refused before any write when it could lose a login', async t => {
  const f = setup(t);
  const a = f.signIn('A', 'a'); const b = f.signIn('B', 'b');
  f.setGlobal('stranger');
  await assert.rejects(() => f.run(b.id), { code: 'GLOBAL_NOT_MANAGED' });
  f.setGlobal('a');
  await assert.rejects(() => f.run(b.id, { listProcesses: async () => `123 node runner {"accountId":"${b.id}"}` }), { code: 'TARGET_IN_USE' });
  await assert.rejects(() => f.run(b.id, { listProcesses: async () => `123 node runner {"accountId":"${a.id}"}` }), { code: 'HOME_IN_USE' });
  f.keychain.items.set(GLOBAL_SERVICE, credential('a', Date.now() + 30_000));
  await assert.rejects(() => f.run(b.id), { code: 'GLOBAL_REFRESHING' });
  const empty = f.store.createAccount({ label: 'Empty' });
  await assert.rejects(() => f.run(empty.id), { code: 'TARGET_NOT_SIGNED_IN' });
  assert.deepEqual(f.keychain.writes, []);
  f.setGlobal('a');
  assert.deepEqual(await f.run(a.id), { switched: false, reason: 'ALREADY_GLOBAL', accountId: a.id, email: 'a@example.com' });
  assert.equal(accountInUse('1 x {"accountId":"other"}', a.id), false);
});

test('a Mac without a global login can receive one, and import copies the current global login', async t => {
  const f = setup(t);
  const b = f.signIn('B', 'b');
  fs.writeFileSync(f.globalFile, JSON.stringify({ projects: {} }), { mode: 0o600 });
  assert.equal((await f.run(b.id)).fromAccountId, null);
  assert.equal(f.globalEmail(), 'b@example.com');

  const g = setup(t);
  g.setGlobal('main');
  writeOAuthAccount(g.globalFile, oauth('main'), { extra: { hasCompletedOnboarding: true } });
  const imported = await importGlobal({ store: g.store, label: 'Main', home: g.homeDir, keychain: g.keychain });
  assert.equal(imported.expectedEmail, 'main@example.com');
  assert.equal(fingerprint(g.keychain.items.get(serviceName(imported.configDir))), fingerprint(credential('main')));
  const copied = JSON.parse(fs.readFileSync(path.join(imported.configDir, '.claude.json'), 'utf8'));
  assert.deepEqual(copied, { hasCompletedOnboarding: true, oauthAccount: oauth('main') });
  assert.equal(g.store.snapshot().globalAccountId, imported.id);
  await assert.rejects(() => importGlobal({ store: g.store, label: 'Again', home: g.homeDir, keychain: g.keychain }), { code: 'GLOBAL_ALREADY_MANAGED' });
});

test('default account, account removal and project removal go through the public contract', async t => {
  const f = setup(t);
  const a = f.signIn('A', 'a'); const b = f.signIn('B', 'b');
  f.setGlobal('a');
  const project = f.store.addProject({ path: f.projectDir });
  f.store.setLastProject(b.id, project.id);
  const call = (command, args) => response(args ? { command, args } : { command }, { env: f.env, keychain: f.keychain, listProcesses: async () => '' });
  assert.deepEqual((await call('account.setDefault', { accountId: b.id })).data, { defaultAccountId: b.id });
  assert.equal((await call('snapshot')).data.defaultAccountId, b.id);
  assert.equal((await call('global.status')).data.accountId, a.id);
  assert.equal((await call('account.remove', { accountId: a.id })).error.code, 'ACCOUNT_IS_GLOBAL');
  assert.equal((await call('project.remove', { projectId: project.id })).ok, true);
  assert.equal(f.store.getAccount(b.id).lastProjectId, null);
  const removed = await call('account.remove', { accountId: b.id });
  assert.equal(removed.ok, true);
  assert.equal(fs.existsSync(path.dirname(b.configDir)), false);
  assert.equal(f.keychain.items.has(serviceName(b.configDir)), false);
  const snapshot = (await call('snapshot')).data;
  assert.equal(snapshot.defaultAccountId, null);
  assert.deepEqual(snapshot.accounts.map(account => account.id), [a.id]);
  assert.equal(fs.existsSync(f.projectDir), true);
});

test('version 1 metadata is upgraded in place and stale locks from dead writers are cleared', t => {
  const f = fixture(t);
  const store = f.store();
  const account = store.createAccount({ label: 'A' });
  const v1 = { version: 1, revision: 4, accounts: [{ id: account.id, label: 'A', expectedEmail: null, lastProjectId: null }], projects: [] };
  fs.writeFileSync(store.stateFile, JSON.stringify(v1), { mode: 0o600 });
  const upgraded = f.store().snapshot();
  assert.equal(upgraded.version, 2); assert.equal(upgraded.defaultAccountId, null); assert.equal(upgraded.globalAccountId, null);
  fs.writeFileSync(store.lockFile, '999999', { mode: 0o600 });
  store.setDefaultAccount(account.id);
  assert.equal(JSON.parse(fs.readFileSync(store.stateFile, 'utf8')).version, 2);
  fs.writeFileSync(store.lockFile, String(process.pid), { mode: 0o600 });
  assert.throws(() => store.setDefaultAccount(null), { code: 'STORE_BUSY' });
  fs.unlinkSync(store.lockFile);
});

test('a login is refused when the claude command ignores the account folder', async t => {
  const f = fixture(t);
  const store = f.store();
  const account = store.createAccount({ label: 'A' });
  const status = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty',
    email: 'main@example.com', configDirectory: path.join(f.homeDir, '.claude') });
  const adapter = new OfficialAdapter({ cliPath: f.fake(), env: { ...f.env, FAKE_STATUS: status } });
  await assert.rejects(() => adapter.assertHonorsConfigDir(store.getAccount(account.id)), { code: 'CLI_IGNORES_CONFIG_DIR' });
  const honest = new OfficialAdapter({ cliPath: f.fake(), env: { ...f.env, FAKE_STATUS: JSON.stringify({ loggedIn: false,
    authMethod: 'none', apiProvider: 'firstParty', configDirectory: store.getAccount(account.id).configDir }), FAKE_EXIT: '1' } });
  assert.equal((await honest.assertHonorsConfigDir(store.getAccount(account.id))).loggedIn, false);
});

test('a second, separate login of the global account is not marked as the global copy', async t => {
  const f = setup(t);
  const main = f.signIn('Main', 'a');
  f.setGlobal('a');
  f.store.setGlobalAccount(main.id);
  const twin = f.store.createAccount({ label: 'Twin' });
  f.keychain.items.set(serviceName(twin.configDir), credential('a-second-session'));
  fs.writeFileSync(path.join(twin.configDir, '.claude.json'), JSON.stringify({ oauthAccount: oauth('a') }), { mode: 0o600 });
  assert.equal((await f.run(twin.id)).reason, 'ALREADY_GLOBAL');
  assert.equal(f.store.snapshot().globalAccountId, main.id);
  assert.equal(globalStatus({ store: f.store, home: f.homeDir }).accountId, main.id);
  f.keychain.items.set(serviceName(main.configDir), credential('a'));
  assert.deepEqual(f.keychain.writes, []);
});

test('a default configuration answered by another auth method does not confirm a switch', async t => {
  const f = setup(t);
  f.signIn('A', 'a'); const b = f.signIn('B', 'b');
  f.setGlobal('a');
  const adapter = { globalStatus: async () => ({ loggedIn: true, authMethod: 'api_key', email: 'b@example.com' }), probeGlobal: async () => true };
  await assert.rejects(() => switchGlobal({ store: f.store, adapter, accountId: b.id, home: f.homeDir, keychain: f.keychain,
    listProcesses: async () => '' }), error => error.code === 'SWITCH_ROLLED_BACK' && error.message.includes('SWITCH_NOT_CONFIRMED'));
  assert.equal(f.globalEmail(), 'a@example.com');
});

test('an expired global access token does not block a switch, and the switch lock is shared and recoverable', async t => {
  const f = setup(t);
  f.signIn('A', 'a'); const b = f.signIn('B', 'b');
  f.setGlobal('a');
  f.keychain.items.set(GLOBAL_SERVICE, credential('a-expired', Date.now() - 3_600_000));
  assert.equal((await f.run(b.id)).switched, true);
  const lock = path.join(f.store.rootDir, '.global-switch.lock');
  fs.writeFileSync(lock, String(process.pid), { mode: 0o600 });
  await assert.rejects(() => f.run(b.id), { code: 'SWITCH_BUSY' });
  const call = (command, args) => response({ command, args }, { env: f.env, keychain: f.keychain, listProcesses: async () => '' });
  assert.equal((await call('account.remove', { accountId: b.id })).error.code, 'SWITCH_BUSY');
  fs.writeFileSync(lock, '999999', { mode: 0o600 });
  assert.equal((await f.run(b.id)).reason, 'ALREADY_GLOBAL');
  assert.equal(fs.existsSync(lock), false);
});
