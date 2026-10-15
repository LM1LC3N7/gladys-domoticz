// A fake Domoticz behind the client of src/domoticz.js: the devices of the
// fixtures, a clock for getdevices&lastupdate (the devices updated at or
// after it, like Domoticz), the commands run with their effect, failures.

import { DomoticzError } from '../../src/domoticz.js';
import { answers } from '../fixtures/domoticz.js';

export const TOKEN = 'eyJ0.fake-access-token.sig';
export const USER = { username: 'gladys', password: 'secret' };

const pad = (n) => String(n).padStart(2, '0');
/** Domoticz LastUpdate: local time, to the second. */
const stamp = (seconds) => {
  const d = new Date(seconds * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};

export function fakeDomoticz({ token = TOKEN, user = USER } = {}) {
  const start = answers();
  const box = {
    ...start,
    devices: start.getdevices.result,
    /** Domoticz time (seconds) */
    clock: 1_792_092_000,
    /** idx -> time of its last update */
    updated: new Map(),
    /** the Gladys machine is in the trusted networks */
    trusted: false,
    /** every call: { param, params } */
    calls: [],
    /** the commands run */
    executed: [],
    /** an error every call throws */
    fail: undefined,
    /** param -> error thrown by that command */
    failOn: {},
    clients: [],
  };
  for (const record of box.devices) {
    box.updated.set(record.idx, box.clock - 600);
  }

  const find = (idx) =>
    box.devices.find((r) => r.idx === String(idx) && r.Type !== 'Scene' && r.Type !== 'Group');

  /** A device changes in Domoticz: its fields, its LastUpdate. */
  box.emit = (idx, changes = {}) => {
    box.clock += 1;
    const record = find(idx);
    Object.assign(record, changes, { LastUpdate: stamp(box.clock) });
    box.updated.set(record.idx, box.clock);
    return record;
  };

  box.callsOf = (param) => box.calls.filter((c) => c.param === param);

  function command(param, params) {
    const record = find(params.idx);
    if (!record) {
      throw new DomoticzError('api', `${param} refused`);
    }
    box.executed.push({ param, params: { ...params } });
    if (param === 'switchlight') {
      const cmd = params.switchcmd;
      if (cmd === 'Set Level') {
        box.emit(record.idx, {
          Status: `Set Level: ${params.level} %`,
          Level: Number(params.level),
        });
      } else if (cmd === 'Open' || cmd === 'Close' || cmd === 'Stop') {
        const status = { Open: 'Open', Close: 'Closed', Stop: 'Stopped' }[cmd];
        box.emit(record.idx, { Status: status, Data: status });
      } else if (/Lock/.test(record.SwitchType)) {
        const on = cmd === 'On';
        const locked = record.SwitchTypeVal === 20 ? !on : on;
        box.emit(record.idx, { Status: locked ? 'Locked' : 'Unlocked' });
      } else {
        box.emit(record.idx, { Status: cmd, Data: cmd });
      }
    } else if (param === 'setsetpoint') {
      box.emit(record.idx, { SetPoint: String(params.setpoint), Data: String(params.setpoint) });
    } else {
      box.emit(record.idx, {});
    }
    return { status: 'OK', title: param };
  }

  function answer(param, params) {
    if (box.failOn[param]) {
      throw box.failOn[param];
    }
    switch (param) {
      case 'getversion':
        return structuredClone(box.getversion);
      case 'getconfig':
        return structuredClone(box.getconfig);
      case 'getplans':
        return structuredClone(box.getplans);
      case 'getdevices': {
        const since = params.lastupdate === undefined ? undefined : Number(params.lastupdate);
        const result = box.devices.filter(
          (r) => since === undefined || (box.updated.get(r.idx) ?? 0) >= since,
        );
        const json = { status: 'OK', title: 'Devices', ActTime: box.clock, app_version: '2026.4' };
        if (result.length > 0) {
          json.result = structuredClone(result);
        }
        return json;
      }
      case 'switchlight':
      case 'setsetpoint':
      case 'setcolbrightnessvalue':
      case 'setkelvinlevel':
        return command(param, params);
      default:
        return { status: 'ERR' };
    }
  }

  const signedIn = (auth) => {
    if (auth.kind === 'token') {
      return auth.token === token;
    }
    if (auth.kind === 'password') {
      return auth.username === user.username && auth.password === user.password;
    }
    return box.trusted;
  };

  box.connect = (config) => {
    const client = {
      config,
      closed: false,
      mode: config.auth.kind === 'password' ? 'session' : config.auth.kind,
      async call(param, params = {}) {
        box.calls.push({ param, params });
        if (box.fail) {
          throw box.fail;
        }
        if (!signedIn(config.auth)) {
          if (param === 'getversion') {
            return { status: 'OK', title: 'GetVersion' }; // Domoticz answers, without the version
          }
          throw new DomoticzError('auth', 'not signed in (HTTP 401)', { status: 401 });
        }
        const json = answer(param, params);
        if (json.status !== 'OK') {
          throw new DomoticzError('api', `${param} refused`);
        }
        return json;
      },
      close() {
        client.closed = true;
      },
    };
    box.clients.push(client);
    return client;
  };

  return box;
}

/** Lets the pending promises settle (no timer involved). */
export const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
