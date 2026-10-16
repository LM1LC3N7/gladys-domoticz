# gladys-domoticz

[Gladys Assistant](https://gladysassistant.com) external integration bridging a
**Domoticz** server: every used Domoticz device becomes a Gladys device of the
Discovery tab, its states follow Domoticz within seconds, and Gladys controls
it through Domoticz. Made for Domoticz users who move to Gladys at their own
pace, or run both side by side. Unofficial, not affiliated with Domoticz.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **In the Gladys store.** Install it from **Integrations**, or with **Install
> from GitHub** and `https://github.com/LM1LC3N7/gladys-domoticz`. First
> version, tested against the official Domoticz Docker image (Domoticz 2026.4)
> with virtual devices of every kind, not yet on many real installations.
> Feedback and bug reports are welcome in the
> [GitHub issues](https://github.com/LM1LC3N7/gladys-domoticz/issues).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (DomoticzApp) ⇄ src/domoticz.js ⇄ Domoticz JSON API
                                   ├─ src/inventory.js  devices + room plans -> device list (pure)
                                   ├─ src/mapping.js    one device -> features, readers, writers (pure)
                                   ├─ src/devices.js    devices -> Gladys devices + routing tables (pure)
                                   └─ src/publisher.js  states within 300/min, sensor throttling, presses
```

All calls are `GET <base>/json.htm?type=command&param=…` (the syntax of
Domoticz 2023.2 and later):

- **Signing in**: an access token (`Authorization: Bearer`, Domoticz 2026.2+),
  else a user name and password (HTTP Basic, which Domoticz takes over https;
  over http it falls back to the `logincheck` session of the web interface and
  keeps its cookie), else nothing for a Gladys machine in the trusted networks.
- **Inventory**: `getdevices&filter=all&used=true` and `getplans` (rooms). Read
  at connection, every 10 minutes, on Scan, and when an unknown device shows up
  in the changes.
- **Changes**: `getdevices&lastupdate=<ActTime of the last answer>` every
  `poll_interval` seconds (3 by default): only the devices updated since. The
  ones of the cursor second come back (harmless: unchanged values are not sent
  again, presses are told apart by their `LastUpdate`).
- **Commands**: `switchlight`, `setcolbrightnessvalue`, `setkelvinlevel`,
  `setsetpoint`, then the changes are read right away.
- **Mapping**: by `Type`, `SubType` and `SwitchTypeVal` for the switches, by the
  value fields (`Temp`, `Humidity`, `Barometer`, `Usage`, `Counter`…) for the
  sensors; the Gladys core enums on the other side (a door contact is 0 = open
  in Gladys). One device per Domoticz device: external ids
  `ext:<selector>:domoticz:<idx>` and `…:<role>`.
- **Failures**: Domoticz unreachable → status message and `unreachable`
  transport badges, reconnection after 5 s, doubling up to 60 s (refused
  credentials: every 5 minutes). The reconnection reads the inventory again.
  A sensor Domoticz flags as timed out gets a degraded badge.

## Reused work

No maintained JavaScript client of the Domoticz API exists: the npm packages
(`domoticz-api`, `domoticz-js`, `domoticz-api-linker`…) are abandoned since
2015–2022, and `homebridge-edomoticz`, the only active project, is a Homebridge
plugin under GPL-3.0, not a library. The API being small, the client is our
own (~300 lines). It follows the
[Domoticz JSON API documentation](https://wiki.domoticz.com/Domoticz_API/JSON_URL%27s)
and the Domoticz sources (GPL-3.0, read as documentation only, nothing copied):
the switch and meter type tables, the `lastupdate` filter, the sign-in rules.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/domoticz-2026.4/` holds the answers of a real Domoticz 2026.4
(official Docker image, one virtual device of each kind);
`test/fixtures/domoticz.js` adds a few records a virtual install cannot make,
and `test/helpers/fakeDomoticz.js` serves them with a clock for `lastupdate`.
The app tests run the real SDK wiring against the SDK's fake Gladys.

The integration was also run against the official `domoticz/domoticz` Docker
image (Domoticz 2026.4, 47 virtual devices of every kind): inventory, values,
changes, two presses of a push button, every command read back, rename at the
Scan, access token, user and password (session over http, Basic over https),
self-signed certificate, wrong token, wrong password, no credentials,
unreachable port.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic lists the repository in the Gladys store.

## License

Apache-2.0. Domoticz is a trademark of its owners; this project is not
affiliated with Domoticz.
