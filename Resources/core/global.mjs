import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail, AppError } from './errors.mjs';
import { runCaptured } from './official.mjs';
import { GLOBAL_SERVICE, Keychain, expiresAt, fingerprint, serviceName } from './login-store.mjs';
import { absolutePath, email, text, uuid } from './validation.mjs';
import { acquireLock } from './store.mjs';

// The Mac-wide default login is what a plain `claude` uses: the keychain item
// "Claude Code-credentials" plus ~/.claude.json's oauthAccount record. A global
// switch copies one managed account's login into that slot. Before doing so,
// the outgoing global login is written back to its own managed account so it
// can be switched back later; every failure after the first global write
// restores the previous login.
const CONFIG_LIMIT = 64 * 1_048_576;
const REFRESH_MARGIN_MS = 90_000;
// Longer than the slowest complete switch, so only an abandoned lock expires.
const SWITCH_LOCK_STALE_MS = 15 * 60_000;

function readConfig(file) {
  let fd;
  try {
    const link = fs.lstatSync(file);
    if (link.isSymbolicLink() || !link.isFile()) fail('CONFIG_UNREADABLE', 'An official configuration file has an unexpected type.');
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > CONFIG_LIMIT) fail('CONFIG_UNREADABLE', 'An official configuration file is too large.');
    const bytes = fs.readFileSync(fd);
    let value;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { fail('CONFIG_UNREADABLE', 'An official configuration file is not valid JSON.'); }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('CONFIG_UNREADABLE', 'An official configuration file is not a JSON object.');
    return { bytes, value, mode: stat.mode & 0o777 };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof AppError) throw error;
    fail('CONFIG_UNREADABLE', 'An official configuration file could not be read.');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function identity(oauthAccount) {
  if (oauthAccount === null || typeof oauthAccount !== 'object' || Array.isArray(oauthAccount)) return null;
  const { accountUuid, emailAddress } = oauthAccount;
  if (typeof emailAddress !== 'string' || !emailAddress) return null;
  try { email(emailAddress); } catch { return null; }
  return { accountUuid: typeof accountUuid === 'string' && accountUuid ? accountUuid : null, email: emailAddress, record: oauthAccount };
}

export function oauthIdentity(file) {
  return identity(readConfig(file)?.value?.oauthAccount ?? null);
}

export function sameIdentity(a, b) {
  if (!a || !b) return false;
  if (a.accountUuid && b.accountUuid) return a.accountUuid === b.accountUuid;
  return a.email.toLowerCase() === b.email.toLowerCase();
}

export const globalConfigFile = home => path.join(home, '.claude.json');
export const accountConfigFile = account => path.join(account.configDir, '.claude.json');

// Rewrites only oauthAccount (and, for a new account folder, onboarding flags)
// and keeps every other field written by running official sessions. The file
// is compared again just before the rename; a concurrent edit causes a retry.
export function writeOAuthAccount(file, oauthAccount, { extra = {}, create = false } = {}) {
  absolutePath(file);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = readConfig(file);
    if (!current && !create) fail('CONFIG_UNREADABLE', 'An official configuration file is missing.');
    const value = { ...(current?.value ?? {}), ...extra };
    if (oauthAccount === undefined) delete value.oauthAccount; else value.oauthAccount = oauthAccount;
    const temporary = path.join(path.dirname(file), `.ccac-${randomUUID()}.tmp`);
    let fd;
    let published = false;
    try {
      fd = fs.openSync(temporary, 'wx', current?.mode ?? 0o600);
      fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      const latest = readConfig(file);
      const unchanged = current ? latest !== null && latest.bytes.equals(current.bytes) : latest === null;
      if (!unchanged) continue;
      fs.renameSync(temporary, file);
      published = true;
      return;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      // Only the unique temporary file created above may be removed.
      if (!published) try { fs.unlinkSync(temporary); } catch { /* Already gone. */ }
    }
  }
  fail('CONFIG_BUSY', 'An official configuration file kept changing. Retry in a moment.');
}

// Claude Code reloads its login when ~/.claude/.credentials.json changes; a
// timestamp-only update makes running default windows pick up the switch at
// their next request. When the file is absent they re-read the keychain anyway.
export function notifyRunningWindows(home) {
  const file = path.join(home, '.claude', '.credentials.json');
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return 'not_needed';
    const now = new Date();
    fs.utimesSync(file, now, now);
    return 'notified';
  } catch {
    return 'not_needed';
  }
}

