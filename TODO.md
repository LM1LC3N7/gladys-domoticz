# TODO — Domoticz bridge v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, then update README, `docs/en.md`, `docs/fr.md`,
  `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).
- No forum topic of its own, ever, and no forum post from a module session:
  the batch claimed in /t/10385 (post #178) gets one recap message there, with
  a link to each repo, once the ten are published.

## Status

- [x] **Milestone 1 — core** (2026-10-15): JSON API client with the three ways
      of signing in (access token, user and password with the session
      fallback, trusted network), inventory (`getdevices`, room plans), mapping
      of the switch types, colour bulbs, covers, selectors, locks, setpoints,
      weather fields, energy/P1/gas/water meters and the other General
      subtypes, one device per Domoticz device, change loop
      (`getdevices&lastupdate`), push buttons and doorbells as events, commands
      (`switchlight`, `setcolbrightnessvalue`, `setkelvinlevel`,
      `setsetpoint`), transport badges (unreachable, hardware disabled, sensor
      timeout as degraded), connection test, reconnection, manifest, docs
      en/fr. 68 tests; run against the official `domoticz/domoticz` image
      (Domoticz 2026.4, 47 virtual devices): 57 checks green.
- [ ] **Milestone 2 — real installs**: collect `getdevices` answers from testers
      (Z-Wave JS, Zigbee2MQTT, RFXCOM, P1, Evohome, Tado, Shelly, Tuya…
      hardware) as fixtures; fix what differs (Status texts of the protocol
      switches, Security panels and their sensors, MaxDimLevel other than 100,
      counters with a divider, US units).
- [ ] **Milestone 3 — more types**: scenes and groups (a scene action
      "run a Domoticz scene", groups as switches through `switchscene`),
      media players (`Media Player` on/off, status as text), thermostat modes
      (`Thermostat Mode` / `Fan Mode` General subtypes as lists), Evohome zones
      and hot water, user variables (a scene action to set one), the
      `Protected` devices with a passcode field.
- [ ] **Milestone 4 — first release**: cover image, Docker image build check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic (the forum recap is the main session's, see Working method).

## Decisions

- **Own client, no dependency**: no maintained JavaScript client of the
  Domoticz API exists (npm `domoticz-api` 2015, `domoticz-js` 2015,
  `domoticz-api-linker` 2022, `mydomoathome` a GPL gateway with ~20
  dependencies); `homebridge-edomoticz` (active, GPL-3.0) is a Homebridge
  plugin, not a library. The API is a handful of GET commands: ~300 lines,
  written from the Domoticz wiki and sources (read as documentation, nothing
  copied).
- **The 2023.2+ syntax only** (`type=command&param=getdevices`): the older
  `type=devices` one is gone from current versions; supporting it is not worth
  the code. Documented as the minimum version.
- **Signing in**: Domoticz requires a user since its setup wizard. An access
  token (2026.2+) is the first choice: Bearer works over http. With a user,
  Basic is tried first (Domoticz accepts it over https only, unless "Allow
  Basic-Auth over plain HTTP" is set), and a 401 switches to the `logincheck`
  session of the web interface (user in base64, MD5 of the password, cookie
  `DMZSID`), signed in again when it expires. `getversion` answers anyone with
  HTTP 200, only without the version: for a user that answer counts as the 401. Users with two-factor authentication cannot sign in (`require2fa`): the
  status says to take a token.
- **Changes by `getdevices&lastupdate=<ActTime of the last answer>`**: Domoticz
  returns the devices whose `LastUpdate` is at or after it, so the devices of
  the cursor second come back once more; unchanged values are dropped by
  `publishChangedStates`, presses are told apart by `LastUpdate` (an event only
  when it changed). Two presses within one second are one: `LastUpdate` has a
  one-second resolution. A rename does not touch `LastUpdate`: renames show up
  at the inventory read (every 10 minutes, Scan). An inventory read already
  under way is not doubled by the polls that see the new device too.
- **Presses at the connection are not sent**: a `LastUpdate` change seen by the
  first read after an outage may be old.
- **Values in the units of the Domoticz interface**: `Temp` follows
  `TempSign` (C/F) and `Speed`/`Gust` follow `WindSign` (m/s, km/h kept; mph
  and knots converted to km/h; Beaufort as a unitless value), read from
  `getconfig` at each connection. The secondary feature names use its
  `language` (fr, else en).
- **Light or switch**: an On/Off or dimmer switch is a light while it keeps the
  default "Light" icon, a switch with any other icon (the users pick
  WallSocket, Fan, Heating…). Colour switches are always lights.
- **Colour temperature**: Domoticz `t` 0 (coldest) … 255 (warmest) maps
  linearly to 153 … 500 mireds; written with `setkelvinlevel` (the same ratio
  in %). Colours are written with `setcolbrightnessvalue&hex=…` at the current
  brightness.
- **Covers**: Domoticz already reverses the position of the
  "ReversePosition" blinds in its answers and commands: the values are used
  as they are. A partial position reads as state 0 (stopped).
- **Badges**: `HardwareDisabled` → unreachable (degraded, with the reason: the
  SDK shows a message only with `degraded`); `HaveTimeout` → local, degraded.
- **Setpoints** whose bounds are the -200…200 defaults get 5…30 °C
  (41…86 °F); a setpoint in another unit is a read-only value.
- **Selectors**: the option values are the levels (`"0"`, `"10"`…), stable when
  a level is renamed; the labels are the level names (base64 since 2023,
  plain before), level 0 hidden when `LevelOffHidden`.
- **Fresh Domoticz quirk** (e2e only): after the setup wizard creates the
  admin, the https server only knows it after a restart; `domoticz-e2e.sh up`
  restarts the container.
