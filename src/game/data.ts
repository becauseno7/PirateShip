// Static game content: devil fruits, islands, upgrades, story lines.

export type FruitId = 'blaze' | 'stretch' | 'thunder' | 'frost' | 'quake';

export interface AbilityInfo {
  name: string;
  desc: string;
  cost: number; // energy
  cd: number; // seconds
}
export interface FruitDef {
  id: FruitId;
  name: string; // Japanese-flavored name
  english: string;
  type: 'Logia' | 'Paramecia';
  color: number;
  color2: number;
  awakenColor: number;
  blurb: string;
  basic: string;
  abilities: [AbilityInfo, AbilityInfo, AbilityInfo];
  ultimate: AbilityInfo;
  awakenedName: string;
}

export const FRUITS: Record<FruitId, FruitDef> = {
  blaze: {
    id: 'blaze', name: 'Hono Hono no Mi', english: 'Blaze-Blaze Fruit', type: 'Logia',
    color: 0xff5a1f, color2: 0xffd23a, awakenColor: 0xfff1b0,
    blurb: 'Your body becomes living flame. Burn ships to cinders and light up the night sea.',
    basic: 'Fire-wreathed fists that scorch on every hit.',
    abilities: [
      { name: 'Blazing Fist', desc: 'Hurl a colossal fireball that detonates on impact.', cost: 22, cd: 2.2 },
      { name: 'Pyre Column', desc: 'Erupt a pillar of flame beneath your target, launching foes.', cost: 30, cd: 5 },
      { name: 'Ember Step', desc: 'Dash forward in a streak of fire, scorching everything you pass.', cost: 15, cd: 3 },
    ],
    ultimate: { name: 'Great Sun: Daybreak', desc: 'Raise a second sun into the sky and bring it crashing down.', cost: 0, cd: 1 },
    awakenedName: 'Awakened Sunflame',
  },
  stretch: {
    id: 'stretch', name: 'Nobi Nobi no Mi', english: 'Stretch-Stretch Fruit', type: 'Paramecia',
    color: 0x8a3fd1, color2: 0xd9a8ff, awakenColor: 0xffffff,
    blurb: 'Your body turns to rubber. Stretch, bounce and pummel with absurd, joyful force.',
    basic: 'Elastic punches with long reach.',
    abilities: [
      { name: 'Pistol Punch', desc: 'Wind up and launch a fist across the battlefield.', cost: 15, cd: 1.2 },
      { name: 'Gatling Barrage', desc: 'A blur of a hundred stretching fists in front of you.', cost: 30, cd: 5 },
      { name: 'Rocket Launch', desc: 'Sling yourself forward and crash down with a shockwave.', cost: 20, cd: 3.5 },
    ],
    ultimate: { name: 'Gear Dawn: Titan', desc: 'Inflate into a laughing giant of pure joy for a short time.', cost: 0, cd: 1 },
    awakenedName: 'Awakened Joyboy Form',
  },
  thunder: {
    id: 'thunder', name: 'Raikou Raikou no Mi', english: 'Thunder-Thunder Fruit', type: 'Logia',
    color: 0x3fa8ff, color2: 0xfff27a, awakenColor: 0xe6f7ff,
    blurb: 'Become the storm itself. Strike at the speed of lightning and call down the heavens.',
    basic: 'Crackling strikes that arc between foes.',
    abilities: [
      { name: 'Thunder Spear', desc: 'A lance of lightning that chains between enemies.', cost: 20, cd: 1.8 },
      { name: 'Heaven\'s Wrath', desc: 'Summon a thunderstorm that pounds an area with bolts.', cost: 35, cd: 6 },
      { name: 'Flash Step', desc: 'Teleport forward in a bolt of light.', cost: 15, cd: 2.5 },
    ],
    ultimate: { name: 'Raijin: Ten Thousand Bolts', desc: 'Become a god of thunder and blanket the land in lightning.', cost: 0, cd: 1 },
    awakenedName: 'Awakened Thunder God',
  },
  frost: {
    id: 'frost', name: 'Kori Kori no Mi', english: 'Frost-Frost Fruit', type: 'Logia',
    color: 0x7fe0ff, color2: 0xffffff, awakenColor: 0xd6f6ff,
    blurb: 'Command absolute cold. Freeze foes solid and stop the very sea in its tracks.',
    basic: 'Frigid blows that chill and slow.',
    abilities: [
      { name: 'Ice Lances', desc: 'Fire a fan of razor ice spears.', cost: 18, cd: 1.6 },
      { name: 'Ice Age', desc: 'A freezing wave that encases enemies in ice.', cost: 32, cd: 6 },
      { name: 'Glacier Slide', desc: 'Skate forward on a trail of ice, chilling foes.', cost: 14, cd: 3 },
    ],
    ultimate: { name: 'Absolute Zero', desc: 'Freeze everything around you, then shatter it.', cost: 0, cd: 1 },
    awakenedName: 'Awakened Eternal Winter',
  },
  quake: {
    id: 'quake', name: 'Yure Yure no Mi', english: 'Quake-Quake Fruit', type: 'Paramecia',
    color: 0xf2efe6, color2: 0x9aa3b5, awakenColor: 0xfff9e0,
    blurb: 'Shatter the air like glass. The strongest fruit for raw destruction.',
    basic: 'Tremor punches that crack the air.',
    abilities: [
      { name: 'Quake Fist', desc: 'A cone of shattering force that blasts enemies away.', cost: 22, cd: 2 },
      { name: 'Seaquake', desc: 'Split the ground around you with an expanding tremor.', cost: 34, cd: 6 },
      { name: 'Skybreaker Leap', desc: 'Leap high and smash down, cracking the earth.', cost: 18, cd: 3.5 },
    ],
    ultimate: { name: 'World Splitter', desc: 'Crack the sky itself and bring it down on your enemies.', cost: 0, cd: 1 },
    awakenedName: 'Awakened World Breaker',
  },
};
export const FRUIT_ORDER: FruitId[] = ['blaze', 'stretch', 'thunder', 'frost', 'quake'];