export async function processList({ run = runCaptured } = {}) {
  try {
    const result = await run('/bin/ps', ['-axo', 'pid=,command='], { timeoutMs: 10_000, maxBytes: 8_388_608 });
    if (result.code !== 0) fail('PROCESS_LIST_UNAVAILABLE', 'Running sessions could not be checked.');
    return result.stdout;
  } catch (error) {
    if (error instanceof AppError && error.code === 'PROCESS_LIST_UNAVAILABLE') throw error;
    fail('PROCESS_LIST_UNAVAILABLE', 'Running sessions could not be checked.');
  }
}

// Sessions opened by this app keep the terminal runner alive with the account
// ID in its request argument. Two live copies of one login would refresh it
// independently and invalidate each other, so such accounts are not touched.
export function accountInUse(processes, accountId) {
  uuid(accountId);
  return processes.includes(`"accountId":"${accountId}"`);
}

// Two entries may hold separate logins of the same Claude account; the one this
// app last placed in the global slot wins, then list order.
export function findManaged(store, wanted) {
  if (!wanted) return null;
  const state = store.snapshot();
  const matches = state.accounts.filter(account => sameIdentity(oauthIdentity(accountConfigFile(account)), wanted));
  return matches.find(account => account.id === state.globalAccountId) ?? matches[0] ?? null;
}

export function globalStatus({ store, home = os.homedir() }) {
  const current = oauthIdentity(globalConfigFile(home));
  const managed = findManaged(store, current);
  const state = store.snapshot();
  return { signedIn: current !== null, email: current?.email ?? null, accountId: managed?.id ?? null,
    switchedByApp: managed !== null && state.globalAccountId === managed.id };
}

// An account whose login this app placed in the default slot shares one
// refresh chain with it. Opening the same account separately would let two
// processes refresh one chain, so that launch is refused until it is switched away.
export function assertNotGlobalCopy(store, account, home = os.homedir()) {
  if (store.snapshot().globalAccountId !== account.id) return;
  const current = oauthIdentity(globalConfigFile(home));
  if (current && sameIdentity(current, oauthIdentity(accountConfigFile(account)))) {
    fail('ACCOUNT_IS_GLOBAL', 'This account is the current global account. Use a normal Claude window, or switch global to another account first.');
  }
}

export async function importGlobal({ store, label, home = os.homedir(), keychain = new Keychain() }) {
  return withSwitchLock(store, () => importLocked({ store, label, home, keychain }));
}

async function importLocked({ store, label, home, keychain }) {
  const name = text(label).trim();
  const config = readConfig(globalConfigFile(home));
  const current = identity(config?.value?.oauthAccount ?? null);
  const credential = await keychain.read(GLOBAL_SERVICE);
  if (!current || !credential) fail('GLOBAL_NOT_SIGNED_IN', 'There is no global claude.ai login to import.');
  if (findManaged(store, current)) fail('GLOBAL_ALREADY_MANAGED', 'The global login is already one of these accounts.');
  const account = store.createAccount({ label: name, expectedEmail: current.email });
  try {
    await keychain.write(serviceName(account.configDir), credential);
    const extra = {};
    for (const key of ['hasCompletedOnboarding', 'lastOnboardingVersion']) {
      if (Object.hasOwn(config.value, key)) extra[key] = config.value[key];
    }
    writeOAuthAccount(accountConfigFile(account), current.record, { extra, create: true });
    store.setGlobalAccount(account.id);
  } catch (error) {
    try { await keychain.remove(serviceName(account.configDir)); } catch { /* Report the original failure. */ }
    try { store.removeAccount(account.id); } catch { /* Report the original failure. */ }
    throw error;
  }
  return { ...store.getAccount(account.id), imported: true };
}

// Global switches and account removal share one lock: both touch the global
// slot and per-account keychain items.
export async function withSwitchLock(store, operation) {
  const release = acquireLock(path.join(store.rootDir, '.global-switch.lock'), { staleMs: SWITCH_LOCK_STALE_MS,
    code: 'SWITCH_BUSY', message: 'Another global switch is still running.' });
  try { return await operation(); } finally { release(); }
}

