// Pure fit logic – no DOM, so it can be unit-tested with Node.
// All values in mm. Status order: fail > warn > unknown > info > ok.

export const RANK = { ok: 0, info: 1, unknown: 2, warn: 3, fail: 4 };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const mm = (v) => `${Math.round(v * 10) / 10} mm`;

/**
 * @param {object} p  cupW, cupD, cupH, gapH, openW, robotDia, robotH,
 *                    dockW, dockD, dockH, heightMargin, sideClear, frontClear,
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
    else if (c < p.heightMargin) add('height', 'Robot under door', 'warn', `Only ${mm(c)} clearance – less than your ${mm(p.heightMargin)} margin.`);
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
    else if (needed > p.cupW) add('dockW', 'Dock width', 'warn', `Dock fits, but not with ${mm(p.sideClear)} each side (${mm(p.cupW - p.dockW)} total spare).`);
    else add('dockW', 'Dock width', 'ok', `${mm(p.cupW - p.dockW)} spare across the cupboard.`);
  } else add('dockW', 'Dock width', 'unknown', 'Dock width unknown.');

  // 4. Dock height vs internal height
  if (isNum(p.dockH)) {
    const c = p.cupH - p.dockH;
    if (c < 0) add('dockH', 'Dock height', 'fail', `Dock is ${mm(-c)} taller than the space.`);
    else if (c < 40) add('dockH', 'Dock height', 'warn', `Only ${mm(c)} above the dock – may be tight for lifting the lid or tanks out.`);
    else add('dockH', 'Dock height', 'ok', `${mm(c)} above the dock.`);
  } else add('dockH', 'Dock height', 'unknown', 'Dock height unknown – check the manual.');

  // 5. Depth: dock + parked robot vs internal depth
  let parkedDepth = null;
  if (isNum(p.dockD)) {
    parkedDepth = p.dockD + (p.robotOnDock ? 0 : (p.robotDia || 0));
    const over = parkedDepth - p.cupD;
    if (p.dockD > p.cupD) add('depth', 'Depth when parked', 'fail', `Dock alone is ${mm(p.dockD - p.cupD)} deeper than the cupboard.`);
    else if (over > 0) {
      const robotFitsUnder = isNum(p.robotH) && p.robotH <= p.gapH;
      add('depth', 'Depth when parked', robotFitsUnder ? 'warn' : 'fail',
        robotFitsUnder
          ? `Parked robot pokes out under the door by ${mm(over)}.`
          : `Parked robot sticks out ${mm(over)} and is too tall to sit under the door.`);
    } else add('depth', 'Depth when parked', 'ok', `${mm(-over)} spare between the parked robot and the door.`);
  } else add('depth', 'Depth when parked', 'unknown', 'Dock depth unknown.');

  // 6. Front clearance (informational)
  if (isNum(parkedDepth) && p.frontClear > 0) {
    const insideRun = Math.max(0, p.cupD - (p.dockD ?? 0));
    const outside = Math.max(0, p.frontClear - insideRun);
    add('front', 'Front approach', 'info',
      outside > 0
        ? `Needs ${mm(p.frontClear)} clear floor in front of the dock – ${mm(outside)} of it outside the cupboard.`
        : `The ${mm(p.frontClear)} approach fits inside the cupboard.`);
  }

  // 'info' checks never change the verdict
  const overall = checks.reduce((w, c) => {
    const st = c.status === 'info' ? 'ok' : c.status;
    return RANK[st] > RANK[w] ? st : w;
  }, 'ok');
  return { checks, overall, geometry: { parkedDepth } };
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
    robotOnDock: m.robotOnDock,
  };
}
