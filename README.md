# Tides of the Grand Meridian

A 3D pirate adventure for the browser, inspired by One Piece. Create a captain, eat a devil fruit, and sail with your first mate Kaito across the Grand Meridian to Solhaven, the island of the Last Dawn.

Everything is generated in code: the islands, ocean, ships, characters, effects, music and sound effects. No external assets are loaded.

## Play

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
```

A desktop browser with WebGL2 is required. Settings → Quality lowers shadows and turns off bloom on slower machines.

## The voyage

1. **Create your captain.** Choose a name, a ship name, skin, hair, clothes, hat and scars.
2. **Eat a devil fruit.** There are five, each with a combo, three powers, a passive and an awakened ultimate:
   - Hono Hono (Blaze, Logia)
   - Nobi Nobi (Stretch, Paramecia)
   - Raikou Raikou (Thunder, Logia)
   - Kori Kori (Frost, Logia)
   - Yure Yure (Quake, Paramecia)
3. **Sail.** Take the helm yourself, or press **T** and Kaito steers toward the Log Pose. The compass always points at the next island and shows its distance.
4. **Fight at sea.** You will meet pirate crews, the Meridian Navy, Sea Kings and krakens. Fire broadsides or use your fruit from the deck. A sunk ship becomes a wreck you can board: clear its survivors and loot its hold, or just sail on.
5. **Make landfall.** Moor at an island's pier (the map marks your ship), go ashore, and explore a large island. It has crew camps, chests, villagers, and a boss arena. Then return to your ship and set sail.
6. **Upgrade.** Loot gold, timber and iron. Patch the hull at sea with **R**, or visit a shipwright for full repairs and upgrades to the hull, cannons and sails.
7. **Awaken.** At Thunderhold, Warlord Gorrath will push you to the brink. That is where your fruit awakens and unlocks its ultimate.

| # | Island | Boss |
|---|--------|------|
| 0 | Saltbreeze Village | (home port) |
| 1 | Coral Haven | Captain Barnacle |
| 2 | Emberpeak | Admiral Kazan |
| 3 | Frostveil | Borr |
| 4 | Thunderhold | Warlord Gorrath (awakening) |
| 5 | Mirage Dunes | Sultana Zahra |
| 6 | Solhaven | Emperor Vexis (final) |

The world map (**M**) fills in as you explore. Islands you have not reached show only as blurred silhouettes.

## Controls

| On foot | |
|---|---|
| W A S D / Shift / Space | Move / sprint / jump |
| Left click | Combo |
| 1 2 3 | Fruit powers |
| 4 | Awakened ultimate (after awakening, when the meter is full) |
| Q | Dodge |
| E | Interact: loot, talk, board, go ashore |

| At sea | |
|---|---|
| F | Take or leave the helm |
| T | Let Kaito steer to the Log Pose |
| W / S | Raise or lower sails |
| A / D | Rudder |
| Left click | Broadside on the side you are looking at |
| Shift | Gale Burst (uses Burst Cola) |
| R | Patch the hull (10 timber + 2 iron) |

**M** opens the map and **Esc** pauses. The game saves automatically when you moor and after each boss, and you can also save from the pause menu.

## Code layout

- `src/game/`: game state machine, cutscenes, encounters, data (fruits, islands, bosses), save state.
- `src/world/`: procedural islands, terrain, ocean shader, sky and weather.
- `src/entities/`: player, companion, enemies, bosses, ships and sea monsters.
- `src/combat/`: damage, projectiles and the devil fruit powers.
- `src/fx/`: particles, shockwaves, lightning and screen effects.
- `src/ui/`: HUD, minimap and world map, and menus.
- `src/core/`: input, synthesized audio, math and noise.

Built with [Three.js](https://threejs.org), TypeScript and Vite.
