import type { FormatId, MoveInfo, PokemonSet, SpeciesDexPort, StatsTable, ValidationPort, ValidationSetResult } from '@pokemon/domain';

export type PreviewRoleHint = 'default' | 'hazard-control' | 'disruption' | 'pivot' | 'speed' | 'bulky' | 'offense';

interface PreviewOptions {
  roleHint?: PreviewRoleHint;
}

const SETUP_MOVE_IDS = new Set(['dragondance', 'swordsdance', 'nastyplot', 'calmmind', 'quiverdance', 'bulkup', 'curse', 'agility', 'rockpolish', 'trailblaze']);
const RECOVERY_MOVE_IDS = new Set(['roost', 'recover', 'slackoff', 'softboiled', 'moonlight', 'morningsun', 'synthesis', 'shoreup', 'milkdrink', 'rest']);
const DISRUPTION_MOVE_IDS = new Set(['taunt', 'encore', 'haze', 'clearsmog', 'thunderwave', 'willowisp', 'yawn', 'roar', 'whirlwind', 'dragontail', 'trickroom']);
const HAZARD_CONTROL_MOVE_IDS = new Set(['defog', 'rapidspin', 'mortalspin', 'courtchange']);
const PIVOT_MOVE_IDS = new Set(['uturn', 'voltswitch', 'partingshot', 'flipturn', 'teleport', 'chillyreception', 'batonpass']);
const PRIORITY_MOVE_IDS = new Set(['extremespeed', 'shadowSneak', 'suckerpunch', 'grassyglide', 'iceshard', 'machpunch', 'aquajet', 'bulletpunch', 'vacuumwave'].map((value) => value.toLowerCase()));
const GENERIC_ITEM_POOL = ['Leftovers', 'Sitrus Berry', 'Lum Berry', 'Focus Sash', 'Life Orb', 'Assault Vest', 'Choice Scarf', 'Choice Band', 'Choice Specs', 'Rocky Helmet', 'Air Balloon', 'Mental Herb'];
const COVERAGE_TYPE_PRIORITY = ['Ground', 'Ice', 'Fire', 'Electric', 'Fighting', 'Fairy', 'Ghost', 'Dark', 'Steel', 'Water'];

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function toId(value: string | undefined): string {
  return normalize(value).replace(/[^a-z0-9]/g, '');
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

function chooseAbility(speciesName: string, dex: SpeciesDexPort): string {
  const species = dex.getSpecies(speciesName);
  if (!species) return '';

  return [...species.abilities]
    .sort((left, right) => (dex.getAbility(right)?.rating ?? 0) - (dex.getAbility(left)?.rating ?? 0))[0] ?? species.abilities[0] ?? '';
}

function getPreferredCategory(speciesName: string, dex: SpeciesDexPort): 'Physical' | 'Special' {
  const species = dex.getSpecies(speciesName);
  if (!species) return 'Physical';
  return species.baseStats.spa > species.baseStats.atk ? 'Special' : 'Physical';
}

function scoreOffensiveMove(move: MoveInfo, speciesName: string, dex: SpeciesDexPort, preferredCategory: 'Physical' | 'Special'): number {
  const species = dex.getSpecies(speciesName);
  if (!species || move.category === 'Status') return -999;

  let score = move.basePower ?? 0;
  if (species.types.includes(move.type)) score += 24;
  if (move.category === preferredCategory) score += 12;
  if (move.priority > 0) score += 18 + move.priority * 5;
  if (move.selfSwitch) score += 8;

  const coverageIndex = COVERAGE_TYPE_PRIORITY.findIndex((type) => type === move.type);
  if (coverageIndex >= 0) score += COVERAGE_TYPE_PRIORITY.length - coverageIndex;

  const text = `${move.shortDesc ?? ''}`.toLowerCase();
  if (text.includes('must recharge') || text.includes('charges, then attacks')) score -= 18;
  return score;
}

function dedupeMoveNames(moves: MoveInfo[]): MoveInfo[] {
  const seen = new Set<string>();
  return moves.filter((move) => {
    const id = toId(move.name);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function getMovesFromPool(learnableMoves: MoveInfo[], pool: Set<string>): MoveInfo[] {
  return dedupeMoveNames(learnableMoves.filter((move) => pool.has(move.id)));
}

function buildMoves(speciesName: string, dex: SpeciesDexPort, options: PreviewOptions = {}): string[] {
  const species = dex.getSpecies(speciesName);
  if (!species) return [];

  const preferredCategory = getPreferredCategory(speciesName, dex);
  const learnableMoves = dex.getLearnableMoves(speciesName);
  const damagingMoves = learnableMoves.filter((move) => move.category !== 'Status' && (move.basePower ?? 0) >= 40);
  const stabMoves = dedupeMoveNames(
    damagingMoves
      .filter((move) => species.types.includes(move.type))
      .sort((left, right) => scoreOffensiveMove(right, speciesName, dex, preferredCategory) - scoreOffensiveMove(left, speciesName, dex, preferredCategory)),
  );
  const coverageMoves = dedupeMoveNames(
    damagingMoves
      .filter((move) => !species.types.includes(move.type))
      .sort((left, right) => scoreOffensiveMove(right, speciesName, dex, preferredCategory) - scoreOffensiveMove(left, speciesName, dex, preferredCategory)),
  );

  const bulky = species.baseStats.hp + Math.max(species.baseStats.def, species.baseStats.spd) >= 185;
  const offensive = Math.max(species.baseStats.atk, species.baseStats.spa) >= 110;
  const utilityMoves: MoveInfo[] = [];

  if (options.roleHint === 'hazard-control') utilityMoves.push(...getMovesFromPool(learnableMoves, HAZARD_CONTROL_MOVE_IDS));
  if (options.roleHint === 'disruption') utilityMoves.push(...getMovesFromPool(learnableMoves, DISRUPTION_MOVE_IDS));
  if (options.roleHint === 'pivot') utilityMoves.push(...getMovesFromPool(learnableMoves, PIVOT_MOVE_IDS));
  if (options.roleHint === 'speed') utilityMoves.push(...getMovesFromPool(learnableMoves, SETUP_MOVE_IDS), ...getMovesFromPool(learnableMoves, PRIORITY_MOVE_IDS));

  if (offensive) utilityMoves.push(...getMovesFromPool(learnableMoves, SETUP_MOVE_IDS));
  if (bulky) utilityMoves.push(...getMovesFromPool(learnableMoves, RECOVERY_MOVE_IDS), ...getMovesFromPool(learnableMoves, DISRUPTION_MOVE_IDS));
  if (bulky || species.baseStats.spe >= 80) utilityMoves.push(...getMovesFromPool(learnableMoves, PIVOT_MOVE_IDS));
  if (bulky) utilityMoves.push(...getMovesFromPool(learnableMoves, HAZARD_CONTROL_MOVE_IDS));

  const chosen: MoveInfo[] = [];
  const pushUnique = (move?: MoveInfo) => {
    if (!move) return;
    if (chosen.some((entry) => toId(entry.name) === toId(move.name))) return;
    chosen.push(move);
  };

  pushUnique(stabMoves[0]);
  pushUnique(stabMoves[1] ?? coverageMoves[0]);

  for (const move of dedupeMoveNames(utilityMoves)) {
    if (chosen.length >= 4) break;
    pushUnique(move);
  }

  for (const move of [...stabMoves, ...coverageMoves, ...learnableMoves]) {
    if (chosen.length >= 4) break;
    pushUnique(move);
  }

  return chosen.slice(0, 4).map((move) => move.name);
}

function buildItemOptions(speciesName: string, dex: SpeciesDexPort, moves: string[], options: PreviewOptions = {}): string[] {
  const species = dex.getSpecies(speciesName);
  if (!species) return GENERIC_ITEM_POOL;

  const offensive = Math.max(species.baseStats.atk, species.baseStats.spa) >= 110;
  const bulky = species.baseStats.hp + Math.max(species.baseStats.def, species.baseStats.spd) >= 185;
  const fast = species.baseStats.spe >= 100;
  const preferredCategory = getPreferredCategory(speciesName, dex);
  const moveIds = new Set(moves.map((move) => toId(move)));

  const items: string[] = [];
  if (species.requiredItem) items.push(species.requiredItem);
  if (bulky) items.push('Leftovers', 'Sitrus Berry', 'Rocky Helmet');
  if (fast || options.roleHint === 'speed') items.push('Choice Scarf', 'Focus Sash');
  if (moveIds.has('dragondance') || moveIds.has('swordsdance') || moveIds.has('quiverdance') || moveIds.has('nastyplot') || moveIds.has('calmmind')) {
    items.push('Lum Berry', 'Life Orb', 'Leftovers');
  }
  if (offensive && preferredCategory === 'Physical') items.push('Choice Band');
  if (offensive && preferredCategory === 'Special') items.push('Choice Specs');
  if (bulky && !moveIds.has('recover') && !moveIds.has('roost')) items.push('Assault Vest');

  return Array.from(new Set([...items, ...GENERIC_ITEM_POOL]));
}

function buildNature(speciesName: string, dex: SpeciesDexPort, moves: string[], options: PreviewOptions = {}): string {
  const species = dex.getSpecies(speciesName);
  if (!species) return 'Serious';

  const preferredCategory = getPreferredCategory(speciesName, dex);
  const bulky = options.roleHint === 'bulky'
    || options.roleHint === 'hazard-control'
    || species.baseStats.hp + Math.max(species.baseStats.def, species.baseStats.spd) >= 190;
  const wantsSpeed = options.roleHint === 'speed' || species.baseStats.spe >= 95 || moves.some((move) => SETUP_MOVE_IDS.has(toId(move)));

  if (bulky) {
    if (species.baseStats.def >= species.baseStats.spd) return preferredCategory === 'Special' ? 'Bold' : 'Impish';
    return preferredCategory === 'Special' ? 'Calm' : 'Careful';
  }

  if (wantsSpeed) return preferredCategory === 'Special' ? 'Timid' : 'Jolly';
  return preferredCategory === 'Special' ? 'Modest' : 'Adamant';
}

function buildEvs(speciesName: string, dex: SpeciesDexPort, moves: string[], options: PreviewOptions = {}): Partial<StatsTable> | undefined {
  const species = dex.getSpecies(speciesName);
  if (!species) return undefined;

  const preferredCategory = getPreferredCategory(speciesName, dex);
  const bulky = options.roleHint === 'bulky'
    || options.roleHint === 'hazard-control'
    || species.baseStats.hp + Math.max(species.baseStats.def, species.baseStats.spd) >= 190;

  if (bulky) {
    if (species.baseStats.def >= species.baseStats.spd) return { hp: 252, def: 252, spd: 4 };
    return { hp: 252, def: 4, spd: 252 };
  }

  if (preferredCategory === 'Special') return { spa: 252, spe: 252, def: 4 };
  return { atk: 252, spe: 252, spd: 4 };
}

function buildIvs(speciesName: string, dex: SpeciesDexPort): Partial<StatsTable> | undefined {
  return getPreferredCategory(speciesName, dex) === 'Special' ? { atk: 0 } : undefined;
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T> | undefined)?.then === 'function';
}

function formatSetPreview(set: PokemonSet, format?: FormatId): string {
  const statLabel = format && isChampionsLikeFormat(format) ? 'Stat Points' : 'EVs';

  const lines = [
    set.item ? `${set.species} @ ${set.item}` : set.species,
    set.ability ? `Ability: ${set.ability}` : null,
    formatStatsLine(statLabel, set.evs),
    formatStatsLine('IVs', set.ivs),
    set.nature ? `${set.nature} Nature` : null,
    `Moves: ${set.moves.join(' / ')}`,
  ].filter((value): value is string => Boolean(value));

  return lines.join(' | ');
}

export function getCompetitiveSetPreview(
  speciesName: string,
  format: FormatId,
  dex: SpeciesDexPort,
  validator: ValidationPort,
  options: PreviewOptions = {},
): string | null {
  const species = dex.getSpecies(speciesName);
  if (!species) return null;

  const moves = buildMoves(species.name, dex, options);
  if (moves.length === 0) return null;

  const ability = chooseAbility(species.name, dex);
  const nature = buildNature(species.name, dex, moves, options);
  const evs = convertStatPoints(buildEvs(species.name, dex, moves, options), format);
  const ivs = normalizeIvs(buildIvs(species.name, dex));
  const itemOptions = buildItemOptions(species.name, dex, moves, options);

  for (const item of itemOptions) {
    const set: PokemonSet = {
      species: species.name,
      item,
      ability,
      nature,
      moves,
      level: 50,
      evs,
      ivs,
    };

    const result = validator.validateSet(set, format);
    if (isPromiseLike<ValidationSetResult>(result)) {
      continue;
    }

    if (result.valid) {
      return formatSetPreview(result.normalizedSet ?? set, format);
    }
  }

  return null;
}

export function prioritizePreviewableCandidates(
  candidates: string[],
  format: FormatId,
  dex: SpeciesDexPort,
  validator: ValidationPort,
  options: PreviewOptions = {},
): string[] {
  const previewable = candidates.filter((name) => Boolean(getCompetitiveSetPreview(name, format, dex, validator, options)));
  const rest = candidates.filter((name) => !previewable.includes(name));
  return [...previewable, ...rest];
}
