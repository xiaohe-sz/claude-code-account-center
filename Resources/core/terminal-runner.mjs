import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { Store } from './store.mjs';
import { OfficialAdapter } from './official.mjs';
import { validateRunnerRequest } from './terminal.mjs';
import { LIMITS } from './validation.mjs';
import { fail, publicError } from './errors.mjs';

export async function runTerminal(request, { env = process.env, spawnCLI = spawn } = {}) {
  validateRunnerRequest(request);
  const store = new Store({ rootDir: request.stateDir });
  const account = store.getAccount(request.accountId);
  const adapter = new OfficialAdapter({ cliPath: request.cliPath, env });
  const project = request.action === 'launch' ? store.resolveProject(account.id, request.projectId) : null;
  if (request.action === 'launch') {
    const status = await adapter.status(account);
    if (!status.ready) fail('AUTH_NOT_READY', 'Sign in with the expected Claude account before launching this project.');
  }
  const spec = adapter.invocation(account, { action: request.action, cwd: project?.path ?? account.configDir });
  return new Promise((resolve, reject) => {
    // Official interactive output is shown directly to its user; this app never
    // captures, logs, or persists login output or credentials.
    const child = spawnCLI(spec.file, spec.args, { cwd: spec.cwd, env: spec.env, shell: false, stdio: 'inherit' });
    const forward = signal => { if (child.exitCode === null) child.kill(signal); };
    const onInterrupt = () => forward('SIGINT');
    const onTerminate = () => forward('SIGTERM');
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onTerminate);
    const cleanup = () => {
      process.off('SIGINT', onInterrupt);
      process.off('SIGTERM', onTerminate);
    };
    child.once('spawn', () => {
      if (project) {
        try { store.setLastProject(account.id, project.id); }
        catch {
          // Never relaunch a successfully spawned interactive process on a
          // metadata failure. This fixed warning contains no subprocess data.
          process.stderr.write('CCAC: The last project could not be saved.\n');
        }
      }
    });
    child.once('error', () => {
      cleanup();
      try { fail('CLI_EXECUTION_FAILED', 'The official command could not start.'); } catch (error) { reject(error); }
    });
    child.once('exit', (code, signal) => { cleanup(); resolve(code ?? (signal === 'SIGINT' ? 130 : 1)); });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3 || Buffer.byteLength(process.argv[2]) > LIMITS.inputBytes) fail('INVALID_INPUT', 'Invalid runner request.');
    let request;
    try { request = JSON.parse(process.argv[2]); } catch { fail('INVALID_INPUT', 'Invalid runner request.'); }
    process.exitCode = await runTerminal(request);
  } catch (error) {
    const safe = publicError(error);
    process.stderr.write(`CCAC: ${safe.code}: ${safe.message}\n`);
    process.exitCode = 1;
  }
}
