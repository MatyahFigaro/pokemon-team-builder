import type { PokemonSet, SpeciesDexPort, Suggestion, Team, ValidationPort } from '@pokemon/domain';
import { getSpeciesUsage, getTopUsageNames, getTopUsageThreatNames, getUsageAnalyticsForFormat, getUsageWeight, preloadUsageAnalytics } from '@pokemon/storage';

import { summarizeRoles } from '../analysis/roles.js';
import { getCompetitiveSet, getCompetitiveSetPreview, type PreviewRoleHint } from '../suggest/legal-preview.js';
import { analyzeTeam, type AnalyzeTeamDeps } from './analyze-team.js';

export interface PreviewMatchupPlan {
  recommendedLead: string;
  recommendedBring: string[];
  benchOrder: string[];
  opponentLikelyLeads: string[];
  opponentBacklinePatterns: string[];
  pace: 'fast' | 'balanced' | 'slow';
  speedNotes: string[];
  damageNotes: string[];
  winConditions: string[];
  reasons: string[];
}

export interface SetOptimizationEntry {
  member: string;
  summary: string;
  changes: string[];
  preview: string;
}

export interface TeamSetOptimizationReport {
  optimizedTeam: Team;
  suggestions: Suggestion[];
  entries: SetOptimizationEntry[];
}

export interface MetaScoutingEntry {
  species: string;
  usage: number;
  rank?: number;
  commonMoves: string[];
  commonItems: string[];
  commonAbility?: string;
  commonTera?: string;
}

export interface MetaScoutingReport {
  format: string;
  source: string;
  updatedAt: string;
  resolvedFormat?: string;
  exactMatch: boolean;
  topThreats: MetaScoutingEntry[];
  commonCores: string[];
  antiMetaIdeas: string[];
  notes: string[];
}

export interface BuildConstraints {
  format: string;
  coreSpecies?: string[];
  style?: 'balance' | 'hyper-offense' | 'bulky-offense' | 'stall' | 'trick-room' | 'rain' | 'sun' | 'sand';
  avoidSpecies?: string[];
  allowRestricted?: boolean;
}

export interface BuildRecommendation {
  species: string;
  score: number;
  reasons: string[];
  preview?: string | null;
}

export interface ConstrainedBuildReport {
  format: string;
  style: string;
  anchors: string[];
  missingRoles: string[];
  recommendations: BuildRecommendation[];
  notes: string[];
}

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function toId(value: string | undefined): string {
  return normalize(value).replace(/[^a-z0-9]/g, '');
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T> | undefined)?.then === 'function';
}

function memberName(member: Team['members'][number]): string {
  return member.name?.trim() || member.species;
}

function formatStatSpread(stats?: PokemonSet['evs']): string {
  if (!stats) return 'default spread';

  const parts = Object.entries(stats)
    .filter(([, value]) => typeof value === 'number' && value > 0)
    .map(([stat, value]) => `${value} ${stat.toUpperCase()}`);

  return parts.length ? parts.join(' / ') : 'default spread';
}

const BUILD_HAZARD_MOVES = ['Stealth Rock', 'Spikes', 'Toxic Spikes', 'Sticky Web'];
const BUILD_PIVOT_MOVES = ['U-turn', 'Volt Switch', 'Parting Shot', 'Flip Turn', 'Teleport', 'Chilly Reception'];
const BUILD_RECOVERY_MOVES = ['Recover', 'Roost', 'Slack Off', 'Soft-Boiled', 'Moonlight', 'Morning Sun', 'Synthesis', 'Rest'];
const BUILD_SUPPORT_MOVES = ['Will-O-Wisp', 'Thunder Wave', 'Yawn', 'Encore', 'Taunt', 'Trick', 'Haze', 'Roar', 'Whirlwind', 'Dragon Tail', 'Trick Room'];
const BUILD_PRIORITY_MOVES = ['Extreme Speed', 'Sucker Punch', 'Aqua Jet', 'Ice Shard', 'Mach Punch', 'Bullet Punch', 'Shadow Sneak', 'Vacuum Wave'];

function hasConfiguredHazardMove(set: Pick<PokemonSet, 'moves'> | undefined): boolean {
  return (set?.moves ?? []).some((move) => BUILD_HAZARD_MOVES.some((hazard) => toId(hazard) === toId(move)));
}

function getHazardTagsFromPreview(preview?: string | null): string[] {
  if (!preview) return [];
  const movesSection = preview.split('Moves:')[1];
  if (!movesSection) return [];

  const moveIds = movesSection.split('/').map((move) => toId(move));
  const hazards = BUILD_HAZARD_MOVES.filter((move) => moveIds.includes(toId(move)));
  return hazards.length ? ['hazard', ...hazards.map((move) => `hazard:${toId(move)}`)] : [];
}

interface ClassicTypeCore {
  name: string;
  types: string[];
  preferredStyles: Array<NonNullable<BuildConstraints['style']>>;
  pressureTypes: string[];
}

const CLASSIC_TYPE_CORES: ClassicTypeCore[] = [
  {
    name: 'Fire / Water / Grass',
    types: ['Fire', 'Water', 'Grass'],
    preferredStyles: ['balance', 'bulky-offense'],
    pressureTypes: ['Dragon', 'Flying'],
  },
  {
    name: 'Steel / Fairy / Dragon',
    types: ['Steel', 'Fairy', 'Dragon'],
    preferredStyles: ['balance', 'bulky-offense', 'hyper-offense'],
    pressureTypes: ['Ground', 'Ghost'],
  },
  {
    name: 'Fighting / Dark / Psychic',
    types: ['Fighting', 'Dark', 'Psychic'],
    preferredStyles: ['hyper-offense', 'bulky-offense'],
    pressureTypes: ['Fairy', 'Flying'],
  },
];

function getRoleHint(roles: string[]): PreviewRoleHint {
  if (roles.includes('hazard-removal')) return 'hazard-control';
  if (roles.includes('pivot')) return 'pivot';
  if (roles.includes('speed-control') || roles.includes('lead')) return 'speed';
  if (roles.includes('physical-wall') || roles.includes('special-wall')) return 'bulky';
  if (roles.includes('setup-sweeper')) return 'offense';
  return 'default';
}

function canLearnAnyMove(speciesName: string, moveNames: string[], dex: SpeciesDexPort): boolean {
  return moveNames.some((moveName) => dex.canLearnMove(speciesName, moveName));
}

function isBssLikeFormat(format: string): boolean {
  const id = toId(format);
  return id.includes('bss') || id.includes('battlestadium') || id.includes('championsbss');
}

function getMegaBaseName(speciesName: string): string {
  const megaIndex = speciesName.indexOf('-Mega');
  return megaIndex >= 0 ? speciesName.slice(0, megaIndex) : speciesName;
}

function isMegaSpecies(species: NonNullable<ReturnType<SpeciesDexPort['getSpecies']>>, dex: SpeciesDexPort): boolean {
  if (!species.requiredItem) return false;
  const item = dex.getItem(species.requiredItem);
  return Boolean(item?.megaStone || item?.megaEvolves || species.name.includes('-Mega'));
}

function isMegaSet(set: Pick<PokemonSet, 'species' | 'item'>, dex: SpeciesDexPort): boolean {
  if (set.species.includes('-Mega')) return true;

  if (set.item) {
    const item = dex.getItem(set.item);
    if (item?.megaStone || item?.megaEvolves) return true;
  }

  const species = dex.getSpecies(set.species);
  return species ? isMegaSpecies(species, dex) : false;
}

