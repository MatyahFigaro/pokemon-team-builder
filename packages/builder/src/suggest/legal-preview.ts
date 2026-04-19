import type { FormatId, MoveInfo, PokemonSet, SpeciesDexPort, StatsTable, ValidationPort, ValidationSetResult } from '@pokemon/domain';

export type PreviewRoleHint = 'default' | 'hazard-control' | 'disruption' | 'pivot' | 'speed' | 'bulky' | 'offense';

interface PreviewOptions {
  roleHint?: PreviewRoleHint;
}

const PHYSICAL_SETUP_MOVE_IDS = new Set(['dragondance', 'swordsdance', 'bulkup', 'curse']);
const SPECIAL_SETUP_MOVE_IDS = new Set(['nastyplot', 'calmmind', 'quiverdance']);
const SPEED_SETUP_MOVE_IDS = new Set(['agility', 'rockpolish', 'trailblaze']);
const RECOVERY_MOVE_IDS = new Set(['roost', 'recover', 'slackoff', 'softboiled', 'moonlight', 'morningsun', 'synthesis', 'shoreup', 'milkdrink', 'rest']);
const DISRUPTION_MOVE_IDS = new Set(['taunt', 'encore', 'haze', 'clearsmog', 'thunderwave', 'willowisp', 'yawn', 'roar', 'whirlwind', 'dragontail', 'trickroom']);
const HAZARD_CONTROL_MOVE_IDS = new Set(['defog', 'rapidspin', 'mortalspin', 'courtchange']);
const PIVOT_MOVE_IDS = new Set(['uturn', 'voltswitch', 'partingshot', 'flipturn', 'teleport', 'chillyreception', 'batonpass']);
const PRIORITY_MOVE_IDS = new Set(['extremespeed', 'shadowsneak', 'suckerpunch', 'grassyglide', 'iceshard', 'machpunch', 'aquajet', 'bulletpunch', 'vacuumwave']);
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

function isLowQualityFallbackMove(move: MoveInfo): boolean {
  const text = `${move.shortDesc ?? ''}`.toLowerCase();

  return move.id === 'gigaimpact'
    || move.id === 'hyperbeam'
    || move.id === 'focuspunch'
    || move.id === 'steelbeam'
    || text.includes('must recharge')
    || text.includes('charges, then attacks')
    || text.includes('fails unless')
    || text.includes('if hit by an attack')
    || text.includes('the user faints')
    || text.includes('the user loses 50% of its max hp')
    || text.includes('harshly lowers the user');
}

