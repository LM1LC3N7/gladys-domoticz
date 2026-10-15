// -----------------------------------------------------------------------------
// One Domoticz device -> Gladys features: the records of a real Domoticz
// 2026.4 (test/fixtures), each kind of device read and written.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import {
  COVER_STATE,
  OPENING_SENSOR_STATE,
  decodeLevelNames,
  isScene,
  leadingNumber,
  mapDevice,
  numbersOf,
  parseColor,
  switchIsOn,
  tToMireds,
  unitOf,
  unitText,
} from '../src/mapping.js';
import { answers } from './fixtures/domoticz.js';

const CTX = { tempSign: 'C', windSign: 'm/s', language: 'en' };
const records = answers().getdevices.result;

function map(name, { ctx = CTX, change = {} } = {}) {
  const found = records.find((r) => r.Name === name);
  assert.ok(found, `${name} is in the fixtures`);
  const record = { ...structuredClone(found), ...change };
  const mapped = mapDevice(record, ctx);
  const features = Object.fromEntries(mapped.features.map((f) => [f.key, f]));
  const values = {};
  for (const { key, read, event } of mapped.readers) {
    if (!event) {
      const value = read(record);
      values[key] = value?.state ?? value?.text ?? value;
    }
  }
  const write = (key, value) => mapped.writers[key].write(value, record);
  return { record, mapped, features, values, write, keys: Object.keys(features) };
}

const kind = (feature) => [feature.category, feature.type, feature.unit];

test('on/off switches: a light by default, a switch with another icon', () => {
  const lamp = map('Lampe salon');
  assert.deepEqual(lamp.keys, ['binary']);
  assert.deepEqual(kind(lamp.features.binary), [C.LIGHT, T.LIGHT.BINARY, undefined]);
  assert.equal(lamp.features.binary.name, 'Lampe salon');
  assert.equal(lamp.features.binary.read_only, false);
  assert.equal(lamp.features.binary.has_feedback, true);
  assert.equal(lamp.values.binary, 0);
  assert.deepEqual(lamp.write('binary', 1), [
    { param: 'switchlight', params: { switchcmd: 'On' } },
  ]);
  assert.deepEqual(lamp.write('binary', 0), [
    { param: 'switchlight', params: { switchcmd: 'Off' } },
  ]);

  const plug = map('Prise TV');
  assert.deepEqual(kind(plug.features.binary), [C.SWITCH, T.SWITCH.BINARY, undefined]);
  assert.equal(plug.values.binary, 1);
});

test('dimmers: on/off and brightness in %, the level kept while off', () => {
  const dimmer = map('Variateur');
  assert.deepEqual(dimmer.keys, ['binary', 'brightness']);
  assert.deepEqual(kind(dimmer.features.brightness), [C.LIGHT, T.LIGHT.BRIGHTNESS, undefined]);
  assert.equal(dimmer.features.brightness.name, 'Variateur – brightness');
  assert.deepEqual(dimmer.values, { binary: 1, brightness: 75 });
  assert.deepEqual(dimmer.write('brightness', 150), [
    { param: 'switchlight', params: { switchcmd: 'Set Level', level: 100 } },
  ]);
  const off = map('Variateur', { change: { Status: 'Off' } });
  assert.deepEqual(off.values, { binary: 0, brightness: 75 });
});

