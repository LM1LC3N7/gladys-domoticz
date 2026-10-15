// -----------------------------------------------------------------------------
// The Domoticz inventory: the getdevices and getplans answers -> the devices
// to offer, each with its room (pure).
//
// A room is a Domoticz plan (Setup → More Options → Room plan). A device can
// be in several plans: the first one in the plan order names it.
// -----------------------------------------------------------------------------

import { isScene } from './mapping.js';

/** Domoticz answers a missing list as no `result` at all: always a list. */
export const asList = (result) => {
  if (Array.isArray(result)) {
    return result;
  }
  return result && typeof result === 'object' ? Object.values(result) : [];
};

/**
 * @param {{ devices: object, plans?: object }} answers the JSON answers of
 *   getdevices (filter=all, used=true) and getplans
 * @returns {{ devices: Array<{ idx: string, name: string, room?: string, record: object }>, skipped: { scenes: number, unused: number }, plans: number, actTime?: number }}
 */
export function buildInventory({ devices, plans }) {
  const planList = asList(plans?.result)
    .map((p) => ({
      idx: String(p.idx),
      name: String(p.Name ?? '').trim(),
      order: Number(p.Order),
    }))
    .filter((p) => p.name !== '' && p.name !== '$Hidden Devices')
    .sort(
      (a, b) =>
        (Number.isFinite(a.order) ? a.order : 1e9) - (Number.isFinite(b.order) ? b.order : 1e9),
    );
  const rank = new Map(planList.map((p, i) => [p.idx, i]));
  const skipped = { scenes: 0, unused: 0 };
  const list = [];
  for (const record of asList(devices?.result)) {
    if (!record || record.idx === undefined) {
      continue;
    }
    if (isScene(record)) {
      skipped.scenes += 1;
      continue;
    }
    if (record.Used === 0 || record.Used === false) {
      skipped.unused += 1;
      continue;
    }
    const roomIds = asList(record.PlanIDs)
      .map(String)
      .filter((id) => rank.has(id))
      .sort((a, b) => rank.get(a) - rank.get(b));
    list.push({
      idx: String(record.idx),
      name: String(record.Name ?? '').trim() || `Domoticz ${record.idx}`,
      room: roomIds.length > 0 ? planList[rank.get(roomIds[0])].name : undefined,
      record,
    });
  }
  const actTime = Number(devices?.ActTime);
  return {
    devices: list,
    skipped,
    plans: planList.length,
    actTime: Number.isFinite(actTime) ? actTime : undefined,
  };
}
