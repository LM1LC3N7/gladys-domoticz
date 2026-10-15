// -----------------------------------------------------------------------------
// The Domoticz JSON API (json.htm): the only network access.
//
// One GET per call: <base>/json.htm?type=command&param=<name>&… Domoticz
// answers a JSON object whose `status` is "OK", or "ERR"/"ERROR" with an
// optional `message`; HTTP 401 when the caller is not signed in.
//
// Signing in (recent Domoticz versions require a user):
//   - an access token: "Authorization: Bearer <token>", over http or https;
//   - a user name and password: HTTP Basic, which Domoticz accepts over https
//     (and over http only when "Allow Basic-Auth over plain HTTP" is set);
//     on a 401 the client signs in like the web interface does (logincheck,
//     user name in base64 and password as an MD5) and keeps the session
//     cookie, signing in again when the session expires;
//   - nothing: the Gladys machine is in the trusted networks of Domoticz.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { API_PATH, LIMITS, TIMINGS } from './constants.js';

export class DomoticzError extends Error {
  /**
   * @param {'auth'|'twofactor'|'forbidden'|'api'|'network'|'certificate'|'timeout'|'http'|'redirect'|'format'|'size'} kind
   */
  constructor(kind, message, { status } = {}) {
    super(message);
    this.name = 'DomoticzError';
    this.kind = kind;
    this.status = status;
  }
}

const NETWORK_REASONS = {
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  EHOSTUNREACH: 'host unreachable',
  ENETUNREACH: 'network unreachable',
  ENOTFOUND: 'unknown host name',
  EAI_AGAIN: 'host name not resolved',
  ETIMEDOUT: 'connection timed out',
  EPIPE: 'connection closed',
};

const CERTIFICATE_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** A socket error -> DomoticzError (never the URL: a login carries the credentials). */
export function networkError(err) {
  if (err instanceof DomoticzError) {
    return err;
  }
  if (CERTIFICATE_CODES.has(err?.code)) {
    return new DomoticzError('certificate', `certificate refused (${err.code})`);
  }
  const reason = NETWORK_REASONS[err?.code] ?? err?.code ?? 'network error';
  return new DomoticzError('network', reason);
}

/**
 * GETs a URL and resolves { status, location, cookies, body }.
 * @param {string} url
 * @param {{ headers?: object, timeout: number, verifyCertificate: boolean, agent?: http.Agent, maxBytes?: number }} options
 */
export function httpGet(url, { headers = {}, timeout, verifyCertificate, agent, maxBytes }) {
  const limit = maxBytes ?? LIMITS.responseBytes;
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === 'https:' ? https : http;
    let timer;
    let settled = false;
    /** The first outcome wins: a destroyed request may still end or fail after it. */
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
    };
    const req = lib.request(
      target,
      {
        method: 'GET',
        agent,
        headers: { Accept: 'application/json', ...headers },
        rejectUnauthorized: verifyCertificate,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > limit) {
            const mb = Math.max(1, Math.round(limit / 1048576));
            settle(reject, new DomoticzError('size', `answer larger than ${mb} MB`));
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          const setCookie = res.headers['set-cookie'];
          settle(resolve, {
            status: res.statusCode,
            location: res.headers.location,
            cookies: Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [],
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        res.on('error', (err) => settle(reject, networkError(err)));
      },
    );
    timer = setTimeout(() => {
      settle(
        reject,
        new DomoticzError('timeout', `no answer within ${Math.round(timeout / 1000)} s`),
      );
      req.destroy();
    }, timeout);
    req.on('error', (err) => settle(reject, networkError(err)));
    req.end();
  });
}

/** The JSON object of an answer, or the DomoticzError it carries. */
export function parseAnswer({ status, location, body }) {
  if (status >= 300 && status < 400) {
    let where = location ?? '';
    try {
      where = new URL(location).origin;
    } catch {
      // A relative location: keep it as is.
    }
    throw new DomoticzError('redirect', `redirected to ${where}`, { status });
  }
  if (status === 401) {
    throw new DomoticzError('auth', 'not signed in (HTTP 401)', { status });
  }
  if (status === 403) {
    throw new DomoticzError('forbidden', 'access refused (HTTP 403)', { status });
  }
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    json = undefined;
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw status === 200
      ? new DomoticzError('format', 'not a Domoticz API answer', { status })
      : new DomoticzError('http', `HTTP ${status}`, { status });
  }
  if (status !== 200) {
    throw new DomoticzError('http', `HTTP ${status}`, { status });
  }
  if (json.status === 'OK') {
    return json;
  }
  if (typeof json.status !== 'string') {
    throw new DomoticzError('format', 'not a Domoticz API answer', { status });
  }
  const what = String(json.message ?? json.statustext ?? '').slice(0, 300);
  const title = json.title ? String(json.title) : 'the request';
  throw new DomoticzError('api', what || `${title} refused`, { status });
}

