// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { POLL_INTERVAL, SENSOR_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  domoticz_url: '',
  access_token: '',
  username: '',
  password: '',
  verify_certificate: true,
  poll_interval: POLL_INTERVAL.default,
  sensor_interval: SENSOR_INTERVAL.default,
};

/**
 * The base address of Domoticz from what the user typed: "192.168.1.20:8080",
 * "http://domoticz.lan:8080/", "https://host/domoticz", or a page of its web
 * interface ("…/index.html", "…/json.htm").
 * @returns {{ url: string, origin: string } | { error: 'empty' | 'invalid' | 'credentials' }}
 */
export function parseDomoticzUrl(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    return { error: 'empty' };
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: 'invalid' };
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return { error: 'invalid' };
  }
  if (url.username || url.password) {
    // The credentials have their own fields (the password is a secret).
    return { error: 'credentials' };
  }
  const path = url.pathname.replace(/\/(json\.htm|index\.html?)$/i, '').replace(/\/+$/, '');
  return { url: `${url.origin}${path}`, origin: url.origin };
}

const bounded = (raw, { min, max, default: fallback }) => {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

/**
 * How the integration signs in, by order of preference: an access token
 * (recent Domoticz versions), a user name and password, or nothing when the
 * Gladys machine is in the trusted networks of Domoticz.
 */
function authOf(c) {
  const token = String(c.access_token ?? '').trim();
  if (token !== '') {
    return { kind: 'token', token };
  }
  const username = String(c.username ?? '').trim();
  const password = String(c.password ?? '');
  if (username !== '') {
    return { kind: 'password', username, password };
  }
  return { kind: 'none' };
}

export function normalizeConfig(raw = {}) {
  const given = Object.fromEntries(
    Object.entries(raw ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  );
  const c = { ...DEFAULTS, ...given };
  const target = parseDomoticzUrl(c.domoticz_url);
  const auth = authOf(c);
  let error = target.error;
  if (!error && auth.kind === 'password' && auth.password === '') {
    error = 'no-password';
  }
  return {
    url: target.url,
    origin: target.origin,
    error,
    auth,
    verifyCertificate: c.verify_certificate !== false,
    pollInterval: bounded(c.poll_interval, POLL_INTERVAL),
    sensorInterval: Math.round(bounded(c.sensor_interval, SENSOR_INTERVAL)),
  };
}
