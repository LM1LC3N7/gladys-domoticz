// -----------------------------------------------------------------------------
// One Domoticz device -> Gladys features, readers and writers (pure).
//
// A device of the getdevices answer is one record: its Type / SubType say
// what it measures, its SwitchType (switches only) how it behaves, and its
// fields carry the values (Status, Level, Color, Temp, Humidity, Barometer,
// Usage, Counter… — strings with their unit, like "21.5 C" or "678.9 Watt").
// `mapDevice` returns:
//   features  the Gladys features (key relative to the device, part of the
//             external id: never change a key),
//   readers   [{ key, read(record) -> { state } | { text } | null, event }],
//             an `event` reader is a press: read only when the device was
//             updated (LastUpdate), and sent even when the value is the same,
//   writers   { [key]: { write(value, record) -> [{ param, params }], text } }
//             (one API call per entry; `record` is the last one read),
//   throttled the keys of the measurements (spaced by the sensor interval).
// Value conventions: the Gladys side follows the enums of
// server/utils/constants.js in the Gladys core (copied here, the SDK does not
// export them); the Domoticz side its web interface (Status texts, Level in %).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { LIMITS } from './constants.js';

// Value enums of the Gladys core (server/utils/constants.js), not in the SDK.
export const COVER_STATE = { STOP: 0, OPEN: 1, CLOSE: -1 };
export const OPENING_SENSOR_STATE = { OPEN: 0, CLOSE: 1 };
export const BUTTON_STATUS = { CLICK: 1 };

/** Domoticz switch types (SwitchTypeVal), main/RFXNames.h. */
export const SWITCH = {
  ON_OFF: 0,
  DOORBELL: 1,
  CONTACT: 2,
  BLINDS: 3,
  SIREN: 4,
  SMOKE: 5,
  BLINDS_INVERTED: 6, // removed in 2023, kept for old installs
  DIMMER: 7,
  MOTION: 8,
  PUSH_ON: 9,
  PUSH_OFF: 10,
  DOOR_CONTACT: 11,
  DUSK: 12,
  BLINDS_PERCENT: 13,
  VENETIAN_US: 14,
  VENETIAN_EU: 15,
  BLINDS_PERCENT_INVERTED: 16, // removed in 2023, kept for old installs
  MEDIA: 17,
  SELECTOR: 18,
  DOOR_LOCK: 19,
  DOOR_LOCK_INVERTED: 20,
  BLINDS_PERCENT_STOP: 21,
  BLINDS_STOP: 22,
};

/** Domoticz meter types (SwitchTypeVal of the counters). */
export const METER = { ENERGY: 0, GAS: 1, WATER: 2, CUSTOM: 3, ENERGY_GENERATED: 4, TIME: 5 };

// --- Units -----------------------------------------------------------------------

const UNITS = {
  C: U.CELSIUS,
  '°C': U.CELSIUS,
  F: U.FAHRENHEIT,
  '°F': U.FAHRENHEIT,
  '%': U.PERCENT,
  Pa: U.PASCAL,
  hPa: U.HECTO_PASCAL,
  kPa: U.KILO_PASCAL,
  Bar: U.BAR,
  bar: U.BAR,
  mbar: U.MILLIBAR,
  psi: U.PSI,
  Lux: U.LUX,
  lux: U.LUX,
  lx: U.LUX,
  ppm: U.PPM,
  ppb: U.PPB,
  W: U.WATT,
  Watt: U.WATT,
  kW: U.KILOWATT,
  Wh: U.WATT_HOUR,
  kWh: U.KILOWATT_HOUR,
  MWh: U.MEGAWATT_HOUR,
  A: U.AMPERE,
  mA: U.MILLI_AMPERE,
  V: U.VOLT,
  mV: U.MILLI_VOLT,
  VA: U.VOLT_AMPERE,
  kVA: U.KILOVOLT_AMPERE,
  var: U.VOLT_AMPERE_REACTIVE,
  mm: U.MM,
  cm: U.CM,
  m: U.M,
  km: U.KM,
  in: U.INCH,
  inch: U.INCH,
  ft: U.FEET,
  mi: U.MILE,
  L: U.LITER,
  l: U.LITER,
  Liter: U.LITER,
  m3: U.CUBIC_METER,
  'm³': U.CUBIC_METER,
  'm/s': U.METER_PER_SECOND,
  'km/h': U.KILOMETER_PER_HOUR,
  mph: U.MILE_PER_HOUR,
  'mm/h': U.MILLIMETER_PER_HOUR,
  dB: U.DECIBEL,
  UVI: U.UV_INDEX,
  '°': U.DEGREE,
  '€': U.EURO,
  EUR: U.EURO,
  $: U.DOLLAR,
  s: U.SECONDS,
  min: U.MINUTES,
  h: U.HOURS,
};

