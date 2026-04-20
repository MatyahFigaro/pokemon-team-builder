import { createRequire } from 'node:module';

import type { MatchupRequest, MatchupSummary, PokemonSet, SimulationPort, Team } from '@pokemon/domain';

import { ShowdownDexAdapter } from './dex.js';
import { toShowdownTeam } from './mappers.js';

const require = createRequire(import.meta.url);
const showdown = require('pokemon-showdown') as any;
const { BattleStream, getPlayerStreams, Teams } = showdown;

const PRIORITY_MOVES = new Set(['extremespeed', 'suckerpunch', 'aquajet', 'iceshard', 'machpunch', 'bulletpunch', 'shadowsneak', 'vacuumwave']);
const RECOVERY_MOVES = new Set(['recover', 'roost', 'slackoff', 'softboiled', 'moonlight', 'morningsun', 'synthesis', 'rest']);
const SETUP_MOVES = new Set(['swordsdance', 'dragondance', 'nastyplot', 'calmmind', 'bulkup', 'agility', 'quiverdance', 'trailblaze']);
const PIVOT_MOVES = new Set(['uturn', 'voltswitch', 'partingshot', 'flipturn', 'teleport', 'chillyreception']);
const STATUS_SPREAD_MOVES = new Set(['thunderwave', 'willowisp', 'toxic', 'spore', 'sleeppowder', 'stunspore', 'glare', 'nuzzle', 'yawn']);
const HAZARD_MOVES = new Set(['stealthrock', 'spikes', 'toxicspikes', 'stickyweb']);
const PHAZING_MOVES = new Set(['roar', 'whirlwind', 'dragontail', 'circlethrow', 'haze', 'clearsmog']);
const SCOUT_MOVES = new Set(['protect', 'substitute', 'kingsshield', 'spikyshield', 'banefulbunker']);

interface PlayerChoiceRequest {
  wait?: boolean;
  forceSwitch?: boolean[];
  teamPreview?: boolean;
  active?: Array<{
    moves?: Array<{ move: string; disabled?: boolean; target?: string }>;
    trapped?: boolean;
    canMegaEvo?: boolean;
    canTerastallize?: boolean;
  }>;
  side?: {
    pokemon: Array<{
      details?: string;
      condition: string;
      active?: boolean;
      reviving?: boolean;
      commanding?: boolean;
    }>;
  };
}

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function toId(value: string | undefined): string {
  return normalize(value).replace(/[^a-z0-9]/g, '');
}

function isBssLikeFormat(format: string): boolean {
  const id = toId(format);
  return id.includes('bss') || id.includes('battlestadium') || id.includes('championsbss');
}

function canonicalSpeciesId(value: string | undefined): string {
  return toId((value ?? '').replace(/-mega(?:-[xy])?$/i, '').replace(/-primal$/i, ''));
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatPercent(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return `${Math.round(value * 100)}%`;
}

function estimateDamagePercentRange(score: number): { min: number; max: number } {
  const center = clamp(Math.round(18 + (score * 0.34)), 10, 94);
  const spread = center >= 70 ? 12 : center >= 45 ? 10 : 8;
  const min = clamp(center - spread, 5, 95);
  const max = clamp(center + spread, min + 5, 100);
  return { min, max };
}

function describeEffectiveness(effectiveness: number): string {
  if (effectiveness >= 2) return 'super effective';
  if (effectiveness === 0) return 'immune';
  if (effectiveness < 1) return 'resisted';
  return 'neutral';
}

function buildTurnBreakdown(results: Array<{ winner: 'p1' | 'p2' | 'tie'; turns: number }>): string[] {
  const buckets = [
    { label: 'Turns 1-4', test: (turns: number) => turns <= 4, wins: 0, losses: 0, draws: 0 },
    { label: 'Turns 5-8', test: (turns: number) => turns >= 5 && turns <= 8, wins: 0, losses: 0, draws: 0 },
    { label: 'Turns 9+', test: (turns: number) => turns >= 9, wins: 0, losses: 0, draws: 0 },
  ];

  for (const result of results) {
    const bucket = buckets.find((entry) => entry.test(result.turns));
    if (!bucket) continue;
    if (result.winner === 'p1') bucket.wins += 1;
    else if (result.winner === 'p2') bucket.losses += 1;
    else bucket.draws += 1;
  }

  return buckets.map((bucket) => {
    const total = bucket.wins + bucket.losses + bucket.draws;
    if (total === 0) return `${bucket.label}: no finishes landed in this phase.`;

    const lean = bucket.wins > bucket.losses
      ? 'favors you'
      : bucket.losses > bucket.wins
        ? 'favors the opponent'
        : 'stays roughly even';

    return `${bucket.label}: ${bucket.wins}W / ${bucket.losses}L / ${bucket.draws}D (${lean}).`;
  });
}

function buildDamageHighlights(request: MatchupRequest, dex: ShowdownDexAdapter): string[] {
  const ourCore = pickBring(request.team, request.opponent, dex, request.format, Math.min(2, request.team.members.length));
  const theirCore = pickBring(request.opponent, request.team, dex, request.format, Math.min(2, request.opponent.members.length));

  return ourCore.flatMap((attacker) => theirCore.map((defender) => {
    const best = getBestMoveData(attacker, defender, dex, request.format);
    if (!best) return null;

    const range = estimateDamagePercentRange(best.score);
    return {
      score: best.score,
      line: `${attacker.species} ${best.move} into ${defender.species}: ~${range.min}-${range.max}% (${describeEffectiveness(best.effectiveness)}).`,
    };
  }))
    .filter((entry): entry is { score: number; line: string } => Boolean(entry))
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.line)
    .slice(0, 4);
}

