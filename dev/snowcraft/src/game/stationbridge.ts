// Late-bound links from the interactive objects (fixtures_*.ts) to modules that would create an import cycle with fixtures.ts
// (fauna -> tools -> fixtures, quest -> tools). stationwire.ts fills these in once everything is loaded; until then the features that
// need them (bear scare, journal lines, icebreaker ETA, drift preview) simply do nothing.
import type { Animal } from './state';

export interface JournalLine { kind: 'note' | 'storm' | 'site' | 'event' | 'know'; text: string; t: number }
export const bridge = {
  journal: null as null | JournalLine[],
  quest: null as null | { icebreakerAt: number; iceArrivedAt: number; iceDeadline: number },
  fauna: null as null | { dog: Animal | null; bear: Animal | null },
  aiOf: null as null | ((e: Animal) => { mode: string; hold: number; tx: number; t: number; carry?: string; hunger?: number } | undefined),
  setAiMode: null as null | ((e: Animal, mode: string) => void),
  scent: null as null | Float32Array,
  drift: null as null | { nextAt: number; pending: null | { k0: number; k1: number; dir: 1 | -1 }; floes: { x0: number; x1: number }[] },
};
