import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWriteJSON, privateDirectory, readJSON } from './store.mjs';
import { absolutePath, executable, uuid } from './validation.mjs';
import { fail } from './errors.mjs';
import { shellQuote } from './terminal.mjs';

const SCHEMA = 1;

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function optionalJSON(file) {
  try {
    return readJSON(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function settingsBytes(file, readFile) {
  try { return readFile(file); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function settingsSnapshot(file, readFile) {
  // Keep the existing storage checks, then parse the exact bytes used for the
  // optimistic comparison so the value and its version cannot come from reads
  // on opposite sides of an external update.
  optionalJSON(file);
  const bytes = settingsBytes(file, readFile);
  if (bytes === null) return { bytes, settings: {} };
  let settings;
  try { settings = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('INVALID_STATE', 'Stored metadata is not valid JSON.'); }
  return { bytes, settings: settings ?? {} };
}

function parseShellQuotedCommand(command) {
  if (typeof command !== 'string' || command.length === 0) return null;
  const args = [];
  let offset = 0;
  while (offset < command.length) {
    if (command[offset] !== "'") return null;
    offset += 1;
    let arg = '';
    while (true) {
      const quote = command.indexOf("'", offset);
      if (quote === -1) return null;
      arg += command.slice(offset, quote);
      offset = quote + 1;
      if (command[offset] === '\\' && command[offset + 1] === "'" && command[offset + 2] === "'") {
        arg += "'";
        offset += 3;
      } else {
        break;
      }
    }
    args.push(arg);
    if (offset === command.length) return args;
    if (command[offset] !== ' ') return null;
    offset += 1;
  }
  return null;
}

function commandHistoryFile(store, accountId) {
  return path.join(store.rootDir, 'usage', `${accountId}.statusline.json`);
}

function validUsageCommand(command, store, accountId) {
  const args = parseShellQuotedCommand(command);
  if (args === null || args.length !== 6 || args[0] !== '/usr/bin/env' || args[1] !== '-i' ||
      args[4] !== accountId || args[5] !== store.rootDir ||
      !args[3].endsWith(`${path.sep}Resources${path.sep}core${path.sep}usage-statusline.mjs`)) {
    return false;
  }
  try {
    absolutePath(args[2]);
    absolutePath(args[3]);
    return args.map(shellQuote).join(' ') === command;
  } catch {
    return false;
  }
}

function readCommandHistory(store, accountId) {
  const history = optionalJSON(commandHistoryFile(store, accountId));
  if (history === null) return [];
  if (!plainObject(history) || Object.keys(history).sort().join(',') !== 'commands,schema' ||
      history.schema !== SCHEMA || !Array.isArray(history.commands) || history.commands.length > 16 ||
      history.commands.some(command => !validUsageCommand(command, store, accountId))) {
    fail('INVALID_STATE', 'The stored status-line command history is invalid.');
  }
  return history.commands;
}

function isOldUsageCommand(command, store, accountId) {
  return validUsageCommand(command, store, accountId) && readCommandHistory(store, accountId).includes(command);
}

function rememberCommands(store, accountId, generated) {
  const history = readCommandHistory(store, accountId);
  const commands = [...history];
  for (const command of generated) {
    if (!commands.includes(command)) commands.push(command);
  }
  if (commands.length === history.length) return;
  const retained = commands.slice(-16);
  for (const command of generated) {
    if (!retained.includes(command)) {
      if (retained.length === 16) retained.shift();
      retained.push(command);
    }
  }
  privateDirectory(path.join(store.rootDir, 'usage'), { create: true });
  atomicWriteJSON(commandHistoryFile(store, accountId), { schema: SCHEMA, commands: retained });
}

function usageFile(store, accountId) {
  return path.join(store.rootDir, 'usage', `${accountId}.json`);
}

function statusLineCommand(store, accountId, nodePath) {
  const script = fileURLToPath(new URL('./usage-statusline.mjs', import.meta.url));
  if (!fs.statSync(script).isFile()) fail('RESOURCES_MISSING', 'The status-line component is unavailable.');
  const node = executable(nodePath);
  return ['/usr/bin/env', '-i', node, script, accountId, store.rootDir].map(shellQuote).join(' ');
}

export function configureUsage({ store, accountId, nodePath = process.execPath }, { readFile = fs.readFileSync } = {}) {
  uuid(accountId);
  const account = store.getAccount(accountId);
  const settingsFile = path.join(account.configDir, 'settings.json');
  const { bytes, settings } = settingsSnapshot(settingsFile, readFile);
  if (!plainObject(settings)) fail('INVALID_STATE', 'The official settings file must contain a JSON object.');
  const command = statusLineCommand(store, accountId, nodePath);
  let statusLine = { type: 'command', command };
  let previousCommand = null;
  let alreadyConfigured = false;
  if (Object.hasOwn(settings, 'statusLine')) {
    const current = settings.statusLine;
    if (!plainObject(current) || current.type !== 'command' || typeof current.command !== 'string') {
      fail('STATUSLINE_CONFLICT', 'An existing statusLine command was left unchanged.');
    }
    previousCommand = current.command;
    if (current.command === command) {
      alreadyConfigured = true;
    } else {
      if (!isOldUsageCommand(current.command, store, accountId)) {
        fail('STATUSLINE_CONFLICT', 'An existing statusLine command was left unchanged.');
      }
      statusLine = { ...current, command };
    }
  }
  rememberCommands(store, accountId, previousCommand === null ? [command] : [previousCommand, command]);
  if (alreadyConfigured) return { configured: true, alreadyConfigured: true };
  const currentBytes = settingsBytes(settingsFile, readFile);
  if (bytes === null ? currentBytes !== null : currentBytes === null || !bytes.equals(currentBytes)) {
    fail('SETTINGS_CHANGED', 'The official settings file changed. Retry to preserve the new changes.');
  }
  atomicWriteJSON(settingsFile, { ...settings, statusLine });
  return { configured: true, alreadyConfigured: false };
}

function unknownSnapshot(now, reason) {
  return {
    schema: SCHEMA,
    status: 'unknown',
    windows: { fiveHour: null, sevenDay: null },
    observedAt: now.toISOString(),
    reason,
  };
}

function validStoredWindow(value) {
  if (value === null) return null;
  if (!plainObject(value) || Object.keys(value).sort().join(',') !== 'resetsAt,usedPercentage') {
    fail('INVALID_STATE', 'The stored usage snapshot has an invalid window.');
  }
  const { usedPercentage, resetsAt } = value;
  if (typeof usedPercentage !== 'number' || !Number.isFinite(usedPercentage) ||
      usedPercentage < 0 || usedPercentage > 100 ||
      typeof resetsAt !== 'number' || !Number.isFinite(resetsAt) ||
      resetsAt <= 0 || resetsAt > 8_640_000_000_000) {
    fail('INVALID_STATE', 'The stored usage snapshot has invalid values.');
  }
  return { usedPercentage, resetsAt };
}

function validateSnapshot(value) {
  if (!plainObject(value) ||
      Object.keys(value).sort().join(',') !== 'observedAt,reason,schema,status,windows' ||
      value.schema !== SCHEMA || !['available', 'unknown'].includes(value.status) ||
      typeof value.observedAt !== 'string' || !Number.isFinite(Date.parse(value.observedAt)) ||
      typeof value.reason !== 'string' || value.reason.length > 120 ||
      !plainObject(value.windows) || Object.keys(value.windows).sort().join(',') !== 'fiveHour,sevenDay') {
    fail('INVALID_STATE', 'The stored usage snapshot has an unsupported shape.');
  }
  const windows = {
    fiveHour: validStoredWindow(value.windows.fiveHour),
    sevenDay: validStoredWindow(value.windows.sevenDay),
  };
  const hasWindow = windows.fiveHour !== null || windows.sevenDay !== null;
  if ((value.status === 'available') !== hasWindow) {
    fail('INVALID_STATE', 'The stored usage snapshot is inconsistent.');
  }
  return { ...value, windows };
}

export function usageSnapshot({ store, accountId, now = () => new Date() }) {
  uuid(accountId);
  store.getAccount(accountId);
  const currentTime = now();
  if (!(currentTime instanceof Date) || !Number.isFinite(currentTime.getTime())) {
    fail('INVALID_INPUT', 'A valid snapshot time is required.');
  }
  const usageDir = path.join(store.rootDir, 'usage');
  try {
    fs.lstatSync(usageDir);
  } catch (error) {
    if (error.code === 'ENOENT') return unknownSnapshot(currentTime, 'NO_SNAPSHOT');
    throw error;
  }
  privateDirectory(usageDir);
  const stored = optionalJSON(usageFile(store, accountId));
  if (stored === null) return unknownSnapshot(currentTime, 'NO_SNAPSHOT');
  const snapshot = validateSnapshot(stored);
  const nowSeconds = currentTime.getTime() / 1000;
  for (const key of ['fiveHour', 'sevenDay']) {
    if (snapshot.windows[key] && snapshot.windows[key].resetsAt <= nowSeconds) snapshot.windows[key] = null;
  }
  if (snapshot.windows.fiveHour === null && snapshot.windows.sevenDay === null) {
    return { ...snapshot, status: 'unknown', reason: 'WINDOWS_RESET' };
  }
  return snapshot;
}

export const __testables = { statusLineCommand, validateSnapshot };