function buildSwitchPredictions(request: MatchupRequest, dex: ShowdownDexAdapter): string[] {
  const ourLead = pickBring(request.team, request.opponent, dex, request.format, 1)[0];
  const likelyOpposingLeads = pickBring(request.opponent, request.team, dex, request.format, Math.min(2, request.opponent.members.length));
  if (!ourLead) return [];

  return likelyOpposingLeads.flatMap((lead, index) => {
    const switches = request.opponent.members
      .filter((member) => canonicalSpeciesId(member.species) !== canonicalSpeciesId(lead.species))
      .map((member) => ({
        species: member.species,
        score: scoreSetIntoTarget(member, ourLead, dex, request.format) - scoreSetIntoTarget(ourLead, member, dex, request.format),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 2)
      .map((entry) => entry.species);

    if (switches.length === 0) return [];
    return [`Turn ${index + 1}: if ${lead.species} is pressured by ${ourLead.species}, the likely switch branch is ${switches.join(' or ')}.`];
  }).slice(0, 4);
}

function getPredictionAccuracy(request: MatchupRequest, dex: ShowdownDexAdapter): { move?: number; switch?: number; notes: string[] } {
  const ourLead = pickBring(request.team, request.opponent, dex, request.format, 1)[0];
  const likelyOpposingLeads = pickBring(request.opponent, request.team, dex, request.format, Math.min(3, request.opponent.members.length));
  if (!ourLead || likelyOpposingLeads.length === 0) return { notes: [] };

  let moveConfidenceSum = 0;
  let switchConfidenceSum = 0;
  let moveSamples = 0;
  let switchSamples = 0;

  for (const lead of likelyOpposingLeads) {
    const direct = getBestMoveData(ourLead, lead, dex, request.format);
    if (!direct) continue;

    const candidateSwitches = request.opponent.members
      .filter((member) => canonicalSpeciesId(member.species) !== canonicalSpeciesId(lead.species))
      .map((member) => ({
        member,
        score: scoreSetIntoTarget(member, ourLead, dex, request.format) - scoreSetIntoTarget(ourLead, member, dex, request.format),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 2);

    const targets = [lead, ...candidateSwitches.map((entry) => entry.member)];
    const matching = targets.filter((target) => getBestMoveData(ourLead, target, dex, request.format)?.move === direct.move).length;
    moveConfidenceSum += matching / Math.max(1, targets.length);
    moveSamples += 1;

    if (candidateSwitches.length > 0) {
      const top = candidateSwitches[0]?.score ?? 0;
      const second = candidateSwitches[1]?.score ?? top - 6;
      switchConfidenceSum += clamp(0.55 + Math.max(0, top - second) / 60, 0.55, 0.9);
      switchSamples += 1;
    }
  }

  const move = moveSamples > 0 ? moveConfidenceSum / moveSamples : undefined;
  const switchPrediction = switchSamples > 0 ? switchConfidenceSum / switchSamples : undefined;

  return {
    move,
    switch: switchPrediction,
    notes: uniqueStrings([
      moveSamples > 0 ? `Safe-click move prediction accuracy sits around ${formatPercent(move)} into the most common benchmark branches.` : null,
      switchSamples > 0 ? `Likely switch-call confidence sits around ${formatPercent(switchPrediction)} on the top preview turns.` : null,
    ]),
  };
}

function splitFirst(value: string, delimiter: string): [string, string] {
  const index = value.indexOf(delimiter);
  return index >= 0 ? [value.slice(0, index), value.slice(index + delimiter.length)] : [value, ''];
}

function speciesFromDetails(details?: string): string {
  return (details ?? '').split(',')[0]?.trim() ?? '';
}

function parseConditionPercent(condition?: string): number {
  const normalized = normalize(condition);
  if (!normalized || normalized.endsWith(' fnt') || normalized === '0 fnt') return 0;

  const hpPart = (condition ?? '').split(' ')[0] ?? '';
  const [currentRaw, maxRaw] = hpPart.split('/');
  const current = Number(currentRaw ?? Number.NaN);
  const max = Number(maxRaw ?? Number.NaN);
  if (Number.isFinite(current) && Number.isFinite(max) && max > 0) {
    return current / max;
  }

  const percentMatch = hpPart.match(/^(\d+(?:\.\d+)?)%$/);
  if (percentMatch) {
    return Number(percentMatch[1]) / 100;
  }

  return 1;
}

function countLivePokemon(sidePokemon: Array<{ condition: string }>): number {
  return sidePokemon.filter((pokemon) => !normalize(pokemon.condition).endsWith(' fnt')).length;
}

function sumPositiveBoosts(boosts: Record<string, number>): number {
  return Object.values(boosts).reduce((sum, value) => sum + (value > 0 ? value : 0), 0);
}

function pickRankedOption<T extends { score: number }>(
  options: T[],
  nextRandom: () => number,
  slack = 10,
): T | undefined {
  if (options.length === 0) return undefined;
  if (options.length === 1) return options[0];

  const bestScore = options[0]?.score ?? 0;
  const viable = options.filter((option, index) => index < 3 && option.score >= bestScore - slack);
  if (viable.length <= 1) return viable[0] ?? options[0];

  const weights = viable.map((option, index) => Math.max(1, option.score - (bestScore - slack) + (viable.length - index)));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let target = nextRandom() * totalWeight;

  for (let index = 0; index < viable.length; index += 1) {
    target -= weights[index] ?? 0;
    if (target <= 0) return viable[index];
  }

  return viable[0] ?? options[0];
}

type TeamArchetype = 'hyper-offense' | 'balance' | 'stall' | 'trick-room' | 'rain' | 'sun';

function scoreMemberStrategicValue(
  set: PokemonSet,
  dex: ShowdownDexAdapter,
  format: string,
): number {
  const profile = dex.getBattleProfile(set, format);
  if (!profile) return 60;

  const offense = Math.max(profile.baseStats.atk, profile.baseStats.spa);
  const bulk = profile.baseStats.hp + profile.baseStats.def + profile.baseStats.spd;
  let score = offense * 0.28 + profile.baseStats.spe * 0.22 + bulk * 0.05;

  if (hasTaggedMove(set, SETUP_MOVES)) score += 18;
  if (hasTaggedMove(set, PRIORITY_MOVES)) score += 7;
  if (hasTaggedMove(set, RECOVERY_MOVES)) score += 6;
  if (hasTaggedMove(set, PIVOT_MOVES)) score += 5;
  if (set.species.includes('-Mega') || /ite$/i.test(set.item ?? '')) score += 8;

  return score;
}

function detectTeamArchetype(team: Team, dex: ShowdownDexAdapter, format: string): TeamArchetype {
  let fastCount = 0;
  let bulkyCount = 0;
  let setupCount = 0;
  let recoveryCount = 0;
  let trickRoomCount = 0;
  let rainCount = 0;
  let sunCount = 0;
  let totalSpeed = 0;

  for (const member of team.members) {
    const profile = dex.getBattleProfile(member, format);
    if (!profile) continue;

    const speed = profile.baseStats.spe;
    const offense = Math.max(profile.baseStats.atk, profile.baseStats.spa);
    const bulk = profile.baseStats.hp + profile.baseStats.def + profile.baseStats.spd;
    const abilityId = toId(member.ability);
    const moveIds = new Set(member.moves.map((move) => toId(move)));

    totalSpeed += speed;
    if (speed >= 100 || hasTaggedMove(member, PRIORITY_MOVES)) fastCount += 1;
    if (bulk >= 260) bulkyCount += 1;
    if (offense >= 115 || hasTaggedMove(member, SETUP_MOVES)) setupCount += 1;
    if (hasTaggedMove(member, RECOVERY_MOVES)) recoveryCount += 1;
    if (moveIds.has('trickroom')) trickRoomCount += 1;
    if (abilityId === 'drizzle' || abilityId === 'swiftswim' || moveIds.has('raindance')) rainCount += 1;
    if (abilityId === 'drought' || abilityId === 'chlorophyll' || abilityId === 'protosynthesis' || moveIds.has('sunnyday')) sunCount += 1;
  }

  const averageSpeed = team.members.length ? totalSpeed / team.members.length : 0;

  if (rainCount >= 2) return 'rain';
  if (sunCount >= 2) return 'sun';
  if (trickRoomCount >= 1 && averageSpeed <= 85) return 'trick-room';
  if (recoveryCount >= 2 && bulkyCount >= 2 && setupCount <= Math.max(1, team.members.length / 2)) return 'stall';
  if (fastCount + setupCount >= Math.max(3, team.members.length + 1) && recoveryCount <= 1) return 'hyper-offense';
  return 'balance';
}

function packTeam(team: Team): string {
  return Teams.pack(toShowdownTeam(team) as never);
}

function hasTaggedMove(set: Pick<PokemonSet, 'moves'>, moveIds: Set<string>): boolean {
  return set.moves.some((move) => moveIds.has(toId(move)));
}

function getBestMoveData(
  attackerSet: PokemonSet,
  defenderSet: PokemonSet,
  dex: ShowdownDexAdapter,
  format: string,
): { move: string; score: number; effectiveness: number } | null {
  const attacker = dex.getBattleProfile(attackerSet, format);
  const defender = dex.getBattleProfile(defenderSet, format);
  if (!attacker || !defender) return null;

  const ranked = attackerSet.moves
    .map((moveName) => dex.getMove(moveName))
    .filter((move): move is NonNullable<ReturnType<ShowdownDexAdapter['getMove']>> => Boolean(move))
    .map((move) => {
      if (move.category === 'Status' || (move.basePower ?? 0) <= 0) {
        return {
          move: move.name,
          effectiveness: 1,
          score: hasTaggedMove(attackerSet, SETUP_MOVES) ? 28 : hasTaggedMove(attackerSet, PIVOT_MOVES) ? 18 : 8,
        };
      }

      const offense = move.category === 'Special' ? attacker.baseStats.spa : attacker.baseStats.atk;
      const defense = move.category === 'Special' ? defender.baseStats.spd : defender.baseStats.def;
      const stab = attacker.types.includes(move.type) ? 1.5 : 1;
      const effectiveness = dex.getTypeEffectiveness(move.type, defender.types);
      const priority = move.priority > 0 ? 1 + (move.priority * 0.15) : 1;
      const score = (move.basePower ?? 0) * stab * Math.max(0.25, effectiveness) * priority * (offense / Math.max(1, defense));

      return {
        move: move.name,
        effectiveness,
        score,
      };
    })
    .sort((left, right) => right.score - left.score);

  return ranked[0] ?? null;
}

function scoreSpecificMove(
  attackerSet: PokemonSet,
  moveName: string,
  defenderSet: PokemonSet,
  dex: ShowdownDexAdapter,
  format: string,
): number {
  const attacker = dex.getBattleProfile(attackerSet, format);
  const defender = dex.getBattleProfile(defenderSet, format);
  const move = dex.getMove(moveName);
  if (!attacker || !defender || !move) return 0;

  const moveId = toId(move.name);
  if (move.category === 'Status' || (move.basePower ?? 0) <= 0) {
    let score = 8;
    if (SETUP_MOVES.has(moveId)) score += 18;
    if (PIVOT_MOVES.has(moveId)) score += 12;
    if (RECOVERY_MOVES.has(moveId)) score += 10;
    if (move.status === 'par') score += 8;
    if (moveId === 'protect') score += 4;
    return score;
  }

  const offense = move.category === 'Special' ? attacker.baseStats.spa : attacker.baseStats.atk;
  const defense = move.category === 'Special' ? defender.baseStats.spd : defender.baseStats.def;
  const stab = attacker.types.includes(move.type) ? 1.5 : 1;
  const effectiveness = dex.getTypeEffectiveness(move.type, defender.types);
  const priority = move.priority > 0 ? 1 + (move.priority * 0.2) : 1;

  return (move.basePower ?? 0) * stab * Math.max(0.25, effectiveness) * priority * (offense / Math.max(1, defense));
}

function scoreMoveIntoTeam(
  attackerSet: PokemonSet,
  moveName: string,
  opponent: Team,
  dex: ShowdownDexAdapter,
  format: string,
): number {
  const scores = opponent.members.map((target) => scoreSpecificMove(attackerSet, moveName, target, dex, format));
  if (!scores.length) return 0;

  const best = Math.max(...scores);
  const average = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  return best * 0.65 + average * 0.35;
}

function scoreSetIntoTarget(
  attackerSet: PokemonSet,
  defenderSet: PokemonSet,
  dex: ShowdownDexAdapter,
  format: string,
): number {
  const attacker = dex.getBattleProfile(attackerSet, format);
  const defender = dex.getBattleProfile(defenderSet, format);
  if (!attacker || !defender) return 0;

  const bestAttack = getBestMoveData(attackerSet, defenderSet, dex, format);
  const bestReply = getBestMoveData(defenderSet, attackerSet, dex, format);

  let score = (bestAttack?.score ?? 30) - (bestReply?.score ?? 30);
  score += (attacker.baseStats.spe - defender.baseStats.spe) * 0.35;
  score += ((attacker.baseStats.hp + attacker.baseStats.def + attacker.baseStats.spd) - (defender.baseStats.hp + defender.baseStats.def + defender.baseStats.spd)) * 0.04;

  if ((bestAttack?.effectiveness ?? 1) >= 2) score += 12;
  if ((bestReply?.effectiveness ?? 1) >= 2) score -= 12;
  if (hasTaggedMove(attackerSet, PRIORITY_MOVES)) score += 6;
  if (hasTaggedMove(attackerSet, RECOVERY_MOVES)) score += 4;
  if (hasTaggedMove(attackerSet, SETUP_MOVES)) score += 5;
  if (hasTaggedMove(attackerSet, PIVOT_MOVES)) score += 4;

  return score;
}

function getCombinations<T>(values: T[], size: number): T[][] {
  if (size <= 0) return [[]];
  if (size >= values.length) return [values.slice()];

  const combinations: T[][] = [];
  const current: T[] = [];

  const walk = (start: number) => {
    if (current.length === size) {
      combinations.push([...current]);
      return;
    }

    for (let index = start; index <= values.length - (size - current.length); index += 1) {
      const value = values[index];
      if (value === undefined) continue;
      current.push(value);
      walk(index + 1);
      current.pop();
    }
  };

  walk(0);
  return combinations;
}

function pickBring(
  team: Team,
  opponent: Team,
  dex: ShowdownDexAdapter,
  format: string,
  limit = 3,
): PokemonSet[] {
  const bringCount = Math.max(1, Math.min(limit, team.members.length));
  const memberScores = new Map(team.members.map((member) => [member, opponent.members.reduce((sum, target) => sum + scoreSetIntoTarget(member, target, dex, format), 0)]));

  if (bringCount === 1) {
    return [...team.members]
      .sort((left, right) => (memberScores.get(right) ?? 0) - (memberScores.get(left) ?? 0) || left.species.localeCompare(right.species))
      .slice(0, 1);
  }

  const candidateGroups = getCombinations(team.members, bringCount)
    .map((members) => ({
      members,
      score: scoreBringGroup(members, opponent.members, dex, format),
    }))
    .sort((left, right) => right.score - left.score);

  const bestGroup = candidateGroups[0]?.members ?? team.members.slice(0, bringCount);

  return [...bestGroup]
    .sort((left, right) => (memberScores.get(right) ?? 0) - (memberScores.get(left) ?? 0) || left.species.localeCompare(right.species));
}

function buildTeamPreviewChoice(
  team: Team,
  opponent: Team,
  dex: ShowdownDexAdapter,
  format: string,
): string {
  const bringLimit = isBssLikeFormat(format) ? Math.min(3, team.members.length) : team.members.length;
  const bring = pickBring(team, opponent, dex, format, bringLimit);
  const selectedSlots = bring
    .map((member) => team.members.findIndex((entry) => entry === member) + 1)
    .filter((slot) => slot > 0);
  const remainingSlots = team.members.map((_, index) => index + 1).filter((slot) => !selectedSlots.includes(slot));
  const ordered = [...selectedSlots, ...remainingSlots];

  return ordered.length ? `team ${ordered.join('')}` : 'default';
}

function scoreBringGroup(
  teamMembers: PokemonSet[],
  opponentMembers: PokemonSet[],
  dex: ShowdownDexAdapter,
  format: string,
): number {
  const remaining = [...opponentMembers];
  let total = 0;

  for (const member of teamMembers) {
    if (remaining.length === 0) break;

    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const target = remaining[index];
      if (!target) continue;

      const currentScore = scoreSetIntoTarget(member, target, dex, format);
      if (currentScore > bestScore) {
        bestScore = currentScore;
        bestIndex = index;
      }
    }

    total += bestScore;
    remaining.splice(bestIndex, 1);
  }

  const utility = teamMembers.reduce((sum, member) => sum
    + (hasTaggedMove(member, PRIORITY_MOVES) ? 4 : 0)
    + (hasTaggedMove(member, PIVOT_MOVES) ? 3 : 0)
    + (hasTaggedMove(member, RECOVERY_MOVES) ? 2 : 0), 0);

  return total + utility;
}

class EngineGreedyPlayer {
  private usedMega = false;
  private usedTera = false;
  private opponentActiveSet: PokemonSet | null = null;
  private readonly foePrefix: 'p1' | 'p2';
  private currentTurn = 0;
  private selfBoosts: Record<string, number> = {};
  private foeBoosts: Record<string, number> = {};
  private foeStatus: string | undefined;
  private rngState: number;
  private readonly ourArchetype: TeamArchetype;
  private readonly opponentArchetype: TeamArchetype;

  constructor(
    private readonly stream: any,
    private readonly playerSide: 'p1' | 'p2',
    private readonly team: Team,
    private readonly opponent: Team,
    private readonly dex: ShowdownDexAdapter,
    private readonly format: string,
    seed = 1,
  ) {
    this.foePrefix = playerSide === 'p1' ? 'p2' : 'p1';
    this.rngState = (seed + (playerSide === 'p1' ? 11 : 29)) >>> 0;
    this.ourArchetype = detectTeamArchetype(team, dex, format);
    this.opponentArchetype = detectTeamArchetype(opponent, dex, format);
  }

  private nextRandom(): number {
    this.rngState = ((1664525 * this.rngState) + 1013904223) >>> 0;
    return this.rngState / 0x100000000;
  }

  async start(): Promise<void> {
    for await (const chunk of this.stream) {
      this.receive(String(chunk));
    }
  }

  private receive(chunk: string): void {
    for (const line of chunk.split('\n')) {
      this.receiveLine(line);
    }
  }

  private updateOpponentState(line: string): void {
    if (line.startsWith('|turn|')) {
      this.currentTurn = Number(line.split('|')[2] ?? this.currentTurn);
      return;
    }

    if (
      line.startsWith(`|switch|${this.foePrefix}a:`)
      || line.startsWith(`|drag|${this.foePrefix}a:`)
      || line.startsWith(`|replace|${this.foePrefix}a:`)
    ) {
      const segments = line.split('|');
      const species = speciesFromDetails(segments[3]);
      this.opponentActiveSet = this.opponent.members.find((member) => canonicalSpeciesId(member.species) === canonicalSpeciesId(species)) ?? null;
      this.foeBoosts = {};
      this.foeStatus = undefined;
      return;
    }

    if (
      line.startsWith(`|switch|${this.playerSide}a:`)
      || line.startsWith(`|drag|${this.playerSide}a:`)
      || line.startsWith(`|replace|${this.playerSide}a:`)
    ) {
      this.selfBoosts = {};
      return;
    }

    if (line.startsWith(`|-status|${this.foePrefix}a:`)) {
      this.foeStatus = line.split('|')[3] ?? this.foeStatus;
      return;
    }

    if (line.startsWith(`|-curestatus|${this.foePrefix}a:`)) {
      this.foeStatus = undefined;
      return;
    }

    if (line.startsWith(`|-boost|${this.playerSide}a:`) || line.startsWith(`|-unboost|${this.playerSide}a:`)) {
      const segments = line.split('|');
      const stat = segments[3] ?? '';
      const amount = Number(segments[4] ?? 0) * (line.startsWith('|-unboost|') ? -1 : 1);
      this.selfBoosts[stat] = (this.selfBoosts[stat] ?? 0) + amount;
      return;
    }

    if (line.startsWith(`|-boost|${this.foePrefix}a:`) || line.startsWith(`|-unboost|${this.foePrefix}a:`)) {
      const segments = line.split('|');
      const stat = segments[3] ?? '';
      const amount = Number(segments[4] ?? 0) * (line.startsWith('|-unboost|') ? -1 : 1);
      this.foeBoosts[stat] = (this.foeBoosts[stat] ?? 0) + amount;
      return;
    }

    if (line.startsWith('|-clearallboost|')) {
      this.selfBoosts = {};
      this.foeBoosts = {};
      return;
    }

    if (line.startsWith(`|faint|${this.foePrefix}a:`)) {
      this.opponentActiveSet = null;
      this.foeBoosts = {};
      this.foeStatus = undefined;
    }
  }

  private receiveLine(line: string): void {
    if (!line.startsWith('|')) return;

    this.updateOpponentState(line);

    const [cmd, rest] = splitFirst(line.slice(1), '|');
    if (cmd === 'request') {
      this.receiveRequest(JSON.parse(rest) as PlayerChoiceRequest);
      return;
    }

    if (cmd === 'error' && !rest.startsWith('[Unavailable choice]')) {
      throw new Error(rest);
    }
  }

  private receiveRequest(request: PlayerChoiceRequest): void {
    const choice = this.buildChoice(request);
    if (choice) void this.stream.write(choice);
  }

  private getSwitchOptions(sidePokemon: NonNullable<PlayerChoiceRequest['side']>['pokemon'], activeIndex: number, chosen: number[]) {
    void activeIndex;

    return sidePokemon
      .map((pokemon, index) => ({ pokemon, slot: index + 1, set: this.team.members[index] }))
      .filter((entry) => Boolean(entry.set))
      .filter((entry) => !entry.pokemon.active)
      .filter((entry) => !entry.pokemon.condition.endsWith(' fnt'))
      .filter((entry) => !chosen.includes(entry.slot))
      .map((entry) => {
        const set = entry.set as PokemonSet;
        const hpRatio = parseConditionPercent(entry.pokemon.condition);
        const strategicValue = scoreMemberStrategicValue(set, this.dex, this.format);
        const activeScore = this.opponentActiveSet ? scoreSetIntoTarget(set, this.opponentActiveSet, this.dex, this.format) : 0;
        const teamScore = this.opponent.members.reduce((sum, target) => sum + scoreSetIntoTarget(set, target, this.dex, this.format), 0);
        let score = (activeScore * 0.8) + (teamScore * 0.2) + (hpRatio * 12);

        if (strategicValue >= 95 && hpRatio < 0.45) score -= 6;
        if (strategicValue < 75 && hpRatio < 0.35) score += 2;

        return {
          slot: entry.slot,
          score,
        };
      })
      .sort((left, right) => right.score - left.score);
  }

  private getBestActiveSet(slotIndex: number, sidePokemon: NonNullable<PlayerChoiceRequest['side']>['pokemon']): PokemonSet | null {
    const bySlot = this.team.members[slotIndex];
    if (bySlot) return bySlot;

    const details = sidePokemon[slotIndex]?.details;
    const species = speciesFromDetails(details);
    return this.team.members.find((member) => canonicalSpeciesId(member.species) === canonicalSpeciesId(species)) ?? null;
  }

  private buildChoice(request: PlayerChoiceRequest): string | undefined {
    if (request.wait) return undefined;
    if (request.teamPreview) return buildTeamPreviewChoice(this.team, this.opponent, this.dex, this.format);

    const sidePokemon = request.side?.pokemon ?? [];

    if (request.forceSwitch) {
      const chosen: number[] = [];
      const choices = request.forceSwitch.map((mustSwitch, index) => {
        if (!mustSwitch) return 'pass';
        const switches = this.getSwitchOptions(sidePokemon, index, chosen);
        const target = pickRankedOption(switches, () => this.nextRandom(), 8)?.slot;
        if (!target) return 'pass';
        chosen.push(target);
        return `switch ${target}`;
      });

      return choices.join(', ');
    }

    if (!request.active?.length) return undefined;

    const chosen: number[] = [];
    const choices = request.active.map((activeState, activeIndex) => {
      const currentPokemon = sidePokemon[activeIndex];
      if (!currentPokemon || currentPokemon.condition.endsWith(' fnt') || currentPokemon.commanding) return 'pass';

      const currentSet = this.getBestActiveSet(activeIndex, sidePokemon);
      if (!currentSet) return 'move 1';

      const hpRatio = parseConditionPercent(currentPokemon.condition);
      const matchupScore = this.opponentActiveSet ? scoreSetIntoTarget(currentSet, this.opponentActiveSet, this.dex, this.format) : 0;
      const selfBoostTotal = sumPositiveBoosts(this.selfBoosts);
      const foeBoostTotal = sumPositiveBoosts(this.foeBoosts);
      const currentValue = scoreMemberStrategicValue(currentSet, this.dex, this.format);
      const remainingCount = countLivePokemon(sidePokemon);
      const isEndgame = remainingCount <= 2 || this.currentTurn >= 8;
      const shouldPreserveCurrent = (currentValue >= 92 || selfBoostTotal >= 2) && hpRatio <= 0.45;
      const isExpendableCurrent = currentValue < 82 && selfBoostTotal === 0 && hpRatio <= 0.4 && remainingCount >= 2;

      const moveChoices = (activeState.moves ?? [])
        .map((move, index) => {
          const moveId = toId(move.move);
          const teamScore = scoreMoveIntoTeam(currentSet, move.move, this.opponent, this.dex, this.format);
          const targetScore = this.opponentActiveSet ? scoreSpecificMove(currentSet, move.move, this.opponentActiveSet, this.dex, this.format) : teamScore;
          let score = this.opponentActiveSet ? ((targetScore * 0.8) + (teamScore * 0.2)) : teamScore;

          if (SETUP_MOVES.has(moveId)) {
            if (selfBoostTotal >= 2) score -= 22;
            else if (matchupScore >= 18 && hpRatio >= 0.6) score += 24;
            else if (hpRatio <= 0.5) score -= 12;
          }

          if (RECOVERY_MOVES.has(moveId)) {
            score += hpRatio <= 0.45 && matchupScore >= -4 ? 28 : hpRatio <= 0.65 ? 10 : -8;
            if (currentValue >= 90 && selfBoostTotal > 0) score += 8;
          }

          if (PIVOT_MOVES.has(moveId)) {
            score += matchupScore < 0 ? 16 : 6;
          }

          if (PRIORITY_MOVES.has(moveId) && targetScore >= 65) score += 10;

          if (STATUS_SPREAD_MOVES.has(moveId)) {
            score += this.foeStatus ? -18 : matchupScore >= -6 ? 12 : 4;
          }

          if (PHAZING_MOVES.has(moveId) && foeBoostTotal >= 2) {
            score += 26;
          }

          if (HAZARD_MOVES.has(moveId)) {
            score += isBssLikeFormat(this.format)
              ? (this.currentTurn <= 1 && matchupScore > 8 ? 4 : -12)
              : (this.currentTurn <= 2 && matchupScore >= 0 ? 8 : 1);
          }

          if (SCOUT_MOVES.has(moveId)) {
            score += hpRatio < 0.35 ? 6 : -10;
          }

          if (this.opponentArchetype === 'hyper-offense') {
            if (PRIORITY_MOVES.has(moveId)) score += 8;
            if (SETUP_MOVES.has(moveId) && matchupScore < 20) score -= 8;
            if (HAZARD_MOVES.has(moveId)) score -= 8;
            if (RECOVERY_MOVES.has(moveId) && hpRatio > 0.45) score -= 6;
          }

          if (this.opponentArchetype === 'stall') {
            if (SETUP_MOVES.has(moveId)) score += 10;
            if (STATUS_SPREAD_MOVES.has(moveId)) score += 6;
            if (SCOUT_MOVES.has(moveId)) score -= 6;
          }

          if (this.opponentArchetype === 'trick-room') {
            if (moveId === 'agility' || moveId === 'trailblaze') score -= 16;
            if (PHAZING_MOVES.has(moveId) || STATUS_SPREAD_MOVES.has(moveId)) score += 10;
            if (PRIORITY_MOVES.has(moveId)) score += 5;
          }

          if (this.opponentArchetype === 'rain' || this.opponentArchetype === 'sun') {
            if (STATUS_SPREAD_MOVES.has(moveId)) score += 6;
          }

          if (this.ourArchetype === 'hyper-offense') {
            if (SETUP_MOVES.has(moveId)) score += 5;
            if (RECOVERY_MOVES.has(moveId) && hpRatio > 0.45) score -= 6;
          }

          if (this.ourArchetype === 'stall' || this.ourArchetype === 'balance') {
            if (PIVOT_MOVES.has(moveId)) score += 4;
            if (RECOVERY_MOVES.has(moveId) && hpRatio <= 0.6) score += 4;
          }

          if (isEndgame) {
            if (!SETUP_MOVES.has(moveId) && !RECOVERY_MOVES.has(moveId) && !STATUS_SPREAD_MOVES.has(moveId) && !HAZARD_MOVES.has(moveId)) {
              score += 10;
            }
            if (PIVOT_MOVES.has(moveId) || HAZARD_MOVES.has(moveId)) score -= 10;
          }

          if (isExpendableCurrent) {
            if (!SETUP_MOVES.has(moveId) && !RECOVERY_MOVES.has(moveId) && !STATUS_SPREAD_MOVES.has(moveId) && !HAZARD_MOVES.has(moveId)) {
              score += 12;
            }
            if (PIVOT_MOVES.has(moveId) || HAZARD_MOVES.has(moveId) || SCOUT_MOVES.has(moveId)) score -= 12;
          }

          if (shouldPreserveCurrent) {
            if (RECOVERY_MOVES.has(moveId)) score += 8;
            if (PIVOT_MOVES.has(moveId)) score += 6;
            if (SETUP_MOVES.has(moveId) && hpRatio < 0.4) score -= 14;
          }

          if (!SETUP_MOVES.has(moveId) && !RECOVERY_MOVES.has(moveId) && !STATUS_SPREAD_MOVES.has(moveId) && !HAZARD_MOVES.has(moveId) && currentValue < 75 && hpRatio < 0.3) {
            score += 8;
          }

          if ((STATUS_SPREAD_MOVES.has(moveId) || HAZARD_MOVES.has(moveId)) && currentValue >= 90 && hpRatio < 0.5) {
            score -= 10;
          }

          return {
            slot: index + 1,
            move: move.move,
            disabled: move.disabled,
            target: move.target ?? 'normal',
            score,
          };
        })
        .filter((move) => !move.disabled)
        .sort((left, right) => right.score - left.score);

      const bestMove = pickRankedOption(moveChoices, () => this.nextRandom(), 10);
      const switchChoices = activeState.trapped ? [] : this.getSwitchOptions(sidePokemon, activeIndex, chosen);
      const bestSwitch = pickRankedOption(switchChoices, () => this.nextRandom(), 8);
      const shouldSwitch = Boolean(bestSwitch && (
        !bestMove
        || (matchupScore < -20 && bestSwitch.score > (bestMove?.score ?? 0) + (isExpendableCurrent ? 14 : 6))
        || (hpRatio < 0.35 && shouldPreserveCurrent && bestSwitch.score > (bestMove?.score ?? 0) - 2)
        || (foeBoostTotal >= 2 && !isExpendableCurrent && bestSwitch.score > (bestMove?.score ?? 0))
        || (selfBoostTotal > 0 && currentValue >= 95 && hpRatio < 0.45 && bestSwitch.score > (bestMove?.score ?? 0) - 1)
      ));

      if (shouldSwitch && bestSwitch) {
        chosen.push(bestSwitch.slot);
        return `switch ${bestSwitch.slot}`;
      }

      if (!bestMove) return 'move 1';

      let choice = `move ${bestMove.slot}`;
      if (request.active && request.active.length > 1 && ['normal', 'any', 'adjacentFoe'].includes(bestMove.target)) {
        choice += ' 1';
      }

      if (activeState.canMegaEvo && !this.usedMega && (bestMove.score >= 95 || matchupScore > 8)) {
        this.usedMega = true;
        choice += ' mega';
      } else if (activeState.canTerastallize && !this.usedTera && bestMove.score >= 120) {
        this.usedTera = true;
        choice += ' terastallize';
      }

      return choice;
    });

    return choices.join(', ');
  }
}

async function runBattleStreamGame(
  request: MatchupRequest,
  dex: ShowdownDexAdapter,
  iteration: number,
): Promise<{ winner: 'p1' | 'p2' | 'tie'; turns: number; ourLead?: string; theirLead?: string }> {
  const streams = getPlayerStreams(new BattleStream());
  const p1 = new EngineGreedyPlayer(streams.p1, 'p1', request.team, request.opponent, dex, request.format, ((iteration + 1) * 97));
  const p2 = new EngineGreedyPlayer(streams.p2, 'p2', request.opponent, request.team, dex, request.format, ((iteration + 1) * 193));

  const p1Task = p1.start();
  const p2Task = p2.start();

  let winner: 'p1' | 'p2' | 'tie' = 'tie';
  let turns = 0;
  let ourLead: string | undefined;
  let theirLead: string | undefined;

  const seed = [iteration + 1, iteration + 2, iteration + 3, iteration + 4];
  const initMessage = `>start ${JSON.stringify({ formatid: request.format, seed })}\n`
    + `>player p1 ${JSON.stringify({ name: 'P1', team: packTeam(request.team) })}\n`
    + `>player p2 ${JSON.stringify({ name: 'P2', team: packTeam(request.opponent) })}`;

  void streams.omniscient.write(initMessage);

  for await (const chunk of streams.omniscient) {
    for (const line of String(chunk).split('\n')) {
      if (!ourLead && line.startsWith('|switch|p1a:')) {
        const segments = line.split('|');
        ourLead = speciesFromDetails(segments[3]);
      }

      if (!theirLead && line.startsWith('|switch|p2a:')) {
        const segments = line.split('|');
        theirLead = speciesFromDetails(segments[3]);
      }

      if (line.startsWith('|turn|')) {
        turns = Number(line.split('|')[2] ?? turns);
      }

      if (line.startsWith('|win|')) {
        const victor = line.split('|')[2];
        winner = victor === 'P1' ? 'p1' : victor === 'P2' ? 'p2' : 'tie';
        break;
      }

      if (line.startsWith('|tie|')) {
        winner = 'tie';
        break;
      }
    }

    if (winner !== 'tie' || String(chunk).includes('|tie|')) break;
  }

  try {
    void streams.omniscient.writeEnd();
  } catch {
    // The stream may already be closed once the winner is known.
  }

  await Promise.allSettled([p1Task, p2Task]);

  return { winner, turns, ourLead, theirLead };
}

export class ShowdownSimulationAdapter implements SimulationPort {
  private readonly dex = new ShowdownDexAdapter();

  async simulateMatchup(request: MatchupRequest): Promise<MatchupSummary> {
    try {
      return await this.simulateWithBattleStream(request);
    } catch (error) {
      return this.simulateHeuristicFallback(request, error);
    }
  }

  private async simulateWithBattleStream(request: MatchupRequest): Promise<MatchupSummary> {
    const maxIterations = isBssLikeFormat(request.format) ? 8 : 6;
    const defaultIterations = isBssLikeFormat(request.format) ? 6 : 4;
    const iterations = Math.max(1, Math.min(request.iterations || defaultIterations, maxIterations));

    if (!request.team.members.length || !request.opponent.members.length) {
      return {
        iterations,
        wins: 0,
        losses: 0,
        draws: iterations,
        winRate: 0.5,
        turnBreakdown: [],
        damageHighlights: [],
        switchPredictions: [],
        notes: ['Simulation needs at least one Pokémon on each side.'],
      };
    }

    let wins = 0;
    let losses = 0;
    let draws = 0;
    let totalTurns = 0;
    const ourLeads: string[] = [];
    const theirLeads: string[] = [];
    const gameResults: Array<{ winner: 'p1' | 'p2' | 'tie'; turns: number }> = [];

    for (let index = 0; index < iterations; index += 1) {
      const result = await runBattleStreamGame(request, this.dex, index);
      totalTurns += result.turns;
      gameResults.push({ winner: result.winner, turns: result.turns });
      if (result.ourLead) ourLeads.push(result.ourLead);
      if (result.theirLead) theirLeads.push(result.theirLead);

      if (result.winner === 'p1') wins += 1;
      else if (result.winner === 'p2') losses += 1;
      else draws += 1;
    }

    const spotlight = pickBring(request.team, request.opponent, this.dex, request.format, 1)[0];
    const mainThreat = pickBring(request.opponent, request.team, this.dex, request.format, 1)[0];
    const averageTurns = totalTurns / Math.max(1, iterations);
    const winRate = (wins + (draws * 0.5)) / iterations;
    const ourArchetype = detectTeamArchetype(request.team, this.dex, request.format);
    const opponentArchetype = detectTeamArchetype(request.opponent, this.dex, request.format);
    const turnBreakdown = buildTurnBreakdown(gameResults);
    const prediction = getPredictionAccuracy(request, this.dex);
    const damageHighlights = buildDamageHighlights(request, this.dex);
    const switchPredictions = buildSwitchPredictions(request, this.dex);

    const notes = uniqueStrings([
      spotlight ? `${spotlight.species} showed the cleanest engine-backed line from preview.` : null,
      mainThreat ? `${mainThreat.species} was the opposing slot demanding the most respect in battle.` : null,
      `The sim read this as ${ourArchetype} into opposing ${opponentArchetype}.`,
      ourLeads[0] ? `Most stable opener from the sim: ${ourLeads[0]}.` : null,
      theirLeads[0] ? `Most common opposing lead in sim: ${theirLeads[0]}.` : null,
      averageTurns <= 6
        ? 'These battles closed quickly, so tempo and immediate pressure mattered most.'
        : 'These battles tended to go longer, so preserving pivots and recovery mattered more.',
      ...prediction.notes,
      winRate >= 0.6
        ? 'The projected bring-3 shell looks favorable if you preserve momentum.'
        : winRate <= 0.45
          ? 'The projected matchup is fragile and may need tighter positioning or a different bring pattern.'
          : 'The projected matchup looks close, so sequencing and speed control should decide it.',
    ]).slice(0, 6);

    return {
      iterations,
      wins,
      losses,
      draws,
      winRate,
      movePredictionAccuracy: prediction.move,
      switchPredictionAccuracy: prediction.switch,
      turnBreakdown,
      damageHighlights,
      switchPredictions,
      notes,
    };
  }

  private async simulateHeuristicFallback(request: MatchupRequest, error?: unknown): Promise<MatchupSummary> {
    const iterations = Math.max(2, Math.min(request.iterations || 6, 6));

    if (!request.team.members.length || !request.opponent.members.length) {
      return {
        iterations,
        wins: 0,
        losses: 0,
        draws: iterations,
        winRate: 0.5,
        turnBreakdown: [],
        damageHighlights: [],
        switchPredictions: [],
        notes: ['Simulation needs at least one Pokémon on each side.'],
      };
    }

    let wins = 0;
    let losses = 0;
    let draws = 0;
    const gameResults: Array<{ winner: 'p1' | 'p2' | 'tie'; turns: number }> = [];

    for (let index = 0; index < iterations; index += 1) {
      const ourBring = pickBring(request.team, request.opponent, this.dex, request.format, 3);
      const theirBring = pickBring(request.opponent, request.team, this.dex, request.format, 3);

      const ourScore = scoreBringGroup(ourBring, theirBring, this.dex, request.format) + ((Math.random() - 0.5) * 8);
      const theirScore = scoreBringGroup(theirBring, ourBring, this.dex, request.format);
      const turns = ourScore > theirScore + 4 ? 4 + (index % 3) : theirScore > ourScore + 4 ? 6 + (index % 4) : 8 + (index % 3);

      if (ourScore > theirScore + 4) {
        wins += 1;
        gameResults.push({ winner: 'p1', turns });
      } else if (theirScore > ourScore + 4) {
        losses += 1;
        gameResults.push({ winner: 'p2', turns });
      } else {
        draws += 1;
        gameResults.push({ winner: 'tie', turns });
      }
    }

    const spotlight = pickBring(request.team, request.opponent, this.dex, request.format, 1)[0];
    const mainThreat = pickBring(request.opponent, request.team, this.dex, request.format, 1)[0];
    const winRate = (wins + (draws * 0.5)) / iterations;
    const ourArchetype = detectTeamArchetype(request.team, this.dex, request.format);
    const opponentArchetype = detectTeamArchetype(request.opponent, this.dex, request.format);
    const turnBreakdown = buildTurnBreakdown(gameResults);
    const prediction = getPredictionAccuracy(request, this.dex);
    const damageHighlights = buildDamageHighlights(request, this.dex);
    const switchPredictions = buildSwitchPredictions(request, this.dex);

    const notes = uniqueStrings([
      spotlight ? `${spotlight.species} still shows the cleanest preview line.` : null,
      mainThreat ? `${mainThreat.species} is still the opposing slot demanding the most respect.` : null,
      `The heuristic model read this as ${ourArchetype} into opposing ${opponentArchetype}.`,
      'Engine-backed battle rollout was unavailable here, so the simulator fell back to matchup heuristics.',
      error instanceof Error ? `Fallback reason: ${error.message}` : null,
      ...prediction.notes,
      winRate >= 0.6
        ? 'The projected bring-3 shell looks favorable if you preserve momentum.'
        : winRate <= 0.45
          ? 'The projected matchup is fragile and may need tighter positioning or a different bring pattern.'
          : 'The projected matchup looks close, so sequencing and speed control should decide it.',
    ]).slice(0, 6);

    return {
      iterations,
      wins,
      losses,
      draws,
      winRate,
      movePredictionAccuracy: prediction.move,
      switchPredictionAccuracy: prediction.switch,
      turnBreakdown,
      damageHighlights,
      switchPredictions,
      notes,
    };
  }
}
