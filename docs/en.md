# Domoticz bridge

This integration connects Gladys to **your Domoticz** and offers every Domoticz
device in the **Discovery** tab of Gladys: lights, switches, shutters, locks,
thermostats, sensors, meters. Once a device is added, its states follow
Domoticz within seconds, and Gladys controls it **through Domoticz**, which
keeps running with its hardware (Z-Wave, Zigbee, RFXCOM, P1, plugins…). Move to
Gladys at your own pace, room after room, or use both side by side.
Unofficial, not affiliated with Domoticz.

> **Development version (0.1).** Tested against the official Domoticz Docker
> image (Domoticz 2026.4) with virtual devices of every kind, not yet on many
> real installs. Your feedback is welcome on the GitHub repository.

## What you get

| Domoticz devices                                                                | In Gladys                                                      |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| On/Off switch, dimmer (a light, or a switch when you gave it another icon)      | on/off, brightness                                             |
| Colour switch (RGB, RGBW, RGBWW, white CW/WW)                                   | a light: on/off, brightness, colour, colour temperature        |
| Blinds, Blinds + Stop, Venetian blinds, Blinds percentage (+ Stop)              | a shutter: open, close, stop, position                         |
| Selector                                                                        | a list of its levels                                           |
| Door lock, door lock inverted                                                   | a lock                                                         |
| X10 siren                                                                       | a siren                                                        |
| Push On / Push Off button, doorbell                                             | a button (every press is an event for your scenes)             |
| Contact, door contact, motion sensor, smoke detector, dusk sensor               | opening, motion and smoke sensors                              |
| Setpoint (thermostat)                                                           | a thermostat setpoint                                          |
| Temp, Temp + Humidity (+ Baro), Humidity, Barometer, Rain, Wind, UV, Lux        | temperature, humidity, pressure, rain, wind, UV, light sensors |
| Usage, kWh, P1 smart meter (with the energy sent to the grid), current, voltage | power, energy index, grid export, current, voltage             |
| Gas, water and energy counters (counter incremental, managed counter, RFXMeter) | a volume (m³) or an energy index                               |
| Air quality, sound level, distance, pressure, percentage, custom sensor         | the sensor of the right category, or a value with its unit     |
| Text, alert, security panel                                                     | a text                                                         |
| Battery level of battery devices                                                | the battery level                                              |

Each **used** Domoticz device makes **one Gladys device**, named after the
device and its room plan ("Lamp (Living room)"); its idx, type and hardware are
kept in its parameters. The devices you did not mark as used, the scenes and
groups (for now) and the media players are left out.

The second features of a device are named in the language of the Domoticz
interface ("Weather station – humidity"), and the temperatures and wind speeds
follow its units (°C or °F, m/s or km/h; mph and knots are converted to km/h).

## Requirements

- Domoticz 2023.2 or later (the access tokens need 2026.2 or later).
- The Gladys machine reaches Domoticz on the local network (port 8080 for
  http, 443 for https by default).

## Installation

1. In Domoticz, create an **access token**: **Setup → More Options → Access
   Tokens**, with the "User" rights (to control the devices) and no expiry.
   Domoticz shows it once: copy it.
   - Older Domoticz: use a **user** instead (**Setup → Users**), with the
     "User" rights or more and without two-factor authentication.
2. In Gladys, open the integration, **Configuration**:
   - **Address of Domoticz**: the address you open Domoticz with, seen from the
     Gladys machine, port included: `http://192.168.1.20:8080` or
     `https://domoticz.lan`. Not `localhost`: the integration runs in its own
     container.
   - **Access token**: paste it. Or the **user name** and **password**.
3. Click **Test the connection**: the Domoticz version, how Gladys signed in,
   the number of devices and rooms, and the number of devices offered show up.
4. Open the **Discovery** tab and add the devices you want. Their values are
   sent as soon as they are added.

Leave the three credentials empty only if the address of the Gladys machine is
in the **trusted networks** of Domoticz (**Setup → Settings → Security**).

## Options

- **Verify the TLS certificate (https)**: on by default. Turn it off for the
  self-signed certificate of a default Domoticz install.
- **Interval between two reads of the Domoticz changes**: 3 seconds by default
  (1 to 60). Gladys asks Domoticz which devices changed since the last read.
- **Minimum interval between two readings of a sensor**: 10 seconds by default
  (0 to 300). A meter that reports every few seconds is sent to Gladys at this
  pace. Switches, lights, buttons, motion and opening sensors are never
  delayed.

## Good to know

- **Domoticz stays in charge of the hardware**: Gladys sends its commands to
  Domoticz, which drives the Z-Wave, Zigbee, RFXCOM… devices. Keep Domoticz
  running.
- **A new device** shows up in Discovery within seconds, at its first update.
  **A renamed device** (Domoticz does not mark a rename as an update) shows up
  within 10 minutes, at once with the **Scan** button of the Discovery tab.
- **Push buttons and doorbells**: every press reaches your scenes, even two
  presses of the same button in a row (Domoticz dates updates to the second:
  two presses within the same second count as one).
- **Transport badge**: a device turns "unreachable" when Domoticz is, or when
  its hardware is disabled in Domoticz; a sensor Domoticz flags as timed out
  (red in Domoticz) gets an orange dot.
- **Devices protected by a code** in Domoticz cannot be controlled from Gladys:
  remove the protection to do so.
- **Door contacts**: Domoticz says Open / Closed, Gladys 0 for open and 1 for
  closed; the integration converts.

## Troubleshooting

| Status message                                 | What to do                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Domoticz refused the access token              | Create a new one (Setup → More Options → Access Tokens) and paste it.                                                 |
| Domoticz refused the user name or the password | Check them in Setup → Users. A user with two-factor authentication cannot be used: take an access token.              |
| Domoticz asks Gladys to sign in                | Fill in an access token or a user, or add the Gladys machine to the trusted networks.                                 |
| Domoticz refused the access                    | The user or the token needs at least the "User" rights.                                                               |
| Domoticz is unreachable: connection refused    | Check the address and the port (8080 by default), seen from the Gladys machine, not `localhost`. Is Domoticz running? |
| certificate refused                            | A self-signed certificate: turn off "Verify the TLS certificate", or use `http://`.                                   |

The logs of the integration (Gladys, integration page) give the details.

## Privacy

Everything stays on your local network: the integration only talks to your
Domoticz. The access token and the password are stored as secrets by Gladys
and never written to the logs.
