import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Store } from './store.mjs';
import { OfficialAdapter, discoverClaude } from './official.mjs';
import { createTerminalPlan, openTerminal } from './terminal.mjs';
import { configureUsage, usageSnapshot } from './usage.mjs';
import { checkNetwork, webrtcPagePath } from './network.mjs';
import { listOrcaProjects, openOrcaTerminal } from './orca.mjs';
import { Keychain, serviceName } from './login-store.mjs';
import { accountInUse, globalStatus, importGlobal, processList, switchGlobal, withSwitchLock } from './global.mjs';
import { LIMITS, object, text, uuid } from './validation.mjs';
import { fail, publicError } from './errors.mjs';

// Protocol v1: one UTF-8 JSON request on stdin, then EOF; one JSON response on
// stdout. 16 KiB maximum input, 10 second input deadline, strict command fields.
// {"command":"account.create","args":{"label":"Work","expectedEmail":null}}
// Commands below define their complete accepted fields. Unknown fields fail.
export async function dispatch(request, { env = process.env, open = openTerminal, networkCheck = checkNetwork,
  orcaList = listOrcaProjects, orcaOpen = openOrcaTerminal, keychain = new Keychain({ env }),
  listProcesses = processList, makeAdapter = options => new OfficialAdapter(options) } = {}) {
  object(request, ['command', 'args'], ['command']);
  text(request.command, 40);
  const args = Object.hasOwn(request, 'args') ? request.args : {};
  const schemas = {
    snapshot: [[], []],
    'account.create': [['label', 'expectedEmail'], ['label']],
    'project.add': [['path', 'label'], ['path']],
    'project.select': [['accountId', 'projectId'], ['accountId', 'projectId']],
    'terminal.plan': [['accountId', 'projectId', 'action', 'cliPath'], ['accountId']],
    'terminal.open': [['accountId', 'projectId', 'action', 'cliPath'], ['accountId']],
    'auth.login': [['accountId', 'cliPath'], ['accountId']],
    'auth.status': [['accountId', 'cliPath'], ['accountId']],
    'usage.configure': [['accountId'], ['accountId']],
    'usage.snapshot': [['accountId'], ['accountId']],
    'network.check': [[], []],
    'network.webrtcPage': [[], []],
    'account.setDefault': [['accountId'], ['accountId']],
    'account.remove': [['accountId'], ['accountId']],
    'account.importGlobal': [['label'], ['label']],
    'project.remove': [['projectId'], ['projectId']],
    'global.status': [[], []],
    'global.switch': [['accountId', 'cliPath'], ['accountId']],
    'orca.projects': [[], []],
    'orca.open': [['accountId', 'projectId', 'action', 'cliPath'], ['accountId', 'projectId']],
    doctor: [['cliPath'], []],
  };
  if (!Object.hasOwn(schemas, request.command)) fail('UNKNOWN_COMMAND', 'Unknown command.');
  object(args, ...schemas[request.command]);
  if (Object.hasOwn(args, 'accountId')) uuid(args.accountId);
  if (Object.hasOwn(args, 'projectId')) uuid(args.projectId);
  const home = typeof env.HOME === 'string' && env.HOME.startsWith('/') ? env.HOME : undefined;
  if (Object.hasOwn(args, 'action') && !['launch', 'login'].includes(args.action)) fail('INVALID_INPUT', 'Invalid terminal action.');
  const store = new Store({ env });
  switch (request.command) {
    case 'snapshot': return store.snapshot();
    case 'account.create': return store.createAccount(args);
    case 'project.add': return store.addProject(args);
    case 'project.select': store.setLastProject(args.accountId, args.projectId); return store.getAccount(args.accountId);
    case 'usage.configure': return configureUsage({ store, accountId: args.accountId });
    case 'usage.snapshot': return usageSnapshot({ store, accountId: args.accountId });
    case 'network.check': return networkCheck();
    case 'network.webrtcPage': return { path: webrtcPagePath() };
    case 'account.setDefault': return store.setDefaultAccount(args.accountId);
    case 'account.remove': return withSwitchLock(store, async () => {
      const account = store.getAccount(args.accountId);
      if (globalStatus({ store, home }).accountId === account.id) {
        fail('ACCOUNT_IS_GLOBAL', 'Switch global to another account before removing the current global account.');
      }
      if (accountInUse(await listProcesses(), account.id)) fail('ACCOUNT_IN_USE', 'Close this account\'s Claude Code sessions first.');
      // Metadata first: a later keychain failure leaves only an unused item,
      // never a listed account whose login is gone.
      const removed = store.removeAccount(account.id);
      try { await keychain.remove(serviceName(account.configDir)); } catch { /* Item stays unused. */ }
      return removed;
    });
    case 'account.importGlobal': return importGlobal({ store, label: args.label, home, keychain });
    case 'project.remove': return store.removeProject(args.projectId);
    case 'global.status': return globalStatus({ store, home });
    case 'global.switch': return switchGlobal({ store, adapter: makeAdapter({ cliPath: args.cliPath, env }),
      accountId: args.accountId, home, keychain, listProcesses });
    case 'orca.projects': return orcaList({ env });
    case 'orca.open': {
      if (args.action !== undefined && args.action !== 'launch') {
        fail('INVALID_INPUT', 'Orca open only supports a project launch.');
      }
      const adapter = new OfficialAdapter({ cliPath: args.cliPath, env });
      return orcaOpen({ store, adapter, accountId: args.accountId, projectId: args.projectId, env });
    }
    case 'doctor': {
      let cli;
      try { cli = { available: true, ...discoverClaude({ cliPath: args.cliPath, env }) }; }
      catch (error) { cli = { available: false, error: publicError(error) }; }
      return { platform: process.platform, architecture: process.arch,
        nodeVersion: process.versions.node, nodeSupported: Number(process.versions.node.split('.')[0]) >= 20,
        terminalSupported: process.platform === 'darwin', storage: 'ok', cli };
    }
    default: {
      const adapter = new OfficialAdapter({ cliPath: args.cliPath, env });
      if (request.command === 'auth.status') return adapter.status(store.getAccount(args.accountId));
      const options = { store, adapter, accountId: args.accountId, projectId: args.projectId,
        action: request.command === 'auth.login' ? 'login' : args.action ?? 'launch' };
      return request.command === 'terminal.plan' ? createTerminalPlan(options) : open(options);
    }
  }
}

export async function response(request, options) {
  try { return { ok: true, data: await dispatch(request, options) }; }
  catch (error) { return { ok: false, error: publicError(error) }; }
}

async function readRequest(stream) {
  const chunks = [];
  let size = 0;
  const timer = setTimeout(() => stream.destroy(new Error('deadline')), 10_000);
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > LIMITS.inputBytes) fail('INPUT_LIMIT', 'Request exceeds the 16 KiB input limit.');
      chunks.push(chunk);
    }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { fail('INVALID_INPUT', 'Expected one UTF-8 JSON request on stdin.'); }
  } catch (error) {
    if (error.code === 'INPUT_LIMIT' || error.code === 'INVALID_INPUT') throw error;
    fail('INPUT_TIMEOUT', 'Input could not be read within the allowed time.');
  } finally { clearTimeout(timer); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  let result;
  try {
    if (Number(process.versions.node.split('.')[0]) < 20) fail('NODE_VERSION', 'Node.js 20 or newer is required.');
    if (process.argv.length !== 2) fail('INVALID_INPUT', 'Pass one JSON request on stdin, without command-line arguments.');
    result = await response(await readRequest(process.stdin));
  } catch (error) { result = { ok: false, error: publicError(error) }; }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
