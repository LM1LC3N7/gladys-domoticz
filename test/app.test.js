// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys, and a fake Domoticz serving the answers of a real one. Timers are
// mocked: the change loop, the reconnections and the state flush run when the
// test ticks.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DomoticzApp } from '../src/app.js';
import { ACTIONS, TIMINGS } from '../src/constants.js';
import { DomoticzError } from '../src/domoticz.js';
import { registerHandlers } from '../src/handlers.js';
import { T } from '../src/i18n.js';
import { TOKEN, USER, fakeDomoticz, settle } from './helpers/fakeDomoticz.js';

const DEVICE = (idx) => `ext:test-integration:domoticz:${idx}`;
const POLL = 3000;
const CONFIG = { domoticz_url: '192.168.1.20:8080', access_token: TOKEN };

async function setup(t, config = CONFIG, prepare = () => {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_792_092_000_000 });
  const gladys = createFakeGladys({ config });
  const box = fakeDomoticz();
  prepare(box);
  const app = new DomoticzApp({
    gladys,
    connect: box.connect,
    now: () => Date.now(),
    logger: createLogger({ level: 'silent' }),
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const tick = async (ms) => {
    t.mock.timers.tick(ms);
    await settle();
  };
  return { gladys, app, box, tick };
}

const deviceNamed = (gladys, name) => gladys.fake.discoveredDevices.find((d) => d.name === name);

async function created(gladys, name) {
  const device = deviceNamed(gladys, name);
  assert.ok(device, `${name} is discovered`);
  await gladys.fake.deviceCreated(device);
  return device;
}

const featureOf = (device, key) => {
  const feature = device.features.find((f) => f.external_id === `${device.external_id}:${key}`);
  assert.ok(feature, `${device.name} has ${key}`);
  return feature;
};

const statesOf = (gladys, featureId) =>
  gladys.fake.states.filter((s) => s.device_feature_external_id === featureId);

test('the devices of Domoticz become Gladys devices, the values flow once created', async (t) => {
  const { gladys, box, tick } = await setup(t);
  assert.equal(box.clients[0].config.url, 'http://192.168.1.20:8080');
  assert.deepEqual(box.clients[0].config.auth, { kind: 'token', token: TOKEN });
  assert.equal(gladys.fake.discoveredDevices.length, 55);
  assert.ok(deviceNamed(gladys, 'Lampe salon (Salon)'));
  assert.ok(deviceNamed(gladys, 'Prise TV (Bureau)'));
  assert.ok(!deviceNamed(gladys, 'Kodi'), 'nothing to offer: left out');
  assert.ok(!gladys.fake.discoveredDevices.some((d) => d.name.startsWith('Tout éteindre')));
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.connectionStatus.message.en, T.connected('2026.4', 55).en);

  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.states.length, 0, 'nothing is sent for a device not created');

  await created(gladys, 'Lampe salon (Salon)');
  await created(gladys, 'Température (Salon)');
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${DEVICE(1)}:binary`), 0);
  assert.equal(gladys.fake.lastState(`${DEVICE(16)}:temperature`), 22.75);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: DEVICE(16),
    transport: DEVICE_TRANSPORTS.LOCAL,
  });
});

test('the changes reach Gladys at the poll interval, from the last answer on', async (t) => {
  const { gladys, box, tick } = await setup(t);
  await created(gladys, 'Lampe salon (Salon)');
  await created(gladys, 'Porte entrée');
  const actTime = box.clock;
  box.emit(1, { Status: 'On', Data: 'On' });
  box.emit(7, { Status: 'Closed', Data: 'Closed' });
  await tick(POLL);
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${DEVICE(1)}:binary`), 1);
  assert.equal(gladys.fake.lastState(`${DEVICE(7)}:opening`), 1, 'closed door');
  const [poll] = box.callsOf('getdevices').slice(-1);
  assert.equal(poll.params.lastupdate, actTime, 'the cursor is the ActTime of the inventory');

  await tick(POLL);
  assert.equal(box.callsOf('getdevices').at(-1).params.lastupdate, box.clock);
  assert.equal(box.callsOf('getplans').length, 1, 'no inventory read for value changes');
});

