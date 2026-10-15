// -----------------------------------------------------------------------------
// The inventory (rooms, scenes left out) and the Gladys devices built from it.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, deviceName } from '../src/devices.js';
import { asList, buildInventory } from '../src/inventory.js';
import { answers } from './fixtures/domoticz.js';

const ids = (idx) => ({
  device: `ext:test:domoticz:${idx}`,
  feature: (key) => `ext:test:domoticz:${idx}:${key}`,
});

function inventory() {
  const a = answers();
  return buildInventory({ devices: a.getdevices, plans: a.getplans });
}

test('the inventory: used devices, rooms in plan order, scenes and groups left out', () => {
  const inv = inventory();
  assert.equal(inv.devices.length, 56);
  assert.deepEqual(inv.skipped, { scenes: 2, unused: 0 });
  assert.equal(inv.plans, 2);
  assert.equal(inv.actTime, answers().getdevices.ActTime);
  const room = (name) => inv.devices.find((d) => d.name === name).room;
  assert.equal(room('Lampe salon'), 'Salon');
  assert.equal(room('Fenêtre'), 'Bureau', 'in two rooms: the first one in the plan order');
  assert.equal(room('Variateur'), undefined, 'PlanIDs [0]: no room');
});

test('unused devices are left out, a missing list is empty', () => {
  const inv = buildInventory({
    devices: {
      result: [
        { idx: '1', Name: 'A', Used: 0 },
        { idx: '2', Name: '' },
      ],
    },
  });
  assert.deepEqual(inv.skipped, { scenes: 0, unused: 1 });
  assert.equal(inv.devices[0].name, 'Domoticz 2');
  assert.deepEqual(asList(undefined), []);
  assert.deepEqual(asList({ a: 1 }), [1]);
});

test('the Gladys devices: one per Domoticz device, room in the name, params', () => {
  const model = buildModel(ids, inventory(), { tempSign: 'C', windSign: 'm/s', language: 'en' });
  assert.equal(model.counts.devices, 56);
  assert.equal(model.counts.empty, 1, 'the media player');
  assert.equal(model.devices.length, 55);
  const lamp = model.devices.find((d) => d.external_id === 'ext:test:domoticz:1');
  assert.equal(lamp.name, 'Lampe salon (Salon)');
  assert.equal(lamp.should_poll, false);
  assert.deepEqual(lamp.params, [
    { name: 'DOMOTICZ_IDX', value: '1' },
    { name: 'DOMOTICZ_ROOM', value: 'Salon' },
    { name: 'DOMOTICZ_TYPE', value: 'Light/Switch / Switch' },
    { name: 'DOMOTICZ_HARDWARE', value: 'Virtual' },
  ]);
  assert.deepEqual(
    lamp.features.map((f) => f.external_id),
    ['ext:test:domoticz:1:binary'],
  );
  assert.ok(model.writers.has('ext:test:domoticz:1:binary'));
  assert.equal(model.owners.get('ext:test:domoticz:1:binary'), '1');
  assert.equal(model.readers.get('1').length, 1);
  assert.ok(model.throttled.has('ext:test:domoticz:16:temperature'));
  assert.equal(model.deviceIdx.get('ext:test:domoticz:16'), '16');
  assert.equal(deviceName({ name: 'x'.repeat(120) }).length, 100);
});
