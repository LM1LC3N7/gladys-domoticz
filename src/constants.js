// -----------------------------------------------------------------------------
// Keys shared with the manifest (frozen: users store them in their
// configuration) and the tuning of the integration.
// -----------------------------------------------------------------------------

/** Manifest `actions` keys. */
export const ACTIONS = {
  TEST: 'test_connection',
};

/** Pace of the Domoticz change loop (seconds), mirrored by the manifest. */
export const POLL_INTERVAL = { min: 1, max: 60, default: 3 };

/** Sensor throttling bounds (seconds), mirrored by the manifest. */
export const SENSOR_INTERVAL = { min: 0, max: 300, default: 10 };

/** The JSON API of Domoticz, under its base address. */
export const API_PATH = '/json.htm';

export const LIMITS = {
  /** Gladys accepts 300 states per minute: keep a margin for the other paths. */
  statesPerMinute: 250,
  /** Size of a Domoticz answer read (bytes): the device list of a big install is a few MB. */
  responseBytes: 32 * 1024 * 1024,
  /** Text states sent to Gladys. */
  text: 1000,
  /** Levels of a selector switch. */
  options: 50,
  /** Devices published at once (publishDiscoveredDevices). */
  devices: 2000,
};

export const TIMINGS = {
  /** The pending states are sent at this pace. */
  flushInterval: 1000,
  /** An unchanged value is re-sent this often, so it stays recently dated in Gladys. */
  stateHeartbeat: 30 * 60_000,
  /** One request (the device list of the inventory gets `inventoryTimeout`). */
  requestTimeout: 15_000,
  inventoryTimeout: 60_000,
  /** One inventory request of the connection test (the button waits 90 s). */
  testTimeout: 25_000,
  /** The inventory is read again this often: renamed devices, new rooms. */
  inventoryRefresh: 10 * 60_000,
  /** A new device showed up in the changes: wait for the burst to end. */
  inventoryDebounce: 3000,
  /** After a Gladys command, the changes are read this soon (not at the next tick). */
  commandEcho: 400,
  /** Reconnection delays after a failure (doubled each time, up to the max). */
  retryMin: 5000,
  retryMax: 60_000,
  /** Refused credentials are retried slowly: the user has to change them. */
  authRetry: 5 * 60_000,
};
