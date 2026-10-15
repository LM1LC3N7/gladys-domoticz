# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15), its only
runtime dependency. It reads the devices of the user's Domoticz through its
JSON API, turns every used device into a Gladys device, follows the Domoticz
changes and sends the Gladys commands back. Unofficial, not affiliated with
Domoticz.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/mapping.test.js          # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js            SDK bootstrap only
src/handlers.js     every SDK handler -> the app (shared with the tests)
src/app.js          DomoticzApp: connection, change loop, inventory reloads,
                    states, presses, commands, transports, connection test
src/domoticz.js     the only network access: GET json.htm, sign-in (token,
                    Basic, logincheck session), error kinds
src/inventory.js    getdevices + getplans -> devices with their room (pure)
src/mapping.js      one device record -> features, readers, writers (pure)
src/devices.js      devices -> Gladys devices + routing tables (pure)
src/publisher.js    states within the Gladys rate limit, presses apart
src/config.js       config_schema normalized (base address, sign-in)
src/constants.js    manifest keys, limits, timings
src/i18n.js         runtime texts (en/fr)
test/fixtures/      answers of a real Domoticz 2026.4 (+ a few made records)
test/helpers/       a fake Domoticz; Gladys is the SDK's fake
```

## Rules

- **External ids are forever**: device = `domoticz:<idx>`, feature =
  `<role>` (`binary`, `brightness`, `color`, `color-temperature`, `state`,
  `position`, `selector`, `setpoint`, `button`, `opening`, `motion`, `smoke`,
  `dusk`, `temperature`, `humidity`, `pressure`, `rain-rate`, `rain-today`,
  `wind-speed`, `wind-gust`, `wind-direction`, `uv`, `radiation`, `power`,
  `energy`, `export-power`, `export-energy`, `volume`, `voltage`, `current`,
  `current-l1..3`, `lux`, `co2`, `noise`, `distance`, `value`, `text`,
  `status`, `battery`). Never change how they are built.
- The manifest keys (`test_connection`, the config keys) are frozen: users store them.
- Value conventions: the Domoticz side is what its web interface shows (Status
  texts, `Level` in %, `Color` JSON with `t` 0 = coldest); the Gladys side the
  enums of `server/utils/constants.js` (copied in `src/mapping.js`, the SDK does
  not export them). They differ (door contacts, covers, colour temperature in
  mireds): convert in the readers and writers.
- Button presses go through `publisher.pushEvent` (publishStates): never
  through `publishChangedStates`, which would drop a second identical press.
  A press is a change of `LastUpdate`, never read at the connection.
- Never send a unit Gladys does not know (`unitOf` returns undefined): the
  whole device list would be refused.
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable, bridge network (unicast to the LAN only).
- Gladys rate limits: 300 states/min, 300 scene events/min.
- Never log or put in a status message the token, the password or a URL of
  `logincheck` (it carries the credentials): errors never quote URLs.
- Tests never touch the network (`test/domoticz.test.js` uses a loopback server
  for the transport). The real HTTP path is checked against the official
  Domoticz Docker image: `~/gladys-integrations/e2e/domoticz-e2e.sh up|run|down`.
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
