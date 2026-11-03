// Stone to Sand — simulation worker.
// Pays out sand after the dig that cleared the stone. A shared claim ring
// keeps this from doubling the main-thread payout when both hooks run.

const BUFFER_KEY = "stoneToSand";
const RING = 8192;
const HEADER = 5;
const LENGTH = HEADER + RING;
const DEFAULT_SAND = 6;

const api = sandkit.api;
const NEIGHBORS = buildNeighbors(6);
const jobs = [];
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

function getBuffer() {
  if (buffer) return buffer;
  try {
    if (api.shared && api.shared.buffers && api.shared.buffers.require) {
      buffer = api.shared.buffers.require(BUFFER_KEY, { type: "int32", length: LENGTH });
    }
  } catch (error) {}
  if (!buffer) {
    try {
      buffer = api.shared.buffers.ensure(BUFFER_KEY, { type: "int32", length: LENGTH });
    } catch (error) {
      try {
        buffer = api.shared.buffers.get(BUFFER_KEY);
      } catch (inner) {
        buffer = null;
      }
    }
  }
  return buffer;
}

function readAmount() {
  try {
    if (api.settings && api.settings.get) {
      const value = api.settings.get("sandPerStone");
      const direct = clampAmount(value);
      if (direct !== null) return direct;
    }
  } catch (error) {}
  const buf = getBuffer();
  if (buf && buf[2] > 0) return clampAmount(buf[2]) || DEFAULT_SAND;
  return DEFAULT_SAND;
}

function readEnabled() {
  try {
    if (api.settings && api.settings.get) {
      const value = api.settings.get("enabled");
      if (typeof value === "boolean") return value;
    }
  } catch (error) {}
  const buf = getBuffer();
  if (buf && buf[1] === 2) return false;
  return true;
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

function dropSand(cells, amount) {
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
      api.elements.createAtCell(x, y, "sand");
      placed++;
    }
  }
  return still;
}

function install() {
  if (!api.hooks || !api.hooks.modify) return;
  getBuffer();
  try {
    const stoneType = api.terrains.getTypeById("stone");
    const sandType = api.elements.getTypeById("sand");
    if (stoneType != null && sandType != null && api.terrains.updateDefinition) {
      api.terrains.updateDefinition(stoneType, {
        output: { elementType: sandType, chance: 1 },
      });
    }
  } catch (error) {}

  api.hooks.modify("excavation:prepare", (args) => {
    if (!readEnabled()) return;
    try {
      const cells = snapshot(args);
      if (cells.length) jobs.push({ cells: cells, tries: 6 });
    } catch (error) {}
  }, { priority: 1000 });

  try {
    api.events.on("worker:update:post", () => {
      if (!jobs.length) return;
      const amount = readAmount();
      for (let i = jobs.length - 1; i >= 0; i--) {
        const job = jobs[i];
        job.cells = dropSand(job.cells, amount);
        job.tries -= 1;
        if (!job.cells.length || job.tries <= 0) jobs.splice(i, 1);
      }
    });
  } catch (error) {}
}

install();
