import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Store, atomicWriteJSON } from '../Resources/core/store.mjs';
import { fixture, cliFile } from './helpers.mjs';

test('accounts use independent private UUID directories; metadata never contains auth files', t => {
  const f = fixture(t);
  const store = f.store();
  const first = store.createAccount({ label: 'Personal', expectedEmail: 'person@example.com' });
  const second = store.createAccount({ label: 'Work', expectedEmail: '' });
  assert.match(first.id, /^[0-9a-f-]{36}$/);
  assert.notEqual(first.configDir, second.configDir);
  assert.equal(second.expectedEmail, null);
  for (const directory of [store.rootDir, store.accountsDir, path.dirname(first.configDir), first.configDir, second.configDir]) {
    assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  }
  assert.equal(fs.statSync(store.stateFile).mode & 0o777, 0o600);
  fs.writeFileSync(path.join(first.configDir, 'official-private-file'), 'SENTINEL_DO_NOT_READ', { mode: 0o600 });
  assert.equal(JSON.stringify(store.snapshot()).includes('SENTINEL_DO_NOT_READ'), false);
  assert.equal(JSON.parse(fs.readFileSync(store.stateFile)).accounts[0].configDir, undefined);
  assert.deepEqual(new Store({ env: f.env }).snapshot(), store.snapshot());
});

test('project paths are canonical, deduplicated and last project is per account', t => {
  const f = fixture(t); const store = f.store();
  const a = store.createAccount({ label: 'A' }); const b = store.createAccount({ label: 'B' });
  const project = store.addProject({ path: f.projectDir });
  const alias = path.join(f.root, 'project-alias');
  fs.symlinkSync(f.projectDir, alias);
  assert.equal(store.addProject({ path: alias }).id, project.id);
  store.setLastProject(a.id, project.id);
  assert.equal(store.resolveProject(a.id).path, fs.realpathSync(f.projectDir));
  assert.equal(store.getAccount(b.id).lastProjectId, null);
  assert.throws(() => store.resolveProject(b.id), { code: 'PROJECT_REQUIRED' });
  fs.renameSync(f.projectDir, `${f.projectDir}-moved`);
  assert.throws(() => store.resolveProject(a.id), { code: 'INVALID_DIRECTORY' });
});

