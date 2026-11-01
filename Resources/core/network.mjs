import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';

export const STATUS = {
  PASS: 'pass',
  ISSUE: 'issue',
  UNVERIFIED: 'unverified',
};

const EGRESS_URL = 'https://api.ipify.org/?format=json';
const EGRESS_TIMEOUT_MS = 8_000;
const ROUTE_DEADLINE_MS = 11_000;
const DNS_DEADLINE_MS = 6_000;
const MAX_EGRESS_BODY_BYTES = 1_024;
const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;
const MAX_NETWORK_OUTPUT_BYTES = 1 << 18;
const DNS_COMMAND_ARGS = ['+short', 'CH', 'TXT', 'whoami.cloudflare', '@1.1.1.1'];

function result(status, reason, observed) {
  const entry = { status, reason };
  if (observed !== undefined) entry.observed = observed;
  return entry;
}

export function webrtcPagePath() {
  return fileURLToPath(new URL('../network/webrtc.html', import.meta.url));
}

function makeByteCollector(maxBytes) {
  const chunks = [];
  let total = 0;
  let overflow = false;
  return {
    push(chunk) {
      const source = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      if (total + source.length > maxBytes) overflow = true;
      const remaining = Math.max(0, maxBytes - total);
      const slice = source.length > remaining ? source.subarray(0, remaining) : source;
      total += slice.length;
      if (slice.length) chunks.push(slice);
    },
    value() {
      return Buffer.concat(chunks);
    },
    capped() {
      return overflow;
    },
  };
}

export class ObservableCLIProcessRunner {
  run(command, args, { timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, maxOutputBytes = MAX_NETWORK_OUTPUT_BYTES } = {}) {
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(command, args, {
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (error) {
        reject(error);
        return;
      }
      const stdout = makeByteCollector(maxOutputBytes);
      const stderr = makeByteCollector(maxOutputBytes);
      let timedOut = false;
      let settled = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      child.on('error', error => finish(reject, error));
      child.stdout?.on('data', stdout.push.bind(stdout));
      child.stderr?.on('data', stderr.push.bind(stderr));
      child.on('close', code => finish(resolve, {
        code,
        stdout: stdout.value(),
        stderr: stderr.value(),
        timedOut,
        capped: stdout.capped() || stderr.capped(),
      }));
    });
  }
}

function decodeOutput(value) {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return typeof value === 'string' ? value : String(value ?? '');
}

async function readEgressBody(response) {
  if (response.body && typeof response.body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_EGRESS_BODY_BYTES) return null;
      chunks.push(buffer);
    }
    return Buffer.concat(chunks);
  }
  const text = await response.text();
  return Buffer.byteLength(text, 'utf8') > MAX_EGRESS_BODY_BYTES ? null : Buffer.from(text, 'utf8');
}

async function performEgress({ fetchImpl }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EGRESS_TIMEOUT_MS);
  try {
    const response = await fetchImpl(EGRESS_URL, { signal: controller.signal });
    if (!response || response.ok !== true) return result(STATUS.UNVERIFIED, 'EGRESS_HTTP_ERROR');
    const body = await readEgressBody(response);
    if (body === null) return result(STATUS.UNVERIFIED, 'EGRESS_RESPONSE_TOO_LARGE');
    let parsed;
    try {
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    } catch {
      return result(STATUS.UNVERIFIED, 'EGRESS_RESPONSE_UNRECOGNIZED');
    }
    const ip = parsed && typeof parsed.ip === 'string' ? parsed.ip : null;
    if (ip && isIP(ip) !== 0) return result(STATUS.PASS, 'EGRESS_OK', { ip });
    return result(STATUS.UNVERIFIED, 'EGRESS_RESPONSE_UNRECOGNIZED');
  } catch {
    return result(STATUS.UNVERIFIED, 'EGRESS_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }
}

function collectGlobalInet6(text) {
  const found = [];
  const pattern = /^\s*inet6\s+(\S+)/gm;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const base = match[1].split('%')[0];
    if (isIP(base) !== 6) continue;
    const normalized = new URL(`http://[${base}]/`).hostname.slice(1, -1);
    const excluded = normalized === '::'
      || normalized === '::1'
      || /^ff/i.test(normalized)
      || /^fe[89ab]/i.test(normalized)
      || /^f[cd]/i.test(normalized);
    if (!excluded) found.push(base);
  }
  return found;
}

function summarizeIpv6({ hasDefaultRoute, globalAddresses }) {
  const hasGlobalAddress = globalAddresses.length > 0;
  if (hasDefaultRoute && hasGlobalAddress) {
    return result(STATUS.PASS, 'IPV6_STACK_HEALTHY', { hasDefaultRoute, hasGlobalAddress });
  }
  if (hasDefaultRoute) {
    return result(STATUS.PASS, 'IPV6_DEFAULT_ROUTE_NO_GLOBAL_ADDRESS', { hasDefaultRoute, hasGlobalAddress });
  }
  if (hasGlobalAddress) {
    return result(STATUS.ISSUE, 'IPV6_GLOBAL_ADDRESS_WITHOUT_DEFAULT_ROUTE', { hasDefaultRoute, hasGlobalAddress });
  }
  return result(STATUS.PASS, 'IPV6_STACK_NOT_IN_USE', { hasDefaultRoute, hasGlobalAddress });
}

