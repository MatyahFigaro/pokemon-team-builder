import type { FormatId, MoveInfo, PokemonSet, SpeciesDexPort, StatsTable, ValidationPort, ValidationSetResult } from '@pokemon/domain';
import { getSpeciesUsage, getTopUsageNames, listManualSets, type ManualSetRecord } from '@pokemon/storage';

export type PreviewRoleHint = 'default' | 'hazard-control' | 'disruption' | 'pivot' | 'speed' | 'bulky' | 'offense';

interface PreviewOptions {
  roleHint?: PreviewRoleHint;
  style?: string;
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

function chooseAbility(speciesName: string, dex: SpeciesDexPort, format?: FormatId): string {
  const species = dex.getSpecies(speciesName);
  if (!species) return '';

  const usageWeights = new Map((getSpeciesUsage(format ?? '', speciesName)?.abilities ?? []).map((entry) => [toId(entry.name), entry.usage]));

  return [...species.abilities]
    .sort((left, right) => {
      const usageDiff = (usageWeights.get(toId(right)) ?? 0) - (usageWeights.get(toId(left)) ?? 0);
      if (usageDiff !== 0) return usageDiff;
      return (dex.getAbility(right)?.rating ?? 0) - (dex.getAbility(left)?.rating ?? 0);
    })[0] ?? species.abilities[0] ?? '';
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

function getPreferredCategory(speciesName: string, dex: SpeciesDexPort, format?: FormatId): 'Physical' | 'Special' {
  const species = dex.getSpecies(speciesName);
  if (!species) return 'Physical';

  const statDiff = species.baseStats.spa - species.baseStats.atk;
  const learnableMoves = dex.getLearnableMoves(speciesName);
  const learnableMoveIds = new Set(learnableMoves.map((move) => move.id));
  const abilityIds = new Set(species.abilities.map(toId));

  if (statDiff >= 15) return 'Special';
  if (statDiff <= -15) return 'Physical';
  if (abilityIds.has('contrary') && (learnableMoveIds.has('leafstorm') || learnableMoveIds.has('overheat') || learnableMoveIds.has('dracometeor'))) {
    return 'Special';
  }

  const usageWeights = new Map((getSpeciesUsage(format ?? '', speciesName)?.moves ?? []).map((entry) => [toId(entry.name), entry.usage]));
  const scoreCategory = (category: 'Physical' | 'Special'): number => {
    const offensiveStat = category === 'Special' ? species.baseStats.spa : species.baseStats.atk;
    const bestMoves = learnableMoves
      .filter((move) => move.category === category && (move.basePower ?? 0) >= 60)
      .sort((left, right) => scoreOffensiveMove(right, speciesName, dex, category) - scoreOffensiveMove(left, speciesName, dex, category))
      .slice(0, 4)
      .reduce((sum, move) => sum + Math.max(0, scoreOffensiveMove(move, speciesName, dex, category)) + ((usageWeights.get(move.id) ?? 0) * 2), 0);

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
  format?: FormatId,
): boolean {
  const species = dex.getSpecies(speciesName);
  if (!species) return false;

  const moveInfos = getMoveInfos(moves, dex);
  const hasNaturalBulk = species.baseStats.hp + Math.max(species.baseStats.def, species.baseStats.spd) >= 195;
  const hasSupportUtility = moveInfos.some((move) => RECOVERY_MOVE_IDS.has(move.id) || DISRUPTION_MOVE_IDS.has(move.id) || HAZARD_CONTROL_MOVE_IDS.has(move.id));

  return hasNaturalBulk && (options.roleHint === 'bulky' || options.roleHint === 'hazard-control' || hasSupportUtility || species.baseStats.spe < 80);
}

function buildMoves(speciesName: string, format: FormatId, dex: SpeciesDexPort, options: PreviewOptions = {}): string[] {
  const species = dex.getSpecies(speciesName);
  if (!species) return [];

  const preferredCategory = getPreferredCategory(speciesName, dex, format);
  const usageWeights = new Map((getSpeciesUsage(format, speciesName)?.moves ?? []).map((entry) => [toId(entry.name), entry.usage]));
  const learnableMoves = dex.getLearnableMoves(speciesName);
  const sortByUsageAndPower = (moves: MoveInfo[]) => dedupeMoveNames(moves)
    .sort((left, right) => {
      const leftScore = scoreOffensiveMove(left, speciesName, dex, preferredCategory) + ((usageWeights.get(left.id) ?? 0) * 3);
      const rightScore = scoreOffensiveMove(right, speciesName, dex, preferredCategory) + ((usageWeights.get(right.id) ?? 0) * 3);
      return rightScore - leftScore;
    });
  const sameCategoryDamagingMoves = learnableMoves.filter(
    (move) => move.category === preferredCategory && (move.basePower ?? 0) >= 55 && !isLowQualityFallbackMove(move),
  );
  const damagingMoves = sortByUsageAndPower(sameCategoryDamagingMoves.length
    ? sameCategoryDamagingMoves
    : learnableMoves.filter((move) => move.category !== 'Status' && (move.basePower ?? 0) >= 60 && !isLowQualityFallbackMove(move)));

  const stabMoves = sortByUsageAndPower(damagingMoves.filter((move) => species.types.includes(move.type)));
  const coverageMoves = sortByUsageAndPower(damagingMoves.filter((move) => !species.types.includes(move.type)));
  const recoveryMoves = sortByUsageAndPower(getMovesFromPool(learnableMoves, RECOVERY_MOVE_IDS));
  const disruptionMoves = sortByUsageAndPower(getMovesFromPool(learnableMoves, DISRUPTION_MOVE_IDS));
  const hazardControlMoves = sortByUsageAndPower(getMovesFromPool(learnableMoves, HAZARD_CONTROL_MOVE_IDS));
  const pivotMoves = sortByUsageAndPower(getMovesFromPool(learnableMoves, PIVOT_MOVE_IDS));
  const priorityMoves = sortByUsageAndPower(getMovesFromPool(learnableMoves, PRIORITY_MOVE_IDS));
  const setupMoves = sortByUsageAndPower(learnableMoves.filter((move) => isSetupMoveForCategory(move, preferredCategory)));

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

  const wantsBulkyUtility = shouldUseBulkySpread(speciesName, dex, chosen.map((move) => move.name), options, format);
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

function buildItemOptions(speciesName: string, format: FormatId, dex: SpeciesDexPort, moves: string[], options: PreviewOptions = {}): string[] {
  const species = dex.getSpecies(speciesName);
  if (!species) return GENERIC_ITEM_POOL;

  const preferredCategory = getPreferredCategory(speciesName, dex, format);
  const moveInfos = getMoveInfos(moves, dex);
  const damagingCount = moveInfos.filter((move) => move.category !== 'Status').length;
  const statusCount = moveInfos.length - damagingCount;
  const bulky = shouldUseBulkySpread(speciesName, dex, moves, options);
  const fast = species.baseStats.spe >= 100;
  const offensive = Math.max(species.baseStats.atk, species.baseStats.spa) >= 110;
  const abilityIds = new Set(species.abilities.map(toId));
  const hasSetup = moveInfos.some((move) => isSetupMoveForCategory(move, preferredCategory));
  const hasRecovery = moveInfos.some((move) => RECOVERY_MOVE_IDS.has(move.id));
  const hasDisruption = moveInfos.some((move) => DISRUPTION_MOVE_IDS.has(move.id));
  const choiceFriendly = !hasSetup && !hasRecovery && statusCount === 0;
  const abilityDrivenBreaker = abilityIds.has('contrary') || abilityIds.has('technician') || abilityIds.has('hugepower') || abilityIds.has('purepower');

  const usageItems = getTopUsageNames(getSpeciesUsage(format, speciesName)?.items, 6);
  const items: string[] = [...usageItems];
  if (species.requiredItem) items.push(species.requiredItem);
  if (bulky || hasRecovery || hasDisruption || options.roleHint === 'hazard-control') items.push('Leftovers', 'Sitrus Berry', 'Rocky Helmet');
  if (fast || options.roleHint === 'speed') items.push('Focus Sash');
  if ((offensive || abilityDrivenBreaker) && !bulky) items.push('Life Orb', 'Lum Berry');
  if ((fast || options.roleHint === 'speed') && choiceFriendly && (offensive || species.baseStats.spe >= 115)) items.push('Choice Scarf');
  if (hasSetup) items.push('Lum Berry', 'Life Orb');
  if ((offensive || abilityDrivenBreaker) && choiceFriendly && damagingCount >= 3 && preferredCategory === 'Physical') items.push('Choice Band');
  if ((offensive || abilityDrivenBreaker) && choiceFriendly && damagingCount >= 3 && preferredCategory === 'Special') items.push('Choice Specs');
  if (bulky && statusCount === 0) items.push('Assault Vest');

  return Array.from(new Set([...items, ...GENERIC_ITEM_POOL]));
}

function buildNature(speciesName: string, dex: SpeciesDexPort, moves: string[], options: PreviewOptions = {}, format?: FormatId): string {
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

function buildEvs(speciesName: string, dex: SpeciesDexPort, moves: string[], options: PreviewOptions = {}, format?: FormatId): Partial<StatsTable> | undefined {
  const species = dex.getSpecies(speciesName);
  if (!species) return undefined;

  const preferredCategory = getPreferredCategory(speciesName, dex, format);
  const bulky = shouldUseBulkySpread(speciesName, dex, moves, options, format);

  if (bulky) {
    if (species.baseStats.def >= species.baseStats.spd) return { hp: 252, def: 252, spd: 4 };
    return { hp: 252, def: 4, spd: 252 };
  }

  if (preferredCategory === 'Special') return { spa: 252, spe: 252, def: 4 };
  return { atk: 252, spe: 252, spd: 4 };
}

function buildIvs(speciesName: string, dex: SpeciesDexPort, format?: FormatId): Partial<StatsTable> | undefined {
  return getPreferredCategory(speciesName, dex, format) === 'Special' ? { atk: 0 } : undefined;
}

function getValidatedUsageSet(
  speciesName: string,
  format: FormatId,
  dex: SpeciesDexPort,
  validator: ValidationPort,
  options: PreviewOptions = {},
): PokemonSet | null {
  const species = dex.getSpecies(speciesName);
  const usage = getSpeciesUsage(format, speciesName);
  if (!species || !usage) return null;

  const preferredCategory = getPreferredCategory(species.name, dex, format);
  const usageWeights = new Map((usage.moves ?? []).map((entry) => [toId(entry.name), entry.usage]));
  const learnableMoveIds = new Set(dex.getLearnableMoves(species.name).map((move) => move.id));
  const usageMoves = getTopUsageNames(usage.moves, 14)
    .map((moveName) => dex.getMove(moveName))
    .filter((move): move is MoveInfo => Boolean(move))
    .filter((move) => !isLowQualityFallbackMove(move))
    .filter((move) => move.category === 'Status' || learnableMoveIds.has(move.id));

  const sortByUsageAndPower = (moves: MoveInfo[]) => dedupeMoveNames(moves)
    .sort((left, right) => {
      const leftScore = scoreOffensiveMove(left, species.name, dex, preferredCategory) + ((usageWeights.get(left.id) ?? 0) * 4);
      const rightScore = scoreOffensiveMove(right, species.name, dex, preferredCategory) + ((usageWeights.get(right.id) ?? 0) * 4);
      return rightScore - leftScore;
    });

  const chosen: MoveInfo[] = [];
  const pushUnique = (move?: MoveInfo) => {
    if (!move) return;
    if (chosen.some((entry) => entry.id === move.id)) return;
    chosen.push(move);
  };

  const damagingMoves = sortByUsageAndPower(usageMoves.filter((move) => move.category !== 'Status' && (move.basePower ?? 0) >= 55));
  const stabMoves = damagingMoves.filter((move) => species.types.includes(move.type));
  const coverageMoves = damagingMoves.filter((move) => !species.types.includes(move.type));
  const recoveryMoves = sortByUsageAndPower(usageMoves.filter((move) => RECOVERY_MOVE_IDS.has(move.id)));
  const disruptionMoves = sortByUsageAndPower(usageMoves.filter((move) => DISRUPTION_MOVE_IDS.has(move.id)));
  const pivotMoves = sortByUsageAndPower(usageMoves.filter((move) => PIVOT_MOVE_IDS.has(move.id)));
  const priorityMoves = sortByUsageAndPower(usageMoves.filter((move) => PRIORITY_MOVE_IDS.has(move.id)));
  const setupMoves = sortByUsageAndPower(usageMoves.filter((move) => isSetupMoveForCategory(move, preferredCategory)));

  pushUnique(stabMoves[0] ?? damagingMoves[0]);
  pushUnique(stabMoves[1] ?? coverageMoves[0] ?? damagingMoves[1]);

  if (options.roleHint === 'pivot') pushUnique(pivotMoves[0]);
  if (options.roleHint === 'speed') pushUnique(priorityMoves[0] ?? setupMoves[0]);
  if (options.roleHint === 'bulky' || options.roleHint === 'hazard-control') {
    pushUnique(recoveryMoves[0]);
    pushUnique(disruptionMoves[0]);
  } else {
    pushUnique(setupMoves[0]);
    pushUnique(priorityMoves[0]);
    pushUnique(pivotMoves[0]);
  }

  const fallbackMoves = buildMoves(species.name, format, dex, options)
    .map((moveName) => dex.getMove(moveName))
    .filter((move): move is MoveInfo => Boolean(move));

  for (const move of [...coverageMoves, ...damagingMoves, ...recoveryMoves, ...disruptionMoves, ...priorityMoves, ...setupMoves, ...pivotMoves, ...fallbackMoves]) {
    if (chosen.length >= 4) break;
    pushUnique(move);
  }

  const moves = chosen.slice(0, 4).map((move) => move.name);
  if (moves.length === 0 || !passesPreviewQualityGate(species.name, moves, dex, format)) return null;

  const abilityOptions = Array.from(new Set([
    ...getTopUsageNames(usage.abilities, 3),
    chooseAbility(species.name, dex, format),
  ].filter(Boolean)));
  const itemOptions = Array.from(new Set([
    ...getTopUsageNames(usage.items, 6),
    ...buildItemOptions(species.name, format, dex, moves, options),
  ].filter(Boolean)));
  const teraType = getTopUsageNames(usage.teraTypes, 1)[0] ?? chooseTeraType(species.name, format, dex);
  const nature = buildNature(species.name, dex, moves, options, format);
  const evs = convertStatPoints(buildEvs(species.name, dex, moves, options, format), format);
  const ivs = normalizeIvs(buildIvs(species.name, dex, format));

  for (const ability of abilityOptions) {
    for (const item of itemOptions) {
      const set: PokemonSet = {
        species: species.name,
        item,
        ability,
        nature,
        moves,
        level: 50,
        teraType,
        evs,
        ivs,
      };

      const result = validator.validateSet(set, format);
      if (isPromiseLike<ValidationSetResult>(result)) continue;

      const normalized = result.normalizedSet ?? set;
      if (result.valid && passesSetConsistencyGate(normalized, dex, format)) return normalized;
    }
  }

  return null;
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T> | undefined)?.then === 'function';
}

function inferManualRoleHints(record: ManualSetRecord, dex: SpeciesDexPort, format: FormatId): Set<PreviewRoleHint> {
  const hints = new Set<PreviewRoleHint>();
  const roles = new Set([...(record.roles ?? []), ...(record.set.roles ?? [])]);
  const moveInfos = getMoveInfos(record.set.moves, dex);
  const itemId = toId(record.set.item);

  if (roles.has('pivot') || moveInfos.some((move) => PIVOT_MOVE_IDS.has(move.id))) hints.add('pivot');
  if (roles.has('hazard-removal') || roles.has('hazard-setter') || moveInfos.some((move) => HAZARD_CONTROL_MOVE_IDS.has(move.id))) hints.add('hazard-control');
  if (
    roles.has('speed-control')
    || roles.has('scarfer')
    || roles.has('lead')
    || itemId === 'choicescarf'
    || moveInfos.some((move) => SPEED_SETUP_MOVE_IDS.has(move.id) || PRIORITY_MOVE_IDS.has(move.id) || move.id === 'trickroom')
  ) {
    hints.add('speed');
  }

  if (
    roles.has('physical-wall')
    || roles.has('special-wall')
    || roles.has('cleric')
    || shouldUseBulkySpread(record.set.species, dex, record.set.moves, { roleHint: 'bulky' }, format)
    || moveInfos.some((move) => RECOVERY_MOVE_IDS.has(move.id))
  ) {
    hints.add('bulky');
  }

  if (
    roles.has('wallbreaker')
    || roles.has('physical-attacker')
    || roles.has('special-attacker')
    || roles.has('setup-sweeper')
    || moveInfos.some((move) => isSetupMoveForCategory(move, getPreferredCategory(record.set.species, dex, format)))
  ) {
    hints.add('offense');
  }

  if (hints.size === 0) hints.add('default');
  return hints;
}

function inferManualStyleIds(record: ManualSetRecord, dex: SpeciesDexPort, format: FormatId): Set<string> {
  const styles = new Set((record.styles ?? []).map((style) => toId(style)));
  const text = `${record.label ?? ''} ${record.notes ?? ''}`.toLowerCase();
  const moveIds = new Set(getMoveInfos(record.set.moves, dex).map((move) => move.id));
  const abilityId = toId(record.set.ability);

  if (text.includes('bulky offense') || text.includes('bulky-offense')) styles.add('bulkyoffense');
  if (text.includes('hyper offense') || text.includes('hyper-offense')) styles.add('hyperoffense');
  if (text.includes('trick room') || text.includes('trick-room')) styles.add('trickroom');
  if (text.includes('balance') || text.includes('balanced')) styles.add('balance');
  if (text.includes('rain')) styles.add('rain');

  if (moveIds.has('trickroom')) styles.add('trickroom');
  if (moveIds.has('raindance') || abilityId === 'swiftswim' || abilityId === 'drizzle') styles.add('rain');

  const species = dex.getSpecies(record.set.species);
  if (species && Math.max(species.baseStats.atk, species.baseStats.spa) >= 115 && species.baseStats.spe >= 85) {
    styles.add('hyperoffense');
  }

  if (species && shouldUseBulkySpread(record.set.species, dex, record.set.moves, { roleHint: 'bulky' }, format)) {
    styles.add('balance');
    if (moveIds.size >= 3) styles.add('bulkyoffense');
  }

  return styles;
}

function scoreManualSetCandidate(
  record: ManualSetRecord,
  speciesName: string,
  format: FormatId,
  dex: SpeciesDexPort,
  options: PreviewOptions = {},
): number {
  const requested = dex.getSpecies(speciesName);
  const requestedSpeciesId = toId(speciesName);
  const requestedRequiredItem = requested?.requiredItem ? toId(requested.requiredItem) : '';
  const storedSpeciesId = toId(record.set.species);
  const storedItemId = toId(record.set.item);
  const roleHints = inferManualRoleHints(record, dex, format);
  const styleIds = inferManualStyleIds(record, dex, format);

  let score = storedSpeciesId === requestedSpeciesId ? 120 : 80;
  if (requestedRequiredItem && storedItemId === requestedRequiredItem) score += 25;

  if (options.roleHint && options.roleHint !== 'default') {
    if (roleHints.has(options.roleHint)) score += 40;
    else if (options.roleHint === 'offense' && roleHints.has('speed')) score += 12;
    else if (options.roleHint === 'speed' && roleHints.has('offense')) score += 12;
  }

  const requestedStyleId = toId(options.style);
  if (requestedStyleId) {
    if (styleIds.has(requestedStyleId)) score += 35;
    else if (requestedStyleId === 'bulkyoffense' && (styleIds.has('balance') || styleIds.has('hyperoffense'))) score += 10;
    else if (requestedStyleId === 'balance' && styleIds.has('bulkyoffense')) score += 10;
  }

  if (record.label && toId(record.label).includes('default')) score += 4;
  if (record.notes) score += 2;
  score += Math.min(8, record.set.moves.length * 2);

  return score;
}

function getManualSetCandidates(
  speciesName: string,
  format: FormatId,
  dex: SpeciesDexPort,
  options: PreviewOptions = {},
): ManualSetRecord[] {
  const requested = dex.getSpecies(speciesName);
  const requestedRequiredItem = requested?.requiredItem ? toId(requested.requiredItem) : '';
  const requestedSpeciesId = toId(speciesName);

  return listManualSets({ format })
    .filter((record) => {
      const storedSpeciesId = toId(record.set.species);
      const storedItemId = toId(record.set.item);

      if (storedSpeciesId === requestedSpeciesId) return true;
      if (requestedRequiredItem && storedItemId === requestedRequiredItem) return true;

      const storedSpecies = dex.getSpecies(record.set.species);
      const storedRequiredItem = storedSpecies?.requiredItem ? toId(storedSpecies.requiredItem) : '';
      return Boolean(storedRequiredItem && requestedRequiredItem && storedRequiredItem === requestedRequiredItem);
    })
    .sort((left, right) => {
      const scoreDiff = scoreManualSetCandidate(right, speciesName, format, dex, options) - scoreManualSetCandidate(left, speciesName, format, dex, options);
      if (scoreDiff !== 0) return scoreDiff;
      return right.updatedAt.localeCompare(left.updatedAt);
    });
}

function getValidatedManualSet(
  speciesName: string,
  format: FormatId,
  dex: SpeciesDexPort,
  validator: ValidationPort,
  options: PreviewOptions = {},
): PokemonSet | null {
  for (const record of getManualSetCandidates(speciesName, format, dex, options)) {
    if (!passesSetConsistencyGate(record.set, dex, format)) continue;

    const result = validator.validateSet(record.set, format);
    if (isPromiseLike<ValidationSetResult>(result)) continue;

    const normalized = result.normalizedSet ?? record.set;
    if (result.valid && passesSetConsistencyGate(normalized, dex, format)) return normalized;
  }

  return null;
}

function passesPreviewQualityGate(speciesName: string, moves: string[], dex: SpeciesDexPort, format?: FormatId): boolean {
  const species = dex.getSpecies(speciesName);
  if (!species) return false;

  const preferredCategory = getPreferredCategory(speciesName, dex, format);
  const moveInfos = getMoveInfos(moves, dex);
  const damagingMoves = moveInfos.filter((move) => move.category !== 'Status');
  const badMoves = moveInfos.filter((move) => isLowQualityFallbackMove(move));
  const sameCategoryHits = damagingMoves.filter((move) => move.category === preferredCategory);
  const stabHits = damagingMoves.filter((move) => species.types.includes(move.type));
  const weakCoverage = damagingMoves.filter((move) => !species.types.includes(move.type) && move.type === 'Normal');
  const averageScore = damagingMoves.length
    ? damagingMoves.reduce((sum, move) => sum + scoreOffensiveMove(move, speciesName, dex, preferredCategory), 0) / damagingMoves.length
    : 0;
  const bulky = shouldUseBulkySpread(speciesName, dex, moves, {}, format);

  if (moves.length < 4) return false;
  if (badMoves.length > 0) return false;
  if (weakCoverage.length > 0) return false;
  if (sameCategoryHits.length < 1) return false;
  if (!bulky && damagingMoves.length >= 3 && sameCategoryHits.length < 2) return false;
  if (stabHits.length < 1) return false;
  if (averageScore < 55) return false;
  if (damagingMoves.length < 2 && !bulky) return false;

  return true;
}

function passesSetConsistencyGate(set: PokemonSet, dex: SpeciesDexPort, format: FormatId): boolean {
  if (!passesPreviewQualityGate(set.species, set.moves, dex, format)) return false;

  const moveInfos = getMoveInfos(set.moves, dex);
  const damagingMoves = moveInfos.filter((move) => move.category !== 'Status');
  const statusMoves = moveInfos.filter((move) => move.category === 'Status');
  const preferredCategory = getPreferredCategory(set.species, dex, format);
  const sameCategoryHits = damagingMoves.filter((move) => move.category === preferredCategory);
  const setupMoveCount = moveInfos.filter((move) => isSetupMoveForCategory(move, preferredCategory)).length;
  const recoveryMoveCount = moveInfos.filter((move) => RECOVERY_MOVE_IDS.has(move.id)).length;
  const itemId = toId(set.item);
  const bulky = shouldUseBulkySpread(set.species, dex, set.moves, {}, format);

  if (!bulky && statusMoves.length > 1) return false;
  if (!bulky && damagingMoves.length >= 3 && sameCategoryHits.length < 2) return false;
  if (setupMoveCount > 1) return false;

  if (itemId === 'assaultvest' && statusMoves.length > 0) return false;
  if (['choiceband', 'choicespecs', 'choicescarf'].includes(itemId) && (statusMoves.length > 0 || setupMoveCount > 0 || recoveryMoveCount > 0)) {
    return false;
  }

  return true;
}

function chooseTeraType(speciesName: string, format: FormatId, dex: SpeciesDexPort): string | undefined {
  const species = dex.getSpecies(speciesName);
  if (!species) return undefined;

  const topTera = getSpeciesUsage(format, speciesName)?.teraTypes?.[0]?.name;
  if (topTera) return topTera;
  return species.types[0];
}

function formatSetPreview(set: PokemonSet, format?: FormatId): string {
  const statLabel = format && isChampionsLikeFormat(format) ? 'Stat Points' : 'EVs';

  const lines = [
    set.item ? `${set.species} @ ${set.item}` : set.species,
    set.ability ? `Ability: ${set.ability}` : null,
    set.teraType ? `Tera Type: ${set.teraType}` : null,
    formatStatsLine(statLabel, set.evs),
    formatStatsLine('IVs', set.ivs),
    set.nature ? `${set.nature} Nature` : null,
    `Moves: ${set.moves.join(' / ')}`,
  ].filter((value): value is string => Boolean(value));

  return lines.join(' | ');
}

export function getCompetitiveSet(
  speciesName: string,
  format: FormatId,
  dex: SpeciesDexPort,
  validator: ValidationPort,
  options: PreviewOptions = {},
): PokemonSet | null {
  const species = dex.getSpecies(speciesName);
  if (!species) return null;

  const manualSet = getValidatedManualSet(species.name, format, dex, validator, options);
  if (manualSet) return manualSet;

  const usageSet = getValidatedUsageSet(species.name, format, dex, validator, options);
  if (usageSet) return usageSet;

  const moves = buildMoves(species.name, format, dex, options);
  if (moves.length === 0 || !passesPreviewQualityGate(species.name, moves, dex, format)) return null;

  const ability = chooseAbility(species.name, dex, format);
  const nature = buildNature(species.name, dex, moves, options, format);
  const evs = convertStatPoints(buildEvs(species.name, dex, moves, options, format), format);
  const ivs = normalizeIvs(buildIvs(species.name, dex, format));
  const teraType = chooseTeraType(species.name, format, dex);
  const itemOptions = buildItemOptions(species.name, format, dex, moves, options);

  for (const item of itemOptions) {
    const set: PokemonSet = {
      species: species.name,
      item,
      ability,
      nature,
      moves,
      level: 50,
      teraType,
      evs,
      ivs,
    };

    const result = validator.validateSet(set, format);
    if (isPromiseLike<ValidationSetResult>(result)) {
      continue;
    }

    if (result.valid) {
      const normalized = result.normalizedSet ?? set;
      if (passesSetConsistencyGate(normalized, dex, format)) {
        return normalized;
      }
    }
  }

  return null;
}

export function getCompetitiveSetPreview(
  speciesName: string,
  format: FormatId,
  dex: SpeciesDexPort,
  validator: ValidationPort,
  options: PreviewOptions = {},
): string | null {
  const set = getCompetitiveSet(speciesName, format, dex, validator, options);
  return set ? formatSetPreview(set, format) : null;
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