export async function switchGlobal({ store, adapter, accountId, home = os.homedir(), keychain = new Keychain(),
  listProcesses = processList, probe = true, now = () => Date.now() }) {
  uuid(accountId);
  return withSwitchLock(store, async () => {
    const target = store.getAccount(accountId);
    const targetIdentity = oauthIdentity(accountConfigFile(target));
    const targetCredential = await keychain.read(serviceName(target.configDir));
    if (!targetIdentity || !targetCredential) fail('TARGET_NOT_SIGNED_IN', 'Sign in to this account first.');
    const globalFile = globalConfigFile(home);
    const previousConfig = readConfig(globalFile);
    if (!previousConfig) fail('CONFIG_UNREADABLE', 'The global Claude configuration file is missing. Run claude once first.');
    const previousIdentity = identity(previousConfig.value.oauthAccount ?? null);
    let previousCredential = await keychain.read(GLOBAL_SERVICE);
    if (previousCredential && sameIdentity(previousIdentity, targetIdentity)) {
      // Only an identical copy shares the refresh chain; a separate login of the
      // same account stays independent and must not be marked as the global copy.
      if (fingerprint(previousCredential) === fingerprint(targetCredential)) store.setGlobalAccount(target.id);
      return { switched: false, reason: 'ALREADY_GLOBAL', accountId, email: targetIdentity.email };
    }
    const processes = await listProcesses();
    if (accountInUse(processes, target.id)) fail('TARGET_IN_USE', 'Close this account\'s own Claude Code sessions first.');

    let outgoing = null;
    if (previousCredential) {
      if (!previousIdentity) fail('GLOBAL_UNIDENTIFIED', 'The current global login has no account record.');
      outgoing = findManaged(store, previousIdentity);
      if (!outgoing) fail('GLOBAL_NOT_MANAGED', 'Add the current global account here first, so it can be switched back.');
      if (accountInUse(processes, outgoing.id)) fail('HOME_IN_USE', 'Close the current global account\'s own Claude Code sessions first.');
      // An already expired access token is renewed by the next request that uses
      // it; only a token about to expire may be renewed mid-switch by a window.
      const left = expiresAt(previousCredential) - now();
      if (left > 0 && left < REFRESH_MARGIN_MS) {
        fail('GLOBAL_REFRESHING', 'The global login is about to renew. Retry in a minute.');
      }
      // Save the newest copy of the outgoing login in its own account, then make
      // sure no running window renewed it in the meantime.
      for (let attempt = 0; ; attempt += 1) {
        await keychain.write(serviceName(outgoing.configDir), previousCredential);
        // From here the outgoing account holds a copy of the live global login.
        store.setGlobalAccount(outgoing.id);
        const latest = await keychain.read(GLOBAL_SERVICE);
        if (!latest) fail('KEYCHAIN_UNAVAILABLE', 'The macOS keychain could not be read.');
        if (fingerprint(latest) === fingerprint(previousCredential)) break;
        if (!sameIdentity(oauthIdentity(globalFile), previousIdentity)) fail('GLOBAL_CHANGED', 'The global login changed during the switch.');
        previousCredential = latest;
        if (attempt === 2) fail('GLOBAL_REFRESHING', 'The global login keeps renewing. Retry in a minute.');
      }
    }

    // After the write-back above this is the outgoing account, so a rollback
    // marks the account that again shares the restored global login.
    const previousLease = store.snapshot().globalAccountId;
    try {
      await keychain.write(GLOBAL_SERVICE, targetCredential);
      writeOAuthAccount(globalFile, targetIdentity.record);
      store.setGlobalAccount(target.id);
      const runningWindows = notifyRunningWindows(home);
      const status = await adapter.globalStatus();
      // A settings-level API key or gateway would answer the probe without this
      // login, so the default configuration must report the claude.ai login itself.
      if (!status.loggedIn || status.authMethod !== 'claude.ai' || !status.email ||
          status.email.toLowerCase() !== targetIdentity.email.toLowerCase()) {
        fail('SWITCH_NOT_CONFIRMED', 'The official CLI did not report the new global account.');
      }
      if (probe && !(await adapter.probeGlobal())) fail('SWITCH_PROBE_FAILED', 'A real request with the new global account did not succeed.');
      return { switched: true, accountId, fromAccountId: outgoing?.id ?? null, email: targetIdentity.email,
        probe: probe ? 'passed' : 'skipped', runningWindows };
    } catch (error) {
      const cause = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
      try {
        // A window may already have renewed the new login; keep that renewal
        // in the target account before the previous login is restored.
        const current = await keychain.read(GLOBAL_SERVICE);
        if (current && fingerprint(current) !== fingerprint(targetCredential) &&
            (!previousCredential || fingerprint(current) !== fingerprint(previousCredential))) {
          await keychain.write(serviceName(target.configDir), current);
        }
        if (previousCredential) await keychain.write(GLOBAL_SERVICE, previousCredential);
        else await keychain.remove(GLOBAL_SERVICE);
        writeOAuthAccount(globalFile, previousConfig.value.oauthAccount);
        store.setGlobalAccount(previousLease);
        notifyRunningWindows(home);
      } catch {
        fail('SWITCH_ROLLBACK_FAILED', `The switch failed (${cause}) and the previous global login could not be restored automatically.`);
      }
      fail('SWITCH_ROLLED_BACK', `The switch was not confirmed (${cause}); the previous global login was restored.`);
    }
  });
}

export const __testables = { readConfig, identity };