export type IslandStyle = 'home' | 'tropical' | 'volcano' | 'snow' | 'fortress' | 'desert' | 'final';
export type BossId = 'barnacle' | 'kazan' | 'borr' | 'gorrath' | 'zahra' | 'vexis';

export interface IslandTheme {
  sand: number; grass: number; grass2: number; rock: number; peak: number; path: number;
  shallow: number;
  fog: number; skyTop: number; skyHorizon: number;
  ambient: 'leaves' | 'embers' | 'snow' | 'rain' | 'sand' | 'sparkle' | 'none';
  storm: number;
}

export interface IslandDef {
  id: number;
  name: string;
  title: string;
  style: IslandStyle;
  pos: [number, number];
  radius: number;
  height: number;
  seed: number;
  level: number;
  boss?: BossId;
  grunts: number;
  crew: string; // enemy faction name
  lore: string[];
  theme: IslandTheme;
}

export const ISLANDS: IslandDef[] = [
  {
    id: 0, name: 'Saltbreeze Village', title: 'Where Every Voyage Begins', style: 'home',
    pos: [0, 520], radius: 240, height: 34, seed: 11, level: 0, grunts: 0, crew: '',
    lore: [
      'A sleepy fishing village of windmills and salt flats at the edge of the East Blue.',
      'The old shipwright here swears he once rowed Aurelio the Dawnbringer across the harbor.',
    ],
    theme: { sand: 0xe9d9a6, grass: 0x6dbb4a, grass2: 0x93cf5a, rock: 0x8c8577, peak: 0xa59d8c, path: 0xcdb98a, shallow: 0x3fd6c6, fog: 0xbfe3f2, skyTop: 0x3d8fe0, skyHorizon: 0xcdeafa, ambient: 'leaves', storm: 0 },
  },
  {
    id: 1, name: 'Coral Haven', title: 'The Reef of Ten Thousand Colors', style: 'tropical',
    pos: [380, -1500], radius: 400, height: 60, seed: 23, level: 1, boss: 'barnacle', grunts: 14, crew: 'Barnacle Pirates',
    lore: [
      'A jungle island ringed by living coral, home to ruins older than the Navy itself.',
      'Captain Barnacle anchors his fleet here and taxes every fisherman who dares sail the reef.',
    ],
    theme: { sand: 0xf3e2b0, grass: 0x2f9e44, grass2: 0x5cc23c, rock: 0x7a7468, peak: 0x5d6b52, path: 0xd8c08a, shallow: 0x29e0c9, fog: 0xc2ecf0, skyTop: 0x2f8be6, skyHorizon: 0xd2f4fb, ambient: 'leaves', storm: 0 },
  },
  {
    id: 2, name: 'Emberpeak', title: 'The Mountain That Breathes', style: 'volcano',
    pos: [-760, -3250], radius: 430, height: 140, seed: 37, level: 2, boss: 'kazan', grunts: 16, crew: 'Cinder Corps',
    lore: [
      'A volcano that never sleeps. Rivers of magma carve the black glass slopes.',
      'Admiral Kazan deserted the Navy and forged an army of ash-clad soldiers in its crater.',
    ],
    theme: { sand: 0x34302f, grass: 0x403a3a, grass2: 0x573f36, rock: 0x34303a, peak: 0x24212a, path: 0x6e5444, shallow: 0x3a7f86, fog: 0x6a5458, skyTop: 0x5a4a5e, skyHorizon: 0xe0a07a, ambient: 'embers', storm: 0.15 },
  },
  {
    id: 3, name: 'Frostveil', title: 'Where the Sea Stands Still', style: 'snow',
    pos: [560, -5050], radius: 440, height: 120, seed: 41, level: 3, boss: 'borr', grunts: 16, crew: 'Rimeborn Raiders',
    lore: [
      'An eternal winter island where the sea freezes into glittering fields of ice.',
      'Borr the Frost Titan, last of the ancient giants, guards a frozen throne at its peak.',
    ],
    theme: { sand: 0xdfe6ec, grass: 0xf4f8fb, grass2: 0xdde8f0, rock: 0x6f7c88, peak: 0xffffff, path: 0xb7c4cf, shallow: 0x8fd3e8, fog: 0xd8e6f0, skyTop: 0x6f98c9, skyHorizon: 0xe8f0f8, ambient: 'snow', storm: 0.25 },
  },
  {
    id: 4, name: 'Thunderhold', title: 'Fortress of the Calamity', style: 'fortress',
    pos: [-380, -6950], radius: 460, height: 110, seed: 53, level: 4, boss: 'gorrath', grunts: 20, crew: 'Beast Legion',
    lore: [
      'A storm-wracked rock crowned by a fortress the size of a city. Lightning never stops falling here.',
      'Warlord Gorrath, the Calamity, has never lost a fight. Admirals turn their fleets around at the sight of his banner.',
    ],
    theme: { sand: 0x77736b, grass: 0x4e6b47, grass2: 0x627a4f, rock: 0x5c5c66, peak: 0x4a4a54, path: 0x8a8274, shallow: 0x2f6b78, fog: 0x4c5560, skyTop: 0x262b38, skyHorizon: 0x5d6574, ambient: 'rain', storm: 1 },
  },
  {
    id: 5, name: 'Mirage Dunes', title: 'Kingdom of the Shifting Sands', style: 'desert',
    pos: [860, -8850], radius: 470, height: 70, seed: 67, level: 5, boss: 'zahra', grunts: 20, crew: 'Mirage Guard',
    lore: [
      'A desert kingdom of buried pyramids, where oases appear and vanish overnight.',
      'Sultana Zahra rules from a palace no map has ever recorded twice in the same place.',
    ],
    theme: { sand: 0xe8c47e, grass: 0xd9b26a, grass2: 0xc9a05a, rock: 0xb07a4a, peak: 0x9c6a3e, path: 0xf0d79a, shallow: 0x36d1c4, fog: 0xf0d8a8, skyTop: 0x3d86d6, skyHorizon: 0xf6e2b6, ambient: 'sand', storm: 0.1 },
  },
  {
    id: 6, name: 'Solhaven', title: 'The Last Dawn', style: 'final',
    pos: [0, -10900], radius: 520, height: 130, seed: 79, level: 6, boss: 'vexis', grunts: 22, crew: 'Eclipse Navy',
    lore: [
      'The island at the end of the Grand Meridian, where the sun is said to rest each night.',
      'Here Aurelio the Dawnbringer hid the Daybreak Treasure. Emperor Vexis has guarded it for two hundred years.',
    ],
    theme: { sand: 0xfff0c8, grass: 0x78c25a, grass2: 0xa6d466, rock: 0xd9c49a, peak: 0xf4e6c4, path: 0xf6e2b0, shallow: 0x7ff0e0, fog: 0xffe8c0, skyTop: 0x5a7fd8, skyHorizon: 0xffe0b0, ambient: 'sparkle', storm: 0 },
  },
];

