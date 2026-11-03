// Laser Stone to Sand — main thread.
// The entry is compiled as an async function body. No import/export.

const PROFILE_ID = "laser-stone-to-sand.profile";
const api = sandkit.api;

let installed = false;

function isEnabled() {
  try {
    const value = api.settings.get("enabled");
    if (typeof value === "boolean") return value;
    if (value && typeof value.enabled === "boolean") return value.enabled;
  } catch (error) {}
  return true;
}

function resolveType(getter, ids) {
  for (let i = 0; i < ids.length; i++) {
    try {
      const value = getter(ids[i]);
      if (value !== null && value !== undefined) return value;
    } catch (error) {}
  }
  return null;
}

function laserPower() {
  try {
    const value = api.gameConfig.get("laser:excavationPower");
    if (typeof value === "number" && isFinite(value) && value > 0) return value;
  } catch (error) {}
  return 1;
}

function registerProfile() {
  const stoneType = resolveType(
    (id) => api.terrains.getTypeById(id),
    ["stone", "Stone"],
  );
  const sandType = resolveType(
    (id) => api.elements.getTypeById(id),
    ["sand", "Sand"],
  );
  if (stoneType === null || sandType === null) return false;

  try {
    api.excavation.registerProfile(PROFILE_ID, {
      // Match the laser's own dig power so this profile doesn't buff or nerf it.
      power: laserPower(),
      terrainRules: [
        {
          cellType: stoneType,
          outputElementType: sandType,
        },
      ],
    });
  } catch (error) {
    // The worker entry may have registered the same id already.
  }
  return true;
}

function isLaser(args) {
  return !!args && String(args.sourceId).toLowerCase() === "laser";
}

// Backup for when the profile rule doesn't emit a grain. No-ops if the
// cell already holds the sand the profile just created.
function watchClearedStone(cells, triesLeft) {
  const place = (writer) => {
    const still = [];
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      let isStone = false;
      try {
        isStone = api.terrains.isTypeAtCell(cell.x, cell.y, "stone");
      } catch (error) {}
      if (isStone) {
        still.push(cell);
        continue;
      }
      let empty = false;
      try {
        empty = api.grid.isCellEmptyAtCell(cell.x, cell.y);
      } catch (error) {}
      if (!empty) continue;
      writer.elements.createAtCell(cell.x, cell.y, "sand");
    }
    // Retry only for cells this dig has not cleared yet. A chip that
    // leaves the stone standing does not drop sand.
    if (still.length > 0 && triesLeft > 1 && api.schedule && api.schedule.nextTick) {
      const retry = still;
      api.schedule.nextTick(() => watchClearedStone(retry, triesLeft - 1));
    }
  };

  const run = () => {
    try {
      api.grid.mutate(place);
    } catch (error) {
      try {
        api.world.runWhenSimulationIdle(() => place({
          elements: {
            createAtCell: (x, y, id) => api.elements.createAtCell(x, y, id),
          },
        }));
      } catch (inner) {}
    }
  };

  if (api.schedule && api.schedule.nextTick) api.schedule.nextTick(run);
  else run();
}

function stoneCellsInBeam(args) {
  const originX = args.originCellX;
  const originY = args.originCellY;
  if (!isFinite(originX) || !isFinite(originY)) return [];

  // patternSize in config/laser.json is 7. Cap so a range-sized value
  // (maxRangeCells is 250) can't scan the whole map every tick.
  let diameter = 7;
  if (isFinite(args.patternDiameterCells) && args.patternDiameterCells >= 1) {
    diameter = args.patternDiameterCells;
  }
  if (diameter > 31) diameter = 31;
  const radius = Math.floor(diameter / 2);
  const cells = [];

  for (let y = originY - radius; y <= originY + radius; y++) {
    for (let x = originX - radius; x <= originX + radius; x++) {
      let isStone = false;
      try {
        isStone = api.terrains.isTypeAtCell(x, y, "stone");
      } catch (error) {}
      if (isStone) cells.push({ x: x, y: y });
    }
  }
  return cells;
}

function install() {
  if (installed) return true;
  let registered = false;
  try {
    registered = registerProfile();
  } catch (error) {
    registered = false;
  }
  if (!registered) return false;

  api.hooks.modify("excavation:prepare", (args) => {
    if (!isEnabled() || !isLaser(args)) return;
    args.profileId = PROFILE_ID;
    try {
      const cells = stoneCellsInBeam(args);
      if (cells.length > 0) watchClearedStone(cells, 6);
    } catch (error) {}
  }, { priority: 0 });

  installed = true;
  return true;
}

install();

try {
  api.events.on("game:ready", () => {
    const ok = install();
    try {
      api.ui.toast(
        ok
          ? "Stone drops sand when you mine it with the laser."
          : "Laser Stone to Sand couldn't find stone or sand.",
      );
    } catch (error) {}
  });
} catch (error) {}

try {
  api.events.on("scene:game:started", () => {
    install();
  });
} catch (error) {}
