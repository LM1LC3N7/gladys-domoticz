// The answers of a real Domoticz 2026.4 (official Docker image, one virtual
// device of each kind, see TODO.md), plus a few records that a virtual
// install cannot produce (a battery sensor in timeout, security devices,
// scenes, a protected light, an old plain selector…), made from real ones.

import { readFileSync } from 'node:fs';

const read = (name) =>
  JSON.parse(readFileSync(new URL(`./domoticz-2026.4/${name}.json`, import.meta.url), 'utf8'));

export const VERSION = '2026.4';

const base = (records, idx) => structuredClone(records.find((r) => r.idx === String(idx)));

/** Records added to the real ones (idx 100+). */
function extraRecords(records) {
  const plug = {
    ...base(records, 1),
    idx: '100',
    Name: 'Prise TV',
    Image: 'WallSocket',
    Status: 'On',
    Data: 'On',
    PlanIDs: [3],
  };
  const door = {
    ...base(records, 7),
    idx: '101',
    Name: 'Fenêtre',
    Status: 'Closed',
    Data: 'Closed',
    BatteryLevel: 85,
    HaveTimeout: true,
    PlanIDs: [2, 3],
  };
  const smoke = {
    ...base(records, 10),
    idx: '102',
    Name: 'Fumée KD101',
    Type: 'Security',
    SubType: 'KD101 smoke detector',
    SwitchType: 'Smoke Detector',
    SwitchTypeVal: 5,
    Status: 'Normal',
    Data: 'Normal',
  };
  const panel = {
    ...base(records, 1),
    idx: '103',
    Name: 'Alarme',
    Type: 'Security',
    SubType: 'Security Panel',
    SwitchType: 'Security',
    SwitchTypeVal: 0,
    Status: 'Arm Away',
    Data: 'Arm Away',
  };
  const locked = {
    ...base(records, 1),
    idx: '104',
    Name: 'Lampe protégée',
    Protected: true,
  };
  const disabled = {
    ...base(records, 16),
    idx: '105',
    Name: 'Sonde cave',
    HardwareDisabled: true,
  };
  const inverted = {
    ...base(records, 14),
    idx: '106',
    Name: 'Serrure garage',
    SwitchType: 'Door Lock Inverted',
    SwitchTypeVal: 20,
    Status: 'Locked',
    Data: 'Locked',
  };
  const media = {
    ...base(records, 1),
    idx: '107',
    Name: 'Kodi',
    SwitchType: 'Media Player',
    SwitchTypeVal: 17,
    Status: 'Playing',
    Data: 'Playing',
  };
  const oldSelector = {
    ...base(records, 13),
    idx: '108',
    Name: 'Mode chauffage',
    LevelNames: 'Off|Hors-gel|Eco|Confort',
    LevelOffHidden: true,
    Status: 'Set Level: 30 %',
    Data: 'Confort',
    Level: 30,
  };
  return [plug, door, smoke, panel, locked, disabled, inverted, media, oldSelector];
}

const scenes = () => [
  {
    idx: '1',
    Name: 'Tout éteindre',
    Type: 'Scene',
    Status: 'Off',
    Data: 'Off',
    LastUpdate: '2026-10-15 21:30:00',
    Used: 1,
  },
  {
    idx: '2',
    Name: 'Lumières salon',
    Type: 'Group',
    Status: 'Mixed',
    Data: 'Mixed',
    LastUpdate: '2026-10-15 21:30:00',
    Used: 1,
  },
];

/** Fresh copies of the answers: getversion, getconfig, getplans, getdevices. */
export function answers() {
  const devices = read('getdevices');
  const plans = read('getplans');
  plans.result.push({ Devices: 2, Name: 'Bureau', Order: '1', idx: '3' });
  devices.result = [...scenes(), ...devices.result, ...extraRecords(devices.result)];
  return {
    getversion: read('getversion'),
    getconfig: read('getconfig'),
    getplans: plans,
    getdevices: devices,
  };
}
