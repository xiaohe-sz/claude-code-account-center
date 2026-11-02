import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOrcaSetups } from '../Resources/core/orca.mjs';
import { response } from '../Resources/core/cli.mjs';
import { fixture } from './helpers.mjs';

test('Orca setup parsing keeps only ready local folders, canonical labels and one path', () => {
  const paths = new Map([
    ['/projects/work', true],
    ['/projects/claude', true],
    ['/projects/missing', false],
  ]);
  const stdout = JSON.stringify({
    ok: true,
    result: {
      setups: [
        { id: 'one', hostId: 'local', setupState: 'ready', path: '/projects/work', displayName: '  Work  ' },
        { id: 'two', hostId: 'local', setupState: 'ready', path: '/projects/work', displayName: 'duplicate' },
        { id: 'three', hostId: 'remote', setupState: 'ready', path: '/projects/claude', displayName: 'remote' },
        { id: 'four', hostId: 'local', setupState: 'not-set-up', path: '/projects/claude', displayName: 'bad state' },
        { id: 'five', hostId: 'local', setupState: 'ready', path: '/projects/missing', displayName: 'missing' },
        { id: 'six', hostId: 'local', setupState: 'ready', path: '/projects/claude' },
      ],
    },
  });
  const projects = parseOrcaSetups(stdout, {
    exists: path => paths.get(path) === true,
    isDirectory: () => ({ isDirectory: () => true }),
    realpath: value => value,
  });
  assert.deepEqual(projects, [
    { id: 'six', label: 'claude', path: '/projects/claude', orcaPath: '/projects/claude' },
    { id: 'one', label: 'Work', path: '/projects/work', orcaPath: '/projects/work' },
  ]);
});

test('Orca project listing and opening stay behind the public JSON contract', async t => {
  const f = fixture(t);
  const store = f.store();
  const account = store.createAccount({ label: 'A' });
  const project = store.addProject({ path: f.projectDir, label: 'Demo' });
  const listing = { cliPath: '/opt/homebrew/bin/orca', projects: [
    { id: 'p1', label: 'Demo', path: f.projectDir },
  ] };
  const listed = await response({ command: 'orca.projects' }, {
    env: f.env, orcaList: async () => listing,
  });
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.data, listing);

  const opened = await response({ command: 'orca.open', args: { accountId: account.id,
    projectId: project.id, action: 'launch', cliPath: f.fake() } }, {
    env: f.env,
    orcaOpen: async options => {
      assert.equal(options.accountId, account.id);
      assert.equal(options.projectId, project.id);
      return { opened: true, execution: 'unconfirmed', accountId: account.id,
        projectId: project.id, action: 'launch', backend: 'orca' };
    },
  });
  assert.equal(opened.ok, true);
  assert.equal(opened.data.backend, 'orca');

  const invalidAction = await response({ command: 'orca.open', args: { accountId: account.id,
    projectId: project.id, action: 'login', cliPath: f.fake() } }, { env: f.env });
  assert.equal(invalidAction.ok, false);

  const invalid = await response({ command: 'orca.open', args: { accountId: account.id,
    projectId: project.id, command: 'arbitrary' } }, { env: f.env });
  assert.equal(invalid.ok, false);
});

test('one malformed Orca entry is skipped and symlinked folders match by canonical path', () => {
  const stdout = JSON.stringify({ ok: true, result: { setups: [
    { id: 'bad', hostId: 'local', setupState: 'ready', path: '/projects/odd/', displayName: 'Bad\u0007' },
    { id: 'link', hostId: 'local', setupState: 'ready', path: '/tmp/link', displayName: 'Linked' },
  ] } });
  const projects = parseOrcaSetups(stdout, { exists: () => true, isDirectory: () => ({ isDirectory: () => true }),
    realpath: value => value === '/tmp/link' ? '/private/tmp/link' : value });
  assert.deepEqual(projects, [{ id: 'link', label: 'Linked', path: '/private/tmp/link', orcaPath: '/tmp/link' }]);
});
