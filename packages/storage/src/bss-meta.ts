export interface SpeedBenchmarkRecord {
  label: string;
  value: number;
}

export interface BssThreatRecord {
  species: string;
  tags: string[];
}

export interface BssCoreRecord {
  name: string;
  members: string[];
}

export interface BssMetaSnapshot {
  formatHints: string[];
  bringCount: number;
  pickCount: number;
  levelCap: number;
  speedBenchmarks: SpeedBenchmarkRecord[];
  topThreats: BssThreatRecord[];
  commonCores: BssCoreRecord[];
  suggestedRemoval: string[];
  suggestedSpeedControl: string[];
  suggestedPivots: string[];
}

export const defaultBssMeta = {
  formatHints: ['bss', 'battlestadium', 'championsbss'],
  bringCount: 6,
  pickCount: 3,
  levelCap: 50,
  speedBenchmarks: [
    { label: 'bulky', value: 80 },
    { label: 'fast', value: 100 },
    { label: 'elite', value: 120 },
  ],
  topThreats: [
    { species: 'Dragonite', tags: ['setup', 'priority', 'wincon'] },
    { species: 'Kingambit', tags: ['priority', 'late-game', 'bulky'] },
    { species: 'Primarina', tags: ['bulky', 'special', 'fairy'] },
    { species: 'Rillaboom', tags: ['priority', 'pivot', 'terrain'] },
    { species: 'Ogerpon-Wellspring', tags: ['speed', 'pressure', 'water'] },
    { species: 'Gholdengo', tags: ['special', 'steel', 'anti-removal'] },
    { species: 'Heatran', tags: ['steel', 'special', 'trap'] },
    { species: 'Landorus-Therian', tags: ['pivot', 'ground', 'intimidate'] },
    { species: 'Incineroar', tags: ['pivot', 'intimidate', 'fake-out'] },
    { species: 'Flutter Mane', tags: ['speed', 'special', 'restricted'] },
    { species: 'Miraidon', tags: ['speed', 'restricted', 'electric'] },
    { species: 'Koraidon', tags: ['speed', 'restricted', 'physical'] },
    { species: 'Terapagos', tags: ['restricted', 'bulky', 'late-game'] },
    { species: 'Zacian-Crowned', tags: ['restricted', 'speed', 'steel'] },
    { species: 'Necrozma-Dusk-Mane', tags: ['restricted', 'steel', 'bulky'] },
  ],
  commonCores: [
    { name: 'Intimidate balance', members: ['Incineroar', 'Landorus-Therian'] },
    { name: 'Grass-water pressure', members: ['Rillaboom', 'Ogerpon-Wellspring'] },
    { name: 'Steel-fairy pressure', members: ['Gholdengo', 'Primarina'] },
  ],
  suggestedRemoval: ['Great Tusk', 'Corviknight', 'Iron Treads'],
  suggestedSpeedControl: ['Dragapult', 'Iron Valiant', 'Choice Scarf Gholdengo', 'Booster Energy Flutter Mane'],
  suggestedPivots: ['Incineroar', 'Landorus-Therian', 'Rillaboom', 'Rotom-Wash'],
} satisfies BssMetaSnapshot;
