// Stone to Sand — main thread.
// Any excavation that clears stone leaves sand behind. This does not set
// profileId, so another mod can still own the void gun's dig profile.

const BUFFER_KEY = "stoneToSand";
const RING = 8192;
const HEADER = 5;
const LENGTH = HEADER + RING;
const DEFAULT_SAND = 6;

const api = sandkit.api;
const NEIGHBORS = buildNeighbors(6);
const jobs = [];
let hooked = false;
let buffer;

function buildNeighbors(maxRadius) {
  const list = [];
  for (let r = 0; r <= maxRadius; r++) {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (Math.max(Math.abs(x), Math.abs(y)) === r) list.push([x, y]);
      }
    }
  }
  return list;
}

function clampAmount(value) {
  if (typeof value !== "number" || !isFinite(value)) return null;
  return Math.max(1, Math.min(16, Math.round(value)));
}

function readAmount() {
  try {
    const value = api.settings.get("sandPerStone");
    const direct = clampAmount(value);
    if (direct !== null) return direct;
    if (value && typeof value === "object") {
      const nested = clampAmount(value.sandPerStone);
      if (nested !== null) return nested;
    }
  } catch (error) {}
  if (buffer && buffer[2] > 0) return clampAmount(buffer[2]) || DEFAULT_SAND;
  return DEFAULT_SAND;
}

function readEnabled() {
  try {
    const value = api.settings.get("enabled");
    if (typeof value === "boolean") return value;
    if (value && typeof value.enabled === "boolean") return value.enabled;
  } catch (error) {}
  if (buffer && buffer[1] === 2) return false;
  return true;
}

function syncConfig() {
  buffer = getBuffer();
  if (!buffer) return;
  try {
    buffer[1] = readEnabled() ? 1 : 2;
    buffer[2] = readAmount();
  } catch (error) {}
}

function getBuffer() {
  if (buffer) return buffer;
  try {
    buffer = api.shared.buffers.ensure(BUFFER_KEY, { type: "int32", length: LENGTH });
  } catch (error) {
    try {
      buffer = api.shared.buffers.get(BUFFER_KEY);
    } catch (inner) {
      buffer = null;
    }
  }
  return buffer;
}

function claim(x, y) {
  const buf = getBuffer();
  if (!buf) return true;
  let token = ((((x & 0xffff) << 16) | (y & 0xffff)) ^ 0x5a5a5a5a) | 0;
  if (token === 0) token = 1;

  const finish = () => {
    for (let i = 0; i < RING; i++) {
      if ((buf[HEADER + i] | 0) === token) return false;
    }
    const head = buf[4] | 0;
    buf[HEADER + (head % RING)] = token;
    buf[4] = (head + 1) % RING;
    return true;
  };

  try {
    let spins = 0;
    while (Atomics.compareExchange(buf, 0, 0, 1) !== 0) {
      if (++spins > 10000) return finish();
    }
    try {
      return finish();
    } finally {
      Atomics.store(buf, 0, 0);
    }
  } catch (error) {
    return finish();
  }
}

function isStone(x, y) {
  try {
    return !!api.terrains.isTypeAtCell(x, y, "stone");
  } catch (error) {
    return false;
  }
}

function isSand(x, y) {
  try {
    return !!api.elements.isTypeAtCell(x, y, "sand");
  } catch (error) {
    return false;
  }
}

function isEmpty(x, y) {
  try {
    if (api.grid && api.grid.isCellEmptyAtCell) return !!api.grid.isCellEmptyAtCell(x, y);
  } catch (error) {}
  try {
    if (api.world && api.world.isCellEmptyAtCell) return !!api.world.isCellEmptyAtCell(x, y);
  } catch (error) {}
  return false;
}

function snapshot(args) {
  if (!args || !isFinite(args.originCellX) || !isFinite(args.originCellY)) return [];
  let diameter = 9;
  if (isFinite(args.patternDiameterCells) && args.patternDiameterCells >= 1) {
    diameter = Math.floor(args.patternDiameterCells);
  }
  if (diameter > 75) diameter = 75;
  const radius = Math.floor(diameter / 2);
  const originX = args.originCellX;
  const originY = args.originCellY;
  const cells = [];
  for (let y = originY - radius; y <= originY + radius; y++) {
    for (let x = originX - radius; x <= originX + radius; x++) {
      if (isStone(x, y)) cells.push({ x: x, y: y });
    }
  }
  return cells;
}

function dropSand(writer, cells, amount) {
  const still = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (isStone(cell.x, cell.y)) {
      still.push(cell);
      continue;
    }
    if (!claim(cell.x, cell.y)) continue;
    let placed = isSand(cell.x, cell.y) ? 1 : 0;
    for (let n = 0; n < NEIGHBORS.length && placed < amount; n++) {
      const x = cell.x + NEIGHBORS[n][0];
      const y = cell.y + NEIGHBORS[n][1];
      if (!isEmpty(x, y)) continue;
      if (writer && writer.elements && writer.elements.createAtCell) {
        writer.elements.createAtCell(x, y, "sand");
      } else {
        api.elements.createAtCell(x, y, "sand");
      }
      placed++;
    }
  }
  return still;
}

function remember(cells) {
  if (!cells.length) return;
  jobs.push({ cells: cells, tries: 6 });
  kick();
}

let pumping = false;

function kick() {
  if (pumping) return;
  pumping = true;
  const step = () => {
    const amount = readAmount();
    const run = (writer) => {
      for (let i = jobs.length - 1; i >= 0; i--) {
        const job = jobs[i];
        job.cells = dropSand(writer, job.cells, amount);
        job.tries -= 1;
        if (!job.cells.length || job.tries <= 0) jobs.splice(i, 1);
      }
      if (jobs.length && api.schedule && api.schedule.nextTick) {
        api.schedule.nextTick(step);
      } else {
        pumping = false;
      }
    };
    try {
      api.grid.mutate(run);
    } catch (error) {
      try {
        api.world.runWhenSimulationIdle(() => run(null));
      } catch (inner) {
        pumping = false;
      }
    }
  };
  if (api.schedule && api.schedule.nextTick) api.schedule.nextTick(step);
  else step();
}

function giveStoneASandOutput() {
  try {
    const stoneType = api.terrains.getTypeById("stone");
    const sandType = api.elements.getTypeById("sand");
    if (stoneType == null || sandType == null) return;
    api.terrains.updateDefinition(stoneType, {
      output: { elementType: sandType, chance: 1 },
    });
  } catch (error) {}
}

function install() {
  if (hooked) return;
  syncConfig();
  giveStoneASandOutput();
  api.hooks.modify("excavation:prepare", (args) => {
    syncConfig();
    if (!readEnabled()) return;
    try {
      remember(snapshot(args));
    } catch (error) {}
  }, { priority: 1000 });
  hooked = true;
}

install();

try {
  api.settings.onChange(() => syncConfig());
} catch (error) {}

try {
  api.events.on("game:ready", () => {
    install();
    try {
      api.ui.toast("Broken stone drops sand, no matter what tool clears it.");
    } catch (error) {}
  });
} catch (error) {}

try {
  api.events.on("scene:game:started", () => install());
} catch (error) {}