test('colour bulbs: colour (RGB) and colour temperature (white channels)', () => {
  const rgbw = map('Ampoule RGBW');
  assert.deepEqual(rgbw.keys, ['binary', 'brightness', 'color']);
  assert.deepEqual(rgbw.values, { binary: 1, brightness: 80, color: 0xff7f00 });
  assert.deepEqual(rgbw.write('color', 0x00ff00), [
    {
      param: 'setcolbrightnessvalue',
      params: { hex: '00ff00', brightness: 80, iswhite: 'false' },
    },
  ]);

  const rgbww = map('Ampoule RGBWW');
  assert.deepEqual(rgbww.keys, ['binary', 'brightness', 'color', 'color-temperature']);
  assert.equal(rgbww.values.color, 0x00ff7f);
  assert.equal(rgbww.values['color-temperature'], null, 'in RGB mode, no temperature');

  const white = map('Ampoule blanche');
  assert.deepEqual(white.keys, ['binary', 'brightness', 'color-temperature']);
  assert.deepEqual(kind(white.features['color-temperature']), [
    C.LIGHT,
    T.LIGHT.TEMPERATURE,
    undefined,
  ]);
  assert.equal(white.values['color-temperature'], tToMireds(200));
  assert.equal(tToMireds(0), 153);
  assert.equal(tToMireds(255), 500);
  assert.deepEqual(white.write('color-temperature', 153), [
    { param: 'setkelvinlevel', params: { kelvin: 0 } },
  ]);
  assert.deepEqual(white.write('color-temperature', 500), [
    { param: 'setkelvinlevel', params: { kelvin: 100 } },
  ]);
});

test('shutters: state -1/0/1, position for the percentage ones, stop when supported', () => {
  const blinds = map('Volet');
  assert.deepEqual(blinds.keys, ['state']);
  assert.deepEqual(kind(blinds.features.state), [C.SHUTTER, T.SHUTTER.STATE, undefined]);
  assert.equal(blinds.values.state, COVER_STATE.STOP);
  assert.deepEqual(blinds.write('state', 1), [
    { param: 'switchlight', params: { switchcmd: 'Open' } },
  ]);
  assert.deepEqual(blinds.write('state', -1), [
    { param: 'switchlight', params: { switchcmd: 'Close' } },
  ]);
  assert.throws(() => blinds.write('state', 0), /cannot be stopped/);

  const percent = map('Volet pourcent');
  assert.deepEqual(percent.keys, ['state', 'position']);
  assert.deepEqual(percent.values, { state: COVER_STATE.OPEN, position: 100 });
  assert.deepEqual(percent.write('position', 30.4), [
    { param: 'switchlight', params: { switchcmd: 'Set Level', level: 30 } },
  ]);
  const partial = map('Volet pourcent', { change: { Status: 'Set Level: 40 %', Level: 40 } });
  assert.deepEqual(partial.values, { state: COVER_STATE.STOP, position: 40 });

  const stop = map('Volet stop');
  assert.deepEqual(stop.values, { state: COVER_STATE.STOP, position: 60 });
  assert.deepEqual(stop.write('state', 0), [
    { param: 'switchlight', params: { switchcmd: 'Stop' } },
  ]);
  assert.equal(map('Store vénitien').values.state, COVER_STATE.CLOSE);
});

test('binary sensors: doors (Gladys 0 = open), motion, smoke, dusk', () => {
  const door = map('Porte entrée');
  assert.deepEqual(door.keys, ['opening']);
  assert.deepEqual(kind(door.features.opening), [C.OPENING_SENSOR, T.SENSOR.BINARY, undefined]);
  assert.equal(door.features.opening.read_only, true);
  assert.equal(door.values.opening, OPENING_SENSOR_STATE.OPEN);
  assert.equal(map('Contact').values.opening, OPENING_SENSOR_STATE.CLOSE);
  assert.deepEqual(map('Mouvement').values, { motion: 1 });
  assert.deepEqual(map('Fumée').values, { smoke: 0 });
  assert.deepEqual(map('Fumée', { change: { Status: 'On' } }).values, { smoke: 1 });
  assert.deepEqual(map('Fumée KD101').values, { smoke: 0 }, 'security smoke detector: Normal');
  assert.deepEqual(map('Fumée KD101', { change: { Status: 'Alarm' } }).values, { smoke: 1 });
  assert.deepEqual(kind(map('Crépuscule').features.dusk), [
    C.UNKNOWN,
    T.UNKNOWN.UNKNOWN,
    undefined,
  ]);
});

test('push buttons and doorbells are presses (events), not states', () => {
  const button = map('Bouton');
  assert.deepEqual(kind(button.features.button), [C.BUTTON, T.BUTTON.CLICK, undefined]);
  assert.equal(button.features.button.read_only, true);
  const [reader] = button.mapped.readers;
  assert.equal(reader.event, true);
  assert.deepEqual(reader.read(button.record), { state: 1 });
  const bell = map('Sonnette');
  assert.deepEqual(kind(bell.features.button), [C.DOORBELL, T.DOORBELL.RING, undefined]);
});