function scoreOffensiveMove(move: MoveInfo, speciesName: string, dex: SpeciesDexPort, preferredCategory: 'Physical' | 'Special'): number {
  const species = dex.getSpecies(speciesName);
  if (!species || move.category === 'Status') return -999;
  if (isLowQualityFallbackMove(move)) return -120;

  let score = move.basePower ?? 0;
  if (species.types.includes(move.type)) score += 28;
  else if (move.type === 'Normal') score -= 30;
  if (move.category === preferredCategory) score += 18;
  else score -= 28;
  if ((move.basePower ?? 0) < 60) score -= 8;
  if (move.priority > 0) score += 18 + move.priority * 5;
  if (move.selfSwitch) score += 8;

  const coverageIndex = COVERAGE_TYPE_PRIORITY.findIndex((type) => type === move.type);
  if (coverageIndex >= 0) score += COVERAGE_TYPE_PRIORITY.length - coverageIndex;

  const text = `${move.shortDesc ?? ''}`.toLowerCase();
  if (text.includes('must recharge') || text.includes('charges, then attacks')) score -= 18;
  if (text.includes('recoil')) score -= 18;
  if (text.includes('uses the target') && text.includes('attack stat')) score -= 22;
  if (text.includes('locks the user') || text.includes('lasts 2-3 turns')) score -= 10;
  if (text.includes('the user faints') || text.includes('harshly lowers the user')) score -= 14;
  if (text.includes('lows the user') || text.includes('lowers the user')) score -= 6;

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

function isSetupMoveForCategory(move: MoveInfo, preferredCategory: 'Physical' | 'Special'): boolean {
  if (move.category !== 'Status') return false;

  if (SPEED_SETUP_MOVE_IDS.has(move.id)) return true;
  if (preferredCategory === 'Physical' && PHYSICAL_SETUP_MOVE_IDS.has(move.id)) return true;
  if (preferredCategory === 'Special' && SPECIAL_SETUP_MOVE_IDS.has(move.id)) return true;

  const boosts = move.boosts ?? {};
  if ((boosts.spe ?? 0) > 0) return true;
  if (preferredCategory === 'Physical' && (boosts.atk ?? 0) > 0) return true;
  if (preferredCategory === 'Special' && (boosts.spa ?? 0) > 0) return true;

  return false;
}

function getPreferredCategory(speciesName: string, dex: SpeciesDexPort): 'Physical' | 'Special' {
  const species = dex.getSpecies(speciesName);
  if (!species) return 'Physical';

  const learnableMoves = dex.getLearnableMoves(speciesName);
  const scoreCategory = (category: 'Physical' | 'Special'): number => {
    const offensiveStat = category === 'Special' ? species.baseStats.spa : species.baseStats.atk;
    const bestMoves = learnableMoves
      .filter((move) => move.category === category && (move.basePower ?? 0) >= 60)
      .sort((left, right) => scoreOffensiveMove(right, speciesName, dex, category) - scoreOffensiveMove(left, speciesName, dex, category))
      .slice(0, 3)
      .reduce((sum, move) => sum + Math.max(0, scoreOffensiveMove(move, speciesName, dex, category)), 0);

    return offensiveStat * 2 + bestMoves;
  };

  return scoreCategory('Special') > scoreCategory('Physical') ? 'Special' : 'Physical';
}

function getMoveInfos(moves: string[], dex: SpeciesDexPort): MoveInfo[] {
  return moves
    .map((move) => dex.getMove(move))
    .filter((move): move is MoveInfo => Boolean(move));
}

function shouldUseBulkySpread(
  speciesName: string,
  dex: SpeciesDexPort,
  moves: string[],
  options: PreviewOptions = {},
): boolean {
  const species = dex.getSpecies(speciesName);
  if (!species) return false;

  const moveInfos = getMoveInfos(moves, dex);
  const hasNaturalBulk = species.baseStats.hp + Math.max(species.baseStats.def, species.baseStats.spd) >= 195;
  const hasSupportUtility = moveInfos.some((move) => RECOVERY_MOVE_IDS.has(move.id) || DISRUPTION_MOVE_IDS.has(move.id) || HAZARD_CONTROL_MOVE_IDS.has(move.id));

  return hasNaturalBulk && (options.roleHint === 'bulky' || options.roleHint === 'hazard-control' || hasSupportUtility || species.baseStats.spe < 80);
}

function buildMoves(speciesName: string, dex: SpeciesDexPort, options: PreviewOptions = {}): string[] {
  const species = dex.getSpecies(speciesName);
  if (!species) return [];

  const preferredCategory = getPreferredCategory(speciesName, dex);
  const learnableMoves = dex.getLearnableMoves(speciesName);
  const sameCategoryDamagingMoves = learnableMoves.filter(
    (move) => move.category === preferredCategory && (move.basePower ?? 0) >= 55 && !isLowQualityFallbackMove(move),
  );
  const damagingMoves = (sameCategoryDamagingMoves.length
    ? sameCategoryDamagingMoves
    : learnableMoves.filter((move) => move.category !== 'Status' && (move.basePower ?? 0) >= 60 && !isLowQualityFallbackMove(move)))
    .sort((left, right) => scoreOffensiveMove(right, speciesName, dex, preferredCategory) - scoreOffensiveMove(left, speciesName, dex, preferredCategory));

  const stabMoves = dedupeMoveNames(damagingMoves.filter((move) => species.types.includes(move.type)));
  const coverageMoves = dedupeMoveNames(damagingMoves.filter((move) => !species.types.includes(move.type)));
  const recoveryMoves = getMovesFromPool(learnableMoves, RECOVERY_MOVE_IDS);
  const disruptionMoves = getMovesFromPool(learnableMoves, DISRUPTION_MOVE_IDS);
  const hazardControlMoves = getMovesFromPool(learnableMoves, HAZARD_CONTROL_MOVE_IDS);
  const pivotMoves = getMovesFromPool(learnableMoves, PIVOT_MOVE_IDS);
  const priorityMoves = getMovesFromPool(learnableMoves, PRIORITY_MOVE_IDS);
  const setupMoves = dedupeMoveNames(learnableMoves.filter((move) => isSetupMoveForCategory(move, preferredCategory)));

  const chosen: MoveInfo[] = [];
  const pushUnique = (move?: MoveInfo) => {
    if (!move) return;
    if (chosen.some((entry) => toId(entry.name) === toId(move.name))) return;
    chosen.push(move);
  };

  pushUnique(stabMoves[0] ?? damagingMoves[0]);
  pushUnique(stabMoves[1] ?? coverageMoves[0] ?? damagingMoves[1]);

  if (options.roleHint === 'hazard-control') pushUnique(hazardControlMoves[0]);
  if (options.roleHint === 'disruption') pushUnique(disruptionMoves[0]);
  if (options.roleHint === 'pivot') pushUnique(pivotMoves[0]);
  if (options.roleHint === 'speed') {
    pushUnique(setupMoves.find((move) => (move.boosts?.spe ?? 0) > 0) ?? priorityMoves[0] ?? setupMoves[0]);
  }

  const wantsBulkyUtility = shouldUseBulkySpread(speciesName, dex, chosen.map((move) => move.name), options);
  if (wantsBulkyUtility) {
    pushUnique(recoveryMoves[0]);
    pushUnique(disruptionMoves[0]);
    pushUnique(pivotMoves[0]);
  } else {
    pushUnique(setupMoves[0]);
    pushUnique(priorityMoves[0]);
    pushUnique(pivotMoves[0]);
  }

  for (const move of [...stabMoves.slice(1), ...coverageMoves.slice(1), ...damagingMoves, ...recoveryMoves, ...disruptionMoves, ...setupMoves, ...pivotMoves, ...hazardControlMoves]) {
    if (chosen.length >= 4) break;
    pushUnique(move);
  }

  return chosen.slice(0, 4).map((move) => move.name);
}

function buildItemOptions(speciesName: string, dex: SpeciesDexPort, moves: string[], options: PreviewOptions = {}): string[] {
  const species = dex.getSpecies(speciesName);
  if (!species) return GENERIC_ITEM_POOL;

  const preferredCategory = getPreferredCategory(speciesName, dex);
  const moveInfos = getMoveInfos(moves, dex);
  const damagingCount = moveInfos.filter((move) => move.category !== 'Status').length;
  const statusCount = moveInfos.length - damagingCount;
  const bulky = shouldUseBulkySpread(speciesName, dex, moves, options);
  const fast = species.baseStats.spe >= 100;
  const offensive = Math.max(species.baseStats.atk, species.baseStats.spa) >= 110;
  const hasSetup = moveInfos.some((move) => isSetupMoveForCategory(move, preferredCategory));
  const hasRecovery = moveInfos.some((move) => RECOVERY_MOVE_IDS.has(move.id));

  const items: string[] = [];
  if (species.requiredItem) items.push(species.requiredItem);
  if (bulky || hasRecovery || options.roleHint === 'hazard-control') items.push('Leftovers', 'Sitrus Berry', 'Rocky Helmet');
  if (fast || options.roleHint === 'speed') items.push('Focus Sash', 'Choice Scarf');
  if (hasSetup) items.push('Lum Berry', 'Life Orb');
  if (offensive && statusCount === 0 && damagingCount >= 3 && preferredCategory === 'Physical') items.push('Choice Band');
  if (offensive && statusCount === 0 && damagingCount >= 3 && preferredCategory === 'Special') items.push('Choice Specs');
  if (bulky && statusCount === 0) items.push('Assault Vest');

  return Array.from(new Set([...items, ...GENERIC_ITEM_POOL]));
}

function buildNature(speciesName: string, dex: SpeciesDexPort, moves: string[], options: PreviewOptions = {}): string {
  const species = dex.getSpecies(speciesName);
  if (!species) return 'Serious';

  const preferredCategory = getPreferredCategory(speciesName, dex);
  const moveInfos = getMoveInfos(moves, dex);
  const bulky = shouldUseBulkySpread(speciesName, dex, moves, options);
  const wantsSpeed = options.roleHint === 'speed'
    || species.baseStats.spe >= 95
    || moveInfos.some((move) => isSetupMoveForCategory(move, preferredCategory) || PRIORITY_MOVE_IDS.has(move.id));

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
  const bulky = shouldUseBulkySpread(speciesName, dex, moves, options);

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

function passesPreviewQualityGate(speciesName: string, moves: string[], dex: SpeciesDexPort): boolean {
  const species = dex.getSpecies(speciesName);
  if (!species) return false;

  const preferredCategory = getPreferredCategory(speciesName, dex);
  const moveInfos = getMoveInfos(moves, dex);
  const damagingMoves = moveInfos.filter((move) => move.category !== 'Status');
  const badMoves = moveInfos.filter((move) => isLowQualityFallbackMove(move));
  const sameCategoryHits = damagingMoves.filter((move) => move.category === preferredCategory);
  const stabHits = damagingMoves.filter((move) => species.types.includes(move.type));
  const weakCoverage = damagingMoves.filter((move) => !species.types.includes(move.type) && move.type === 'Normal');
  const averageScore = damagingMoves.length
    ? damagingMoves.reduce((sum, move) => sum + scoreOffensiveMove(move, speciesName, dex, preferredCategory), 0) / damagingMoves.length
    : 0;

  if (moves.length < 4) return false;
  if (badMoves.length > 0) return false;
  if (weakCoverage.length > 0) return false;
  if (sameCategoryHits.length < 1) return false;
  if (stabHits.length < 1) return false;
  if (averageScore < 55) return false;
  if (damagingMoves.length < 2 && !shouldUseBulkySpread(speciesName, dex, moves)) return false;

  return true;
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
  if (moves.length === 0 || !passesPreviewQualityGate(species.name, moves, dex)) return null;

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
