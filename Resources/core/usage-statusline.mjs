import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { atomicWriteJSON, privateDirectory, readJSON } from './store.mjs';
import { absolutePath, LIMITS, uuid } from './validation.mjs';

const STDIN_TIMEOUT_MS = 10_000;
const SCHEMA = 1;

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function normalizeWindow(value) {
  if (!plainObject(value)) return null;
  const usedPercentage = value.used_percentage;
  const resetsAt = value.resets_at;
  if (typeof usedPercentage !== 'number' || !Number.isFinite(usedPercentage) ||
      usedPercentage < 0 || usedPercentage > 100 ||
      typeof resetsAt !== 'number' || !Number.isFinite(resetsAt) ||
      resetsAt <= 0 || resetsAt > 8_640_000_000_000) return null;
  return { usedPercentage, resetsAt };
}

function emptySnapshot(reason, now) {
  return {
    schema: SCHEMA,
    status: 'unknown',
    windows: { fiveHour: null, sevenDay: null },
    observedAt: now.toISOString(),
    reason,
  };
}

export function snapshotFromPayload(payload, now = new Date()) {
  if (!plainObject(payload) || !plainObject(payload.rate_limits)) return emptySnapshot('NO_RATE_LIMIT_WINDOWS', now);
  const windows = {
    fiveHour: normalizeWindow(payload.rate_limits.five_hour),
    sevenDay: normalizeWindow(payload.rate_limits.seven_day),
  };
  if (windows.fiveHour === null && windows.sevenDay === null) return emptySnapshot('NO_RATE_LIMIT_WINDOWS', now);
  return {
    schema: SCHEMA,
    status: 'available',
    windows,
    observedAt: now.toISOString(),
    reason: 'OBSERVED',
  };
}

// A status line rendered before the first reply of a session has no rate-limit
// windows. It must not erase an earlier observation whose windows are still open.
export function keepsExisting(existing, snapshot, now = new Date()) {
  if (snapshot.status === 'available' || existing === null || typeof existing !== 'object') return false;
  if (existing.status !== 'available' || !existing.windows || typeof existing.windows !== 'object') return false;
  const seconds = now.getTime() / 1000;
  return ['fiveHour', 'sevenDay'].some(key => {
    const window = existing.windows[key];
    return window && typeof window.resetsAt === 'number' && window.resetsAt > seconds;
  });
}

function writeSnapshot(stateDir, accountId, snapshot) {
  const usageDir = privateDirectory(path.join(stateDir, 'usage'), { create: true });
  const file = path.join(usageDir, `${accountId}.json`);
  let existing = null;
  try { existing = readJSON(file); } catch { existing = null; }
  if (keepsExisting(existing, snapshot)) return existing;
  atomicWriteJSON(file, snapshot);
  return snapshot;
}

export async function readStatusLineInput(stream = process.stdin, {
  timeoutMs = STDIN_TIMEOUT_MS,
  maxBytes = LIMITS.inputBytes,
} = {}) {
  const chunks = [];
  let size = 0;
  let timedOut = false;
  let failed = null;
  const timer = setTimeout(() => {
    timedOut = true;
    stream.destroy(new Error('status line input deadline'));
  }, timeoutMs);
  try {
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > maxBytes) {
        failed = 'INPUT_LIMIT';
        break;
      }
      chunks.push(chunk);
    }
  } catch {
    failed = timedOut ? 'INPUT_TIMEOUT' : 'INPUT_UNREADABLE';
  } finally {
    clearTimeout(timer);
  }
  if (failed) return { ok: false, reason: failed };
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    const payload = JSON.parse(text);
    if (!plainObject(payload)) return { ok: false, reason: 'INVALID_PAYLOAD' };
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: 'INVALID_PAYLOAD' };
  }
}

function statusLineText(snapshot) {
  if (snapshot.status !== 'available') return 'CCAC usage unknown';
  const parts = [];
  for (const [key, label] of [['fiveHour', '5h'], ['sevenDay', '7d']]) {
    const window = snapshot.windows[key];
    if (window && Number.isFinite(window.usedPercentage)) parts.push(`${label} ${window.usedPercentage.toFixed(1)}% used`);
  }
  return parts.length ? `CCAC ${parts.join(' · ')}` : 'CCAC usage unknown';
}

async function main() {
  if (process.argv.length !== 4) {
    process.stdout.write('CCAC usage unknown\n');
    process.stderr.write('usage-statusline: expected account id and state directory\n');
    process.exitCode = 2;
    return;
  }
  const accountId = process.argv[2];
  const stateDir = process.argv[3];
  try {
    uuid(accountId);
    absolutePath(stateDir);
    privateDirectory(stateDir);
  } catch {
    process.stdout.write('CCAC usage unknown\n');
    process.stderr.write('usage-statusline: invalid account id or state directory\n');
    process.exitCode = 2;
    return;
  }

  const input = await readStatusLineInput();
  const snapshot = input.ok ? snapshotFromPayload(input.payload) : emptySnapshot(input.reason, new Date());
  let shown = snapshot;
  try {
    shown = writeSnapshot(stateDir, accountId, snapshot);
  } catch {
    process.stdout.write('CCAC usage unknown\n');
    process.stderr.write('usage-statusline: snapshot could not be saved\n');
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${statusLineText(shown)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) await main();

export const __testables = { normalizeWindow, statusLineText, keepsExisting };
