// -----------------------------------------------------------------------------
// The client of the Domoticz JSON API: the answers, the errors, the three
// ways of signing in. Requests go to a scripted `get`, or to a loopback HTTP
// server for the transport itself (127.0.0.1 only, never the network).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import {
  DomoticzError,
  createClient,
  httpGet,
  networkError,
  parseAnswer,
  queryOf,
  sessionCookie,
} from '../src/domoticz.js';

const ok = (json) => ({
  status: 200,
  cookies: [],
  body: JSON.stringify({ status: 'OK', ...json }),
});

/** A scripted `get`: answers in order, every request recorded. */
function script(...answers) {
  const requests = [];
  const get = async (url, options) => {
    requests.push({ url, headers: options.headers });
    const next = answers.shift();
    if (!next) {
      throw new Error(`unexpected request ${url}`);
    }
    return typeof next === 'function' ? next(url, options) : next;
  };
  return { get, requests };
}

test('queryOf encodes every value, spaces as %20', () => {
  assert.equal(
    queryOf('switchlight', { idx: 2, switchcmd: 'Set Level', level: 40, skip: undefined }),
    'type=command&param=switchlight&idx=2&switchcmd=Set%20Level&level=40',
  );
});

test('parseAnswer: OK answers, refusals and the errors of the transport', () => {
  assert.deepEqual(parseAnswer(ok({ title: 'x' })), { status: 'OK', title: 'x' });
  const kindOf = (answer) => {
    try {
      parseAnswer(answer);
    } catch (err) {
      assert.ok(err instanceof DomoticzError);
      return [err.kind, err.message];
    }
    return undefined;
  };
  assert.deepEqual(kindOf({ status: 200, body: '{"status":"ERR","title":"SwitchLight"}' }), [
    'api',
    'SwitchLight refused',
  ]);
  assert.deepEqual(kindOf({ status: 200, body: '{"status":"ERROR","message":"WRONG CODE"}' }), [
    'api',
    'WRONG CODE',
  ]);
  assert.deepEqual(kindOf({ status: 401, body: '<html>Unauthorized</html>' }), [
    'auth',
    'not signed in (HTTP 401)',
  ]);
  assert.equal(kindOf({ status: 403, body: '' })[0], 'forbidden');
  assert.deepEqual(kindOf({ status: 302, location: 'https://dz.lan:443/login?x=1' }), [
    'redirect',
    'redirected to https://dz.lan',
  ]);
  assert.equal(kindOf({ status: 200, body: '<html></html>' })[0], 'format');
  assert.equal(kindOf({ status: 200, body: '{"result":[]}' })[0], 'format');
  assert.deepEqual(kindOf({ status: 404, body: 'Not found' }), ['http', 'HTTP 404']);
});

test('networkError names the socket errors, certificates apart', () => {
  assert.deepEqual(
    [networkError({ code: 'ECONNREFUSED' }).kind, networkError({ code: 'ECONNREFUSED' }).message],
    ['network', 'connection refused'],
  );
  assert.equal(networkError({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }).kind, 'certificate');
});

test('an access token travels as a Bearer header', async () => {
  const { get, requests } = script(ok({ version: '2026.4' }));
  const client = createClient({
    url: 'http://dz.lan:8080',
    auth: { kind: 'token', token: 'abc.def.ghi' },
    verifyCertificate: true,
    get,
  });
  assert.equal((await client.call('getversion')).version, '2026.4');
  assert.equal(requests[0].url, 'http://dz.lan:8080/json.htm?type=command&param=getversion');
  assert.equal(requests[0].headers.Authorization, 'Bearer abc.def.ghi');
  assert.equal(client.mode, 'token');
  client.close();
});