test('atomic failure preserves old bytes and mode; temporary file is unpublished', t => {
  const f = fixture(t); const store = f.store();
  const before = fs.readFileSync(store.stateFile, 'utf8');
  const fault = { ...fs, renameSync(source, destination) {
    assert.equal(destination, store.stateFile);
    assert.equal(fs.readFileSync(destination, 'utf8'), before);
    assert.deepEqual(JSON.parse(fs.readFileSync(source)), { complete: true });
    assert.equal(fs.statSync(source).mode & 0o777, 0o600);
    throw new Error('simulated disk error');
  } };
  assert.throws(() => atomicWriteJSON(store.stateFile, { complete: true }, { io: fault }), /simulated disk error/);
  assert.equal(fs.readFileSync(store.stateFile, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(store.rootDir).sort(), ['accounts', 'state.json']);
  atomicWriteJSON(store.stateFile, { ...store.snapshot(), revision: 9 });
  assert.equal(f.store().snapshot().revision, 9);
});

test('separate store instances reload before writes and a held lock fails closed', t => {
  const f = fixture(t); const a = f.store(); const b = f.store();
  a.createAccount({ label: 'A' }); b.createAccount({ label: 'B' });
  assert.equal(a.snapshot().accounts.length, 2);
  assert.equal(a.snapshot().revision, 2);
  fs.writeFileSync(a.lockFile, '', { mode: 0o600 });
  assert.throws(() => b.createAccount({ label: 'C' }), { code: 'STORE_BUSY' });
  assert.equal(a.snapshot().accounts.length, 2);
});

test('bad creation input fails without changing metadata', t => {
  const f = fixture(t); const store = f.store();
  for (const input of [null, [], { label: '' }, { label: 'A\nB' }, { label: 'A', expectedEmail: 7 },
    { label: 'A', expectedEmail: 'bad' }, { label: 'A', configDir: '/unsafe' }, { label: 'A', token: 'hidden' }]) {
    assert.throws(() => store.createAccount(input));
  }
  for (const directory of ['relative', '/tmp/../tmp', '/does-not-exist-for-ccac', '/tmp\ninvalid']) {
    assert.throws(() => store.addProject({ path: directory }));
  }
  assert.equal(store.snapshot().revision, 0);
});

test('invalid explicit storage overrides never fall back to the user default', t => {
  const f = fixture(t);
  for (const rootDir of [null, '', 42, '../relative', '/']) {
    assert.throws(() => new Store({ rootDir, env: f.env }));
  }
  assert.throws(() => new Store({ env: { CCAC_STATE_DIR: null } }));
  assert.equal(fs.existsSync(f.stateDir), false);
});

test('non-regular state files fail without blocking on a FIFO', t => {
  const f = fixture(t); const store = f.store();
  fs.renameSync(store.stateFile, `${store.stateFile}.original`);
  const made = spawnSync('/usr/bin/mkfifo', ['-m', '600', store.stateFile]);
  assert.equal(made.status, 0);
  const result = spawnSync(process.execPath, [cliFile], { env: f.env,
    input: '{"command":"snapshot"}', encoding: 'utf8', timeout: 2000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).error.code, 'UNSAFE_STORAGE');
});

for (const [name, corrupt] of [
  ['array root', () => []],
  ['unknown version', s => ({ ...s, version: 99 })],
  ['unknown fields', s => ({ ...s, credentials: 'never accepted' })],
  ['non-array accounts', s => ({ ...s, accounts: {} })],
  ['negative revision', s => ({ ...s, revision: -1 })],
  ['path traversal account', s => ({ ...s, accounts: [{ id: '../other', label: 'A', expectedEmail: null, lastProjectId: null }] })],
  ['duplicate account', s => ({ ...s, accounts: [s.accounts[0], s.accounts[0]] })],
  ['forged config directory', s => ({ ...s, accounts: [{ ...s.accounts[0], configDir: '/tmp/forged' }] })],
  ['dangling last project', s => ({ ...s, accounts: [{ ...s.accounts[0], lastProjectId: '00000000-0000-4000-8000-000000000000' }] })],
]) {
  test(`persisted metadata fails closed: ${name}`, t => {
    const f = fixture(t); const store = f.store(); store.createAccount({ label: 'A' });
    const original = JSON.parse(fs.readFileSync(store.stateFile));
    fs.writeFileSync(store.stateFile, JSON.stringify(corrupt(original)));
    const bytes = fs.readFileSync(store.stateFile);
    assert.throws(() => f.store());
    assert.deepEqual(fs.readFileSync(store.stateFile), bytes);
  });
}

test('malformed, oversized and non-UTF8 state is rejected', t => {
  const f = fixture(t); const store = f.store();
  for (const invalid of ['{', ' '.repeat(1_048_577), Buffer.from([0xff, 0xfe])]) {
    fs.writeFileSync(store.stateFile, invalid);
    assert.throws(() => f.store(), { code: 'INVALID_STATE' });
  }
});

test('unsafe metadata and account directory permissions are rejected', t => {
  const f = fixture(t); const store = f.store(); const a = store.createAccount({ label: 'A' });
  fs.chmodSync(store.stateFile, 0o644);
  assert.throws(() => store.snapshot(), { code: 'UNSAFE_STORAGE' });
  fs.chmodSync(store.stateFile, 0o600);
  fs.chmodSync(a.configDir, 0o755);
  assert.throws(() => store.snapshot(), { code: 'UNSAFE_STORAGE' });
});

test('linked storage roots, account directories and state files are rejected', t => {
  const f = fixture(t); const store = f.store(); const a = store.createAccount({ label: 'A' });
  const alias = path.join(f.root, 'root-alias'); fs.symlinkSync(store.rootDir, alias);
  assert.throws(() => new Store({ rootDir: alias }), { code: 'UNSAFE_STORAGE' });
  fs.renameSync(a.configDir, `${a.configDir}-original`); fs.symlinkSync(`${a.configDir}-original`, a.configDir);
  assert.throws(() => store.snapshot(), { code: 'UNSAFE_STORAGE' });
  fs.renameSync(store.stateFile, `${store.stateFile}.saved`); fs.symlinkSync(`${store.stateFile}.saved`, store.stateFile);
  assert.throws(() => store.snapshot());
});