test('selectors: a list of levels (base64 names of 2023+, plain names before)', () => {
  const selector = map('Sélecteur');
  assert.deepEqual(kind(selector.features.selector), [C.TEXT, T.TEXT.SELECT, undefined]);
  assert.deepEqual(selector.features.selector.supported_options, [
    { value: '0', label: 'Off', sort_order: 0 },
    { value: '10', label: 'Eco', sort_order: 1 },
    { value: '20', label: 'Confort', sort_order: 2 },
    { value: '30', label: 'Absent', sort_order: 3 },
  ]);
  assert.equal(selector.values.selector, '0');
  assert.deepEqual(selector.write('selector', '20'), [
    { param: 'switchlight', params: { switchcmd: 'Set Level', level: 20 } },
  ]);
  assert.deepEqual(selector.write('selector', 'Eco'), [
    { param: 'switchlight', params: { switchcmd: 'Set Level', level: 10 } },
  ]);
  assert.throws(() => selector.write('selector', '25'), /not a level/);

  const plain = map('Mode chauffage');
  assert.deepEqual(
    plain.features.selector.supported_options.map((o) => o.value),
    ['10', '20', '30'],
    'Off hidden',
  );
  assert.equal(plain.values.selector, '30');
});

test('locks: 1 = locked, the inverted ones lock with Off', () => {
  const lock = map('Serrure');
  assert.deepEqual(kind(lock.features.binary), [C.LOCK, T.LOCK.BINARY, undefined]);
  assert.equal(lock.values.binary, 0);
  assert.deepEqual(lock.write('binary', 1), [
    { param: 'switchlight', params: { switchcmd: 'On' } },
  ]);
  const inverted = map('Serrure garage');
  assert.equal(inverted.values.binary, 1);
  assert.deepEqual(inverted.write('binary', 1), [
    { param: 'switchlight', params: { switchcmd: 'Off' } },
  ]);
  assert.deepEqual(inverted.write('binary', 0), [
    { param: 'switchlight', params: { switchcmd: 'On' } },
  ]);
});

test('setpoints: a thermostat target, sensible bounds instead of -200…200', () => {
  const setpoint = map('Consigne');
  assert.deepEqual(kind(setpoint.features.setpoint), [
    C.THERMOSTAT,
    T.THERMOSTAT.TARGET_TEMPERATURE,
    U.CELSIUS,
  ]);
  assert.deepEqual([setpoint.features.setpoint.min, setpoint.features.setpoint.max], [5, 30]);
  assert.equal(setpoint.values.setpoint, 21.5);
  assert.deepEqual(setpoint.write('setpoint', 19), [
    { param: 'setsetpoint', params: { setpoint: 19 } },
  ]);
  const bounded = map('Consigne', { change: { min: 7, max: 28 } });
  assert.deepEqual([bounded.features.setpoint.min, bounded.features.setpoint.max], [7, 28]);
});

