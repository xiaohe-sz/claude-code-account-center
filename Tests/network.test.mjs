import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { checkNetwork, STATUS, __testables } from '../Resources/core/network.mjs';
import { repository } from './helpers.mjs';

const fixedNow = () => new Date('2026-01-01T00:00:00.000Z');
const outcome = (code, stdout = '', stderr = '') => ({ code, stdout, stderr, timedOut: false, capped: false });

function healthyRunner(calls) {
  return {
    async run(command, args, options) {
      calls.push({ command, args, options });
      if (command === 'route') return outcome(0, 'gateway: 2001:db8::1');
      if (command === 'ifconfig') return outcome(0, 'en0:\n\tinet6 fe80::1%en0\n\tinet6 2001:db8::2');
      if (command === 'dig') return outcome(0, '"192.0.2.53"\n');
      throw new Error('unexpected command');
    },
  };
}

test('network report exposes four top-level layers and never marks browser WebRTC as pass', async () => {
  const calls = [];
  const report = await checkNetwork({
    fetchImpl: async () => new Response(JSON.stringify({ ip: '203.0.113.10' }), { status: 200 }),
    runner: healthyRunner(calls), platform: 'darwin', now: fixedNow,
  });
  assert.equal(report.observedAt, fixedNow().toISOString());
  assert.equal(report.egress.status, STATUS.PASS);
  assert.deepEqual(report.egress.observed, { ip: '203.0.113.10' });
  assert.equal(report.routeIpv6.status, STATUS.PASS);
  assert.equal(report.dns.status, STATUS.PASS);
  assert.deepEqual(report.browserWebRTC.status, STATUS.UNVERIFIED);
  assert.equal(report.browserWebRTC.reason, 'REQUIRES_BROWSER_TEST');
  assert.deepEqual(report.summary, { pass: 3, issue: 0, unverified: 1 });
  assert.equal(Object.hasOwn(report, 'checks'), false);
  assert.deepEqual(calls.map(call => call.command).sort(), ['dig', 'ifconfig', 'route']);
  for (const call of calls) {
    assert.equal(Array.isArray(call.args), true);
    assert.equal(call.options.timeoutMs > 0, true);
    assert.equal(call.options.maxOutputBytes > 0, true);
  }
});

test('a global IPv6 address without a default route is an issue, not a pass', async () => {
  const runner = {
    async run(command) {
      if (command === 'route') return outcome(1, '', 'route: not in table');
      if (command === 'ifconfig') return outcome(0, '\tinet6 2001:db8::2');
      return outcome(1);
    },
  };
  const report = await checkNetwork({
    fetchImpl: async () => { throw new Error('offline'); }, runner, platform: 'darwin', now: fixedNow,
  });
  assert.equal(report.routeIpv6.status, STATUS.ISSUE);
  assert.equal(report.routeIpv6.reason, 'IPV6_GLOBAL_ADDRESS_WITHOUT_DEFAULT_ROUTE');
  assert.equal(report.egress.status, STATUS.UNVERIFIED);
  assert.equal(report.dns.status, STATUS.UNVERIFIED);
  assert.deepEqual(report.summary, { pass: 0, issue: 1, unverified: 3 });
});

test('loopback-only IPv6 without a default route is not a global address', async () => {
  const runner = {
    async run(command) {
      if (command === 'route') return outcome(1, '', 'route: not in table');
      if (command === 'ifconfig') return outcome(0, '\tinet6 ::1');
      return outcome(1);
    },
  };
  const report = await checkNetwork({
    fetchImpl: async () => { throw new Error('offline'); }, runner, platform: 'darwin', now: fixedNow,
  });
  assert.equal(report.routeIpv6.status, STATUS.PASS);
  assert.equal(report.routeIpv6.reason, 'IPV6_STACK_NOT_IN_USE');
  assert.deepEqual(report.routeIpv6.observed, { hasDefaultRoute: false, hasGlobalAddress: false });
});

