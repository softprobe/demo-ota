import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardBrowserRequest, checkInternalToken } from '../src/security.mjs';

test('browser writes reject cross-origin, DNS-rebound, non-JSON and missing-Origin requests', () => {
  const req = { method: 'POST', headers: { host: '127.0.0.1:4310', origin: 'http://127.0.0.1:4310', 'content-type': 'application/json' } };
  assert.doesNotThrow(() => guardBrowserRequest(req, 4310));
  for (const headers of [{ ...req.headers, origin: 'https://evil.example' }, { ...req.headers, host: 'evil.example:4310' }, { ...req.headers, origin: undefined }, { ...req.headers, 'content-type': 'text/plain' }]) {
    assert.throws(() => guardBrowserRequest({ ...req, headers }, 4310));
  }
  assert.doesNotThrow(() => guardBrowserRequest({ method: 'GET', headers: { host: '127.0.0.1:4310' } }, 4310));
});

test('internal travel tool endpoints require their separate process capability', () => {
  assert.equal(checkInternalToken('Bearer test-capability', 'test-capability'), true);
  assert.equal(checkInternalToken('Bearer wrong', 'test-capability'), false);
  assert.equal(checkInternalToken(undefined, 'test-capability'), false);
});