const UNITS_LOWER = new Map(Object.entries(UNITS).map(([k, v]) => [k.toLowerCase(), v]));

/** The Gladys unit of a Domoticz unit, or undefined (Gladys refuses unknown units). */
export function unitOf(unit) {
  if (typeof unit !== 'string' || unit.trim() === '') {
    return undefined;
  }
  const text = unit.trim();
  return UNITS[text] ?? UNITS_LOWER.get(text.toLowerCase());
}

// --- Values ----------------------------------------------------------------------

const NUMBER = /[-+]?\d+(?:[.,]\d+)?(?:e[-+]?\d+)?/i;

/** The first number of a Domoticz value ("21.5 C", "Set Level: 40 %", 12, "1,5"). */
export function leadingNumber(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : undefined;
  }
  const match = NUMBER.exec(String(raw ?? ''));
  if (!match) {
    return undefined;
  }
  const n = Number(match[0].replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/** Every number of a value ("1.1 A, 2.2 A, 3.3 A" -> [1.1, 2.2, 3.3]). */
export function numbersOf(raw) {
  return [...String(raw ?? '').matchAll(new RegExp(NUMBER.source, 'gi'))]
    .map((m) => Number(m[0].replace(',', '.')))
    .filter(Number.isFinite);
}

/** The unit written after the first number ("3456.789 kWh" -> "kWh"), or undefined. */
export function unitText(raw) {
  const text = String(raw ?? '');
  const match = NUMBER.exec(text);
  if (!match) {
    return undefined;
  }
  const rest = text.slice(match.index + match[0].length).trim();
  const unit = /^[^\s,;]+/.exec(rest);
  return unit ? unit[0] : undefined;
}

export const colorToInt = (r, g, b) =>
  ((Number(r) & 255) << 16) | ((Number(g) & 255) << 8) | (Number(b) & 255);

export const intToHex = (n) =>
  Math.max(0, Math.min(0xffffff, Math.round(Number(n) || 0)))
    .toString(16)
    .padStart(6, '0');

/** Gladys colour temperatures in mireds; Domoticz `t`: 0 coldest, 255 warmest. */
export const MIREDS = { min: 153, max: 500 };
export const tToMireds = (t) =>
  Math.round(MIREDS.min + (Math.max(0, Math.min(255, t)) / 255) * (MIREDS.max - MIREDS.min));
/** setkelvinlevel takes the same ratio in percent (0 coldest). */
export const miredsToKelvinLevel = (mireds) =>
  Math.round(
    ((Math.max(MIREDS.min, Math.min(MIREDS.max, mireds)) - MIREDS.min) /
      (MIREDS.max - MIREDS.min)) *
      100,
  );

/** The Color field: a JSON object ({ m, t, r, g, b, cw, ww }), or "". */
export function parseColor(raw) {
  if (raw && typeof raw === 'object') {
    return raw;
  }
  try {
    const color = JSON.parse(String(raw ?? ''));
    return color && typeof color === 'object' ? color : undefined;
  } catch {
    return undefined;
  }
}

/** The level names of a selector: plain "Off|Eco|Comfort" or base64 (2023+). */
export function decodeLevelNames(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    return [];
  }
  let names = text;
  if (!text.includes('|') && /^[A-Za-z0-9+/]+=*$/.test(text)) {
    const decoded = Buffer.from(text, 'base64').toString('utf8');
    if (!decoded.includes('�')) {
      names = decoded;
    }
  }
  return names.split('|');
}

