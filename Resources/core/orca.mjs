import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fail } from './errors.mjs';
import { runCaptured } from './official.mjs';
import { absolutePath, executable, text } from './validation.mjs';
import { createTerminalPlan } from './terminal.mjs';

export function discoverOrca({ env = process.env, homeDir = os.homedir() } = {}) {
  if (Object.hasOwn(env, 'ORCA_CLI')) return executable(env.ORCA_CLI);
  for (const directory of (env.PATH ?? '').split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    try { return executable(path.join(directory, 'orca')); } catch { /* Try next installation. */ }
  }
  for (const candidate of ['/opt/homebrew/bin/orca', '/usr/local/bin/orca',
    path.join(homeDir, '.local', 'bin', 'orca')]) {
    try { return executable(candidate); } catch { /* Try next installation. */ }
  }
  fail('ORCA_NOT_FOUND', 'Orca was not found. Install Orca or configure ORCA_CLI.');
}

// Each entry is validated on its own; one malformed setup is skipped instead of
// hiding the whole list. path is canonical for matching saved projects;
// orcaPath is the spelling Orca knows, used for its worktree selector.
export function parseOrcaSetups(stdout, { exists = fs.existsSync, isDirectory = fs.statSync,
  realpath = fs.realpathSync } = {}) {
  let raw;
  try { raw = JSON.parse(stdout); } catch { fail('ORCA_OUTPUT_INVALID', 'Orca returned an invalid project list.'); }
  if (!raw || raw.ok !== true || !raw.result || !Array.isArray(raw.result.setups)) {
    fail('ORCA_OUTPUT_INVALID', 'Orca returned an invalid project list.');
  }
  const projects = [];
  const seen = new Set();
  for (const setup of raw.result.setups) {
    try {
      if (!setup || setup.hostId !== 'local' || setup.setupState !== 'ready' ||
          typeof setup.path !== 'string' || !path.isAbsolute(setup.path)) continue;
      const orcaPath = absolutePath(setup.path);
      if (!exists(orcaPath) || !isDirectory(orcaPath).isDirectory()) continue;
      const canonical = absolutePath(realpath(orcaPath));
      if (seen.has(canonical)) continue;
      const label = typeof setup.displayName === 'string' && setup.displayName.trim()
        ? setup.displayName.trim() : path.basename(orcaPath);
      text(label, 200, true);
      projects.push({ id: text(setup.id, 512, true), label, path: canonical, orcaPath });
      seen.add(canonical);
    } catch { /* Skip this entry only. */ }
  }
  projects.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
  return projects;
}

export async function listOrcaProjects({ env = process.env, run = runCaptured, homeDir } = {}) {
  const cli = discoverOrca({ env, homeDir });
  let result;
  try {
    result = await run(cli, ['project', 'setups', '--json'], {
      timeoutMs: 12_000, maxBytes: 1_048_576, env,
    });
  } catch (error) {
    if (error?.code === 'CLI_TIMEOUT') fail('ORCA_TIMEOUT', 'Orca did not return its project list in time.');
    if (error?.code === 'CLI_OUTPUT_LIMIT') fail('ORCA_OUTPUT_LIMIT', 'The Orca project list is too large.');
    fail('ORCA_UNAVAILABLE', 'The Orca runtime could not be reached.');
  }
  if (result.code !== 0) fail('ORCA_UNAVAILABLE', 'The Orca runtime could not be reached.');
  return { cliPath: cli, projects: parseOrcaSetups(result.stdout) };
}

export async function openOrcaTerminal({ store, adapter, accountId, projectId, env = process.env,
  run = runCaptured, homeDir } = {}) {
  const account = store.getAccount(accountId);
  const project = store.resolveProject(accountId, projectId);
  const listing = await listOrcaProjects({ env, run, homeDir });
  const match = listing.projects.find(item => item.path === project.path);
  if (!match) fail('ORCA_PROJECT_NOT_FOUND', 'This project is not available in Orca.');
  const plan = createTerminalPlan({ store, adapter, accountId, projectId, action: 'launch' });
  const orca = discoverOrca({ env, homeDir });
  let result;
  try {
    result = await run(orca, ['terminal', 'create', '--worktree', `path:${match.orcaPath}`,
      '--title', `Claude · ${account.label}`, '--command', plan.command, '--focus', '--json'], {
      timeoutMs: 20_000, maxBytes: 65_536, env,
    });
  } catch (error) {
    if (error?.code === 'CLI_TIMEOUT') fail('ORCA_TIMEOUT', 'Orca did not confirm the new terminal in time.');
    fail('ORCA_OPEN_FAILED', 'Orca could not create a terminal.');
  }
  if (result.code !== 0) fail('ORCA_OPEN_FAILED', 'Orca could not create a terminal.');
  let response;
  try { response = JSON.parse(result.stdout); } catch { fail('ORCA_OUTPUT_INVALID', 'Orca returned an invalid terminal response.'); }
  if (response?.ok !== true) fail('ORCA_OPEN_FAILED', 'Orca could not create a terminal.');
  return { opened: true, execution: 'unconfirmed', accountId, projectId, action: 'launch', backend: 'orca' };
}