test('weather sensors: temperature, humidity, pressure, rain, wind, UV', () => {
  const temp = map('Température');
  assert.deepEqual(temp.keys, ['temperature']);
  assert.equal(temp.features.temperature.name, 'Température', 'a single measure keeps the name');
  assert.deepEqual(kind(temp.features.temperature), [
    C.TEMPERATURE_SENSOR,
    T.SENSOR.DECIMAL,
    U.CELSIUS,
  ]);
  assert.equal(temp.values.temperature, 22.75);
  assert.ok(temp.mapped.throttled.has('temperature'));

  const thb = map('Temp hum baro');
  assert.deepEqual(thb.keys, ['temperature', 'humidity', 'pressure']);
  assert.deepEqual(thb.values, { temperature: 19.8, humidity: 61, pressure: 1013 });
  assert.equal(thb.features.humidity.name, 'Temp hum baro – humidity');
  assert.equal(thb.features.pressure.unit, U.HECTO_PASCAL);

  assert.deepEqual(map('Humidité').values, { humidity: 61 });
  assert.deepEqual(map('Baromètre').values, { pressure: 1012.5 });
  const rain = map('Pluie');
  assert.deepEqual(rain.values, { 'rain-rate': 0, 'rain-today': 0 });
  assert.equal(rain.features['rain-today'].unit, U.MILLIMETER_PER_DAY);

  const wind = map('Vent');
  assert.deepEqual(wind.values, { 'wind-speed': 3, 'wind-gust': 5, 'wind-direction': 225 });
  assert.deepEqual(kind(wind.features['wind-speed']), [
    C.SPEED_SENSOR,
    T.SENSOR.DECIMAL,
    U.METER_PER_SECOND,
  ]);
  assert.equal(wind.features['wind-direction'].unit, U.DEGREE);
  const knots = map('Vent', { ctx: { ...CTX, windSign: 'kn' } });
  assert.equal(knots.features['wind-speed'].unit, U.KILOMETER_PER_HOUR);
  assert.equal(knots.values['wind-speed'], 5.56);
  const beaufort = map('Vent', { ctx: { ...CTX, windSign: 'bf' } });
  assert.equal(beaufort.features['wind-speed'].category, C.UNKNOWN);

  assert.deepEqual(map('UV').values, { uv: 3.2 });
  assert.deepEqual(map('Rayonnement').values, { radiation: 450 });

  const fahrenheit = map('Température', { ctx: { ...CTX, tempSign: 'F' } });
  assert.equal(fahrenheit.features.temperature.unit, U.FAHRENHEIT);
});

test('energy: power, index, P1 meters with the export, gas, counters', () => {
  const plug = map('Prise conso');
  assert.deepEqual(plug.keys, ['power', 'energy']);
  assert.deepEqual(kind(plug.features.power), [C.ENERGY_SENSOR, T.ENERGY_SENSOR.POWER, U.WATT]);
  assert.deepEqual(kind(plug.features.energy), [
    C.ENERGY_SENSOR,
    T.ENERGY_SENSOR.INDEX,
    U.KILOWATT_HOUR,
  ]);
  assert.deepEqual(plug.values, { power: 125.4, energy: 3456.789 });

  assert.deepEqual(map('Puissance').values, { power: 678.9 });

  const p1 = map('Compteur P1');
  assert.deepEqual(p1.keys, ['power', 'energy', 'export-power', 'export-energy']);
  assert.deepEqual(p1.values, {
    power: 512,
    energy: 3,
    'export-power': 0,
    'export-energy': 0.7,
  });
  assert.deepEqual(kind(p1.features['export-energy']), [
    C.GRID_SENSOR,
    T.GRID_SENSOR.OUTPUT_INDEX,
    U.KILOWATT_HOUR,
  ]);

  const gas = map('Gaz P1');
  assert.deepEqual(kind(gas.features.volume), [C.VOLUME_SENSOR, T.SENSOR.DECIMAL, U.CUBIC_METER]);
  assert.equal(gas.values.volume, 1234.567);

  assert.deepEqual(map('Compteur eau').values, { energy: 12.345 }, 'meter type: energy');
  const water = map('Compteur eau', {
    change: { SwitchTypeVal: 2, Counter: '12.345 m3', Data: '12.345 m3' },
  });
  assert.deepEqual(water.keys, ['volume']);
  assert.equal(water.values.volume, 12.345);
  const solar = map('Prise conso', { change: { SwitchTypeVal: 4 } });
  assert.equal(solar.features.energy.category, C.ENERGY_PRODUCTION_SENSOR);
  assert.deepEqual(map('Compteur RFX').values, { energy: 9.876 });

  assert.deepEqual(map('Tension').values, { voltage: 231.4 });
  assert.deepEqual(map('Courant').values, { current: 2.35 });
  assert.deepEqual(map('Pince 3 phases').values, {
    'current-l1': 1.1,
    'current-l2': 2.2,
    'current-l3': 3.3,
  });
});