const cut = (text, max = LIMITS.text) => {
  const s = String(text ?? '');
  return s.length > max ? s.slice(0, max) : s;
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const statusOf = (r) => String(r.Status ?? '').trim();

/** On/off of a switch, a dimmer or a colour bulb from its Status. */
export function switchIsOn(r) {
  const status = statusOf(r) || String(r.Data ?? '').trim();
  if (/\boff\b/i.test(status)) {
    return 0;
  }
  if (/^set level/i.test(status) && leadingNumber(r.Level) === 0) {
    return 0;
  }
  return status === '' ? undefined : 1;
}

const SMOKE_WORDS = /\b(on|alarm|panic|smoke|fire|alert)\b/i;
const SMOKE_CLEAR = /\b(off|normal|panic end|no smoke)\b/i;

// --- Labels -----------------------------------------------------------------------

/** Names of the secondary features, in the language of the Domoticz interface. */
const LABELS = {
  brightness: { en: 'brightness', fr: 'luminosité' },
  color: { en: 'colour', fr: 'couleur' },
  colorTemperature: { en: 'colour temperature', fr: 'température de couleur' },
  position: { en: 'position', fr: 'position' },
  temperature: { en: 'temperature', fr: 'température' },
  humidity: { en: 'humidity', fr: 'humidité' },
  pressure: { en: 'pressure', fr: 'pression' },
  rainRate: { en: 'rain rate', fr: 'intensité de pluie' },
  rainToday: { en: 'rain today', fr: 'pluie du jour' },
  windSpeed: { en: 'wind speed', fr: 'vitesse du vent' },
  windGust: { en: 'gusts', fr: 'rafales' },
  windDirection: { en: 'wind direction', fr: 'direction du vent' },
  uv: { en: 'UV index', fr: 'indice UV' },
  radiation: { en: 'solar radiation (W/m²)', fr: 'rayonnement solaire (W/m²)' },
  power: { en: 'power', fr: 'puissance' },
  energy: { en: 'energy', fr: 'énergie' },
  exportPower: { en: 'power sent to the grid', fr: 'puissance injectée' },
  exportEnergy: { en: 'energy sent to the grid', fr: 'énergie injectée' },
  current: { en: 'current', fr: 'courant' },
  battery: { en: 'battery', fr: 'batterie' },
};

// --- Specs ------------------------------------------------------------------------

const decimal = (category, min, max, unit, type = T.SENSOR.DECIMAL) => ({
  category,
  type,
  min,
  max,
  unit,
});

const binarySpec = (category, type = T.SENSOR.BINARY) => ({ category, type, min: 0, max: 1 });

/** Wind speed: Gladys knows m/s and km/h; mph and knots are converted to km/h. */
const WIND_UNITS = {
  'm/s': { unit: U.METER_PER_SECOND, factor: 1 },
  'km/h': { unit: U.KILOMETER_PER_HOUR, factor: 1 },
  mph: { unit: U.KILOMETER_PER_HOUR, factor: 1.609344 },
  kn: { unit: U.KILOMETER_PER_HOUR, factor: 1.852 },
};

const TEMPERATURE_UNITS = { C: U.CELSIUS, F: U.FAHRENHEIT };

// --- The device -------------------------------------------------------------------

class DeviceMapper {
  /**
   * @param {object} record one device of the getdevices answer
   * @param {{ tempSign?: string, windSign?: string, language?: string }} ctx the Domoticz settings
   */
  constructor(record, ctx) {
    this.r = record;
    this.ctx = ctx;
    this.name = String(record.Name ?? `Domoticz ${record.idx}`).trim();
    this.lang = String(ctx.language ?? '').startsWith('fr') ? 'fr' : 'en';
    this.tempUnit = TEMPERATURE_UNITS[String(ctx.tempSign ?? 'C').toUpperCase()] ?? U.CELSIUS;
    this.features = [];
    this.readers = [];
    this.writers = {};
    this.throttled = new Set();
  }

  label(key) {
    return `${this.name} – ${LABELS[key][this.lang]}`;
  }

  /**
   * One feature.
   * @param {string} key part of the external id: never change it
   * @param {object} spec category, type, unit, min, max, supported_options
   * @param {{ read?: Function, write?: Function, text?: boolean, throttle?: boolean, event?: boolean }} io
   */
  add(key, name, spec, { read, write, text = false, throttle = false, event = false } = {}) {
    if (this.features.some((f) => f.key === key)) {
      return;
    }
    const feature = {
      key,
      name: cut(name, 100),
      category: spec.category,
      type: spec.type,
      min: spec.min ?? 0,
      max: spec.max ?? 1,
      read_only: !write,
      // Feedback: Domoticz reports the new state back in its device list.
      has_feedback: Boolean(write && read),
      keep_history: !text,
    };
    if (spec.unit) {
      feature.unit = spec.unit;
    }
    if (spec.supported_options) {
      feature.supported_options = spec.supported_options;
    }
    this.features.push(feature);
    if (read) {
      this.readers.push({ key, read, event });
    }
    if (write) {
      this.writers[key] = { write, text };
    }
    if (throttle) {
      this.throttled.add(key);
    }
  }

  /** A read-only measurement taken from a record field. */
  measure(key, name, spec, value) {
    this.add(key, name, spec, {
      read: (r) => {
        const n = leadingNumber(value(r));
        return n === undefined ? null : { state: n };
      },
      throttle: true,
    });
  }

  text(key, name, value = (r) => r.Data) {
    this.add(
      key,
      name,
      { category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0 },
      {
        text: true,
        read: (r) => {
          const v = value(r);
          return v === undefined || v === null ? null : { text: cut(v) };
        },
      },
    );
  }

  // --- Switches ---------------------------------------------------------------------

  /** A light, unless the user gave the switch another icon in Domoticz. */
  isLight() {
    const image = String(this.r.Image ?? '').trim();
    return this.r.Type === 'Color Switch' || image === '' || image === 'Light';
  }

  onOff(category, type) {
    this.add(
      'binary',
      this.name,
      { category, type, min: 0, max: 1 },
      {
        read: (r) => {
          const on = switchIsOn(r);
          return on === undefined ? null : { state: on };
        },
        write: (value) => [
          { param: 'switchlight', params: { switchcmd: Number(value) > 0 ? 'On' : 'Off' } },
        ],
      },
    );
  }

  dimmer(category, type) {
    this.add(
      'brightness',
      this.label('brightness'),
      { category, type, min: 0, max: 100 },
      {
        read: (r) => {
          const n = leadingNumber(r.Level);
          return n === undefined ? null : { state: clamp(n, 0, 100) };
        },
        write: (value) => [
          {
            param: 'switchlight',
            params: {
              switchcmd: 'Set Level',
              level: clamp(Math.round(Number(value) || 0), 0, 100),
            },
          },
        ],
      },
    );
  }

  colorBulb() {
    const subType = String(this.r.SubType ?? '');
    this.onOff(C.LIGHT, T.LIGHT.BINARY);
    if (this.r.HaveDimmer !== false) {
      this.dimmer(C.LIGHT, T.LIGHT.BRIGHTNESS);
    }
    if (/RGB/i.test(subType)) {
      this.add(
        'color',
        this.label('color'),
        { category: C.LIGHT, type: T.LIGHT.COLOR, min: 0, max: 0xffffff },
        {
          read: (r) => {
            const color = parseColor(r.Color);
            // m: 1 white, 2 colour temperature, 3 RGB, 4 custom (RGB + white).
            if (!color || (color.m !== 3 && color.m !== 4)) {
              return null;
            }
            return { state: colorToInt(color.r, color.g, color.b) };
          },
          write: (value, r) => {
            const level = leadingNumber(r?.Level);
            return [
              {
                param: 'setcolbrightnessvalue',
                params: {
                  hex: intToHex(value),
                  brightness: level > 0 ? Math.round(level) : 100,
                  iswhite: 'false',
                },
              },
            ];
          },
        },
      );
    }
    if (/WW|CW/i.test(subType)) {
      this.add(
        'color-temperature',
        this.label('colorTemperature'),
        { category: C.LIGHT, type: T.LIGHT.TEMPERATURE, min: MIREDS.min, max: MIREDS.max },
        {
          read: (r) => {
            const color = parseColor(r.Color);
            if (!color || color.m !== 2 || !Number.isFinite(Number(color.t))) {
              return null;
            }
            return { state: tToMireds(Number(color.t)) };
          },
          write: (value) => [
            {
              param: 'setkelvinlevel',
              params: { kelvin: miredsToKelvinLevel(Number(value) || MIREDS.min) },
            },
          ],
        },
      );
    }
  }

  /** Shutters: open / close / stop, and the position of the percentage ones. */
  cover({ position, stop = true }) {
    const stateOf = (r) => {
      const status = statusOf(r);
      if (/^open/i.test(status)) {
        return COVER_STATE.OPEN;
      }
      if (/^closed?/i.test(status)) {
        return COVER_STATE.CLOSE;
      }
      if (/^set level/i.test(status)) {
        const level = leadingNumber(r.Level);
        if (level === 0) {
          return COVER_STATE.CLOSE;
        }
        return level === 100 ? COVER_STATE.OPEN : COVER_STATE.STOP;
      }
      return /^stop/i.test(status) ? COVER_STATE.STOP : null;
    };
    this.add(
      'state',
      this.name,
      { category: C.SHUTTER, type: T.SHUTTER.STATE, min: -1, max: 1 },
      {
        read: (r) => {
          const state = stateOf(r);
          return state === null ? null : { state };
        },
        write: (value) => {
          const wanted = Number(value);
          if (wanted === COVER_STATE.STOP && !stop) {
            throw new Error(`${this.name} cannot be stopped`);
          }
          const switchcmd =
            wanted === COVER_STATE.OPEN ? 'Open' : wanted === COVER_STATE.CLOSE ? 'Close' : 'Stop';
          return [{ param: 'switchlight', params: { switchcmd } }];
        },
      },
    );
    if (position) {
      this.add(
        'position',
        this.label('position'),
        { category: C.SHUTTER, type: T.SHUTTER.POSITION, min: 0, max: 100, unit: U.PERCENT },
        {
          read: (r) => {
            const status = statusOf(r);
            if (/^open/i.test(status)) {
              return { state: 100 };
            }
            if (/^closed?$/i.test(status)) {
              return { state: 0 };
            }
            const level = leadingNumber(r.Level);
            return level === undefined ? null : { state: clamp(level, 0, 100) };
          },
          write: (value) => [
            {
              param: 'switchlight',
              params: {
                switchcmd: 'Set Level',
                level: clamp(Math.round(Number(value) || 0), 0, 100),
              },
            },
          ],
        },
      );
    }
  }

  selector() {
    const names = decodeLevelNames(this.r.LevelNames);
    const options = [];
    names.forEach((label, i) => {
      if (i === 0 && this.r.LevelOffHidden === true) {
        return;
      }
      if (options.length < LIMITS.options) {
        options.push({ value: String(i * 10), label: cut(label.trim() || String(i * 10), 100) });
      }
    });
    if (options.length === 0) {
      return;
    }
    this.add(
      'selector',
      this.name,
      {
        category: C.TEXT,
        type: T.TEXT.SELECT,
        min: 0,
        max: 0,
        supported_options: options.map((o, i) => ({ ...o, sort_order: i })),
      },
      {
        text: true,
        read: (r) => {
          const level = /\boff\b/i.test(statusOf(r)) ? 0 : leadingNumber(r.Level);
          if (level === undefined) {
            return null;
          }
          const option = options.find((o) => o.value === String(level));
          return option ? { text: option.value } : null;
        },
        write: (value) => {
          const option = options.find(
            (o) => o.value === String(value).trim() || o.label === String(value).trim(),
          );
          if (!option) {
            throw new Error(`${value} is not a level of ${this.name}`);
          }
          return [
            {
              param: 'switchlight',
              params: { switchcmd: 'Set Level', level: Number(option.value) },
            },
          ];
        },
      },
    );
  }

  lock(inverted) {
    this.add(
      'binary',
      this.name,
      { category: C.LOCK, type: T.LOCK.BINARY, min: 0, max: 1 },
      {
        read: (r) => {
          const status = statusOf(r);
          if (/^locked$/i.test(status)) {
            return { state: 1 };
          }
          return /^unlocked$/i.test(status) ? { state: 0 } : null;
        },
        // A Door Lock locks with On; a Door Lock Inverted with Off.
        write: (value) => {
          const lock = Number(value) > 0;
          return [
            { param: 'switchlight', params: { switchcmd: lock !== inverted ? 'On' : 'Off' } },
          ];
        },
      },
    );
  }

  binarySensor(key, spec, isOn) {
    this.add(key, this.name, spec, {
      read: (r) => {
        const value = isOn(r);
        return value === undefined ? null : { state: value };
      },
    });
  }

  /** A press of a push button or a doorbell: an event at every update. */
  press(category, type) {
    this.add(
      'button',
      this.name,
      { category, type, min: 0, max: 1 },
      { read: () => ({ state: BUTTON_STATUS.CLICK }), event: true },
    );
  }

  switches() {
    const r = this.r;
    const kind = Number(r.SwitchTypeVal);
    const light = this.isLight();
    switch (kind) {
      case SWITCH.DIMMER:
        if (r.Type === 'Color Switch') {
          this.colorBulb();
        } else if (light) {
          this.onOff(C.LIGHT, T.LIGHT.BINARY);
          this.dimmer(C.LIGHT, T.LIGHT.BRIGHTNESS);
        } else {
          this.onOff(C.SWITCH, T.SWITCH.BINARY);
          this.dimmer(C.SWITCH, T.SWITCH.DIMMER);
        }
        return;
      case SWITCH.BLINDS:
      case SWITCH.BLINDS_INVERTED:
      case SWITCH.BLINDS_STOP:
      case SWITCH.VENETIAN_US:
      case SWITCH.VENETIAN_EU:
        this.cover({
          position: false,
          stop: kind !== SWITCH.BLINDS && kind !== SWITCH.BLINDS_INVERTED,
        });
        return;
      case SWITCH.BLINDS_PERCENT:
      case SWITCH.BLINDS_PERCENT_INVERTED:
      case SWITCH.BLINDS_PERCENT_STOP:
        this.cover({ position: true, stop: kind === SWITCH.BLINDS_PERCENT_STOP });
        return;
      case SWITCH.CONTACT:
      case SWITCH.DOOR_CONTACT:
        // Domoticz: Open / Closed. Gladys: OPEN 0, CLOSE 1.
        this.binarySensor('opening', binarySpec(C.OPENING_SENSOR), (d) => {
          const status = statusOf(d);
          if (/^open/i.test(status)) {
            return OPENING_SENSOR_STATE.OPEN;
          }
          return /^closed?$/i.test(status) ? OPENING_SENSOR_STATE.CLOSE : undefined;
        });
        return;
      case SWITCH.MOTION:
        this.binarySensor('motion', binarySpec(C.MOTION_SENSOR), (d) => switchIsOn(d));
        return;
      case SWITCH.SMOKE:
        this.binarySensor('smoke', binarySpec(C.SMOKE_SENSOR), (d) => {
          const status = statusOf(d) || String(d.Data ?? '');
          if (SMOKE_CLEAR.test(status)) {
            return 0;
          }
          return SMOKE_WORDS.test(status) ? 1 : undefined;
        });
        return;
      case SWITCH.DUSK:
        this.binarySensor('dusk', binarySpec(C.UNKNOWN, T.UNKNOWN.UNKNOWN), (d) => switchIsOn(d));
        return;
      case SWITCH.PUSH_ON:
      case SWITCH.PUSH_OFF:
        this.press(C.BUTTON, T.BUTTON.CLICK);
        return;
      case SWITCH.DOORBELL:
        this.press(C.DOORBELL, T.DOORBELL.RING);
        return;
      case SWITCH.SIREN:
        this.onOff(C.SIREN, T.SIREN.BINARY);
        return;
      case SWITCH.SELECTOR:
        this.selector();
        return;
      case SWITCH.DOOR_LOCK:
        this.lock(false);
        return;
      case SWITCH.DOOR_LOCK_INVERTED:
        this.lock(true);
        return;
      case SWITCH.MEDIA:
        // Media players (Kodi, Chromecast…): milestone 2.
        return;
      default:
        if (r.Type === 'Color Switch') {
          this.colorBulb();
        } else if (light) {
          this.onOff(C.LIGHT, T.LIGHT.BINARY);
        } else {
          this.onOff(C.SWITCH, T.SWITCH.BINARY);
        }
    }
  }

  /** Security devices (alarm panels, KD101 smoke detectors…). */
  security() {
    if (Number(this.r.SwitchTypeVal) === SWITCH.SMOKE) {
      this.switches();
      return;
    }
    this.text('status', this.name, (r) => r.Status ?? r.Data);
  }

  // --- Thermostats --------------------------------------------------------------------

  setpoint() {
    const unit = unitOf(String(this.r.vunit ?? 'C').replace('°', '')) ?? this.tempUnit;
    const temperature = unit === U.CELSIUS || unit === U.FAHRENHEIT;
    let min = leadingNumber(this.r.min);
    let max = leadingNumber(this.r.max);
    // Domoticz defaults to -200…200: useless as a slider.
    if (!temperature || min === undefined || max === undefined || min <= -100 || max >= 100) {
      [min, max] = unit === U.FAHRENHEIT ? [41, 86] : [5, 30];
    }
    if (!temperature) {
      this.measure(
        'setpoint',
        this.name,
        decimal(C.UNKNOWN, -1e9, 1e9, unit, T.UNKNOWN.UNKNOWN),
        (r) => r.SetPoint ?? r.Data,
      );
      return;
    }
    this.add(
      'setpoint',
      this.name,
      { category: C.THERMOSTAT, type: T.THERMOSTAT.TARGET_TEMPERATURE, min, max, unit },
      {
        read: (r) => {
          const n = leadingNumber(r.SetPoint ?? r.Data);
          return n === undefined ? null : { state: n };
        },
        write: (value) => {
          const n = Number(value);
          if (!Number.isFinite(n)) {
            throw new Error(`${value} is not a temperature`);
          }
          return [{ param: 'setsetpoint', params: { setpoint: n } }];
        },
      },
    );
  }

  // --- Measurements ---------------------------------------------------------------------

  /** The weather fields, whatever the device type (Temp + Humidity + Baro, Wind, UV…). */
  weather() {
    const r = this.r;
    const t = this.tempUnit;
    if (typeof r.Temp === 'number') {
      this.measure(
        'temperature',
        this.mainOr('temperature'),
        decimal(
          C.TEMPERATURE_SENSOR,
          t === U.FAHRENHEIT ? -150 : -100,
          t === U.FAHRENHEIT ? 300 : 150,
          t,
        ),
        (d) => d.Temp,
      );
    }
    if (typeof r.Humidity === 'number') {
      this.measure(
        'humidity',
        this.mainOr('humidity'),
        decimal(C.HUMIDITY_SENSOR, 0, 100, U.PERCENT),
        (d) => d.Humidity,
      );
    }
    if (typeof r.Barometer === 'number') {
      this.measure(
        'pressure',
        this.mainOr('pressure'),
        decimal(C.PRESSURE_SENSOR, 0, 2000, U.HECTO_PASCAL),
        (d) => d.Barometer,
      );
    }
    if (r.RainRate !== undefined) {
      this.measure(
        'rain-rate',
        this.label('rainRate'),
        decimal(C.PRECIPITATION_SENSOR, 0, 10_000, U.MILLIMETER_PER_HOUR),
        (d) => d.RainRate,
      );
    }
    if (r.Rain !== undefined) {
      this.measure(
        'rain-today',
        this.label('rainToday'),
        decimal(C.PRECIPITATION_SENSOR, 0, 100_000, U.MILLIMETER_PER_DAY),
        (d) => d.Rain,
      );
    }
    if (r.Speed !== undefined || r.Gust !== undefined) {
      const wind = WIND_UNITS[String(this.ctx.windSign ?? 'm/s')];
      const spec = wind
        ? decimal(C.SPEED_SENSOR, 0, 1000, wind.unit)
        : decimal(C.UNKNOWN, 0, 1000, undefined, T.UNKNOWN.UNKNOWN);
      const factor = wind?.factor ?? 1;
      const speed = (field) => (d) => {
        const n = leadingNumber(d[field]);
        return n === undefined ? undefined : Math.round(n * factor * 100) / 100;
      };
      if (r.Speed !== undefined) {
        this.measure('wind-speed', this.label('windSpeed'), spec, speed('Speed'));
      }
      if (r.Gust !== undefined) {
        this.measure('wind-gust', this.label('windGust'), spec, speed('Gust'));
      }
    }
    if (typeof r.Direction === 'number') {
      this.measure(
        'wind-direction',
        this.label('windDirection'),
        decimal(C.ANGLE_SENSOR, 0, 360, U.DEGREE),
        (d) => d.Direction,
      );
    }
    if (r.UVI !== undefined) {
      this.measure(
        'uv',
        this.mainOr('uv'),
        { category: C.UV_SENSOR, type: T.UV_SENSOR.INTEGER, min: 0, max: 20, unit: U.UV_INDEX },
        (d) => d.UVI,
      );
    }
    if (typeof r.Radiation === 'number') {
      this.measure(
        'radiation',
        this.mainOr('radiation'),
        decimal(C.UNKNOWN, 0, 10_000, undefined, T.UNKNOWN.UNKNOWN),
        (d) => d.Radiation,
      );
    }
  }

  /** The device name for a device that only measures this, else "name – measure". */
  mainOr(labelKey) {
    const r = this.r;
    const measures = ['Temp', 'Humidity', 'Barometer', 'UVI', 'Radiation'].filter(
      (f) => r[f] !== undefined && r[f] !== null,
    );
    const wind = r.Speed !== undefined || r.Rain !== undefined;
    return measures.length === 1 && !wind ? this.name : this.label(labelKey);
  }

  /** Power (W) and energy index (kWh) of an electricity meter. */
  electricity({
    production = false,
    power = (d) => d.Usage,
    energy = (d) => d.Counter ?? d.Data,
  } = {}) {
    const category = production ? C.ENERGY_PRODUCTION_SENSOR : C.ENERGY_SENSOR;
    const types = production ? T.ENERGY_PRODUCTION_SENSOR : T.ENERGY_SENSOR;
    if (power(this.r) !== undefined) {
      this.measure(
        'power',
        this.label('power'),
        { category, type: types.POWER, min: production ? 0 : -1e9, max: 1e9, unit: U.WATT },
        power,
      );
    }
    if (energy(this.r) !== undefined) {
      const unit = unitOf(unitText(energy(this.r))) === U.WATT_HOUR ? U.WATT_HOUR : U.KILOWATT_HOUR;
      this.measure(
        'energy',
        this.label('energy'),
        { category, type: types.INDEX, min: 0, max: 1e12, unit },
        energy,
      );
    }
  }

  /** Counters: what they count follows their meter type. */
  meter() {
    const r = this.r;
    const kind = Number(r.SwitchTypeVal);
    const counter = (d) => d.Counter ?? d.Data;
    const unit = unitOf(unitText(counter(r)) ?? r.ValueUnits);
    if (kind === METER.ENERGY || kind === METER.ENERGY_GENERATED) {
      this.electricity({ production: kind === METER.ENERGY_GENERATED, energy: counter });
      return;
    }
    if (kind === METER.GAS || kind === METER.WATER) {
      this.measure(
        'volume',
        this.name,
        decimal(C.VOLUME_SENSOR, 0, 1e12, unit === U.LITER ? U.LITER : U.CUBIC_METER),
        counter,
      );
      return;
    }
    this.measure(
      'value',
      this.name,
      decimal(C.UNKNOWN, -1e12, 1e12, unit, T.UNKNOWN.UNKNOWN),
      counter,
    );
  }

  general() {
    const r = this.r;
    const data = (d) => d.Data;
    const unit = unitOf(unitText(r.Data));
    switch (r.SubType) {
      case 'kWh':
        this.electricity({
          production: Number(r.SwitchTypeVal) === METER.ENERGY_GENERATED,
          energy: data,
        });
        return;
      case 'Voltage':
        this.measure(
          'voltage',
          this.name,
          decimal(C.ENERGY_SENSOR, 0, 100_000, U.VOLT, T.ENERGY_SENSOR.VOLTAGE),
          data,
        );
        return;
      case 'Current':
        this.measure(
          'current',
          this.name,
          decimal(C.ENERGY_SENSOR, 0, 100_000, U.AMPERE, T.ENERGY_SENSOR.CURRENT),
          data,
        );
        return;
      case 'Percentage':
        this.measure(
          'value',
          this.name,
          decimal(C.UNKNOWN, 0, 100, U.PERCENT, T.UNKNOWN.UNKNOWN),
          data,
        );
        return;
      case 'Pressure':
        this.measure(
          'pressure',
          this.name,
          decimal(C.PRESSURE_SENSOR, 0, 10_000, unit ?? U.BAR),
          data,
        );
        return;
      case 'Sound Level':
        this.measure('noise', this.name, decimal(C.NOISE_SENSOR, 0, 200, U.DECIBEL), data);
        return;
      case 'Distance':
      case 'Visibility':
        this.measure('distance', this.name, decimal(C.DISTANCE_SENSOR, 0, 1e9, unit ?? U.CM), data);
        return;
      case 'Counter Incremental':
      case 'Managed Counter':
        this.meter();
        return;
      case 'Alert':
        this.text('text', this.name);
        return;
      case 'Text':
        this.text('text', this.name);
        return;
      case 'Barometer':
      case 'Solar Radiation':
        return; // the weather fields
      default:
        this.fallback();
    }
  }

  /** Whatever Domoticz shows: a number (with its unit when Gladys knows it) or a text. */
  fallback() {
    const data = this.r.Data;
    if (data === undefined || data === null || String(data).trim() === '') {
      return;
    }
    if (leadingNumber(data) !== undefined && !/[;|]/.test(String(data))) {
      this.measure(
        'value',
        this.name,
        decimal(C.UNKNOWN, -1e12, 1e12, unitOf(unitText(data)), T.UNKNOWN.UNKNOWN),
        (d) => d.Data,
      );
    } else {
      this.text('text', this.name);
    }
  }

  measurements() {
    const r = this.r;
    switch (r.Type) {
      case 'Lux':
        this.measure('lux', this.name, decimal(C.LIGHT_SENSOR, 0, 200_000, U.LUX), (d) => d.Data);
        return;
      case 'Air Quality':
        this.measure('co2', this.name, decimal(C.CO2_SENSOR, 0, 100_000, U.PPM), (d) => d.Data);
        return;
      case 'Usage':
        this.electricity({ power: (d) => d.Data, energy: () => undefined });
        return;
      case 'P1 Smart Meter':
        if (r.SubType === 'Gas') {
          this.meter();
          return;
        }
        this.electricity();
        this.measure(
          'export-power',
          this.label('exportPower'),
          {
            category: C.GRID_SENSOR,
            type: T.GRID_SENSOR.OUTPUT_POWER,
            min: 0,
            max: 1e9,
            unit: U.WATT,
          },
          (d) => d.UsageDeliv,
        );
        this.measure(
          'export-energy',
          this.label('exportEnergy'),
          {
            category: C.GRID_SENSOR,
            type: T.GRID_SENSOR.OUTPUT_INDEX,
            min: 0,
            max: 1e12,
            unit: U.KILOWATT_HOUR,
          },
          (d) => d.CounterDeliv,
        );
        return;
      case 'RFXMeter':
      case 'YouLess Meter':
        this.meter();
        return;
      case 'Current':
      case 'Current/Energy': {
        const phases = numbersOf(r.Data).length;
        for (let i = 0; i < Math.max(1, Math.min(3, phases)); i += 1) {
          this.measure(
            `current-l${i + 1}`,
            `${this.label('current')} L${i + 1}`,
            decimal(C.ENERGY_SENSOR, 0, 100_000, U.AMPERE, T.ENERGY_SENSOR.CURRENT),
            (d) => numbersOf(d.Data)[i],
          );
        }
        return;
      }
      case 'General':
        this.general();
        return;
      default:
        if (!this.features.length) {
          this.fallback();
        }
    }
  }

  battery() {
    const level = leadingNumber(this.r.BatteryLevel);
    if (level === undefined || level < 0 || level > 100) {
      return; // 255: not on battery
    }
    this.measure(
      'battery',
      this.label('battery'),
      { category: C.BATTERY, type: T.BATTERY.INTEGER, min: 0, max: 100, unit: U.PERCENT },
      (d) => {
        const n = leadingNumber(d.BatteryLevel);
        return n !== undefined && n >= 0 && n <= 100 ? n : undefined;
      },
    );
  }

  map() {
    const r = this.r;
    if (r.SwitchType === 'Security') {
      this.security();
    } else if (typeof r.SwitchType === 'string' && r.SwitchType !== '') {
      this.switches();
    } else if (r.SetPoint !== undefined && /setpoint|thermostat/i.test(`${r.Type} ${r.SubType}`)) {
      this.setpoint();
    } else {
      this.weather();
      this.measurements();
    }
    if (this.features.length > 0) {
      this.battery();
    }
    return {
      features: this.features,
      readers: this.readers,
      writers: this.writers,
      throttled: this.throttled,
    };
  }
}

/** Scenes and groups are not devices (milestone 2). */
export const isScene = (record) => record?.Type === 'Scene' || record?.Type === 'Group';

/**
 * One Domoticz device -> features, readers, writers.
 * @param {object} record one device of the getdevices answer
 * @param {{ tempSign?: string, windSign?: string, language?: string }} ctx the Domoticz settings (getconfig)
 */
export function mapDevice(record, ctx = {}) {
  return new DeviceMapper(record, ctx).map();
}
