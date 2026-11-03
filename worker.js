// Laser Stone to Sand — simulation worker.
// Excavation is prepared here. Register the same profile and hook so a
// worker-side dig still points the laser at the stone → sand rule.

const PROFILE_ID = "laser-stone-to-sand.profile";
const api = sandkit.api;

function resolveType(getter, ids) {
  for (let i = 0; i < ids.length; i++) {
    try {
      const value = getter(ids[i]);
      if (value !== null && value !== undefined) return value;
    } catch (error) {}
  }
  return null;
}

function isEnabled() {
  try {
    if (!api.settings || !api.settings.get) return true;
    const value = api.settings.get("enabled");
    if (typeof value === "boolean") return value;
    if (value && typeof value.enabled === "boolean") return value.enabled;
  } catch (error) {}
  return true;
}

function install() {
  const stoneType = resolveType(
    (id) => api.terrains.getTypeById(id),
    ["stone", "Stone"],
  );
  const sandType = resolveType(
    (id) => api.elements.getTypeById(id),
    ["sand", "Sand"],
  );
  if (stoneType === null || sandType === null) return;
  if (!api.excavation || !api.excavation.registerProfile) return;

  try {
    api.excavation.registerProfile(PROFILE_ID, {
      power: 1,
      terrainRules: [
        {
          cellType: stoneType,
          outputElementType: sandType,
        },
      ],
    });
  } catch (error) {}

  if (!api.hooks || !api.hooks.modify) return;

  api.hooks.modify("excavation:prepare", (args) => {
    if (!isEnabled()) return;
    if (!args || String(args.sourceId).toLowerCase() !== "laser") return;
    args.profileId = PROFILE_ID;
  }, { priority: 0 });
}

install();
