import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fail } from './errors.mjs';
import { absolutePath, executable, object, text, uuid } from './validation.mjs';
import { runCaptured } from './official.mjs';
import { assertNotGlobalCopy } from './global.mjs';

// The first dispatch waits on macOS's "control Terminal" consent prompt.
export const TERMINAL_DISPATCH_TIMEOUT_MS = 120_000;

export const APPLE_SCRIPT = `on run argv
  tell application "Terminal"
    activate
    do script (item 1 of argv)
  end tell
end run`;

export function shellQuote(value) {
  text(value, 32_768, true);
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function createTerminalPlan({ store, adapter, accountId, projectId, action = 'launch', nodePath = process.execPath }) {
  uuid(accountId);
  if (!['launch', 'login'].includes(action)) fail('INVALID_INPUT', 'Terminal action must be launch or login.');
  const account = store.getAccount(accountId);
  // Login stays in the isolated config directory, independent of project settings.
  if (action === 'login' && projectId !== undefined) fail('INVALID_INPUT', 'Login does not accept a project.');
  const project = action === 'launch' ? store.resolveProject(accountId, projectId) : null;
  if (action === 'launch') assertNotGlobalCopy(store, account, adapter.env?.HOME || undefined);
  const cwd = project?.path ?? account.configDir;
  const cli = adapter.invocation(account, { cwd, action });
  const runner = fileURLToPath(new URL('./terminal-runner.mjs', import.meta.url));
  if (!fs.statSync(runner).isFile()) fail('RUNNER_MISSING', 'The terminal runner is unavailable.');
  const node = executable(nodePath);
  const request = { stateDir: store.rootDir, accountId, action, cliPath: cli.file };
  if (project) request.projectId = project.id;
  // No environment values are serialized. The fresh terminal runner sanitizes
  // the actual terminal environment after its shell startup scripts have run.
  const argv = ['/usr/bin/env', '-u', 'NODE_OPTIONS', '-u', 'NODE_PATH', '-u', 'NODE_REPL_EXTERNAL_MODULE',
    node, runner, JSON.stringify(request)];
  const command = `cd -- ${shellQuote(cwd)} && ${argv.map(shellQuote).join(' ')}`;
  return { terminal: 'Terminal', action, accountId, projectId: project?.id ?? null, cwd,
    configDir: account.configDir, cliPath: cli.file, cliArgs: cli.args, command,
    executable: '/usr/bin/osascript', args: ['-e', APPLE_SCRIPT, '--', command] };
}

// Never accept an externally supplied command/AppleScript plan. Rebuild it from
// validated account and project IDs at the instant the terminal is opened.
export async function openTerminal(options, { platform = process.platform, run = runCaptured } = {}) {
  if (platform !== 'darwin') fail('UNSUPPORTED_PLATFORM', 'Opening Terminal requires macOS.');
  const plan = createTerminalPlan(options);
  if (plan.action === 'login') await options.adapter.assertHonorsConfigDir(options.store.getAccount(plan.accountId));
  const result = await run(plan.executable, plan.args, { timeoutMs: TERMINAL_DISPATCH_TIMEOUT_MS, maxBytes: 4_096 });
  if (result.code !== 0) fail('TERMINAL_OPEN_FAILED', 'Terminal could not be opened. Check macOS automation permission.');
  // AppleScript success only confirms dispatch, not an authenticated CLI launch.
  return { opened: true, execution: 'unconfirmed', accountId: plan.accountId,
    projectId: plan.projectId, action: plan.action };
}

export function validateRunnerRequest(request) {
  object(request, ['stateDir', 'accountId', 'projectId', 'action', 'cliPath'], ['stateDir', 'accountId', 'action', 'cliPath']);
  absolutePath(request.stateDir);
  absolutePath(request.cliPath);
  uuid(request.accountId);
  if (request.projectId !== undefined) uuid(request.projectId);
  if (!['launch', 'login'].includes(request.action)) fail('INVALID_INPUT', 'Unsupported terminal action.');
  if ((request.action === 'launch' && request.projectId === undefined) ||
      (request.action === 'login' && request.projectId !== undefined)) fail('INVALID_INPUT', 'Invalid terminal project selection.');
  return request;
}
