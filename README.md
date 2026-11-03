# Laser Stone to Sand

Sandustry **0.6** mod. Stone normally breaks into nothing. With this on, each stone cell the **mining laser** destroys leaves **one sand** behind. The shovel still can't break stone. The drill and void gun still drop nothing from it.

## Install (Steam)

1. Switch to the **mods** branch if the Mods screen isn't in your build. In Steam: Sandustry → Properties → Betas. Use the branch that matches 0.6.
2. Download the repo as a zip (Code → Download ZIP), then put the folder in the game's `mods` directory. After unzipping, `modinfo.json` must sit directly inside `laser-stone-to-sand`:

   - Windows: `%APPDATA%\sandustry\mods\laser-stone-to-sand\`
   - Linux: `~/.config/sandustry/mods/laser-stone-to-sand/`
   - macOS: `~/Library/Application Support/sandustry/mods/laser-stone-to-sand/`
3. GitHub's zip wraps the folder as `laser-stone-to-sand-main`. Rename that folder to `laser-stone-to-sand`.
4. Launch Sandustry, open **Mods**, and enable **Laser Stone to Sand**.
5. Load a world and cut stone with the laser. Sand should fall out of the broken cells.

Microsoft Store / Game Pass builds can't load local mods.

## Turn it off

Mods screen, or the mod's **Drop sand from lasered stone** setting. You don't have to delete the folder.

## Notes

- One sand per destroyed stone cell, same idea as dirt.
- A hit that only chips stone (it has more than one HP) doesn't drop anything until that cell actually breaks.
- Needs the official `sandkit` mod API (`apiVersion` 1), including `excavation.registerProfile` and the `excavation:prepare` hook.