test('loopback-only IPv6 with a default route is not a global address', async () => {
  const runner = {
    async run(command) {
      if (command === 'route') return outcome(0, 'gateway: 2001:db8::1');
      if (command === 'ifconfig') return outcome(0, '\tinet6 ::1');
      return outcome(1);
    },
  };
  const report = await checkNetwork({
    fetchImpl: async () => { throw new Error('offline'); }, runner, platform: 'darwin', now: fixedNow,
  });
  assert.equal(report.routeIpv6.status, STATUS.PASS);
  assert.equal(report.routeIpv6.reason, 'IPV6_DEFAULT_ROUTE_NO_GLOBAL_ADDRESS');
  assert.deepEqual(report.routeIpv6.observed, { hasDefaultRoute: true, hasGlobalAddress: false });
});

test('IPv6 collection excludes unspecified, multicast, link-local and ULA fixture addresses', () => {
  const addresses = [
    '::', '0:0:0:0:0:0:0:0', '::1', '0:0:0:0:0:0:0:1', 'ff02::1',
    'fe80::1', 'fe90::1', 'fc00::1', 'fd00::1', '2001:db8::2',
  ].map(address => `\tinet6 ${address}`).join('\n');
  assert.deepEqual(__testables.collectGlobalInet6(addresses), ['2001:db8::2']);
});

test('failed and unfinished checks stay unverified', async () => {
  const report = await checkNetwork({
    fetchImpl: async () => { throw new Error('offline'); },
    runner: { async run() { throw new Error('missing tool'); } },
    platform: 'darwin', now: fixedNow,
  });
  for (const layer of [report.egress, report.routeIpv6, report.dns, report.browserWebRTC]) {
    assert.equal(layer.status, STATUS.UNVERIFIED);
  }
  assert.deepEqual(report.summary, { pass: 0, issue: 0, unverified: 4 });
  const nonMac = await checkNetwork({
    fetchImpl: async () => new Response('{}', { status: 200 }),
    runner: { async run() { return outcome(1); } }, platform: 'linux', now: fixedNow,
  });
  assert.equal(nonMac.routeIpv6.reason, 'ROUTE_NOT_SUPPORTED_ON_PLATFORM');
  assert.equal(nonMac.routeIpv6.status, STATUS.UNVERIFIED);
});

test('egress responses have HTTP, size and JSON validation', async () => {
  assert.equal((await __testables.performEgress({
    fetchImpl: async () => new Response('{}', { status: 503 }),
  })).reason, 'EGRESS_HTTP_ERROR');
  assert.equal((await __testables.performEgress({
    fetchImpl: async () => new Response('x'.repeat(1_025), { status: 200 }),
  })).reason, 'EGRESS_RESPONSE_TOO_LARGE');
  assert.equal((await __testables.performEgress({
    fetchImpl: async () => new Response('not-json', { status: 200 }),
  })).reason, 'EGRESS_RESPONSE_UNRECOGNIZED');
});

test('deadlines and byte collectors fail closed at their boundaries', async () => {
  const fallback = { status: 'unverified', reason: 'TEST_TIMEOUT' };
  const value = await __testables.withDeadline(new Promise(() => {}), 5, fallback);
  assert.equal(value, fallback);
  const exact = __testables.makeByteCollector(4);
  exact.push(Buffer.from('1234'));
  assert.equal(exact.capped(), false);
  const overflow = __testables.makeByteCollector(4);
  overflow.push(Buffer.from('12345'));
  assert.equal(overflow.capped(), true);
  assert.equal(overflow.value().toString(), '1234');
});

test('WebRTC page is click-only, bilingual, bounded and free of storage or telemetry', () => {
  const html = fs.readFileSync(`${repository}Resources/network/webrtc.html`, 'utf8');
  assert.match(html, /button\.addEventListener\('click', runOnce\)/);
  assert.match(html, /setTimeout\(/);
  assert.match(html, /12_?000|12000/);
  assert.match(html, /pass means finished, not leak-free/);
  assert.match(html, /unverified/);
  assert.match(html, /STUN/);
  assert.match(html, /中文|本机页面/);
  assert.equal(html.includes('fetch('), false);
  assert.equal(html.includes('localStorage'), false);
  assert.equal(html.includes('sessionStorage'), false);
  assert.equal(html.includes('setInterval'), false);
  assert.equal(html.includes('runOnce();'), false);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const syntax = spawnSync(process.execPath, ['--check'], { input: script, encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
});
