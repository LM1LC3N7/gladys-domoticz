// -----------------------------------------------------------------------------
// The integration: one Domoticz server, its devices turned into Gladys
// devices, the change loop feeding the states, and the commands sent back.
// index.js only wires the SDK handlers to it.
//
// Lifecycle: start -> open (version, settings, inventory) -> poll every
// `poll_interval` seconds for the devices updated since the last answer
// (getdevices&lastupdate) -> on a failure, reconnect with a growing delay (the
// reconnection reads the whole inventory again: the values missed meanwhile
// come back with it). The inventory is also read again every 10 minutes, and
// when an unknown or renamed device shows up in the changes.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { TIMINGS } from './constants.js';
import { buildModel, emptyModel } from './devices.js';
import { DomoticzError, createClient } from './domoticz.js';
import { T } from './i18n.js';
import { asList, buildInventory } from './inventory.js';
import { isScene } from './mapping.js';
import { StatePublisher } from './publisher.js';

export class DomoticzApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'domoticz' }),
    connect = createClient,
    now = Date.now,
    timers = globalThis,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.connect = connect;
    this.now = now;
    this.timers = timers;
    this.config = normalizeConfig();
    this.client = null;
    this.model = emptyModel();
    this.inventory = undefined;
    /** idx -> name of the devices of the inventory (offered or not) */
    this.known = new Map();
    /** idx -> last record read */
    this.records = new Map();
    this.version = undefined;
    /** getconfig: units and language of the Domoticz interface */
    this.settings = {};
    this.online = false;
    /** getdevices cursor: the ActTime of the last answer (Domoticz clock) */
    this.since = undefined;
    /** feature id -> last value read, sent when the user creates the device */
    this.lastValues = new Map();
    this.created = new Set();
    /** device id -> last badge published (JSON) */
    this.transports = new Map();
    this.timer = undefined;
    this.inventoryTimer = undefined;
    this.polling = false;
    this.readingInventory = false;
    this.failures = 0;
    this.generation = 0;
    this.lastStatus = undefined;
    this.publishedDevices = undefined;
    this.warned = new Set();
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    const generation = this.generation;
    this.config = normalizeConfig(raw);
    this.refreshCreated();
    if (this.config.error) {
      await this.setStatus(false, T.configError(this.config.error));
      return;
    }
    this.client = this.newClient();
    this.publisher.configure({
      intervalSeconds: this.config.sensorInterval,
      throttled: this.model.throttled,
    });
    this.publisher.start();
    await this.setStatus(false, T.connecting);
    await this.open(generation);
  }

  stop() {
    this.generation += 1;
    this.timers.clearTimeout(this.timer);
    this.timers.clearTimeout(this.inventoryTimer);
    this.timer = undefined;
    this.inventoryTimer = undefined;
    this.publisher.stop();
    this.client?.close?.();
    this.client = null;
    this.online = false;
    this.polling = false;
    this.failures = 0;
    this.since = undefined;
  }

  newClient() {
    return this.connect({
      url: this.config.url,
      auth: this.config.auth,
      verifyCertificate: this.config.verifyCertificate,
    });
  }

  current(generation) {
    return generation === this.generation;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  warnOnce(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.logger.warn(message);
    }
  }

  /** Runs `fn` after `ms`, unless the app was restarted or stopped meanwhile. */
  schedule(generation, ms, fn) {
    this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      if (this.current(generation)) {
        fn().catch((err) => this.logger.error(`Domoticz loop: ${err.message}`));
      }
    }, ms);
  }

  /** The version (it also proves the sign-in) and the units of the Domoticz interface. */
  async readServer(client, timeout = TIMINGS.requestTimeout) {
    const about = await client.call('getversion', {}, { timeout });
    if (!about.version) {
      // Domoticz answers getversion to anyone, but without the version.
      throw new DomoticzError('auth', 'not signed in');
    }
    const config = await client.call('getconfig', {}, { timeout }).catch((err) => {
      this.warnOnce('getconfig', `Reading the Domoticz settings failed: ${err.message}`);
      return {};
    });
    return {
      version: String(about.version),
      settings: {
        tempSign: config.TempSign,
        windSign: config.WindSign,
        language: config.language,
      },
    };
  }

  /** Connects: the version, the settings, the inventory. */
  async open(generation) {
    const client = this.client;
    try {
      const { version, settings } = await this.readServer(client);
      if (!this.current(generation)) {
        return;
      }
      this.settings = settings;
      await this.loadInventory(generation, { initial: true });
      if (!this.current(generation)) {
        return;
      }
      this.version = version;
      this.online = true;
      this.failures = 0;
      this.logger.info(
        `Connected to Domoticz ${version} at ${this.config.origin} (${client.mode ?? this.config.auth.kind})`,
      );
      await this.setStatus(true, T.connected(version, this.model.devices.length));
      await this.publishAllTransports();
      this.schedule(generation, this.config.pollInterval * 1000, () => this.poll(generation));
      this.scheduleInventory(generation, TIMINGS.inventoryRefresh);
    } catch (err) {
      await this.fail(generation, err);
    }
  }

  async fail(generation, err) {
    if (!this.current(generation)) {
      return;
    }
    this.online = false;
    this.polling = false;
    this.failures += 1;
    const slow = ['auth', 'twofactor', 'forbidden'].includes(err?.kind);
    const delay = slow
      ? TIMINGS.authRetry
      : Math.min(TIMINGS.retryMax, TIMINGS.retryMin * 2 ** (this.failures - 1));
    if (err instanceof DomoticzError) {
      this.logger.warn(`Domoticz: ${err.message} (retrying in ${Math.round(delay / 1000)} s)`);
    } else {
      this.logger.error('Domoticz: unexpected failure', err);
    }
    await this.setStatus(false, T.failure(err, this.config.auth.kind));
    await this.publishAllTransports();
    this.timers.clearTimeout(this.inventoryTimer);
    this.schedule(generation, delay, () => this.open(generation));
  }

  // --- Changes -------------------------------------------------------------------

  async poll(generation) {
    const client = this.client;
    this.polling = true;
    try {
      const params = { filter: 'all', used: 'true' };
      if (this.since !== undefined) {
        params.lastupdate = this.since;
      }
      const answer = await client.call('getdevices', params);
      if (!this.current(generation)) {
        return;
      }
      this.applyChanges(generation, answer);
    } catch (err) {
      await this.fail(generation, err);
      return;
    } finally {
      if (this.current(generation)) {
        this.polling = false;
      }
    }
    this.schedule(generation, this.config.pollInterval * 1000, () => this.poll(generation));
  }

  /** The devices updated since the cursor (the ones of its second come back: harmless). */
  applyChanges(generation, answer) {
    const actTime = Number(answer?.ActTime);
    if (Number.isFinite(actTime)) {
      this.since = actTime;
    }
    let reload = false;
    for (const record of asList(answer?.result)) {
      if (!record || record.idx === undefined || isScene(record)) {
        continue;
      }
      const idx = String(record.idx);
      const name = this.known.get(idx);
      const fresh = String(record.Name ?? '').trim();
      if (name === undefined || (fresh !== '' && fresh !== name)) {
        reload = true; // a new device, or one renamed in Domoticz
      }
      this.applyRecord(record);
    }
    // A read already under way includes it: one read is enough.
    if (reload && !this.readingInventory) {
      this.scheduleInventory(generation, TIMINGS.inventoryDebounce);
    }
  }

  /**
   * One device record: its values to the features, its presses as events,
   * its badge. `initial`: read at the connection (a press seen then may be
   * old news from an outage: not sent).
   */
  applyRecord(record, { initial = false } = {}) {
    const idx = String(record.idx);
    const previous = this.records.get(idx);
    const updated = previous !== undefined && previous.LastUpdate !== record.LastUpdate;
    this.records.set(idx, record);
    for (const { featureId, read, event } of this.model.readers.get(idx) ?? []) {
      if (event && (initial || !updated)) {
        continue;
      }
      let value;
      try {
        value = read(record);
      } catch (err) {
        this.warnOnce(`read:${featureId}`, `${featureId}: ${err.message}`);
        continue;
      }
      if (!value) {
        continue;
      }
      if (event) {
        if (this.created.has(featureId)) {
          this.publisher.pushEvent(featureId, value);
        }
      } else {
        this.record(featureId, value);
      }
    }
    const deviceId = this.deviceIdOf(idx);
    if (deviceId && !initial) {
      this.publishTransport(deviceId).catch((err) =>
        this.logger.warn(`Transport badge failed: ${err.message}`),
      );
    }
  }

  /** Keeps the value, and sends it when the device exists in Gladys. */
  record(featureId, value) {
    this.lastValues.set(featureId, value);
    if (this.created.has(featureId)) {
      this.publisher.push(featureId, value);
    }
  }

  /** After a command: read the changes soon, not at the next tick. */
  pollSoon() {
    const generation = this.generation;
    if (!this.online || this.polling) {
      return;
    }
    this.schedule(generation, TIMINGS.commandEcho, () => this.poll(generation));
  }

  // --- Inventory -----------------------------------------------------------------

  idsOf(idx) {
    return this.gladys.externalIds('domoticz', idx);
  }

  deviceIdOf(idx) {
    const ids = this.idsOf(idx);
    return this.model.deviceIdx.has(ids.device) ? ids.device : undefined;
  }

  async readInventory(client, timeout = TIMINGS.inventoryTimeout) {
    const devices = await client.call('getdevices', { filter: 'all', used: 'true' }, { timeout });
    const plans = await client
      .call('getplans', { order: 'name', used: 'true' }, { timeout })
      .catch((err) => {
        this.warnOnce('getplans', `Reading the Domoticz room plans failed: ${err.message}`);
        return {};
      });
    return buildInventory({ devices, plans });
  }

  /**
   * Reads the devices and the rooms; publishes the devices and the values.
   * `initial`: at the connection, the change cursor starts from this read.
   */
  async loadInventory(generation, { force = false, initial = false } = {}) {
    let inventory;
    this.readingInventory = true;
    try {
      inventory = await this.readInventory(this.client);
    } finally {
      this.readingInventory = false;
    }
    if (!this.current(generation)) {
      return;
    }
    const model = buildModel((idx) => this.idsOf(idx), inventory, this.settings);
    this.inventory = inventory;
    this.model = model;
    this.known = new Map(inventory.devices.map((dev) => [dev.idx, dev.name]));
    if (initial || this.since === undefined) {
      this.since = inventory.actTime;
    }
    this.publisher.configure({
      intervalSeconds: this.config.sensorInterval,
      throttled: model.throttled,
    });
    for (const dev of inventory.devices) {
      this.applyRecord(dev.record, { initial });
    }
    const json = JSON.stringify(model.devices);
    if (force || json !== this.publishedDevices) {
      try {
        await this.gladys.publishDiscoveredDevices(model.devices);
        this.publishedDevices = json;
        this.logger.info(
          `${model.devices.length} devices offered in Discovery (${inventory.devices.length} used Domoticz devices)`,
        );
      } catch (err) {
        this.logger.error(`Publishing the discovered devices failed: ${err.message}`);
      }
    }
  }

  scheduleInventory(generation, ms) {
    this.timers.clearTimeout(this.inventoryTimer);
    this.inventoryTimer = this.timers.setTimeout(() => {
      this.inventoryTimer = undefined;
      if (!this.current(generation) || !this.online) {
        return; // the reconnection reads it anyway
      }
      this.loadInventory(generation)
        .then(async () => {
          if (this.current(generation) && this.online) {
            await this.setStatus(true, T.connected(this.version, this.model.devices.length));
            await this.publishAllTransports();
          }
        })
        .catch((err) => this.logger.warn(`Reading the Domoticz devices failed: ${err.message}`))
        .finally(() => {
          if (this.current(generation) && !this.inventoryTimer) {
            this.scheduleInventory(generation, TIMINGS.inventoryRefresh);
          }
        });
    }, ms);
  }

  /** The Scan button of the Discovery tab. */
  async rescan() {
    if (!this.online || !this.client) {
      await this.gladys.publishDiscoveredDevices(this.model.devices);
      return;
    }
    await this.loadInventory(this.generation, { force: true });
  }

  // --- Transport badges ----------------------------------------------------------

  /** The badge of a device: Domoticz reachable, its hardware enabled, its sensor alive. */
  transportOf(deviceId) {
    if (!this.online) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    const record = this.records.get(this.model.deviceIdx.get(deviceId));
    if (record?.HardwareDisabled === true) {
      // The SDK shows a message only with `degraded`: unreachable, and why.
      return {
        transport: DEVICE_TRANSPORTS.UNREACHABLE,
        degraded: true,
        message: T.badge.hardwareDisabled,
      };
    }
    if (record?.HaveTimeout === true) {
      return { transport: DEVICE_TRANSPORTS.LOCAL, degraded: true, message: T.badge.timeout };
    }
    return { transport: DEVICE_TRANSPORTS.LOCAL };
  }

  async publishTransport(deviceId) {
    if (!this.createdDevices().has(deviceId)) {
      return;
    }
    const badge = this.transportOf(deviceId);
    const key = JSON.stringify(badge);
    if (this.transports.get(deviceId) === key) {
      return;
    }
    this.transports.set(deviceId, key);
    await this.gladys.publishTransports([{ external_id: deviceId, ...badge }]);
  }

  async publishAllTransports() {
    const entries = [];
    for (const deviceId of this.createdDevices()) {
      const badge = this.transportOf(deviceId);
      const key = JSON.stringify(badge);
      if (this.transports.get(deviceId) !== key) {
        this.transports.set(deviceId, key);
        entries.push({ external_id: deviceId, ...badge });
      }
    }
    for (let i = 0; i < entries.length; i += 100) {
      await this.gladys
        .publishTransports(entries.slice(i, i + 100))
        .catch((err) => this.logger.warn(`Transport badges failed: ${err.message}`));
    }
  }

  // --- Devices created by the user -------------------------------------------------

  createdDevices() {
    return new Set((this.gladys.devices ?? []).map((d) => d.external_id));
  }

  refreshCreated() {
    this.created = new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  async deviceCreated(device) {
    this.refreshCreated();
    this.transports.delete(device?.external_id);
    for (const f of device?.features ?? []) {
      const value = this.lastValues.get(f.external_id);
      if (value) {
        this.publisher.push(f.external_id, value);
      }
    }
    if (device?.external_id) {
      await this.publishTransport(device.external_id).catch(() => {});
    }
  }

  async deviceDeleted(device) {
    this.refreshCreated();
    if (device?.external_id) {
      this.transports.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
  }

  // --- Commands ------------------------------------------------------------------

  async setValue(device, feature, value) {
    const client = this.client;
    if (!client || !this.online) {
      throw new Error('Domoticz is not connected');
    }
    const writer = this.model.writers.get(feature.external_id);
    const idx = this.model.owners.get(feature.external_id);
    if (!writer || idx === undefined) {
      throw new Error(`${feature.name ?? feature.external_id} cannot be controlled`);
    }
    const record = this.records.get(idx);
    if (record?.Protected === true) {
      throw new Error(
        `${record.Name} is protected by a code in Domoticz: remove the protection to control it from Gladys`,
      );
    }
    const calls = writer.write(value, record);
    for (const { param, params } of calls) {
      await client.call(param, { idx, ...params });
    }
    this.logger.debug(`${calls.length} Domoticz command(s) sent for ${feature.external_id}`);
    this.pollSoon();
  }

  // --- Configuration screen button ---------------------------------------------------

  /** Reads the version and the inventory with the saved configuration, and counts. */
  async testConnection() {
    const config = this.config;
    if (config.error) {
      return T.configError(config.error);
    }
    const client = this.newClient();
    try {
      const { version, settings } = await this.readServer(client, TIMINGS.testTimeout);
      const inventory = await this.readInventory(client, TIMINGS.testTimeout);
      const model = buildModel((idx) => this.idsOf(idx), inventory, settings);
      return T.test.ok({
        version,
        devices: model.devices.length,
        total: inventory.devices.length,
        scenes: inventory.skipped.scenes,
        empty: model.counts.empty,
        rooms: inventory.plans,
        auth: client.mode ?? config.auth.kind,
      });
    } catch (err) {
      if (!(err instanceof DomoticzError)) {
        this.logger.error('Connection test failed', err);
      }
      return T.failure(err, config.auth.kind);
    } finally {
      client.close?.();
    }
  }
}
