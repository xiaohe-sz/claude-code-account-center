import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail } from './errors.mjs';
import { LIMITS, absolutePath, email, object, projectDirectory, text, uuid } from './validation.mjs';

export const STATE_ENV = 'CCAC_STATE_DIR';
export const SCHEMA_VERSION = 2;
const LOCK_STALE_MS = 120_000;

function exists(file) {
  try { fs.lstatSync(file); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function privateStat(stat, directory) {
  if ((directory ? !stat.isDirectory() : !stat.isFile()) || stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 || (!directory && stat.nlink !== 1) ||
      (process.getuid && stat.uid !== process.getuid())) {
    fail('UNSAFE_STORAGE', 'Storage must be private, owned by this user, and not linked.');
  }
}

export function privateDirectory(directory, { create = false } = {}) {
  absolutePath(directory);
  if (create && !exists(directory)) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { privateStat(fs.lstatSync(directory), true); } catch (error) {
    if (error.code === 'ENOENT') fail('UNSAFE_STORAGE', 'A required storage directory is missing.');
    throw error;
  }
  return directory;
}

export function readJSON(file) {
  let fd;
  try {
    privateStat(fs.lstatSync(file), false);
    // A substituted FIFO/device must not block before its type is inspected.
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    privateStat(stat, false);
    if (stat.size > LIMITS.stateBytes) fail('INVALID_STATE', 'Stored metadata exceeds its size limit.');
    const buffer = Buffer.alloc(LIMITS.stateBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > LIMITS.stateBytes) fail('INVALID_STATE', 'Stored metadata exceeds its size limit.');
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length))); }
    catch { fail('INVALID_STATE', 'Stored metadata is not valid JSON.'); }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

// Same-directory rename publishes a complete file. A failed rename leaves the
// previous state intact; fsync makes successful writes durable on local disks.
// io is injectable only for deterministic filesystem fault tests.
export function atomicWriteJSON(file, value, { io = fs } = {}) {
  absolutePath(file);
  privateDirectory(path.dirname(file));
  if (exists(file)) privateStat(fs.lstatSync(file), false);
  const data = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(data) > LIMITS.stateBytes) fail('STATE_LIMIT', 'Stored metadata exceeds its size limit.');
  const temporary = path.join(path.dirname(file), `.state-${randomUUID()}.tmp`);
  let fd;
  let created = false;
  try {
    fd = io.openSync(temporary, 'wx', 0o600);
    created = true;
    io.fchmodSync(fd, 0o600);
    io.writeFileSync(fd, data, 'utf8');
    io.fsyncSync(fd);
    io.closeSync(fd);
    fd = undefined;
    io.renameSync(temporary, file);
    created = false;
    const directory = io.openSync(path.dirname(file), fs.constants.O_RDONLY);
    try { io.fsyncSync(directory); } finally { io.closeSync(directory); }
  } finally {
    if (fd !== undefined) io.closeSync(fd);
    // Only the unique temporary file created by this call may be removed.
    if (created) io.unlinkSync(temporary);
  }
}

// Version 1 files are upgraded in memory and saved as version 2 by the next write.
export function upgradeState(state) {
  if (state !== null && typeof state === 'object' && !Array.isArray(state) && state.version === 1) {
    object(state, ['version', 'revision', 'accounts', 'projects']);
    return { ...state, version: SCHEMA_VERSION, defaultAccountId: null, globalAccountId: null };
  }
  return state;
}

export function validateState(state) {
  object(state, ['version', 'revision', 'accounts', 'projects', 'defaultAccountId', 'globalAccountId']);
  if (state.version !== SCHEMA_VERSION || !Number.isSafeInteger(state.revision) || state.revision < 0 ||
      !Array.isArray(state.accounts) || state.accounts.length > LIMITS.accounts ||
      !Array.isArray(state.projects) || state.projects.length > LIMITS.projects) {
    fail('INVALID_STATE', 'Stored metadata has an unsupported shape or version.');
  }
  const accountIds = new Set();
  const projectIds = new Set();
  const projectPaths = new Set();
  for (const project of state.projects) {
    object(project, ['id', 'label', 'path']);
    uuid(project.id); text(project.label); absolutePath(project.path);
    if (projectIds.has(project.id) || projectPaths.has(project.path)) fail('INVALID_STATE', 'Duplicate project metadata.');
    projectIds.add(project.id); projectPaths.add(project.path);
  }
  for (const account of state.accounts) {
    object(account, ['id', 'label', 'expectedEmail', 'lastProjectId']);
    uuid(account.id); text(account.label);
    if (email(account.expectedEmail) !== account.expectedEmail) fail('INVALID_STATE', 'Invalid stored email.');
    if (accountIds.has(account.id)) fail('INVALID_STATE', 'Duplicate account metadata.');
    accountIds.add(account.id);
    if (account.lastProjectId !== null && !projectIds.has(uuid(account.lastProjectId))) {
      fail('INVALID_STATE', 'Last project reference is invalid.');
    }
  }
  // globalAccountId records which account's login this app last placed in the
  // Mac-wide default configuration; it is a hint, re-checked before every use.
  for (const key of ['defaultAccountId', 'globalAccountId']) {
    if (state[key] !== null && !accountIds.has(uuid(state[key]))) fail('INVALID_STATE', 'Account reference is invalid.');
  }
  return state;
}