export const AWAKEN_ISLAND = 4;
export const FINAL_ISLAND = ISLANDS.length - 1;

export interface Cost { gold: number; wood: number; iron: number }
export const UPGRADES: Record<'hull' | 'cannons' | 'sails', { name: string; desc: string[]; costs: Cost[] }> = {
  hull: {
    name: 'Hull Plating',
    desc: ['Oak hull', 'Iron-banded hull (+150 HP)', 'Adam-wood hull (+300 HP)', 'Treasure Tree hull (+500 HP)'],
    costs: [{ gold: 400, wood: 20, iron: 6 }, { gold: 1400, wood: 45, iron: 18 }, { gold: 3800, wood: 80, iron: 40 }],
  },
  cannons: {
    name: 'Cannon Battery',
    desc: ['2 cannons per side', '3 cannons per side, +25% dmg', '4 cannons per side, +60% dmg', '5 cannons per side, +110% dmg'],
    costs: [{ gold: 500, wood: 10, iron: 16 }, { gold: 1600, wood: 22, iron: 38 }, { gold: 4000, wood: 40, iron: 70 }],
  },
  sails: {
    name: 'Sails & Rigging',
    desc: ['Canvas sails', 'Reinforced sails (+15% speed)', 'Storm sails (+30% speed)', 'Wind-god sails (+45% speed)'],
    costs: [{ gold: 400, wood: 25, iron: 4 }, { gold: 1300, wood: 50, iron: 12 }, { gold: 3400, wood: 90, iron: 28 }],
  },
};

export const COMPANION = { name: 'Kaito', full: 'Kaito "Three-Blade" Ren' };

export const STORY = {
  intro: [
    'Kaito: So you actually ate that thing. Guess you can never swim again, Captain.',
    'Kaito: The Log Pose points west into the Grand Meridian. Seven islands. One treasure at the end.',
    'Kaito: Solhaven. The Last Dawn. Nobody\'s ever come back from it.',
    'Kaito: ...Good. Let\'s be the first.',
  ],
  sailTips: [
    'Kaito: Take the helm with F, or press T and I\'ll steer us toward the Log Pose.',
    'Kaito: Shift on the helm fires a Gale Burst. Uses a barrel of cola, so don\'t waste them.',
    'Kaito: Click to fire a broadside at whatever side you\'re looking at.',
  ],
  arrive: [
    'Kaito: Land ho! Dock at the pier, the glowing buoy marks it.',
    'Kaito: Big island. Keep your eyes open, the boss will be at the heart of it.',
  ],
};
