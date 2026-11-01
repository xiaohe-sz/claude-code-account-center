import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../Resources/core/store.mjs';

export const repository = fileURLToPath(new URL('../', import.meta.url));
export const cliFile = fileURLToPath(new URL('../Resources/core/cli.mjs', import.meta.url));
export const validStatus = { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'person@example.com' };

export function fixture(t) {
  const parent = path.join(repository, '.build', 'tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true })); // Only this test's newly created directory.
  const stateDir = path.join(root, 'state');
  const projectDir = path.join(root, 'project');
  const homeDir = path.join(root, 'home');
  fs.mkdirSync(projectDir); fs.mkdirSync(homeDir);
  const env = { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: homeDir, LANG: 'en_US.UTF-8',
    TERM: 'xterm-256color', CCAC_STATE_DIR: stateDir };
  const fake = (name = 'claude') => {
    const file = path.join(root, name);
    fs.writeFileSync(file, `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
if (process.env.FAKE_CAPTURE) fs.writeFileSync(process.env.FAKE_CAPTURE, JSON.stringify({ args, env: process.env, cwd: process.cwd() }));
if (args.join(' ') === 'auth status --json') {
  if (process.env.FAKE_STDERR) process.stderr.write(process.env.FAKE_STDERR);
  if (process.env.FAKE_SLEEP) await new Promise(resolve => setTimeout(resolve, Number(process.env.FAKE_SLEEP)));
  process.stdout.write(process.env.FAKE_STATUS ?? ${JSON.stringify(JSON.stringify(validStatus))});
  process.exitCode = Number(process.env.FAKE_EXIT ?? 0);
} else if (args.length === 0 || args.join(' ') === 'auth login') {
  process.exitCode = 0;
} else {
  process.exitCode = 9;
}
`, { mode: 0o700 });
    // .mjs is not required because Node detects ESM in this package's tree.
    return file;
  };
  const store = () => new Store({ rootDir: stateDir, env });
  return { root, stateDir, projectDir, homeDir, env, fake, store };
}
