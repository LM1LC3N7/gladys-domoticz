import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseDomoticzUrl } from '../src/config.js';

test('the base address from what the user typed', () => {
  const url = (raw) => parseDomoticzUrl(raw).url;
  assert.equal(url('192.168.1.20:8080'), 'http://192.168.1.20:8080');
  assert.equal(url(' https://domoticz.lan/ '), 'https://domoticz.lan');
  assert.equal(url('http://box/domoticz/'), 'http://box/domoticz');
  assert.equal(url('http://box:8080/index.html#/Dashboard'), 'http://box:8080');
  assert.equal(url('http://box:8080/json.htm?type=command'), 'http://box:8080');
  assert.equal(parseDomoticzUrl('http://box:8080').origin, 'http://box:8080');
});

test('the addresses refused', () => {
  assert.deepEqual(parseDomoticzUrl(''), { error: 'empty' });
  assert.deepEqual(parseDomoticzUrl(undefined), { error: 'empty' });
  assert.deepEqual(parseDomoticzUrl('ftp://box'), { error: 'invalid' });
  assert.deepEqual(parseDomoticzUrl('http://'), { error: 'invalid' });
  assert.deepEqual(parseDomoticzUrl('http://admin:pw@box:8080'), { error: 'credentials' });
});

test('the configuration, normalized: token first, then user, else nothing', () => {
  assert.deepEqual(normalizeConfig(), {
    url: undefined,
    origin: undefined,
    error: 'empty',
    auth: { kind: 'none' },
    verifyCertificate: true,
    pollInterval: 3,
    sensorInterval: 10,
  });
  const c = normalizeConfig({
    domoticz_url: 'domoticz.lan:8080',
    access_token: ' tok ',
    username: 'gladys',
    password: 'pw',
    verify_certificate: false,
    poll_interval: 0,
    sensor_interval: 1000,
  });
  assert.deepEqual(
    [c.url, c.error, c.auth, c.verifyCertificate, c.pollInterval, c.sensorInterval],
    ['http://domoticz.lan:8080', undefined, { kind: 'token', token: 'tok' }, false, 1, 300],
  );
  assert.deepEqual(
    normalizeConfig({ domoticz_url: 'dz', username: ' gladys ', password: ' p w ' }).auth,
    { kind: 'password', username: 'gladys', password: ' p w ' },
    'a password is kept as typed',
  );
  assert.equal(normalizeConfig({ domoticz_url: 'dz', username: 'gladys' }).error, 'no-password');
  assert.deepEqual(normalizeConfig({ domoticz_url: 'dz' }).auth, { kind: 'none' });
  assert.equal(normalizeConfig({ domoticz_url: 'dz', poll_interval: 'x' }).pollInterval, 3);
});