// A lock file holds its writer's PID. A lock whose writer is gone, or that is
// older than staleMs, is removed so a killed process cannot block every later
// write. The file is re-checked just before removal so a fresh lock created
// by another process in the meantime is never taken away.
export function acquireLock(file, { staleMs = LOCK_STALE_MS, code = 'STORE_BUSY',
  message = 'Storage is locked. Retry after the other operation finishes.' } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    let fd;
    try { fd = fs.openSync(file, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (attempt > 0 || !clearStaleLock(file, staleMs)) fail(code, message);
      continue;
    }
    let own;
    try { fs.writeSync(fd, String(process.pid)); own = fs.fstatSync(fd).ino; } finally { fs.closeSync(fd); }
    return () => {
      try { if (fs.lstatSync(file).ino === own) fs.unlinkSync(file); } catch { /* Already released. */ }
    };
  }
}

function clearStaleLock(file, staleMs) {
  let stat;
  let owner = NaN;
  try {
    stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    owner = Number(fs.readFileSync(file, 'utf8').trim());
  } catch (error) {
    return error.code === 'ENOENT';
  }
  const known = Number.isSafeInteger(owner) && owner > 0;
  let alive = false;
  if (known) {
    try { process.kill(owner, 0); alive = true; } catch (error) { alive = error.code === 'EPERM'; }
  }
  // An unnamed lock may belong to a writer that has not recorded its PID yet.
  if ((alive || !known) && Date.now() - stat.mtimeMs < staleMs) return false;
  try {
    const again = fs.lstatSync(file);
    if (again.ino !== stat.ino || again.mtimeMs !== stat.mtimeMs) return false;
    fs.unlinkSync(file);
  } catch (error) {
    return error.code === 'ENOENT';
  }
  return true;
}

export class Store {
  constructor({ rootDir, env = process.env } = {}) {
    const selected = rootDir !== undefined ? rootDir : Object.hasOwn(env, STATE_ENV) ? env[STATE_ENV] :
      path.join(os.homedir(), 'Library', 'Application Support', 'ClaudeCodeAccountCenter');
    absolutePath(selected);
    privateDirectory(selected, { create: true });
    // Resolve ancestor aliases once; managed children must never be symlinks.
    this.rootDir = fs.realpathSync(selected);
    this.accountsDir = path.join(this.rootDir, 'accounts');
    this.stateFile = path.join(this.rootDir, 'state.json');
    this.lockFile = path.join(this.rootDir, '.write.lock');
    if (!exists(this.stateFile)) {
      this._locked(() => {
        if (exists(this.stateFile)) return;
        privateDirectory(this.accountsDir, { create: true });
        if (fs.readdirSync(this.accountsDir).length) fail('INVALID_STATE', 'Account directories exist without metadata.');
        atomicWriteJSON(this.stateFile, { version: SCHEMA_VERSION, revision: 0, accounts: [], projects: [],
          defaultAccountId: null, globalAccountId: null });
      });
    }
    this._read();
  }

  _locked(operation) {
    privateDirectory(this.rootDir);
    const release = acquireLock(this.lockFile);
    try { return operation(); } finally { release(); }
  }

  _configDir(id) {
    uuid(id);
    return path.join(this.accountsDir, id, 'config');
  }

  _read() {
    privateDirectory(this.rootDir);
    privateDirectory(this.accountsDir);
    const state = validateState(upgradeState(readJSON(this.stateFile)));
    for (const account of state.accounts) {
      privateDirectory(path.join(this.accountsDir, account.id));
      privateDirectory(this._configDir(account.id));
    }
    return state;
  }

  _mutate(operation) {
    return this._locked(() => {
      const state = this._read();
      const result = operation(state);
      state.revision += 1;
      validateState(state);
      atomicWriteJSON(this.stateFile, state);
      return result;
    });
  }

