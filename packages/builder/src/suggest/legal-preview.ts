import type { FormatId, PokemonSet, SpeciesDexPort, StatsTable, ValidationPort, ValidationSetResult } from '@pokemon/domain';

interface CompetitiveTemplate {
  species: string;
  itemOptions: string[];
  ability: string;
  nature: string;
  moves: string[];
  evs?: Partial<StatsTable>;
  ivs?: Partial<StatsTable>;
}

const competitiveSetTemplates: Record<string, CompetitiveTemplate> = {
  corviknight: {
    species: 'Corviknight',
    itemOptions: ['Leftovers', 'Rocky Helmet'],
    ability: 'Mirror Armor',
    nature: 'Impish',
    evs: { hp: 252, def: 168, spd: 88 },
    moves: ['Brave Bird', 'U-turn', 'Roost', 'Defog'],
  },
  greattusk: {
    species: 'Great Tusk',
    itemOptions: ['Leftovers', 'Focus Sash', 'Assault Vest'],
    ability: 'Protosynthesis',
    nature: 'Jolly',
    evs: { atk: 252, def: 4, spe: 252 },
    moves: ['Headlong Rush', 'Close Combat', 'Ice Spinner', 'Rapid Spin'],
  },
  irontreads: {
    species: 'Iron Treads',
    itemOptions: ['Assault Vest', 'Leftovers', 'Focus Sash'],
    ability: 'Quark Drive',
    nature: 'Jolly',
    evs: { atk: 252, def: 4, spe: 252 },
    moves: ['Earthquake', 'Iron Head', 'Rapid Spin', 'Knock Off'],
  },
  heatran: {
    species: 'Heatran',
    itemOptions: ['Leftovers', 'Air Balloon', 'Shuca Berry'],
    ability: 'Flash Fire',
    nature: 'Calm',
    evs: { hp: 252, spa: 4, spd: 252 },
    moves: ['Magma Storm', 'Earth Power', 'Taunt', 'Protect'],
  },
  primarina: {
    species: 'Primarina',
    itemOptions: ['Leftovers', 'Sitrus Berry', 'Choice Specs'],
    ability: 'Torrent',
    nature: 'Bold',
    evs: { hp: 252, def: 156, spa: 100 },
    moves: ['Moonblast', 'Surf', 'Haze', 'Protect'],
  },
  dragonite: {
    species: 'Dragonite',
    itemOptions: ['Lum Berry', 'Choice Band', 'Leftovers'],
    ability: 'Multiscale',
    nature: 'Adamant',
    evs: { atk: 252, spd: 4, spe: 252 },
    moves: ['Dragon Dance', 'Extreme Speed', 'Earthquake', 'Roost'],
  },
  kingambit: {
    species: 'Kingambit',
    itemOptions: ['Black Glasses', 'Leftovers', 'Assault Vest'],
    ability: 'Supreme Overlord',
    nature: 'Adamant',
    evs: { hp: 252, atk: 252, spd: 4 },
    moves: ['Kowtow Cleave', 'Sucker Punch', 'Iron Head', 'Swords Dance'],
  },
  rillaboom: {
    species: 'Rillaboom',
    itemOptions: ['Choice Band', 'Miracle Seed', 'Assault Vest'],
    ability: 'Grassy Surge',
    nature: 'Adamant',
    evs: { atk: 252, spd: 4, spe: 252 },
    moves: ['Grassy Glide', 'Wood Hammer', 'U-turn', 'Knock Off'],
  },
  rotomwash: {
    species: 'Rotom-Wash',
    itemOptions: ['Leftovers', 'Sitrus Berry', 'Choice Scarf'],
    ability: 'Levitate',
    nature: 'Bold',
    evs: { hp: 252, def: 196, spe: 60 },
    moves: ['Volt Switch', 'Hydro Pump', 'Will-O-Wisp', 'Protect'],
  },
  gholdengo: {
    species: 'Gholdengo',
    itemOptions: ['Choice Scarf', 'Choice Specs', 'Leftovers'],
    ability: 'Good as Gold',
    nature: 'Timid',
    evs: { def: 4, spa: 252, spe: 252 },
    moves: ['Make It Rain', 'Shadow Ball', 'Trick', 'Focus Blast'],
  },
  dragapult: {
    species: 'Dragapult',
    itemOptions: ['Choice Specs', 'Choice Band', 'Life Orb'],
    ability: 'Infiltrator',
    nature: 'Timid',
    evs: { def: 4, spa: 252, spe: 252 },
    moves: ['Draco Meteor', 'Shadow Ball', 'Flamethrower', 'U-turn'],
  },
  grimmsnarl: {
    species: 'Grimmsnarl',
    itemOptions: ['Light Clay', 'Sitrus Berry', 'Leftovers'],
    ability: 'Prankster',
    nature: 'Careful',
    evs: { hp: 252, atk: 4, spd: 252 },
    moves: ['Reflect', 'Light Screen', 'Taunt', 'Spirit Break'],
  },
  incineroar: {
    species: 'Incineroar',
    itemOptions: ['Sitrus Berry', 'Rocky Helmet', 'Assault Vest'],
    ability: 'Intimidate',
    nature: 'Careful',
    evs: { hp: 252, def: 92, spd: 164 },
    moves: ['Flare Blitz', 'Knock Off', 'U-turn', 'Will-O-Wisp'],
  },
  landorustherian: {
    species: 'Landorus-Therian',
    itemOptions: ['Rocky Helmet', 'Leftovers', 'Choice Scarf'],
    ability: 'Intimidate',
    nature: 'Impish',
    evs: { hp: 252, def: 196, spe: 60 },
    moves: ['Earthquake', 'U-turn', 'Stealth Rock', 'Taunt'],
  },
};

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function isChampionsLikeFormat(format: FormatId): boolean {
  return normalize(format).includes('champions');
}