test('every press of a push button is an event, none at the connection', async (t) => {
  const { gladys, box, tick } = await setup(t);
  const button = await created(gladys, 'Bouton');
  await tick(POLL);
  await tick(TIMINGS.flushInterval);
  assert.equal(statesOf(gladys, `${button.external_id}:button`).length, 0);

  box.emit(11, { Data: 'On' });
  await tick(POLL);
  box.emit(11, { Data: 'On' });
  await tick(POLL);
  await tick(POLL); // the same record again (the cursor second): not a new press
  await tick(TIMINGS.flushInterval);
  const presses = statesOf(gladys, `${button.external_id}:button`);
  assert.equal(presses.length, 2);
  assert.deepEqual(
    presses.map((s) => s.state),
    [1, 1],
  );
});

test('the Gladys commands run the Domoticz API, the new state is read soon after', async (t) => {
  const { gladys, box, tick } = await setup(t);
  const run = async (name, key, value) => {
    const device = deviceNamed(gladys, name);
    const before = box.executed.length;
    const ack = await gladys.fake.setValue(device, featureOf(device, key), value);
    assert.equal(ack.success, true, `${name} ${key}=${value}: ${ack.error}`);
    return box.executed.slice(before);
  };
  const lamp = await created(gladys, 'Lampe salon (Salon)');
  assert.deepEqual(await run('Lampe salon (Salon)', 'binary', 1), [
    { param: 'switchlight', params: { idx: '1', switchcmd: 'On' } },
  ]);
  await tick(TIMINGS.commandEcho);
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${lamp.external_id}:binary`), 1, 'read back at once');

  assert.deepEqual(await run('Variateur', 'brightness', 40), [
    { param: 'switchlight', params: { idx: '2', switchcmd: 'Set Level', level: 40 } },
  ]);
  assert.deepEqual(await run('Volet pourcent', 'state', -1), [
    { param: 'switchlight', params: { idx: '4', switchcmd: 'Close' } },
  ]);
  assert.deepEqual(await run('Consigne', 'setpoint', 20.5), [
    { param: 'setsetpoint', params: { idx: '40', setpoint: 20.5 } },
  ]);
  assert.deepEqual(await run('Sélecteur', 'selector', '30'), [
    { param: 'switchlight', params: { idx: '13', switchcmd: 'Set Level', level: 30 } },
  ]);
  assert.deepEqual(await run('Ampoule RGBW', 'color', 0x0000ff), [
    {
      param: 'setcolbrightnessvalue',
      params: { idx: '41', hex: '0000ff', brightness: 80, iswhite: 'false' },
    },
  ]);
  assert.deepEqual(await run('Serrure garage', 'binary', 0), [
    { param: 'switchlight', params: { idx: '106', switchcmd: 'On' } },
  ]);

  const sensor = deviceNamed(gladys, 'Température (Salon)');
  const refused = await gladys.fake.setValue(sensor, featureOf(sensor, 'temperature'), 1);
  assert.equal(refused.success, false, 'a sensor cannot be controlled');

  const protectedLamp = deviceNamed(gladys, 'Lampe protégée (Salon)');
  const locked = await gladys.fake.setValue(protectedLamp, featureOf(protectedLamp, 'binary'), 1);
  assert.equal(locked.success, false);
  assert.match(locked.error, /protected by a code/);

  box.failOn.switchlight = new DomoticzError('api', 'WRONG CODE');
  const failed = await gladys.fake.setValue(lamp, featureOf(lamp, 'binary'), 0);
  assert.equal(failed.success, false);
  assert.match(failed.error, /WRONG CODE/);
});

test('a failure marks Domoticz unreachable, the reconnection reads everything again', async (t) => {
  const { gladys, box, tick } = await setup(t);
  const lamp = await created(gladys, 'Lampe salon (Salon)');
  box.fail = new DomoticzError('network', 'connection refused');
  await tick(POLL);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /unreachable: connection refused/);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: lamp.external_id,
    transport: DEVICE_TRANSPORTS.UNREACHABLE,
  });
  const offline = await gladys.fake.setValue(lamp, featureOf(lamp, 'binary'), 1);
  assert.equal(offline.success, false);
  assert.match(offline.error, /not connected/);

  // Missed while unreachable: the inventory brings it back.
  box.fail = undefined;
  box.emit(1, { Status: 'On', Data: 'On' });
  const inventories = box.callsOf('getplans').length;
  await tick(TIMINGS.retryMin);
  await tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(box.callsOf('getplans').length, inventories + 1);
  assert.equal(gladys.fake.lastState(`${lamp.external_id}:binary`), 1);
  assert.equal(gladys.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.LOCAL);
});

test('refused credentials: a clear status, retried every few minutes', async (t) => {
  const { gladys, box, tick } = await setup(t, {
    domoticz_url: 'http://dz.lan:8080',
    access_token: 'not-the-token',
  });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the access token/);
  const attempts = box.calls.length;
  await tick(TIMINGS.retryMax);
  assert.equal(box.calls.length, attempts);
  await tick(TIMINGS.authRetry - TIMINGS.retryMax);
  assert.equal(box.calls.length, attempts + 1);
});

test('a user and password, or nothing on a trusted network', async (t) => {
  const { gladys } = await setup(t, { domoticz_url: 'dz.lan:8080', ...USER });
  assert.equal(gladys.fake.connectionStatus.connected, true);

  await gladys.fake.configUpdated({ domoticz_url: 'dz.lan:8080' });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /asks Gladys to sign in/);
});

test('trusted network: no credentials needed', async (t) => {
  const { gladys } = await setup(t, { domoticz_url: 'dz.lan:8080' }, (box) => {
    box.trusted = true;
  });
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('the connection test shows the version, how it signed in and what is offered', async (t) => {
  const { gladys, box } = await setup(t);
  const ack = await gladys.fake.action(ACTIONS.TEST, {});
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.en,
    'Connection OK with the access token, Domoticz 2026.4: 56 devices, 2 rooms. 55 devices offered in Discovery, 3 left out (2 scenes or groups, 1 with nothing to offer).',
  );
  assert.match(
    ack.data.message.fr,
    /^Connexion OK avec le jeton d'accès, Domoticz 2026\.4 : 56 appareils/,
  );
  assert.equal(box.clients.at(-1).closed, true, 'the test client is closed');

  box.fail = new DomoticzError('http', 'HTTP 404');
  const down = await gladys.fake.action(ACTIONS.TEST, {});
  assert.match(down.data.message.en, /unreachable: HTTP 404\. Check the address and the port/);
});

test('without an address or a password, the status says what to fill in', async (t) => {
  const { gladys, box } = await setup(t, { domoticz_url: '' });
  assert.equal(gladys.fake.connectionStatus.message.en, T.notConfigured.en);
  assert.equal(box.clients.length, 0);
  const ack = await gladys.fake.action(ACTIONS.TEST, {});
  assert.deepEqual(ack.data.message, T.notConfigured);

  await gladys.fake.configUpdated({ domoticz_url: 'dz.lan:8080', username: 'gladys' });
  assert.equal(gladys.fake.connectionStatus.message.en, T.noPassword.en);
});

test('badges: a sensor in timeout is degraded, a disabled hardware unreachable', async (t) => {
  const { gladys, box, tick } = await setup(t);
  const window = await created(gladys, 'Fenêtre (Bureau)');
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: window.external_id,
    transport: DEVICE_TRANSPORTS.LOCAL,
    degraded: true,
    message: T.badge.timeout,
  });
  const cellar = await created(gladys, 'Sonde cave (Salon)');
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: cellar.external_id,
    transport: DEVICE_TRANSPORTS.UNREACHABLE,
    degraded: true,
    message: T.badge.hardwareDisabled,
  });

  box.emit(101, { HaveTimeout: false, Status: 'Open' });
  await tick(POLL);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: window.external_id,
    transport: DEVICE_TRANSPORTS.LOCAL,
  });
});

test('a new device reads the inventory again, a renamed one shows at the refresh', async (t) => {
  const { gladys, box, tick } = await setup(t);
  box.devices.push({
    ...structuredClone(box.devices.find((r) => r.Name === 'Lampe salon')),
    idx: '200',
    Name: 'Nouvelle lampe',
    PlanIDs: [],
  });
  box.emit(200, {});
  await tick(POLL);
  assert.equal(gladys.fake.discoveredDevices.length, 55);
  await tick(TIMINGS.inventoryDebounce);
  assert.ok(deviceNamed(gladys, 'Nouvelle lampe'));

  // Domoticz renames without touching LastUpdate: not in the changes.
  box.devices.find((r) => r.Name === 'Variateur').Name = 'Variateur entrée';
  await tick(POLL);
  assert.ok(!deviceNamed(gladys, 'Variateur entrée'));
  await tick(TIMINGS.inventoryRefresh);
  assert.ok(deviceNamed(gladys, 'Variateur entrée'));
});

test('Scan reads the inventory again, a new configuration reconnects', async (t) => {
  const { gladys, box } = await setup(t);
  await gladys.fake.scanRequest();
  assert.equal(box.callsOf('getplans').length, 2);

  await gladys.fake.configUpdated({ domoticz_url: 'https://dz.lan/', access_token: TOKEN });
  assert.equal(box.clients[0].closed, true);
  assert.equal(box.clients.at(-1).config.url, 'https://dz.lan');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});
