// Persistent player progress + save/load to localStorage.
import { FruitId, ISLANDS } from './data';

export type HatStyle = 'straw' | 'bandana' | 'tricorn' | 'none';
export type HairStyle = 'spiky' | 'messy' | 'long' | 'topknot' | 'bald';

export interface Look {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  shirt: string;
  pants: string;
  hat: HatStyle;
  hatColor: string;
  scar: boolean;
}

export interface Progress {
  version: number;
  name: string;
  shipName: string;
  look: Look;
  fruit: FruitId | null;
  level: number;
  xp: number;
  gold: number;
  wood: number;
  iron: number;
  cola: number;
  bounty: number;
  upgrades: { hull: number; cannons: number; sails: number };
  nextIsland: number;
  cleared: boolean[];
  discovered: boolean[];
  awakened: boolean;
  chests: string[];
  playTime: number;
  lastDock: number;
  shipsSunk: number;
  monstersSlain: number;
  fog: string;
  finished: boolean;
}

export const FOG_CELL = 16;
export const WORLD_MIN_X = -2400, WORLD_MAX_X = 2400, WORLD_MIN_Z = -12200, WORLD_MAX_Z = 1600;
export const FOG_W = Math.ceil((WORLD_MAX_X - WORLD_MIN_X) / FOG_CELL);
export const FOG_H = Math.ceil((WORLD_MAX_Z - WORLD_MIN_Z) / FOG_CELL);

export function defaultLook(): Look {
  return { skin: '#f1c59b', hair: '#1d1a1a', hairStyle: 'messy', shirt: '#c8282b', pants: '#2f5fa8', hat: 'straw', hatColor: '#e9c46a', scar: true };
}

export function newProgress(): Progress {
  return {
    version: 1,
    name: 'Ren',
    shipName: 'Sunrise Wanderer',
    look: defaultLook(),
    fruit: null,
    level: 1,
    xp: 0,
    gold: 150,
    wood: 30,
    iron: 8,
    cola: 3,
    bounty: 0,
    upgrades: { hull: 0, cannons: 0, sails: 0 },
    nextIsland: 1,
    cleared: ISLANDS.map((i) => i.id === 0),
    discovered: ISLANDS.map((i) => i.id <= 1),
    awakened: false,
    chests: [],
    playTime: 0,
    lastDock: 0,
    shipsSunk: 0,
    monstersSlain: 0,
    fog: '',
    finished: false,
  };
}

const KEY = 'pirateship.save.v1';
const SETTINGS_KEY = 'pirateship.settings.v1';

export function saveProgress(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}
export function loadProgress(): Progress | null {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return null;
    const p = JSON.parse(s) as Progress;
    if (!p || p.version !== 1 || !p.fruit) return null;
    return { ...newProgress(), ...p };
  } catch {
    return null;
  }
}
export function clearProgress() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  sensitivity: number;
  invertY: boolean;
  quality: 'low' | 'medium' | 'high';
  shake: boolean;
}
export function loadSettings(): Settings {
  const d: Settings = { master: 0.8, music: 0.55, sfx: 0.9, sensitivity: 1, invertY: false, quality: 'high', shake: true };
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    if (s) return { ...d, ...JSON.parse(s) };
  } catch { /* ignore */ }
  return d;
}
export function saveSettings(s: Settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

/** XP needed to go from `level` to `level+1`. */
export const xpForLevel = (level: number) => Math.round(100 * Math.pow(level, 1.45));
export const maxHpFor = (level: number) => 220 + (level - 1) * 18;
export const damageMult = (level: number) => 1 + (level - 1) * 0.07;

// Fog of war bitset encode/decode (1 bit per cell, base64).
export function encodeFog(bits: Uint8Array): string {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i]) bytes[i >> 3] |= 1 << (i & 7);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
export function decodeFog(str: string, out: Uint8Array) {
  if (!str) return;
  try {
    const s = atob(str);
    for (let i = 0; i < out.length; i++) out[i] = (s.charCodeAt(i >> 3) >> (i & 7)) & 1;
  } catch { /* ignore */ }
}
