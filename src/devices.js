// -----------------------------------------------------------------------------
// The Domoticz inventory -> Gladys devices and routing tables (pure).
//
// One Gladys device per Domoticz device. External ids:
//   device  ext:<selector>:domoticz:<idx>
//   feature <device>:<role>                    (src/mapping.js)
// The idx of a Domoticz device never changes while the device exists: the
// external ids stay stable.
// -----------------------------------------------------------------------------

import { LIMITS } from './constants.js';
import { mapDevice } from './mapping.js';

/** Device names repeat from room to room ("Light"): the room is part of the name. */
export const deviceName = (dev) =>
  (dev.room ? `${dev.name} (${dev.room})` : dev.name).slice(0, 100);

const paramsOf = (dev) =>
  [
    { name: 'DOMOTICZ_IDX', value: dev.idx },
    { name: 'DOMOTICZ_ROOM', value: dev.room },
    {
      name: 'DOMOTICZ_TYPE',
      value: [dev.record.Type, dev.record.SubType].filter(Boolean).join(' / '),
    },
    { name: 'DOMOTICZ_HARDWARE', value: dev.record.HardwareName },
  ]
    .filter((p) => p.value !== undefined && p.value !== null && String(p.value) !== '')
    .map((p) => ({ name: p.name, value: String(p.value).slice(0, 255) }));

export function emptyModel() {
  return {
    devices: [],
    /** idx -> [{ featureId, read, event }] */
    readers: new Map(),
    /** feature id -> { write, text } */
    writers: new Map(),
    /** feature id -> device idx (the API calls name the device) */
    owners: new Map(),
    throttled: new Set(),
    /** device id -> idx */
    deviceIdx: new Map(),
    /** devices read, and left out because nothing maps / over the limit */
    counts: { devices: 0, empty: 0, overflow: 0 },
  };
}

/**
 * @param {(idx: string) => { device: string, feature: (key: string) => string }} idsOf
 *   the external ids of one device (gladys.externalIds('domoticz', idx))
 * @param {{ devices: object[] }} inventory see src/inventory.js
 * @param {{ tempSign?: string, windSign?: string, language?: string }} ctx the Domoticz settings
 */
export function buildModel(idsOf, inventory, ctx = {}) {
  const model = emptyModel();
  for (const dev of inventory.devices) {
    model.counts.devices += 1;
    const mapped = mapDevice(dev.record, ctx);
    if (mapped.features.length === 0) {
      model.counts.empty += 1;
      continue;
    }
    if (model.devices.length >= LIMITS.devices) {
      model.counts.overflow += 1;
      continue;
    }
    const ids = idsOf(dev.idx);
    model.devices.push({
      name: deviceName(dev),
      external_id: ids.device,
      should_poll: false,
      params: paramsOf(dev),
      features: mapped.features.map(({ key, ...feature }) => ({
        ...feature,
        external_id: ids.feature(key),
      })),
    });
    model.deviceIdx.set(ids.device, dev.idx);
    model.readers.set(
      dev.idx,
      mapped.readers.map(({ key, read, event }) => ({ featureId: ids.feature(key), read, event })),
    );
    for (const [key, writer] of Object.entries(mapped.writers)) {
      model.writers.set(ids.feature(key), writer);
      model.owners.set(ids.feature(key), dev.idx);
    }
    for (const key of mapped.throttled) {
      model.throttled.add(ids.feature(key));
    }
  }
  return model;
}