  snapshot() {
    const state = this._read();
    return { ...state, accounts: state.accounts.map(account => ({ ...account, configDir: this._configDir(account.id) })) };
  }

  createAccount(input) {
    object(input, ['label', 'expectedEmail'], ['label']);
    const label = text(input.label).trim();
    const expectedEmail = email(input.expectedEmail ?? null);
    return this._mutate(state => {
      if (state.accounts.length >= LIMITS.accounts) fail('STATE_LIMIT', 'Account limit reached.');
      const account = { id: randomUUID(), label, expectedEmail, lastProjectId: null };
      const directory = path.join(this.accountsDir, account.id);
      // UUID collisions must fail, never attach to an existing directory.
      fs.mkdirSync(directory, { mode: 0o700 });
      fs.mkdirSync(this._configDir(account.id), { mode: 0o700 });
      state.accounts.push(account);
      return { ...account, configDir: this._configDir(account.id) };
    });
  }

  addProject(input) {
    object(input, ['path', 'label'], ['path']);
    const directory = projectDirectory(input.path);
    const label = text(input.label ?? path.basename(directory)).trim();
    return this._mutate(state => {
      const existing = state.projects.find(project => project.path === directory);
      if (existing) return { ...existing };
      if (state.projects.length >= LIMITS.projects) fail('STATE_LIMIT', 'Project limit reached.');
      const project = { id: randomUUID(), label, path: directory };
      state.projects.push(project);
      return { ...project };
    });
  }

  getAccount(id) {
    uuid(id);
    const account = this.snapshot().accounts.find(item => item.id === id);
    if (!account) fail('ACCOUNT_NOT_FOUND', 'Account was not found.');
    return account;
  }

  resolveProject(accountId, projectId) {
    const account = this.getAccount(accountId);
    const selected = projectId ?? account.lastProjectId;
    if (selected === null || selected === undefined) fail('PROJECT_REQUIRED', 'Select a project first.');
    uuid(selected);
    const project = this._read().projects.find(item => item.id === selected);
    if (!project) fail('PROJECT_NOT_FOUND', 'Project was not found.');
    if (projectDirectory(project.path) !== project.path) fail('INVALID_DIRECTORY', 'The project path has changed.');
    return { ...project };
  }

  setDefaultAccount(accountId) {
    if (accountId !== null) this.getAccount(accountId);
    return this._mutate(state => {
      if (accountId !== null && !state.accounts.some(item => item.id === accountId)) fail('ACCOUNT_NOT_FOUND', 'Account was not found.');
      state.defaultAccountId = accountId;
      return { defaultAccountId: accountId };
    });
  }

  setGlobalAccount(accountId) {
    return this._mutate(state => {
      if (accountId !== null && !state.accounts.some(item => item.id === uuid(accountId))) fail('ACCOUNT_NOT_FOUND', 'Account was not found.');
      state.globalAccountId = accountId;
    });
  }

  // Removes the metadata and this app's private copy of the account folder.
  // The caller removes the matching keychain item; the Claude account itself
  // and every project folder are untouched.
  removeAccount(accountId) {
    const account = this.getAccount(accountId);
    this._mutate(state => {
      const index = state.accounts.findIndex(item => item.id === accountId);
      if (index === -1) fail('ACCOUNT_NOT_FOUND', 'Account was not found.');
      state.accounts.splice(index, 1);
      if (state.defaultAccountId === accountId) state.defaultAccountId = null;
      if (state.globalAccountId === accountId) state.globalAccountId = null;
    });
    const directory = path.join(this.accountsDir, accountId);
    privateDirectory(directory);
    fs.rmSync(directory, { recursive: true, force: true });
    return { removed: true, accountId, configDir: account.configDir };
  }

  removeProject(projectId) {
    uuid(projectId);
    return this._mutate(state => {
      const index = state.projects.findIndex(item => item.id === projectId);
      if (index === -1) fail('PROJECT_NOT_FOUND', 'Project was not found.');
      state.projects.splice(index, 1);
      for (const account of state.accounts) if (account.lastProjectId === projectId) account.lastProjectId = null;
      return { removed: true, projectId };
    });
  }

  setLastProject(accountId, projectId) {
    const project = this.resolveProject(accountId, projectId);
    this._mutate(state => {
      const account = state.accounts.find(item => item.id === accountId);
      if (!account || !state.projects.some(item => item.id === project.id)) fail('INVALID_STATE', 'Account or project changed.');
      account.lastProjectId = project.id;
    });
  }
}