test('a password: Basic first, a session when Domoticz refuses Basic over http', async () => {
  const login = (url) => {
    const params = new URL(url).searchParams;
    assert.equal(params.get('param'), 'logincheck');
    assert.equal(Buffer.from(params.get('username'), 'base64').toString(), 'gladys');
    assert.equal(params.get('password'), createHash('md5').update('s3cret').digest('hex'));
    return {
      status: 200,
      cookies: ['DMZSID=abc123_xyz.1792; HttpOnly; SameSite=strict'],
      body: JSON.stringify({ status: 'OK', title: 'logincheck', rights: 2 }),
    };
  };
  const unauthorized = { status: 401, cookies: [], body: '<html>Unauthorized</html>' };
  const { get, requests } = script(
    unauthorized,
    login,
    ok({ result: [] }),
    ok({ title: 'SwitchLight' }),
    unauthorized, // the session expired
    login,
    ok({ title: 'SwitchLight' }),
  );
  const client = createClient({
    url: 'http://dz.lan:8080',
    auth: { kind: 'password', username: 'gladys', password: 's3cret' },
    verifyCertificate: true,
    get,
  });
  assert.equal(client.mode, 'basic');
  await client.call('getdevices');
  assert.match(requests[0].headers.Authorization, /^Basic /);
  assert.equal(
    Buffer.from(requests[0].headers.Authorization.slice(6), 'base64').toString(),
    'gladys:s3cret',
  );
  assert.equal(client.mode, 'session');
  assert.equal(requests[2].headers.Cookie, 'DMZSID=abc123_xyz.1792');
  assert.equal(requests[2].headers.Authorization, undefined, 'no Basic header in a session');
  await client.call('switchlight', { idx: 1, switchcmd: 'On' });
  await client.call('switchlight', { idx: 1, switchcmd: 'Off' });
  assert.equal(requests.length, 7, 'signed in again once, the call replayed');
});

test('getversion without the version (Basic not honoured) also opens a session', async () => {
  const anonymous = ok({ title: 'GetVersion' });
  const { get, requests } = script(
    anonymous,
    {
      status: 200,
      cookies: ['DMZSID=s2; HttpOnly'],
      body: JSON.stringify({ status: 'OK', title: 'logincheck' }),
    },
    ok({ title: 'GetVersion', version: '2026.4' }),
  );
  const client = createClient({
    url: 'http://dz.lan:8080',
    auth: { kind: 'password', username: 'gladys', password: 's3cret' },
    verifyCertificate: true,
    get,
  });
  assert.equal((await client.call('getversion')).version, '2026.4');
  assert.equal(client.mode, 'session');
  assert.equal(requests[2].headers.Cookie, 'DMZSID=s2');
});

test('a refused password, a two-factor user', async () => {
  const unauthorized = { status: 401, cookies: [], body: '' };
  const refused = script(unauthorized, unauthorized);
  const client = createClient({
    url: 'http://dz.lan:8080',
    auth: { kind: 'password', username: 'gladys', password: 'wrong' },
    verifyCertificate: true,
    get: refused.get,
  });
  await assert.rejects(client.call('getversion'), { kind: 'auth' });

  const twoFactor = script(unauthorized, ok({ title: 'logincheck', require2fa: 'true' }));
  const client2 = createClient({
    url: 'http://dz.lan:8080',
    auth: { kind: 'password', username: 'gladys', password: 's3cret' },
    verifyCertificate: true,
    get: twoFactor.get,
  });
  await assert.rejects(client2.call('getversion'), { kind: 'twofactor' });
});

test('no credentials: a 401 is reported as is (not a trusted network)', async () => {
  const { get } = script({ status: 401, cookies: [], body: '' });
  const client = createClient({
    url: 'http://dz.lan:8080',
    auth: { kind: 'none' },
    verifyCertificate: true,
    get,
  });
  await assert.rejects(client.call('getdevices'), { kind: 'auth' });
});

test('sessionCookie keeps name=value, ignores the "none" reset cookie', () => {
  assert.equal(sessionCookie(['DMZSID=none; Expires=Thu, 01 Jan 1970']), undefined);
  assert.equal(sessionCookie(['DMZSID=a_b.c; HttpOnly']), 'DMZSID=a_b.c');
  assert.equal(sessionCookie(undefined), undefined);
});

test('httpGet: a real request on the loopback, the size limit and the timeout', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/big')) {
      res.end('x'.repeat(4096));
    } else if (req.url.startsWith('/slow')) {
      setTimeout(() => res.end('{}'), 500);
    } else {
      res.setHeader('Set-Cookie', 'DMZSID=s1; HttpOnly');
      res.end(JSON.stringify({ status: 'OK', accept: req.headers.accept }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const answer = await httpGet(`${base}/json.htm`, { timeout: 2000, verifyCertificate: true });
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.cookies, ['DMZSID=s1; HttpOnly']);
  assert.equal(JSON.parse(answer.body).accept, 'application/json');
  await assert.rejects(
    httpGet(`${base}/big`, { timeout: 2000, verifyCertificate: true, maxBytes: 1024 }),
    { kind: 'size' },
  );
  await assert.rejects(httpGet(`${base}/slow`, { timeout: 100, verifyCertificate: true }), {
    kind: 'timeout',
  });
});