function getUsageWeightForCandidate(format: string, species: NonNullable<ReturnType<SpeciesDexPort['getSpecies']>>, dex: SpeciesDexPort): number {
  const direct = getUsageWeight(format, species.name);
  if (direct > 0) return direct;

  if (isMegaSpecies(species, dex)) {
    return getUsageWeight(format, getMegaBaseName(species.name)) * 0.95;
  }

  return direct;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildThreatSimulationTeam(format: string, dex: SpeciesDexPort, validator: ValidationPort): Team | null {
  const snapshot = getUsageAnalyticsForFormat(format);
  const topCluster = snapshot?.species.length
    ? uniqueStrings(
      snapshot.species.slice(0, 4).flatMap((entry, index) => [
        entry.species,
        ...getTopUsageNames(entry.teammates, index === 0 ? 2 : 1),
      ]),
    )
    : getTopUsageThreatNames(format, 8);

  const members = topCluster
    .map((speciesName) => getCompetitiveSet(speciesName, format, dex, validator, {
      roleHint: getBuildRoleHint(speciesName, dex),
    }))
    .filter((set): set is PokemonSet => Boolean(set))
    .slice(0, 3);

  if (members.length === 0) return null;

  return {
    format,
    source: 'generated',
    members,
  };
}

function hydrateTeamForSimulation(team: Team, deps: AnalyzeTeamDeps): Team {
  return {
    ...team,
    members: team.members.map((member) => {
      if (member.moves.length >= 4 && member.item && member.ability) return member;

      return getCompetitiveSet(member.species, team.format, deps.dex, deps.validator, {
        roleHint: getBuildRoleHint(member.species, deps.dex),
      }) ?? member;
    }),
  };
}

async function rescoreTopCandidatesWithSimulation(
  candidates: RankedBuildCandidate[],
  seedTeam: Team,
  constraints: BuildConstraints,
  deps: AnalyzeTeamDeps,
): Promise<RankedBuildCandidate[]> {
  if (!deps.simulator) return candidates;

  const probeOpponent = buildThreatSimulationTeam(constraints.format, deps.dex, deps.validator);
  if (!probeOpponent) return candidates;

  const simulationWindow = Math.min(8, candidates.length);
  const rescored = await Promise.all(candidates.slice(0, simulationWindow).map(async (candidate) => {
    const candidateSet = getCompetitiveSet(candidate.species, constraints.format, deps.dex, deps.validator, {
      roleHint: getBuildRoleHint(candidate.species, deps.dex, constraints.style),
      style: constraints.style,
    }) ?? buildAnchorSeedSet(candidate.species, constraints.format, deps.dex, deps.validator, getBuildRoleHint(candidate.species, deps.dex, constraints.style));

    if (!candidateSet) return candidate;

    const simTeam: Team = {
      format: constraints.format,
      source: 'generated',
      members: [...seedTeam.members.slice(0, 2), candidateSet]
        .filter((member, index, array) => array.findIndex((entry) => toId(entry.species) === toId(member.species)) === index)
        .slice(0, 3),
    };

    const summary = await deps.simulator?.simulateMatchup({
      format: constraints.format,
      team: simTeam,
      opponent: probeOpponent,
      iterations: 3,
    });

    if (!summary) return candidate;

    let score = candidate.score + Math.round((summary.winRate - 0.5) * 28);
    const reasons = [...candidate.reasons];

    if (summary.winRate >= 0.62) {
      reasons.unshift(`tests well in Showdown-backed sims into current live pressure (${Math.round(summary.winRate * 100)}%)`);
    } else if (summary.winRate <= 0.42) {
      score -= 4;
      reasons.push('still looks shaky in simulation against the current threat cluster');
    } else {
      reasons.push('simulation looks playable but matchup-dependent into the live threat core');
    }

    return {
      ...candidate,
      score,
      reasons: uniqueStrings(reasons).slice(0, 3),
    } satisfies RankedBuildCandidate;
  }));

  return [...rescored, ...candidates.slice(simulationWindow)]
    .sort((left, right) => right.score - left.score || left.species.localeCompare(right.species));
}

function getBuildRoleHint(speciesName: string, dex: SpeciesDexPort, style?: BuildConstraints['style']): PreviewRoleHint {
  const species = dex.getSpecies(speciesName);
  if (!species) return 'default';

  const abilityIds = species.abilities.map(toId);

  if (canLearnAnyMove(speciesName, BUILD_PIVOT_MOVES, dex)) return 'pivot';
  if (canLearnAnyMove(speciesName, BUILD_HAZARD_MOVES, dex)) return 'hazard-control';
  if (style === 'stall') return 'bulky';
  if (style === 'rain' && (species.types.includes('Water') || abilityIds.some((id) => id === 'drizzle' || id === 'swiftswim'))) return 'offense';
  if (style === 'sun' && (species.types.includes('Fire') || species.types.includes('Grass') || abilityIds.some((id) => id === 'drought' || id === 'chlorophyll' || id === 'solarpower' || id === 'protosynthesis'))) return 'offense';
  if (style === 'sand' && (species.types.some((type) => ['Ground', 'Rock', 'Steel'].includes(type)) || abilityIds.some((id) => id === 'sandstream' || id === 'sandrush' || id === 'sandforce'))) return 'bulky';
  if (style === 'trick-room' || species.baseStats.spe <= 70) return 'bulky';
  if (Math.max(species.baseStats.atk, species.baseStats.spa) >= 115 || species.baseStats.spe >= 100) return 'offense';
  if (species.baseStats.hp + Math.max(species.baseStats.def, species.baseStats.spd) >= 190) return 'bulky';

  return 'default';
}

function buildFallbackAnchorMoves(speciesName: string, dex: SpeciesDexPort, roleHint: PreviewRoleHint): string[] {
  const species = dex.getSpecies(speciesName);
  if (!species) return [];

  const learnableMoves = dex.getLearnableMoves(speciesName);
  const moveMap = new Map(learnableMoves.map((move) => [toId(move.name), move]));
  const preferredCategory = species.baseStats.spa > species.baseStats.atk ? 'Special' : 'Physical';
  const chosen: string[] = [];

  const pushByName = (moveNames: string[]) => {
    for (const moveName of moveNames) {
      const move = moveMap.get(toId(moveName));
      if (!move || chosen.includes(move.name)) continue;
      chosen.push(move.name);
      if (chosen.length >= 4) break;
    }
  };

  if (roleHint === 'hazard-control') pushByName(BUILD_HAZARD_MOVES);
  if (roleHint === 'pivot') pushByName(BUILD_PIVOT_MOVES);
  if (roleHint === 'bulky') pushByName(BUILD_RECOVERY_MOVES);
  if (roleHint === 'offense' || roleHint === 'speed') pushByName(BUILD_PRIORITY_MOVES);
  pushByName(BUILD_SUPPORT_MOVES);

  const damagingMoves = learnableMoves
    .filter((move) => move.category !== 'Status' && (move.basePower ?? 0) >= 50)
    .sort((left, right) => {
      const leftStab = species.types.includes(left.type) ? 25 : 0;
      const rightStab = species.types.includes(right.type) ? 25 : 0;
      const leftStat = left.category === preferredCategory ? 15 : 0;
      const rightStat = right.category === preferredCategory ? 15 : 0;
      return ((right.basePower ?? 0) + rightStab + rightStat) - ((left.basePower ?? 0) + leftStab + leftStat);
    });

  for (const move of damagingMoves) {
    if (chosen.length >= 4) break;
    if (!chosen.includes(move.name)) chosen.push(move.name);
  }

  return chosen.slice(0, 4);
}

function buildAnchorSeedSet(
  speciesName: string,
  format: string,
  dex: SpeciesDexPort,
  validator: ValidationPort,
  roleHint: PreviewRoleHint,
): PokemonSet | null {
  const species = dex.getSpecies(speciesName);
  if (!species) return null;

  const ability = species.abilities[0] ?? '';
  const moves = buildFallbackAnchorMoves(speciesName, dex, roleHint);
  if (!ability || moves.length === 0) return null;

  const nature = roleHint === 'bulky'
    ? (species.baseStats.def >= species.baseStats.spd ? 'Impish' : 'Careful')
    : (species.baseStats.spa > species.baseStats.atk ? 'Modest' : 'Adamant');
  const evs = roleHint === 'bulky'
    ? { hp: 252, def: species.baseStats.def >= species.baseStats.spd ? 252 : 4, spd: species.baseStats.def >= species.baseStats.spd ? 4 : 252 }
    : (species.baseStats.spa > species.baseStats.atk ? { spa: 252, spe: 252, hp: 4 } : { atk: 252, spe: 252, hp: 4 });
  const items = Array.from(new Set([species.requiredItem, 'Leftovers', 'Sitrus Berry', 'Focus Sash', 'Life Orb', 'Rocky Helmet'].filter(Boolean))) as string[];

  for (const item of items) {
    const set: PokemonSet = {
      species: species.name,
      item,
      ability,
      nature,
      moves,
      level: 50,
      evs,
    };

    const result = validator.validateSet(set, format);
    if (isPromiseLike(result)) continue;
    if (result.valid) return result.normalizedSet ?? set;
  }

  const basicSet: PokemonSet = {
    species: species.name,
    ability,
    nature,
    moves,
    level: 50,
    evs,
  };

  const fallbackResult = validator.validateSet(basicSet, format);
  if (isPromiseLike(fallbackResult)) return basicSet;
  return fallbackResult.valid ? (fallbackResult.normalizedSet ?? basicSet) : basicSet;
}

function inferMissingRolesFromAnchors(seedTeam: Team, report: Awaited<ReturnType<typeof analyzeTeam>>, dex: SpeciesDexPort): string[] {
  const inferred = new Set(report.synergy.missingRoles);
  const anchorSpecies = seedTeam.members.map((member) => member.species);

  if (anchorSpecies.some((speciesName) => canLearnAnyMove(speciesName, BUILD_HAZARD_MOVES, dex))) {
    inferred.delete('hazard setter');
  }

  if (anchorSpecies.some((speciesName) => canLearnAnyMove(speciesName, BUILD_PIVOT_MOVES, dex))) {
    inferred.delete('pivot');
  }

  if (isBssLikeFormat(seedTeam.format)) {
    inferred.delete('hazard removal');

    if (!report.speed.hasSpeedControl) {
      inferred.add('speed control');
    }

    if ((report.archetypes?.weakMatchups ?? []).some((label) => normalize(label).includes('stall') || normalize(label).includes('fat'))) {
      inferred.add('stallbreaker');
    }
  }

  return [...inferred];
}

function scoreClassicTypeCoreFit(
  candidate: NonNullable<ReturnType<SpeciesDexPort['getSpecies']>>,
  seedTeam: Team,
  style: BuildConstraints['style'],
  dex: SpeciesDexPort,
): { score: number; reasons: string[]; notes: string[] } {
  const teamTypes = new Set(seedTeam.members.flatMap((member) => dex.getSpecies(member.species)?.types ?? []));
  const candidateTypes = new Set(candidate.types);
  let score = 0;
  const reasons: string[] = [];
  const notes: string[] = [];

  for (const core of CLASSIC_TYPE_CORES) {
    const present = core.types.filter((type) => teamTypes.has(type));
    if (present.length === 0) continue;

    const missing = core.types.filter((type) => !teamTypes.has(type));
    const added = missing.filter((type) => candidateTypes.has(type));

    if (added.length > 0) {
      score += (present.length >= 2 ? 7 : 4) + (added.length * 2);
      if (style && core.preferredStyles.includes(style)) score += 2;
      reasons.push(`helps complete a ${core.name} backbone`);
      notes.push(`Recognized a ${core.name} shell among the anchors and boosted type-completing partners.`);
    }

    if (missing.length === 0) {
      const coveredPressure = core.pressureTypes.filter((type) => dex.getTypeEffectiveness(type, candidate.types) < 1);
      if (coveredPressure.length > 0) {
        score += Math.min(6, coveredPressure.length * 3);
        reasons.push(`helps cover common ${core.name} pressure from ${coveredPressure.join(', ')}`);
        notes.push(`The builder is also patching typical ${core.name} pressure lines such as ${core.pressureTypes.join(' and ')} attacks.`);
      }
    }
  }

  return {
    score,
    reasons: Array.from(new Set(reasons)),
    notes: Array.from(new Set(notes)),
  };
}

function scoreGuideDrivenBssFit(
  candidate: NonNullable<ReturnType<SpeciesDexPort['getSpecies']>>,
  seedTeam: Team,
  report: Awaited<ReturnType<typeof analyzeTeam>>,
  format: string,
  style: BuildConstraints['style'],
  dex: SpeciesDexPort,
): { score: number; reasons: string[]; notes: string[] } {
  if (!isBssLikeFormat(format)) return { score: 0, reasons: [], notes: [] };

  const offense = Math.max(candidate.baseStats.atk, candidate.baseStats.spa);
  const bulk = candidate.baseStats.hp + Math.max(candidate.baseStats.def, candidate.baseStats.spd);
  const hasPivot = canLearnAnyMove(candidate.name, BUILD_PIVOT_MOVES, dex);
  const hasDisruption = canLearnAnyMove(candidate.name, BUILD_SUPPORT_MOVES, dex);
  const hasPriority = canLearnAnyMove(candidate.name, BUILD_PRIORITY_MOVES, dex);
  const weakMatchups = report.archetypes?.weakMatchups ?? [];
  const pressureThreats = report.threats?.topPressureThreats ?? [];

  let score = 0;
  const reasons: string[] = [];
  const notes: string[] = [];

  if (report.battlePlan.speedControlRating === 'poor') {
    if (candidate.baseStats.spe >= 100) {
      score += 8;
      reasons.push('gives the shell a clearer speed benchmark for BSS');
    } else if (hasPriority) {
      score += 5;
      reasons.push('adds emergency priority for short BSS endgames');
    }
  }

  if ((hasPivot || hasDisruption) && (candidate.baseStats.spe >= 90 || bulk >= 180)) {
    score += 5;
    reasons.push('fits a real bring-3 shell as a safe lead or pivot');
    notes.push('Bring-3 scoring now prefers realistic lead plus backline shells, not just six individually strong picks.');
  }

  if (weakMatchups.some((label) => normalize(label).includes('setup')) && hasDisruption) {
    score += 4;
    reasons.push('adds anti-setup counterplay that matters in BSS');
  }

  if (weakMatchups.some((label) => normalize(label).includes('stall') || normalize(label).includes('fat')) && (hasDisruption || offense >= 120)) {
    score += 6;
    reasons.push('helps avoid passive lines into stall or fat builds');
  }

  const patchedThreats = pressureThreats
    .slice(0, 5)
    .map((threat) => dex.getSpecies(threat.species))
    .filter((species): species is NonNullable<ReturnType<SpeciesDexPort['getSpecies']>> => Boolean(species))
    .filter((threat) => threat.types.some((type) => dex.getTypeEffectiveness(type, candidate.types) < 1)
      || candidate.types.some((type) => dex.getTypeEffectiveness(type, threat.types) > 1))
    .map((threat) => threat.name);

  if (patchedThreats.length > 0) {
    score += Math.min(8, patchedThreats.length * 2);
    reasons.push(`patches live BSS pressure from ${patchedThreats.slice(0, 2).join(', ')}`);
    notes.push('Top-format threats from the live ladder are now part of the completion scoring.');
  }

  if (style === 'hyper-offense' && (candidate.baseStats.spe >= 110 || offense >= 125 || hasPriority)) {
    score += 4;
    reasons.push('supports a proactive snowball gameplan');
  }

  if (style === 'bulky-offense' && offense >= 105 && bulk >= 175) {
    score += 4;
    reasons.push('matches the bulky offense pacing from the guide');
  }

  if (style === 'balance' && (hasPivot || (bulk >= 185 && hasDisruption))) {
    score += 4;
    reasons.push('gives the core a safer defensive switch pattern');
  }

  if (style === 'stall' && bulk >= 195 && (hasDisruption || canLearnAnyMove(candidate.name, BUILD_RECOVERY_MOVES, dex))) {
    score += 6;
    reasons.push('fits a slower coverage-first stall structure');
  }

  return {
    score,
    reasons: Array.from(new Set(reasons)),
    notes: Array.from(new Set(notes)),
  };
}

function scoreAnchorFit(
  candidate: NonNullable<ReturnType<SpeciesDexPort['getSpecies']>>,
  seedTeam: Team,
  format: string,
  dex: SpeciesDexPort,
  style?: BuildConstraints['style'],
): { score: number; reasons: string[]; notes: string[] } {
  if (seedTeam.members.length === 0) return { score: 0, reasons: [], notes: [] };

  const anchorIds = new Set(seedTeam.members.map((member) => toId(member.species)));
  const anchorTypes = new Set(seedTeam.members.flatMap((member) => dex.getSpecies(member.species)?.types ?? []));
  const usageRecord = getSpeciesUsage(format, candidate.name);
  const teammateMatches = (usageRecord?.teammates ?? []).filter((ally) => anchorIds.has(toId(ally.name)));

  let score = teammateMatches.length * 4;
  const reasons: string[] = [];
  const notes: string[] = [];

  const classicCoreFit = scoreClassicTypeCoreFit(candidate, seedTeam, style, dex);
  score += classicCoreFit.score;
  reasons.push(...classicCoreFit.reasons);
  notes.push(...classicCoreFit.notes);

  if (teammateMatches.length > 0) {
    reasons.push(`shows live teammate synergy with ${teammateMatches.slice(0, 2).map((ally) => ally.name).join(', ')}`);
  }

  const coveredTypes = new Set<string>();
  for (const anchor of seedTeam.members) {
    for (const type of dex.listTypes()) {
      const anchorWeak = dex.getMatchupMultiplier(type, anchor, format) > 1;
      const candidateCheck = dex.getTypeEffectiveness(type, candidate.types);
      if (anchorWeak && candidateCheck < 1) {
        coveredTypes.add(type);
      }
    }
  }

  if (coveredTypes.size > 0) {
    score += Math.min(8, coveredTypes.size * 2);
    reasons.push(`covers anchor pressure from ${[...coveredTypes].slice(0, 3).join(', ')}`);
  }

  const freshTypes = candidate.types.filter((type) => !anchorTypes.has(type));
  if (freshTypes.length > 0) {
    score += Math.min(4, freshTypes.length * 2);
    reasons.push('broadens the anchor core type coverage');
  }

  if (canLearnAnyMove(candidate.name, BUILD_PIVOT_MOVES, dex)) {
    score += 3;
    reasons.push('can bring the anchors in safely');
  }

  if (canLearnAnyMove(candidate.name, BUILD_HAZARD_MOVES, dex)) {
    score += 2;
    reasons.push('adds valuable support for anchor endgames');
  }

  return {
    score,
    reasons: Array.from(new Set(reasons)),
    notes: Array.from(new Set(notes)),
  };
}

function getBestDamagingMove(attackerSet: PokemonSet, defenderSet: PokemonSet, dex: SpeciesDexPort, format: string) {
  const attacker = dex.getBattleProfile(attackerSet, format);
  const defender = dex.getBattleProfile(defenderSet, format);
  if (!attacker || !defender) return null;

  const best = attackerSet.moves
    .map((moveName) => dex.getMove(moveName))
    .filter((move): move is NonNullable<ReturnType<SpeciesDexPort['getMove']>> => Boolean(move))
    .filter((move) => move.category !== 'Status' && (move.basePower ?? 0) > 0)
    .map((move) => {
      const offensiveStat = move.category === 'Special' ? attacker.baseStats.spa : attacker.baseStats.atk;
      const defensiveStat = move.category === 'Special' ? defender.baseStats.spd : defender.baseStats.def;
      const stab = attacker.types.includes(move.type) ? 1.5 : 1;
      const effectiveness = dex.getTypeEffectiveness(move.type, defender.types);
      const score = (move.basePower ?? 0) * stab * Math.max(0.25, effectiveness) * (offensiveStat / Math.max(1, defensiveStat));
      return { move, score, effectiveness };
    })
    .sort((left, right) => right.score - left.score)[0];

  return best ?? null;
}

function estimateDamageLabel(score: number): string {
  if (score >= 210) return 'likely OHKO pressure';
  if (score >= 140) return 'strong 2HKO pressure';
  if (score >= 95) return 'solid chip into a follow-up KO';
  return 'mostly positioning pressure';
}

function getPace(team: Team, opponent: Team, dex: SpeciesDexPort, format: string): PreviewMatchupPlan['pace'] {
  const averageSpeed = (members: Team['members']) => {
    const speeds = members
      .map((member) => dex.getBattleProfile(member, format)?.baseStats.spe ?? 0)
      .filter((value) => value > 0);

    return speeds.length ? speeds.reduce((sum, value) => sum + value, 0) / speeds.length : 0;
  };

  const ourAverage = averageSpeed(team.members);
  const theirAverage = averageSpeed(opponent.members);

  if (ourAverage >= theirAverage + 12) return 'fast';
  if (theirAverage >= ourAverage + 12) return 'slow';
  return 'balanced';
}

function scoreBringCandidate(
  member: Team['members'][number],
  opponent: Team,
  dex: SpeciesDexPort,
  format: string,
  roles: string[],
): { score: number; reasons: string[] } {
  const ourProfile = dex.getBattleProfile(member, format);
  if (!ourProfile) return { score: 0, reasons: [] };

  let score = Math.round(getUsageWeight(format, ourProfile.name) * 12);
  const reasons: string[] = [];

  if (roles.includes('lead')) {
    score += 6;
    reasons.push('already profiles well as a proactive lead');
  }

  if (roles.includes('pivot')) {
    score += 4;
    reasons.push('keeps momentum flexible in preview games');
  }

  if (roles.includes('setup-sweeper')) {
    score += 4;
    reasons.push('gives the line a strong endgame closer');
  }

  for (const target of opponent.members) {
    const targetProfile = dex.getBattleProfile(target, format);
    if (!targetProfile) continue;

    const bestMove = getBestDamagingMove(member, target, dex, format);
    if (bestMove) {
      if (bestMove.effectiveness >= 2) score += 8;
      else if (bestMove.score >= 140) score += 5;
    }

    if (ourProfile.baseStats.spe >= targetProfile.baseStats.spe + 5) score += 3;

    const incoming = targetProfile.types.map((type) => dex.getMatchupMultiplier(type, member, format));
    if (incoming.some((value) => value === 0)) {
      score += 5;
    } else if (incoming.some((value) => value < 1)) {
      score += 3;
    }

    if (incoming.some((value) => value >= 2)) {
      score -= 3;
    }
  }

  return { score, reasons: Array.from(new Set(reasons)) };
}

export async function planBringFromPreview(team: Team, opponent: Team | null, deps: AnalyzeTeamDeps): Promise<PreviewMatchupPlan> {
  await preloadUsageAnalytics(team.format);
  const report = await analyzeTeam(team, deps);

  if (!opponent) {
    return {
      recommendedLead: report.battlePlan.leadCandidates[0] ?? report.battlePlan.likelyPicks[0] ?? 'None',
      recommendedBring: report.battlePlan.likelyPicks.slice(0, 3),
      benchOrder: team.members.map(memberName).filter((name) => !report.battlePlan.likelyPicks.includes(name)).slice(0, 3),
      opponentLikelyLeads: [],
      opponentBacklinePatterns: [],
      pace: 'balanced',
      speedNotes: [`Current speed control looks ${report.battlePlan.speedControlRating}.`],
      damageNotes: ['Add an opponent preview with --opponent for direct matchup pressure notes.'],
      winConditions: report.battlePlan.notes.slice(0, 3),
      reasons: ['Using your current internal bring-3 plan because no opponent preview was supplied.'],
    };
  }

  const roles = summarizeRoles(team, deps.dex);
  const ourRanked = team.members
    .map((member) => {
      const roleEntry = roles.find((entry) => entry.member === memberName(member));
      const ranked = scoreBringCandidate(member, opponent, deps.dex, team.format, roleEntry?.roles ?? []);
      return { name: memberName(member), score: ranked.score, reasons: ranked.reasons };
    })
    .sort((left, right) => right.score - left.score);

  const opponentRoles = summarizeRoles(opponent, deps.dex);
  const opponentLikelyLeads = opponent.members
    .map((member) => {
      const roleEntry = opponentRoles.find((entry) => entry.member === memberName(member));
      const scored = scoreBringCandidate(member, team, deps.dex, team.format, roleEntry?.roles ?? []);
      return { name: memberName(member), score: scored.score };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map((entry) => entry.name);

  const opponentSet = new Set(opponent.members.map((member) => toId(member.species)));
  const opponentBacklinePatterns = opponentLikelyLeads.map((leadName) => {
    const partnerPool = getTopUsageNames(getSpeciesUsage(team.format, leadName)?.teammates, 6)
      .filter((name) => opponentSet.has(toId(name)) && toId(name) !== toId(leadName))
      .slice(0, 2);

    const fallback = opponent.members
      .map(memberName)
      .filter((name) => toId(name) !== toId(leadName))
      .slice(0, 2);

    const partners = partnerPool.length ? partnerPool : fallback;
    return `${leadName} + ${partners.join(' + ')}`;
  });

  const damageNotes = ourRanked.slice(0, 3).flatMap((entry) => {
    const attacker = team.members.find((member) => memberName(member) === entry.name);
    if (!attacker) return [];

    return opponentLikelyLeads.slice(0, 2).flatMap((targetName) => {
      const target = opponent.members.find((member) => memberName(member) === targetName || member.species === targetName);
      if (!target) return [];

      const bestMove = getBestDamagingMove(attacker, target, deps.dex, team.format);
      if (!bestMove) return [];
      return [`${entry.name} pressures ${targetName} with ${bestMove.move.name} for ${estimateDamageLabel(bestMove.score)}.`];
    });
  }).slice(0, 6);

  const speedNotes: string[] = [];
  const ourFastest = Math.max(...team.members.map((member) => deps.dex.getBattleProfile(member, team.format)?.baseStats.spe ?? 0), 0);
  const theirFastest = Math.max(...opponent.members.map((member) => deps.dex.getBattleProfile(member, team.format)?.baseStats.spe ?? 0), 0);
  if (ourFastest >= theirFastest + 5) speedNotes.push('You have the cleaner natural speed edge in preview.');
  else if (theirFastest >= ourFastest + 5) speedNotes.push('Respect their fastest slot or preserve your speed control carefully.');
  else speedNotes.push('The top end speed is close, so positioning and priority matter.');

  const recommendedBring = ourRanked.slice(0, 3).map((entry) => entry.name);
  const recommendedLead = recommendedBring[0] ?? ourRanked[0]?.name ?? 'None';
  const benchOrder = ourRanked.slice(3).map((entry) => entry.name);

  const winConditions = recommendedBring.map((name) => {
    const roleEntry = roles.find((entry) => entry.member === name);
    if (roleEntry?.roles.includes('setup-sweeper')) return `Preserve ${name} as the late-game cleaner.`;
    if (roleEntry?.roles.includes('wallbreaker')) return `Use ${name} to force early damage and simplify the endgame.`;
    if (roleEntry?.roles.includes('pivot')) return `Lead or pivot through ${name} to scout their backline safely.`;
    return `Keep ${name} healthy for the midgame pivot war.`;
  });

  const reasons = [
    `Lead choice favors immediate pressure and positioning into ${opponentLikelyLeads[0] ?? 'their most likely opener'}.`,
    'Bring choices were weighted by coverage, speed control, resilience, and current live usage trends.',
  ];

  if (deps.simulator) {
    const simulationTeam = hydrateTeamForSimulation(team, deps);
    const simulationOpponent = hydrateTeamForSimulation(opponent, deps);

    const simSummary = await deps.simulator.simulateMatchup({
      format: team.format,
      team: simulationTeam,
      opponent: simulationOpponent,
      iterations: 12,
    });

    reasons.unshift(`Showdown-backed sim projects roughly ${Math.round(simSummary.winRate * 100)}% into the revealed preview.`);
    damageNotes.unshift(...simSummary.notes.slice(0, 2));

    if (simSummary.winRate <= 0.45) {
      speedNotes.push('Simulation says the opening trades are fragile, so preserve speed control and avoid passive sacks.');
    }
  }

  return {
    recommendedLead,
    recommendedBring,
    benchOrder,
    opponentLikelyLeads,
    opponentBacklinePatterns,
    pace: getPace(team, opponent, deps.dex, team.format),
    speedNotes: uniqueStrings(speedNotes),
    damageNotes: uniqueStrings(damageNotes).slice(0, 6),
    winConditions: uniqueStrings(winConditions).slice(0, 4),
    reasons: uniqueStrings(reasons),
  };
}

function describeSetChanges(current: PokemonSet, optimized: PokemonSet): string[] {
  const changes: string[] = [];

  if ((current.item ?? '') !== (optimized.item ?? '')) {
    changes.push(`Item: ${current.item ?? 'none'} -> ${optimized.item ?? 'none'}`);
  }

  if ((current.ability ?? '') !== (optimized.ability ?? '')) {
    changes.push(`Ability: ${current.ability ?? 'none'} -> ${optimized.ability ?? 'none'}`);
  }

  if ((current.nature ?? '') !== (optimized.nature ?? '')) {
    changes.push(`Nature: ${current.nature ?? 'neutral'} -> ${optimized.nature ?? 'neutral'}`);
  }

  if ((current.teraType ?? '') !== (optimized.teraType ?? '')) {
    changes.push(`Tera: ${current.teraType ?? 'unset'} -> ${optimized.teraType ?? 'unset'}`);
  }

  if (current.moves.join('|') !== optimized.moves.join('|')) {
    changes.push(`Moves: ${optimized.moves.join(' / ')}`);
  }

  if (formatStatSpread(current.evs) !== formatStatSpread(optimized.evs)) {
    changes.push(`Spread: ${formatStatSpread(current.evs)} -> ${formatStatSpread(optimized.evs)}`);
  }

  if (formatStatSpread(current.ivs) !== formatStatSpread(optimized.ivs)) {
    changes.push(`IVs: ${formatStatSpread(current.ivs)} -> ${formatStatSpread(optimized.ivs)}`);
  }

  return changes;
}

export async function optimizeTeamSets(team: Team, deps: AnalyzeTeamDeps): Promise<TeamSetOptimizationReport> {
  await preloadUsageAnalytics(team.format);
  const roles = summarizeRoles(team, deps.dex);

  const entries: SetOptimizationEntry[] = [];
  const suggestions: Suggestion[] = [];
  const optimizedMembers = team.members.map((member) => {
    const roleEntry = roles.find((entry) => entry.member === memberName(member));
    const optimized = getCompetitiveSet(member.species, team.format, deps.dex, deps.validator, {
      roleHint: getRoleHint(roleEntry?.roles ?? []),
    });

    if (!optimized) return member;

    const merged = {
      ...optimized,
      name: member.name,
    } satisfies PokemonSet;

    const changes = describeSetChanges(member, merged);
    if (changes.length === 0) return member;

    const preview = getCompetitiveSetPreview(member.species, team.format, deps.dex, deps.validator, {
      roleHint: getRoleHint(roleEntry?.roles ?? []),
    }) ?? `${member.species}: no optimized preview available`;

    entries.push({
      member: memberName(member),
      summary: `Better aligned to the current ${team.format} usage profile and role fit.`,
      changes,
      preview,
    });

    suggestions.push({
      kind: 'set-adjustment',
      title: `Tune ${memberName(member)} for the current format`,
      rationale: 'The live-usage-backed legal preview suggests a cleaner item, move, or spread fit for this role.',
      priority: changes.length >= 4 ? 'high' : 'medium',
      changes,
      exampleOptions: [preview],
    });

    return merged;
  });

  return {
    optimizedTeam: {
      ...team,
      members: optimizedMembers,
    },
    suggestions,
    entries,
  };
}

function getCommonCores(format: string, limit = 5): string[] {
  const snapshot = getUsageAnalyticsForFormat(format);
  if (!snapshot) return [];

  return snapshot.species.slice(0, Math.max(3, limit)).flatMap((entry) => {
    const partners = getTopUsageNames(entry.teammates, 2);
    if (partners.length < 2) return [];
    return [`${entry.species} + ${partners[0]}`, `${entry.species} + ${partners[0]} + ${partners[1]}`];
  }).filter((value, index, array) => array.indexOf(value) === index).slice(0, limit);
}

function buildAntiMetaIdeas(format: string, dex: SpeciesDexPort): string[] {
  const topThreats = getTopUsageThreatNames(format, 12)
    .map((name) => dex.getSpecies(name))
    .filter((species): species is NonNullable<ReturnType<SpeciesDexPort['getSpecies']>> => Boolean(species));

  if (topThreats.length === 0) {
    return ['No live meta snapshot is available yet for this format.'];
  }

  const typePressure = new Map<string, number>();
  for (const species of topThreats) {
    for (const type of species.types) {
      typePressure.set(type, (typePressure.get(type) ?? 0) + 1);
    }
  }

  const topTypes = [...typePressure.entries()].sort((left, right) => right[1] - left[1]).slice(0, 3).map(([type]) => type);

  return topTypes.map((type) => {
    const answers = getTopUsageThreatNames(format, 30)
      .map((name) => dex.getSpecies(name))
      .filter((species): species is NonNullable<ReturnType<SpeciesDexPort['getSpecies']>> => Boolean(species))
      .filter((species) => species.types.every((defType) => dex.getTypeEffectiveness(type, [defType]) <= 1))
      .slice(0, 3)
      .map((species) => species.name);

    return answers.length
      ? `With ${type} pressure trending up, consider anti-meta slots like ${answers.join(', ')}.`
      : `The format is currently leaning on ${type} pressure, so resistances to that type gain value.`;
  });
}

export async function scoutLiveMeta(format: string, dex: SpeciesDexPort): Promise<MetaScoutingReport> {
  await preloadUsageAnalytics(format);
  const snapshot = getUsageAnalyticsForFormat(format);

  if (!snapshot) {
    return {
      format,
      source: 'none',
      updatedAt: 'unknown',
      resolvedFormat: undefined,
      exactMatch: false,
      topThreats: [],
      commonCores: [],
      antiMetaIdeas: ['No live usage feed could be loaded for this format right now.'],
      notes: ['Try again later or confirm the format has current Smogon stats support.'],
    };
  }

  const notes = ['Meta scouting is pulled from live monthly usage and teammates data rather than static species templates.'];
  if (!snapshot.exactMatch) {
    notes.unshift(`No exact public ladder exists for ${format}; using ${snapshot.resolvedFormat ?? 'the closest available public format'} as a proxy.`);
  } else if (snapshot.source.includes('pokemon-champions-stats.vercel.app')) {
    notes.unshift('Using the exact public Pokémon Champions ladder page for this format. Species ordering is rank-based from that live site.');
  }

  return {
    format,
    source: snapshot.source,
    updatedAt: snapshot.updatedAt,
    resolvedFormat: snapshot.resolvedFormat,
    exactMatch: snapshot.exactMatch,
    topThreats: snapshot.species.slice(0, 10).map((entry) => ({
      species: entry.species,
      usage: entry.usage,
      rank: entry.rank,
      commonMoves: getTopUsageNames(entry.moves, 4),
      commonItems: getTopUsageNames(entry.items, 2),
      commonAbility: getTopUsageNames(entry.abilities, 1)[0],
      commonTera: getTopUsageNames(entry.teraTypes, 1)[0],
    })),
    commonCores: getCommonCores(format, 6),
    antiMetaIdeas: buildAntiMetaIdeas(format, dex),
    notes,
  };
}

function matchesStyle(speciesName: string, style: BuildConstraints['style'], dex: SpeciesDexPort, format: string): boolean {
  const species = dex.getSpecies(speciesName);
  if (!species || !style) return true;

  const offense = Math.max(species.baseStats.atk, species.baseStats.spa);
  const bulk = species.baseStats.hp + Math.max(species.baseStats.def, species.baseStats.spd);
  const abilityIds = species.abilities.map(toId);
  const hasPriority = canLearnAnyMove(species.name, BUILD_PRIORITY_MOVES, dex);
  const hasPivot = canLearnAnyMove(species.name, BUILD_PIVOT_MOVES, dex);
  const hasSetup = canLearnAnyMove(species.name, ['Dragon Dance', 'Swords Dance', 'Nasty Plot', 'Calm Mind', 'Bulk Up', 'Agility', 'Rock Polish', 'Quiver Dance', 'Trailblaze'], dex);

  if (style === 'hyper-offense') {
    return offense >= 105
      || (species.baseStats.spe >= 105 && (offense >= 90 || hasSetup || hasPriority || hasPivot))
      || (hasPriority && offense >= 95)
      || abilityIds.some((id) => ['protosynthesis', 'quarkdrive', 'moxie', 'supremeoverlord', 'contrary', 'beastboost'].includes(id));
  }
  if (style === 'bulky-offense') return offense >= 100 && bulk >= 165;
  if (style === 'balance') return bulk >= 175 || (offense >= 95 && species.baseStats.spe >= 75 && species.baseStats.spe <= 110);
  if (style === 'stall') return bulk >= 185 && (canLearnAnyMove(species.name, BUILD_RECOVERY_MOVES, dex) || canLearnAnyMove(species.name, BUILD_SUPPORT_MOVES, dex));
  if (style === 'trick-room') return species.baseStats.spe <= 80 && offense >= 100;
  if (style === 'rain') return species.types.includes('Water') || abilityIds.some((id) => id === 'drizzle' || id === 'swiftswim');
  if (style === 'sun') return species.types.includes('Fire') || species.types.includes('Grass') || abilityIds.some((id) => id === 'drought' || id === 'chlorophyll' || id === 'solarpower' || id === 'protosynthesis');
  if (style === 'sand') return species.types.some((type) => ['Ground', 'Rock', 'Steel'].includes(type)) || abilityIds.some((id) => id === 'sandstream' || id === 'sandrush' || id === 'sandforce');

  return true;
}

interface RankedBuildCandidate extends BuildRecommendation {
  types: string[];
  tags: string[];
}

function getMissingAnchorTypes(seedTeam: Team, dex: SpeciesDexPort): string[] {
  const presentTypes = new Set(seedTeam.members.flatMap((member) => dex.getSpecies(member.species)?.types ?? []));
  return dex.listTypes().filter((type) => !presentTypes.has(type));
}

function selectDiverseRecommendations(
  candidates: RankedBuildCandidate[],
  limit: number,
  maxMegaCount = Number.POSITIVE_INFINITY,
  maxHazardCount = 1,
): BuildRecommendation[] {
  const remaining = [...candidates];
  const selected: RankedBuildCandidate[] = [];
  const typeCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();

  const getAdjustment = (candidate: RankedBuildCandidate): number => {
    let adjustment = 0;

    const repeatedTypes = candidate.types.filter((type) => (typeCounts.get(type) ?? 0) > 0);
    adjustment -= repeatedTypes.length * 10;
    if (repeatedTypes.length === candidate.types.length && repeatedTypes.length > 0) adjustment -= 8;

    const repeatedCompletionTags = candidate.tags.filter((tag) => tag.startsWith('complete:') && (tagCounts.get(tag) ?? 0) > 0);
    adjustment -= repeatedCompletionTags.length * 12;

    const repeatedCoreTags = candidate.tags.filter((tag) => tag.startsWith('core:') && (tagCounts.get(tag) ?? 0) > 0);
    adjustment -= Math.max(0, repeatedCoreTags.length - 1) * 6;

    const repeatedTags = candidate.tags.filter((tag) => (tagCounts.get(tag) ?? 0) > 0);
    adjustment -= Math.max(0, repeatedTags.length - 1) * 3;

    if (candidate.tags.includes('mega') && (tagCounts.get('mega') ?? 0) >= maxMegaCount) adjustment -= 1000;
    if (candidate.tags.includes('hazard') && (tagCounts.get('hazard') ?? 0) >= maxHazardCount) adjustment -= 1000;

    if (candidate.types.some((type) => (typeCounts.get(type) ?? 0) === 0)) adjustment += 5;
    if (candidate.tags.some((tag) => (tagCounts.get(tag) ?? 0) === 0)) adjustment += 4;

    return adjustment;
  };

  while (selected.length < limit && remaining.length > 0) {
    remaining.sort((left, right) => {
      const leftAdjusted = left.score + getAdjustment(left);
      const rightAdjusted = right.score + getAdjustment(right);
      return rightAdjusted - leftAdjusted || right.score - left.score || left.species.localeCompare(right.species);
    });

    const next = remaining.shift();
    if (!next) break;

    if (next.tags.includes('mega') && (tagCounts.get('mega') ?? 0) >= maxMegaCount) continue;
    if (next.tags.includes('hazard') && (tagCounts.get('hazard') ?? 0) >= maxHazardCount) continue;

    selected.push(next);
    for (const type of next.types) typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    for (const tag of next.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }

  return selected.map(({ types, tags, ...entry }) => entry);
}

export async function buildWithConstraints(constraints: BuildConstraints, deps: AnalyzeTeamDeps): Promise<ConstrainedBuildReport> {
  await preloadUsageAnalytics(constraints.format);

  const anchors = (constraints.coreSpecies ?? []).filter(Boolean);
  const avoid = new Set((constraints.avoidSpecies ?? []).map(toId));
  const seedMembers = anchors
    .map((speciesName) => {
      const roleHint = getBuildRoleHint(speciesName, deps.dex, constraints.style);
      return getCompetitiveSet(speciesName, constraints.format, deps.dex, deps.validator, {
        roleHint,
        style: constraints.style,
      }) ?? buildAnchorSeedSet(speciesName, constraints.format, deps.dex, deps.validator, roleHint);
    })
    .filter((set): set is PokemonSet => Boolean(set));

  const seedTeam: Team = {
    format: constraints.format,
    source: 'generated',
    members: seedMembers,
  };

  const report = await analyzeTeam(seedTeam, deps);
  const missingRoles = inferMissingRolesFromAnchors(seedTeam, report, deps.dex);
  const existing = new Set(seedTeam.members.map((member) => toId(member.species)));
  const available = deps.dex.listAvailableSpecies(constraints.format);

  const missingAnchorTypes = new Set(getMissingAnchorTypes(seedTeam, deps.dex));
  const megaAnchors = seedTeam.members.filter((member) => isMegaSet(member, deps.dex)).length;
  const hazardAnchors = seedTeam.members.filter((member) => hasConfiguredHazardMove(member)).length;
  const maxRecommendedMegas = Math.max(0, 2 - megaAnchors);
  const maxRecommendedHazards = Math.max(0, 1 - hazardAnchors);

  let rankedCandidates: RankedBuildCandidate[] = available
    .filter((species) => !existing.has(toId(species.name)))
    .filter((species) => !avoid.has(toId(species.name)))
    .filter((species) => constraints.allowRestricted ? true : species.bst < 671)
    .filter((species) => matchesStyle(species.name, constraints.style, deps.dex, constraints.format))
    .filter((species) => {
      const usageWeight = getUsageWeightForCandidate(constraints.format, species, deps.dex);
      const offense = Math.max(species.baseStats.atk, species.baseStats.spa);
      const bulk = species.baseStats.hp + Math.max(species.baseStats.def, species.baseStats.spd);
      const topAbilityRating = Math.max(0, ...species.abilities.map((ability) => deps.dex.getAbility(ability)?.rating ?? 0));

      if (isBssLikeFormat(constraints.format) && usageWeight < 0.05 && species.bst < 500 && offense < 100 && species.baseStats.spe < 105 && bulk < 185 && topAbilityRating < 4) {
        return false;
      }

      return true;
    })
    .map((species) => {
      let score = Math.round(getUsageWeightForCandidate(constraints.format, species, deps.dex) * 12);
      const reasons: string[] = [];
      const abilityIds = species.abilities.map(toId);
      const anchorFit = scoreAnchorFit(species, seedTeam, constraints.format, deps.dex, constraints.style);
      const guideFit = scoreGuideDrivenBssFit(species, seedTeam, report, constraints.format, constraints.style, deps.dex);
      const bulk = species.baseStats.hp + Math.max(species.baseStats.def, species.baseStats.spd);
      const offense = Math.max(species.baseStats.atk, species.baseStats.spa);
      const hasPivot = canLearnAnyMove(species.name, BUILD_PIVOT_MOVES, deps.dex);
      const hasPriority = canLearnAnyMove(species.name, BUILD_PRIORITY_MOVES, deps.dex);
      const hasSupport = canLearnAnyMove(species.name, BUILD_SUPPORT_MOVES, deps.dex);
      const megaCandidate = isMegaSpecies(species, deps.dex);

      score += anchorFit.score + guideFit.score;
      reasons.push(...anchorFit.reasons, ...guideFit.reasons);

      if (missingRoles.some((role) => normalize(role).includes('speed')) && (species.baseStats.spe >= 100 || hasPriority)) {
        score += species.baseStats.spe >= 100 ? 7 : 4;
        reasons.push(species.baseStats.spe >= 100 ? 'helps patch missing speed control' : 'adds useful priority insurance');
      }

      if (missingRoles.some((role) => normalize(role).includes('pivot')) && hasPivot) {
        score += 6;
        reasons.push('improves positioning and bring flexibility');
      }

      if (missingRoles.some((role) => normalize(role).includes('stall')) && (hasSupport || offense >= 120)) {
        score += 5;
        reasons.push('gives the core a more reliable stallbreaking line');
      }

      if (missingRoles.some((role) => normalize(role).includes('hazard')) && canLearnAnyMove(species.name, BUILD_HAZARD_MOVES, deps.dex)) {
        score += isBssLikeFormat(constraints.format) ? 2 : 6;
        reasons.push(isBssLikeFormat(constraints.format) ? 'adds optional field pressure without warping bring-3 plans' : 'patches the current hazard game');
      }

      if (missingRoles.some((role) => normalize(role).includes('wall')) && bulk >= 190) {
        score += 6;
        reasons.push('adds sturdier defensive padding');
      }

      if (constraints.style === 'trick-room' && species.baseStats.spe <= 70) {
        score += 5;
        reasons.push('fits a Trick Room pace naturally');
      }

      if (constraints.style === 'rain' && (species.types.includes('Water') || abilityIds.some((id) => id === 'drizzle' || id === 'swiftswim'))) {
        score += 5;
        reasons.push('slots naturally into a rain shell');
      }

      if (constraints.style === 'sun' && (species.types.includes('Fire') || species.types.includes('Grass') || abilityIds.some((id) => id === 'drought' || id === 'chlorophyll' || id === 'solarpower' || id === 'protosynthesis'))) {
        score += 5;
        reasons.push('slots naturally into a sun shell');
      }

      if (constraints.style === 'sand' && (species.types.some((type) => ['Ground', 'Rock', 'Steel'].includes(type)) || abilityIds.some((id) => id === 'sandstream' || id === 'sandrush' || id === 'sandforce'))) {
        score += 5;
        reasons.push('slots naturally into a sand shell');
      }

      if (constraints.style === 'stall' && canLearnAnyMove(species.name, [...BUILD_RECOVERY_MOVES, ...BUILD_SUPPORT_MOVES], deps.dex)) {
        score += 5;
        reasons.push('fits a slower coverage-first plan');
      }

      const preview = getCompetitiveSetPreview(species.name, constraints.format, deps.dex, deps.validator, {
        roleHint: getBuildRoleHint(species.name, deps.dex, constraints.style),
        style: constraints.style,
      });
      if (preview) score += 3;
      else score -= 10;

      if (megaCandidate) {
        if (preview && anchorFit.score + guideFit.score >= 8) {
          score += 4;
          reasons.push('offers a matchup-dependent Mega option that still fits the core');
        } else {
          score -= 8;
        }
      }

      const tags = [
        megaCandidate ? 'mega' : null,
        ...getHazardTagsFromPreview(preview),
        species.baseStats.spe >= 100 || hasPriority ? 'speed' : null,
        hasPivot ? 'pivot' : null,
        hasSupport ? 'utility' : null,
        bulk >= 190 ? 'bulk' : null,
        offense >= 115 ? 'breaker' : null,
        ...species.types.filter((type) => missingAnchorTypes.has(type)).map((type) => `complete:${toId(type)}`),
        ...reasons
          .filter((reason) => reason.startsWith('helps complete a '))
          .map((reason) => `core:${toId(reason.replace('helps complete a ', '').replace(' backbone', ''))}`),
      ].filter((value): value is string => Boolean(value));

      return {
        species: species.name,
        score,
        reasons: (reasons.length ? Array.from(new Set(reasons)) : ['high legal fit with current usage and coverage needs']).slice(0, 3),
        preview,
        types: species.types,
        tags,
      } satisfies RankedBuildCandidate;
    })
    .sort((left, right) => right.score - left.score || left.species.localeCompare(right.species));

  rankedCandidates = await rescoreTopCandidatesWithSimulation(rankedCandidates, seedTeam, constraints, deps);

  const recommendations = selectDiverseRecommendations(
    rankedCandidates,
    Math.max(1, 6 - seedTeam.members.length),
    maxRecommendedMegas,
    maxRecommendedHazards,
  );

  return {
    format: constraints.format,
    style: constraints.style ?? 'balanced-flex',
    anchors,
    missingRoles,
    recommendations,
    notes: [
      anchors.length ? 'The current recommendations were built around the requested anchor core.' : 'No anchor core was supplied, so results focus on general live-meta fit.',
      anchors.length ? 'Scoring now rewards live teammate synergy, defensive coverage, and support value for the requested anchors.' : 'Recommendations are usage-weighted and role-aware.',
      ...(isBssLikeFormat(constraints.format)
        ? [
            'The BSS teambuilding guide is now reflected in scoring: bring-3 shells, safe leads or pivots, speed control or priority, and matchup patching matter more than generic hazards or same-type stacking.',
            'The builder also avoids stuffing the roster with too many Mega options; at most two Mega candidates are kept, and they still need real synergy with the rest of the shell.',
            'It also avoids overstacking hazard setters, so field pressure does not crowd out better bring-3 partners.',
            deps.simulator ? 'Top shortlist options were also rechecked with Showdown-backed matchup sims against the current live threat cluster.' : undefined,
            `Current live pressure points include ${(report.threats.topPressureThreats ?? []).slice(0, 3).map((threat) => threat.species).join(', ') || 'the usual top threats'}.`,
          ]
        : []),
      constraints.allowRestricted ? 'Restricted-level options were left available.' : 'Very high-BST restricted options were filtered out by default.',
    ].filter((note): note is string => Boolean(note)),
  };
}