function convertStatPoints(evs?: Partial<StatsTable>, format?: FormatId): Partial<StatsTable> | undefined {
  if (!evs) return undefined;
  if (!format || !isChampionsLikeFormat(format)) return evs;

  const converted: Partial<StatsTable> = {};
  const entries = Object.entries(evs) as Array<[keyof StatsTable, number | undefined]>;

  for (const [stat, value] of entries) {
    if (!value || value <= 0) continue;
    converted[stat] = Math.min(32, Math.max(2, Math.round(value / 8)));
  }

  let total = Object.values(converted).reduce((sum, value) => sum + (value ?? 0), 0);
  const statOrder: Array<keyof StatsTable> = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

  while (total > 66) {
    const nextStat = statOrder
      .filter((stat) => (converted[stat] ?? 0) > 0)
      .sort((left, right) => (converted[right] ?? 0) - (converted[left] ?? 0))[0];

    if (!nextStat) break;
    converted[nextStat] = Math.max(0, (converted[nextStat] ?? 0) - 1);
    total -= 1;
  }

  return converted;
}

function normalizeIvs(ivs?: Partial<StatsTable>): Partial<StatsTable> | undefined {
  if (!ivs) return undefined;

  const normalized: Partial<StatsTable> = {};
  for (const [stat, value] of Object.entries(ivs) as Array<[keyof StatsTable, number | undefined]>) {
    if (typeof value !== 'number') continue;
    const clamped = Math.max(0, Math.min(31, Math.round(value)));
    if (clamped !== 31) normalized[stat] = clamped;
  }

  return Object.keys(normalized).length ? normalized : undefined;
}

function formatStatsLine(label: string, stats?: Partial<StatsTable>): string | null {
  if (!stats) return null;

  const parts = (Object.entries(stats) as Array<[keyof StatsTable, number | undefined]>)
    .filter(([, value]) => typeof value === 'number' && value > 0)
    .map(([stat, value]) => `${value} ${stat === 'spa' ? 'SpA' : stat === 'spd' ? 'SpD' : stat.toUpperCase()}`);

  return parts.length ? `${label}: ${parts.join(' / ')}` : null;
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T> | undefined)?.then === 'function';
}

function formatSetPreview(set: PokemonSet): string {
  const lines = [
    set.item ? `${set.species} @ ${set.item}` : set.species,
    set.ability ? `Ability: ${set.ability}` : null,
    formatStatsLine('EVs', set.evs),
    formatStatsLine('IVs', set.ivs),
    set.nature ? `${set.nature} Nature` : null,
    `Moves: ${set.moves.join(' / ')}`,
  ].filter((value): value is string => Boolean(value));

  return lines.join(' | ');
}

export function getCompetitiveSetPreview(
  speciesName: string,
  format: FormatId,
  validator: ValidationPort,
): string | null {
  const key = normalize(speciesName).replace(/[^a-z0-9]/g, '');
  const template = competitiveSetTemplates[key];
  if (!template) return null;

  for (const item of template.itemOptions) {
    const set: PokemonSet = {
      species: template.species,
      item,
      ability: template.ability,
      nature: template.nature,
      moves: template.moves,
      level: 50,
      evs: convertStatPoints(template.evs, format),
      ivs: normalizeIvs(template.ivs),
    };

    const result = validator.validateSet(set, format);
    if (isPromiseLike<ValidationSetResult>(result)) {
      continue;
    }

    if (result.valid) {
      return formatSetPreview(result.normalizedSet ?? set);
    }
  }

  return null;
}

export function prioritizePreviewableCandidates(
  candidates: string[],
  format: FormatId,
  validator: ValidationPort,
): string[] {
  const previewable = candidates.filter((name) => Boolean(getCompetitiveSetPreview(name, format, validator)));
  const rest = candidates.filter((name) => !previewable.includes(name));
  return [...previewable, ...rest];
}
