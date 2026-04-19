import type { MatchupRequest, MatchupSummary, PokemonSet, SimulationPort, Team } from '@pokemon/domain';

import { ShowdownDexAdapter } from './dex.js';

const PRIORITY_MOVES = new Set(['extremespeed', 'suckerpunch', 'aquajet', 'iceshard', 'machpunch', 'bulletpunch', 'shadowsneak', 'vacuumwave']);
const RECOVERY_MOVES = new Set(['recover', 'roost', 'slackoff', 'softboiled', 'moonlight', 'morningsun', 'synthesis', 'rest']);
const SETUP_MOVES = new Set(['swordsdance', 'dragondance', 'nastyplot', 'calmmind', 'bulkup', 'agility', 'quiverdance', 'trailblaze']);
const PIVOT_MOVES = new Set(['uturn', 'voltswitch', 'partingshot', 'flipturn', 'teleport', 'chillyreception']);

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function toId(value: string | undefined): string {
  return normalize(value).replace(/[^a-z0-9]/g, '');
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

function pickBring(
  team: Team,
  opponent: Team,
  dex: ShowdownDexAdapter,
  format: string,
  limit = 3,
): PokemonSet[] {
  return [...team.members]
    .map((member) => ({
      member,
      score: opponent.members.reduce((sum, target) => sum + scoreSetIntoTarget(member, target, dex, format), 0),
    }))
    .sort((left, right) => right.score - left.score || left.member.species.localeCompare(right.member.species))
    .slice(0, Math.min(limit, team.members.length))
    .map((entry) => entry.member);
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

export class ShowdownSimulationAdapter implements SimulationPort {
  private readonly dex = new ShowdownDexAdapter();

  async simulateMatchup(request: MatchupRequest): Promise<MatchupSummary> {
    const iterations = Math.max(4, request.iterations || 12);

    if (!request.team.members.length || !request.opponent.members.length) {
      return {
        iterations,
        wins: 0,
        losses: 0,
        draws: iterations,
        winRate: 0.5,
        notes: ['Simulation needs at least one Pokémon on each side.'],
      };
    }

    let wins = 0;
    let losses = 0;
    let draws = 0;

    for (let index = 0; index < iterations; index += 1) {
      const ourBring = pickBring(request.team, request.opponent, this.dex, request.format, 3);
      const theirBring = pickBring(request.opponent, request.team, this.dex, request.format, 3);

      const ourScore = scoreBringGroup(ourBring, theirBring, this.dex, request.format) + ((Math.random() - 0.5) * 12);
      const theirScore = scoreBringGroup(theirBring, ourBring, this.dex, request.format);

      if (ourScore > theirScore + 4) wins += 1;
      else if (theirScore > ourScore + 4) losses += 1;
      else draws += 1;
    }

    const spotlight = pickBring(request.team, request.opponent, this.dex, request.format, 1)[0];
    const mainThreat = pickBring(request.opponent, request.team, this.dex, request.format, 1)[0];
    const winRate = wins / iterations;

    const notes = [
      spotlight ? `${spotlight.species} shows the cleanest simulated line from preview.` : null,
      mainThreat ? `${mainThreat.species} is the opposing slot that demands the most respect.` : null,
      winRate >= 0.6
        ? 'The projected bring-3 shell looks favorable if you preserve momentum.'
        : winRate <= 0.45
          ? 'The projected matchup is fragile and may need tighter positioning or a different bring pattern.'
          : 'The projected matchup looks close, so sequencing and speed control should decide it.',
    ].filter((value): value is string => Boolean(value));

    return {
      iterations,
      wins,
      losses,
      draws,
      winRate,
      notes,
    };
  }
}
