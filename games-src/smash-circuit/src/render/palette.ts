// Bright, saturated cartoon palettes per theme (sRGB hex).
import type { TrackDef } from '../types';

export interface ThemePalette {
  background: number;      // clear colour (far beyond the ground plane)
  ground: number; groundAlt: number; groundDark: number;
  road: number; roadWear: number; roadLine: number;
  shoulder: number; shoulderAlt: number;
  hemiSky: number; hemiGround: number; hemiIntensity: number; sun: number; sunIntensity: number;
  dust: number;            // off-road dust / spray colour
  skid: number;
  foliage: number[];       // tree crown greens (or pine greens)
  trunk: number;
  accent: number[];        // banners, flags, crowd shirts
  rock: number; rockDark: number;
  stand: number;
  /** torn-road crater: light broken lip and darker earth core (exposed dirt under the asphalt, never black) */
  dirt: number; dirtDark: number;
}

export const PALETTES: Record<TrackDef['theme'], ThemePalette> = {
  meadow: {
    background: 0x6cc24a,
    ground: 0x76d150, groundAlt: 0x6bc745, groundDark: 0x5db83e,
    road: 0x4b5160, roadWear: 0x3f4553, roadLine: 0xffffff,
    shoulder: 0xc9c096, shoulderAlt: 0xb9b084,
    hemiSky: 0xfff6e0, hemiGround: 0x9fd88f, hemiIntensity: 1.35, sun: 0xfff0d0, sunIntensity: 1.9,
    dust: 0xb9a981, skid: 0x15171c,
    foliage: [0x3fbf4a, 0x58cf3a, 0x2fa84a, 0x7ad23c], trunk: 0x8a5a36,
    accent: [0xff4d4d, 0xffd23c, 0x3a9bff, 0xffffff, 0xff8a2b],
    rock: 0x9aa0a8, rockDark: 0x7b828c, stand: 0xc5cfdd,
    dirt: 0x8a7358, dirtDark: 0x5a4636,
  },
  desert: {
    background: 0xe9b968,
    ground: 0xf2c879, groundAlt: 0xeabf6c, groundDark: 0xe0ad58,
    road: 0x5c5662, roadWear: 0x4a4550, roadLine: 0xfff4dc,
    shoulder: 0xf6dfa4, shoulderAlt: 0xe9cb86,
    hemiSky: 0xfff0d2, hemiGround: 0xf0b86e, hemiIntensity: 1.3, sun: 0xffe2b0, sunIntensity: 2.0,
    dust: 0xe8c07a, skid: 0x2a1d17,
    foliage: [0x4cae58, 0x3d9a55, 0x62b95a], trunk: 0x9a6a3a,
    accent: [0xe8452c, 0x19b8c4, 0xffd23c, 0xffffff, 0xff8a2b],
    rock: 0xd0804e, rockDark: 0xaa5f3a, stand: 0xe6cfa8,
    dirt: 0xc4975a, dirtDark: 0x84603a,
  },
  // t4 Neon Harbour: a night-time city block. Dark navy pavement, violet-lit asphalt, hot neon accents; the light
  // stays bright enough that cars, props and the racing line read as clearly as on the day tracks.
  night: {
    background: 0x1a1d3a,
    ground: 0x2c3158, groundAlt: 0x333a66, groundDark: 0x23274a,
    road: 0x3a3550, roadWear: 0x2f2b44, roadLine: 0x5ff6ff,
    shoulder: 0xff4fb8, shoulderAlt: 0x2a2440,
    hemiSky: 0xc9b8ff, hemiGround: 0x4b3f8a, hemiIntensity: 1.3, sun: 0xffd0f0, sunIntensity: 1.55,
    dust: 0x8a86b8, skid: 0x0c0b16,
    foliage: [0x5ff6ff, 0xff4fb8, 0xffe14a, 0x8cff6a], trunk: 0x3b3f5c,
    accent: [0xff4fb8, 0x5ff6ff, 0xffe14a, 0xffffff, 0x9b6bff],
    rock: 0x6c7194, rockDark: 0x4d5276, stand: 0x8c90b8,
    dirt: 0x6a6280, dirtDark: 0x443d58,
  },
  snow: {
    background: 0xdcecfa,
    ground: 0xf4f9ff, groundAlt: 0xe6f1fc, groundDark: 0xd3e5f6,
    road: 0x4d5668, roadWear: 0x3f485a, roadLine: 0xffffff,
    shoulder: 0xe9f1f8, shoulderAlt: 0xd4e2ef,
    hemiSky: 0xf2f8ff, hemiGround: 0xb9d4ee, hemiIntensity: 1.4, sun: 0xfff6e8, sunIntensity: 1.7,
    dust: 0xffffff, skid: 0x232a36,
    foliage: [0x2f8a5c, 0x267a52, 0x3a9a66], trunk: 0x6d4a32,
    accent: [0xff3d5a, 0x2f9bff, 0xffd23c, 0xffffff, 0xff8a2b],
    rock: 0xa6b4c4, rockDark: 0x7f8fa3, stand: 0xcfdbe8,
    dirt: 0xa8a39c, dirtDark: 0x6a645d,
  },
};