async function runCommand(runner, command, args) {
  const outcome = await runner.run(command, args, {
    timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
    maxOutputBytes: MAX_NETWORK_OUTPUT_BYTES,
  });
  if (!outcome || typeof outcome !== 'object') throw new Error('command result unavailable');
  return outcome;
}

async function performRouteIpv6({ runner, platform }) {
  if (platform !== 'darwin') return result(STATUS.UNVERIFIED, 'ROUTE_NOT_SUPPORTED_ON_PLATFORM');
  let routeOutcome;
  try {
    routeOutcome = await runCommand(runner, 'route', ['-n', 'get', '-inet6', 'default']);
  } catch {
    return result(STATUS.UNVERIFIED, 'ROUTE_UNAVAILABLE');
  }
  if (routeOutcome.timedOut) return result(STATUS.UNVERIFIED, 'ROUTE_TIMEOUT');
  if (routeOutcome.capped) return result(STATUS.UNVERIFIED, 'ROUTE_OUTPUT_LIMIT_EXCEEDED');
  const routeText = `${decodeOutput(routeOutcome.stderr)}\n${decodeOutput(routeOutcome.stdout)}`;
  const noRoute = /not\s+in\s+table|no\s+route|not\s+found/i.test(routeText);
  if (routeOutcome.code !== 0 && !noRoute) return result(STATUS.UNVERIFIED, 'ROUTE_UNPARSED');

  let ifOutcome;
  try {
    ifOutcome = await runCommand(runner, 'ifconfig', []);
  } catch {
    return result(STATUS.UNVERIFIED, 'ROUTE_UNAVAILABLE');
  }
  if (ifOutcome.timedOut) return result(STATUS.UNVERIFIED, 'ROUTE_TIMEOUT');
  if (ifOutcome.capped) return result(STATUS.UNVERIFIED, 'ROUTE_OUTPUT_LIMIT_EXCEEDED');
  if (ifOutcome.code !== 0) return result(STATUS.UNVERIFIED, 'ROUTE_UNAVAILABLE');
  return summarizeIpv6({
    hasDefaultRoute: routeOutcome.code === 0,
    globalAddresses: collectGlobalInet6(decodeOutput(ifOutcome.stdout)),
  });
}

async function performDns({ runner }) {
  let outcome;
  try {
    outcome = await runCommand(runner, 'dig', DNS_COMMAND_ARGS);
  } catch {
    return result(STATUS.UNVERIFIED, 'DNS_TOOL_UNAVAILABLE');
  }
  if (outcome.timedOut) return result(STATUS.UNVERIFIED, 'DNS_TIMEOUT');
  if (outcome.capped) return result(STATUS.UNVERIFIED, 'DNS_OUTPUT_LIMIT_EXCEEDED');
  if (outcome.code !== 0) return result(STATUS.UNVERIFIED, 'DNS_UNAVAILABLE');
  const text = decodeOutput(outcome.stdout);
  const pattern = /"([^"]+)"|^\s*(\S+)/gm;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const candidate = match[1] ?? match[2];
    if (isIP(candidate) !== 0) return result(STATUS.PASS, 'DNS_RESPONSE_OK', { resolverIp: candidate });
  }
  return result(STATUS.UNVERIFIED, 'DNS_RESPONSE_UNRECOGNIZED');
}

async function withDeadline(promise, timeoutMs, fallback) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise(resolve => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function checkNetwork(options = {}) {
  const {
    fetchImpl = defaultNetworkFetch,
    runner = defaultRunner,
    platform = process.platform,
    now = () => new Date(),
  } = options;
  const observedAt = now().toISOString();
  const [egress, routeIpv6, dns] = await Promise.all([
    withDeadline(performEgress({ fetchImpl }), EGRESS_TIMEOUT_MS + 500,
      result(STATUS.UNVERIFIED, 'EGRESS_TIMEOUT')),
    withDeadline(performRouteIpv6({ runner, platform }), ROUTE_DEADLINE_MS,
      result(STATUS.UNVERIFIED, 'ROUTE_TIMEOUT')),
    withDeadline(performDns({ runner }), DNS_DEADLINE_MS,
      result(STATUS.UNVERIFIED, 'DNS_TIMEOUT')),
  ]);
  const browserWebRTC = result(STATUS.UNVERIFIED, 'REQUIRES_BROWSER_TEST', { pagePath: webrtcPagePath() });
  const summary = { pass: 0, issue: 0, unverified: 0 };
  for (const check of [egress, routeIpv6, dns, browserWebRTC]) summary[check.status] += 1;
  return { observedAt, platform, egress, routeIpv6, dns, browserWebRTC, summary };
}

const defaultRunner = new ObservableCLIProcessRunner();

async function defaultNetworkFetch(url, init) {
  return fetch(url, init);
}

export const __testables = { collectGlobalInet6, makeByteCollector, performEgress, withDeadline };
