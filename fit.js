// Pure fit logic – no DOM, so it can be unit-tested with Node.
// All values in mm. Status order: fail > warn > unknown > info > ok.

export const RANK = { ok: 0, info: 1, unknown: 2, warn: 3, fail: 4 };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const mm = (v) => `${Math.round(v * 10) / 10} mm`;

/**
 * @param {object} p  cupW, cupD, cupH, gapH, openW, robotDia, robotH,
 *                    dockW, dockD, dockH, dockTowerD (optional), heightMargin, sideClear,
 *                    robotOnDock (bool)
 * @returns {{checks: Array<{id,label,status,detail}>, overall: string, geometry: object}}
 */
export function evaluate(p) {
  const checks = [];
  const add = (id, label, status, detail) => checks.push({ id, label, status, detail });

  // 1. Robot height vs the gap under the door
  if (isNum(p.robotH)) {
    const c = p.gapH - p.robotH;
    if (c < 0) add('height', 'Robot under door', 'fail', `Robot is ${mm(-c)} too tall for the ${mm(p.gapH)} gap.`);
    else if (c < p.heightMargin) add('height', 'Robot under door', 'warn', `Only ${mm(c)} between robot and door – less than ${mm(p.heightMargin)}.`);
    else add('height', 'Robot under door', 'ok', `${mm(c)} clearance under the door.`);
  } else add('height', 'Robot under door', 'unknown', 'Robot height unknown.');

  // 2. Robot diameter vs opening width
  if (isNum(p.robotDia)) {
    const c = p.openW - p.robotDia;
    if (c < 0) add('width', 'Robot through opening', 'fail', `Robot is ${mm(-c)} wider than the opening.`);
    else if (c < 40) add('width', 'Robot through opening', 'warn', `Only ${mm(c)} spare across the opening – it has to drive in dead straight.`);
    else add('width', 'Robot through opening', 'ok', `${mm(c)} spare across the opening.`);
  } else add('width', 'Robot through opening', 'unknown', 'Robot diameter unknown.');

  // 3. Dock width (+ side clearance) vs cupboard width
  if (isNum(p.dockW)) {
    const needed = p.dockW + 2 * p.sideClear;
    if (p.dockW > p.cupW) add('dockW', 'Dock width', 'fail', `Dock is ${mm(p.dockW - p.cupW)} wider than the cupboard.`);
    else if (needed > p.cupW) add('dockW', 'Dock width', 'warn', `Dock fits, but only ${mm((p.cupW - p.dockW) / 2)} each side (less than ${mm(p.sideClear)}).`);
    else add('dockW', 'Dock width', 'ok', `${mm((p.cupW - p.dockW) / 2)} each side of the dock.`);
  } else add('dockW', 'Dock width', 'unknown', 'Dock width unknown.');

  // 4. Dock height vs internal height
  if (isNum(p.dockH)) {
    const c = p.cupH - p.dockH;
    if (c < 0) add('dockH', 'Dock height', 'fail', `Dock is ${mm(-c)} taller than the space.`);
    else if (c < 40) add('dockH', 'Dock height', 'warn', `Only ${mm(c)} above the dock – may be tight for lifting the lid or tanks out.`);
    else add('dockH', 'Dock height', 'ok', `${mm(c)} above the dock.`);
  } else add('dockH', 'Dock height', 'unknown', 'Dock height unknown – check the manual.');

  // 5. Depth: dock tower must fit inside; a low ramp and the parked robot may poke out under the door
  let parkedDepth = null;
  if (isNum(p.dockD)) {
    const towerKnown = isNum(p.dockTowerD);
    const tower = towerKnown ? Math.min(p.dockTowerD, p.dockD) : p.dockD;
    parkedDepth = p.dockD + (p.robotOnDock ? 0 : (p.robotDia || 0));
    const over = parkedDepth - p.cupD;
    const robotFitsUnder = isNum(p.robotH) && p.robotH <= p.gapH;
    if (tower > p.cupD) {
      add('depth', 'Depth when parked', 'fail', towerKnown
        ? `Dock tower is ${mm(tower - p.cupD)} deeper than the cupboard.`
        : `Dock is ${mm(p.dockD - p.cupD)} deeper than the cupboard. If part of that is a low ramp, enter the tower depth – the ramp can sit under the door.`);
    } else if (over > 0) {
      const what = p.dockD > p.cupD ? 'Ramp and parked robot poke' : 'Parked robot pokes';
      add('depth', 'Depth when parked', robotFitsUnder ? 'ok' : 'fail', robotFitsUnder
        ? `${what} out under the door by ${mm(over)} – fine, it sits under the door.`
        : `Parked robot sticks out ${mm(over)} and is too tall to sit under the door.`);
    } else add('depth', 'Depth when parked', 'ok', `${mm(-over)} spare between the parked robot and the door.`);
  } else add('depth', 'Depth when parked', 'unknown', 'Dock depth unknown.');

  // 'info' checks never change the verdict
  const overall = checks.reduce((w, c) => {
    const st = c.status === 'info' ? 'ok' : c.status;
    return RANK[st] > RANK[w] ? st : w;
  }, 'ok');
  const spaces = {
    aboveDock: isNum(p.dockH) ? p.cupH - p.dockH : null,
    dockSides: isNum(p.dockW) ? (p.cupW - p.dockW) / 2 : null,
    aboveRobot: isNum(p.robotH) ? p.gapH - p.robotH : null,
    toDoor: isNum(parkedDepth) ? p.cupD - parkedDepth : null,
    opening: isNum(p.robotDia) ? p.openW - p.robotDia : null,
  };
  return { checks, overall, geometry: { parkedDepth }, spaces };
}

/** Merge cupboard/clearance params with a model's dimensions. */
export function paramsForModel(base, m) {
  return {
    ...base,
    robotDia: m.robot.diameter,
    robotH: m.robot.height,
    dockW: m.dock.width,
    dockD: m.dock.depth,
    dockH: m.dock.height,
    dockTowerD: m.dock.towerDepth ?? null,
    robotOnDock: m.robotOnDock,
  };
}
