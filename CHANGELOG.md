# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Changed

- README: the store install note replaces the work-in-progress notice, and the
  Releasing section no longer says the store topic is still to be added.

## [0.1.1] - 2026-10-16

### Added

- Connection to a Domoticz server (2023.2 or later) through its JSON API, over
  http or https (TLS verification can be turned off for a self-signed
  certificate), signed in with an access token, a user and password, or as a
  trusted network.
- Every used Domoticz device offered in Discovery, one Gladys device per
  Domoticz device, named after its room plan.
- Lights, dimmers and colour bulbs (colour, colour temperature), switches,
  shutters (open, close, stop, position), selectors as lists, locks, sirens,
  setpoints, push buttons and doorbells (every press an event), door, motion,
  smoke and dusk sensors, temperature, humidity, pressure, rain, wind, UV, lux,
  air quality, noise, distance, power, energy, P1 smart meters with the export,
  gas, water and energy counters, currents, voltages, texts, battery levels.
- The states follow Domoticz within seconds; the values missed while Domoticz
  was unreachable come back at the reconnection.
- Gladys commands sent to Domoticz, the new state read back at once.
- Transport badges: unreachable when Domoticz is or when the hardware of the
  device is disabled, degraded when Domoticz flags a sensor as timed out.
- "Test the connection" button: Domoticz version, how Gladys signed in, devices
  and rooms.

[Unreleased]: https://github.com/LM1LC3N7/gladys-domoticz/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-domoticz/releases/tag/v0.1.1