test('the other measures, texts, and what is left out', () => {
  assert.deepEqual(kind(map('Luminosité').features.lux), [C.LIGHT_SENSOR, T.SENSOR.DECIMAL, U.LUX]);
  assert.deepEqual(map('Luminosité').values, { lux: 345 });
  assert.deepEqual(map('Qualité air').values, { co2: 812 });
  assert.deepEqual(map('Son').values, { noise: 48 });
  assert.deepEqual(map('Distance').values, { distance: 123.4 });
  assert.equal(map('Distance').features.distance.unit, U.CM);
  assert.deepEqual(map('Pression').values, { pressure: 1.5 });
  assert.equal(map('Pression').features.pressure.unit, U.BAR);
  assert.deepEqual(map('Pourcentage').values, { value: 42.5 });
  assert.equal(map('Pourcentage').features.value.unit, U.PERCENT);
  assert.deepEqual(map('Alerte').values, { text: 'Attention' });
  assert.deepEqual(map('Texte').values, { text: 'Bonjour' });
  assert.equal(map('Texte').features.text.keep_history, false);
  const flow = map('Débit eau');
  assert.deepEqual(flow.values, { value: 7.5 });
  assert.equal(flow.features.value.unit, undefined, 'l/min is not a Gladys unit');
  assert.deepEqual(map('Alarme').values, { status: 'Arm Away' }, 'a security panel, as a text');

  assert.deepEqual(map('Kodi').keys, [], 'media players: milestone 2');
  assert.equal(isScene(records.find((r) => r.Name === 'Tout éteindre')), true);
  assert.equal(isScene(records.find((r) => r.Name === 'Lampe salon')), false);
});

test('the battery of the battery devices only (255 = mains)', () => {
  const window = map('Fenêtre');
  assert.deepEqual(window.keys, ['opening', 'battery']);
  assert.deepEqual(kind(window.features.battery), [C.BATTERY, T.BATTERY.INTEGER, U.PERCENT]);
  assert.equal(window.values.battery, 85);
  assert.ok(!map('Lampe salon').keys.includes('battery'));
});

test('the secondary features are named in the language of the Domoticz interface', () => {
  const fr = map('Temp hum', { ctx: { ...CTX, language: 'fr' } });
  assert.equal(fr.features.humidity.name, 'Temp hum – humidité');
  assert.equal(fr.features.temperature.name, 'Temp hum – température');
});

test('value helpers', () => {
  assert.equal(leadingNumber('21.5 C'), 21.5);
  assert.equal(leadingNumber('Set Level: 40 %'), 40);
  assert.equal(leadingNumber('-3,5'), -3.5);
  assert.equal(leadingNumber(12), 12);
  assert.equal(leadingNumber('Off'), undefined);
  assert.deepEqual(numbersOf('1.1 A, 2.2 A, 3.3 A'), [1.1, 2.2, 3.3]);
  assert.equal(unitText('3456.789 kWh'), 'kWh');
  assert.equal(unitText('42.5%'), '%');
  assert.equal(unitText('1234.567'), undefined);
  assert.equal(unitOf('Watt'), U.WATT);
  assert.equal(unitOf('kwh'), U.KILOWATT_HOUR);
  assert.equal(unitOf('l/min'), undefined);
  assert.deepEqual(decodeLevelNames('T2ZmfEVjbw=='), ['Off', 'Eco']);
  assert.deepEqual(decodeLevelNames('Off|Eco'), ['Off', 'Eco']);
  assert.deepEqual(decodeLevelNames(''), []);
  assert.equal(switchIsOn({ Status: 'Group Off' }), 0);
  assert.equal(switchIsOn({ Status: 'Set Level: 0 %', Level: 0 }), 0);
  assert.equal(switchIsOn({ Status: 'Set Color', Level: 40 }), 1);
  assert.equal(switchIsOn({ Status: '', Data: '' }), undefined);
  assert.deepEqual(parseColor('{"m":3,"r":1,"g":2,"b":3}'), { m: 3, r: 1, g: 2, b: 3 });
  assert.equal(parseColor(''), undefined);
});