/** The query string of a call, every value encoded (spaces as %20, as Domoticz expects). */
export function queryOf(param, params = {}) {
  const parts = [`type=command`, `param=${encodeURIComponent(param)}`];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.join('&');
}

const md5 = (text) => createHash('md5').update(text, 'utf8').digest('hex');

/**
 * getversion answers anyone, signed in or not: without the version when not.
 * For a client with a password, that answer is the 401 of the other commands.
 */
export function anonymousVersion(param, answer) {
  if (param !== 'getversion' || answer.status !== 200) {
    return false;
  }
  try {
    const json = JSON.parse(answer.body);
    return json?.status === 'OK' && json.version === undefined;
  } catch {
    return false;
  }
}

/** The session cookie (name=value) of a logincheck answer, if any. */
export function sessionCookie(cookies) {
  for (const line of cookies ?? []) {
    const pair = String(line).split(';')[0].trim();
    const [name, value] = pair.split('=');
    if (name && value && value !== 'none') {
      return pair;
    }
  }
  return undefined;
}

/**
 * A client of one Domoticz server.
 * @param {{ url: string, auth: { kind: 'token'|'password'|'none', token?: string, username?: string, password?: string }, verifyCertificate: boolean, get?: typeof httpGet }} options
 */
export function createClient({ url, auth, verifyCertificate, get = httpGet }) {
  const agent = new (url.startsWith('https:') ? https : http).Agent({
    keepAlive: true,
    maxSockets: 2,
  });
  /** 'basic' first for a password, 'session' once Domoticz refused Basic. */
  let mode = auth.kind === 'password' ? 'basic' : auth.kind;
  let cookie;
  let loggingIn;

  const send = (query, { timeout, headers = {} }) =>
    get(`${url}${API_PATH}?${query}`, { headers, timeout, verifyCertificate, agent });

  function headersOf() {
    if (mode === 'token') {
      return { Authorization: `Bearer ${auth.token}` };
    }
    if (mode === 'basic') {
      const basic = Buffer.from(`${auth.username}:${auth.password}`, 'utf8').toString('base64');
      return { Authorization: `Basic ${basic}` };
    }
    if (mode === 'session' && cookie) {
      return { Cookie: cookie };
    }
    return {};
  }

  /** Signs in like the web interface, keeps the session cookie. */
  async function login(timeout) {
    const query = queryOf('logincheck', {
      username: Buffer.from(auth.username, 'utf8').toString('base64'),
      password: md5(auth.password),
    });
    const answer = await send(query, { timeout });
    if (answer.status === 401 || answer.status === 403) {
      throw new DomoticzError('auth', 'user name or password refused', { status: answer.status });
    }
    const json = parseAnswer(answer);
    if (json.require2fa === true || json.require2fa === 'true') {
      throw new DomoticzError('twofactor', 'this user signs in with two-factor authentication');
    }
    const pair = sessionCookie(answer.cookies);
    if (!pair) {
      throw new DomoticzError('auth', 'Domoticz opened no session');
    }
    cookie = pair;
    mode = 'session';
  }

  function relogin(timeout) {
    if (!loggingIn) {
      loggingIn = login(timeout).finally(() => {
        loggingIn = undefined;
      });
    }
    return loggingIn;
  }

  return {
    /** How the client is signed in now (for the logs and the tests). */
    get mode() {
      return mode;
    },
    /**
     * One command of the API; resolves with its JSON answer.
     * @param {string} param e.g. 'getdevices', 'switchlight'
     */
    async call(param, params = {}, { timeout = TIMINGS.requestTimeout } = {}) {
      const query = queryOf(param, params);
      const answer = await send(query, { timeout, headers: headersOf() });
      if (auth.kind === 'password' && (answer.status === 401 || anonymousVersion(param, answer))) {
        // Basic refused over plain http, or the session expired: sign in, once.
        await relogin(timeout);
        return parseAnswer(await send(query, { timeout, headers: headersOf() }));
      }
      return parseAnswer(answer);
    },
    close() {
      agent.destroy();
    },
  };
}
