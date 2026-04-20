import type { AnalysisReport, MatchupRequest, SimulationAnalysisSummary, SimulationPort, SpeciesDexPort, Team, TeamIssue, ValidationPort } from '@pokemon/domain';
import { getTopUsageNames, getTopUsageThreatNames, getUsageAnalyticsForFormat, preloadUsageAnalytics } from '@pokemon/storage';

import { analyzeBssPlan } from '../analysis/bss.js';
import { detectRolesForSet, summarizeRoles } from '../analysis/roles.js';
import { analyzeSpeed } from '../analysis/speed.js';
import { analyzeSynergy } from '../analysis/synergy.js';
import { analyzeWeaknesses } from '../analysis/weaknesses.js';
import { computeStructuralScore } from '../scoring/structural.js';
import { getCompetitiveSet, type PreviewRoleHint } from '../suggest/legal-preview.js';
import { buildCompletionSuggestions } from '../suggest/complete.js';
import { buildPatchSuggestions } from '../suggest/patch.js';
import { buildStrongThreatSimulationTeams } from './simulation-benchmarks.js';

export interface AnalyzeTeamDeps {
  dex: SpeciesDexPort;
  validator: ValidationPort;
  simulator?: SimulationPort;
}

export interface SimulationSelectionOptions {
  simTeams?: number | 'all';
}

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function toId(value: string | undefined): string {
  return normalize(value).replace(/[^a-z0-9]/g, '');
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function isBssLikeFormat(format: string): boolean {
  const id = toId(format);
  return id.includes('bss') || id.includes('battlestadium') || id.includes('championsbss');
}

function getRoleHintForMember(member: Team['members'][number], dex: SpeciesDexPort, format: string): PreviewRoleHint {
  const roles = new Set([...(member.roles ?? []), ...detectRolesForSet(member, dex, format)]);

  if (roles.has('hazard-removal') || roles.has('hazard-setter')) return 'hazard-control';
  if (roles.has('pivot')) return 'pivot';
  if (roles.has('speed-control') || roles.has('scarfer') || roles.has('lead')) return 'speed';
  if (roles.has('physical-wall') || roles.has('special-wall') || roles.has('cleric')) return 'bulky';
  if (roles.has('setup-sweeper') || roles.has('wallbreaker') || roles.has('physical-attacker') || roles.has('special-attacker')) return 'offense';
  return 'default';
}

function hasStatSpread(stats: Record<string, number> | undefined): boolean {
  return Boolean(stats && Object.values(stats).some((value) => typeof value === 'number' && value > 0));
}

function mergeMoves(current: string[], fallback: string[]): string[] {
  return [...current, ...fallback]
    .map((move) => String(move).trim())
    .filter(Boolean)
    .filter((move, index, array) => array.findIndex((candidate) => candidate.toLowerCase() === move.toLowerCase()) === index)
    .slice(0, 4);
}

function shouldHydrateMember(member: Team['members'][number]): boolean {
  return !member.item
    || !member.ability
    || !member.nature
    || member.moves.length < 4
    || !hasStatSpread(member.evs as Record<string, number> | undefined);
}

function hydrateTeamWithReferenceSets(team: Team, deps: AnalyzeTeamDeps): Team {
  return {
    ...team,
    members: team.members.map((member) => {
      if (!shouldHydrateMember(member)) return member;

      const reference = getCompetitiveSet(member.species, team.format, deps.dex, deps.validator, {
        roleHint: getRoleHintForMember(member, deps.dex, team.format),
      });

      if (!reference) return member;

      return {
        ...reference,
        ...member,
        moves: mergeMoves(member.moves, reference.moves),
        evs: hasStatSpread(member.evs as Record<string, number> | undefined) ? member.evs : reference.evs,
        ivs: hasStatSpread(member.ivs as Record<string, number> | undefined) ? member.ivs : reference.ivs,
        roles: Array.from(new Set([...(reference.roles ?? []), ...(member.roles ?? [])])),
      };
    }),
  };
}

function buildThreatSimulationTeams(team: Team, deps: AnalyzeTeamDeps, simTeams: number | 'all' = 1): Team[] {
  return buildStrongThreatSimulationTeams(team.format, deps.dex, deps.validator, {
    maxTeams: simTeams,
  });
}

async function simulateRequests(
  simulator: NonNullable<AnalyzeTeamDeps['simulator']>,
  requests: MatchupRequest[],
): Promise<Array<Awaited<ReturnType<SimulationPort['simulateMatchup']>>>> {
  if (typeof simulator.simulateMatchups === 'function') {
    return simulator.simulateMatchups(requests, { concurrency: Math.min(4, requests.length || 1) });
  }

  return Promise.all(requests.map((request) => simulator.simulateMatchup(request)));
}

function describeSimulationPool(simulation: Pick<SimulationAnalysisSummary, 'opponentModel' | 'opponentPreview'>): string {
  const sample = simulation.opponentPreview.join(', ');
  return sample ? `${simulation.opponentModel}; sample: ${sample}` : simulation.opponentModel;
}

async function getSimulationAnalysis(
  team: Team,
  deps: AnalyzeTeamDeps,
  options: SimulationSelectionOptions = {},
): Promise<SimulationAnalysisSummary> {
  if (!deps.simulator) {
    return {
      enabled: false,
      opponentModel: 'simulator unavailable',
      opponentPreview: [],
      iterations: 0,
      turnBreakdown: [],
      damageHighlights: [],
      switchPredictions: [],
      notes: [],
    };
  }

  const opponents = buildThreatSimulationTeams(team, deps, options.simTeams ?? 1);
  if (opponents.length === 0) {
    return {
      enabled: false,
      opponentModel: 'strong benchmark rotation unavailable',
      opponentPreview: [],
      iterations: 0,
      turnBreakdown: [],
      damageHighlights: [],
      switchPredictions: [],
      notes: [],
    };
  }

  const iterationsPerOpponent = isBssLikeFormat(team.format) ? 2 : 1;
  const summaries = await simulateRequests(
    deps.simulator,
    opponents.map((opponent) => ({
      format: team.format,
      team,
      opponent,
      iterations: iterationsPerOpponent,
    })),
  );

  const wins = summaries.reduce((sum, summary) => sum + (summary?.wins ?? 0), 0);
  const losses = summaries.reduce((sum, summary) => sum + (summary?.losses ?? 0), 0);
  const draws = summaries.reduce((sum, summary) => sum + (summary?.draws ?? 0), 0);
  const iterations = summaries.reduce((sum, summary) => sum + (summary?.iterations ?? 0), 0);
  const opponentPreview = uniqueStrings(opponents.flatMap((opponent) => opponent.members.map((member) => member.species))).slice(0, 6);
  const winRate = iterations > 0 ? (wins + (draws * 0.5)) / iterations : 0.5;
  const moveAccuracies = summaries.map((summary) => summary?.movePredictionAccuracy).filter((value): value is number => typeof value === 'number');
  const switchAccuracies = summaries.map((summary) => summary?.switchPredictionAccuracy).filter((value): value is number => typeof value === 'number');

  const usesManualBenchmarks = opponents.some((opponent) => opponent.source === 'manual-benchmark');

  return {
    enabled: true,
    opponentModel: usesManualBenchmarks
      ? `manual benchmark rotation (${opponents.length} teams)`
      : `strong live benchmark rotation (${opponents.length} shells)`,
    opponentPreview,
    iterations,
    wins,
    losses,
    draws,
    winRate,
    movePredictionAccuracy: moveAccuracies.length ? moveAccuracies.reduce((sum, value) => sum + value, 0) / moveAccuracies.length : undefined,
    switchPredictionAccuracy: switchAccuracies.length ? switchAccuracies.reduce((sum, value) => sum + value, 0) / switchAccuracies.length : undefined,
    turnBreakdown: uniqueStrings(summaries.flatMap((summary) => summary?.turnBreakdown ?? [])).slice(0, 6),
    damageHighlights: uniqueStrings(summaries.flatMap((summary) => summary?.damageHighlights ?? [])).slice(0, 6),
    switchPredictions: uniqueStrings(summaries.flatMap((summary) => summary?.switchPredictions ?? [])).slice(0, 6),
    notes: uniqueStrings(summaries.flatMap((summary) => summary?.notes ?? [])).slice(0, 6),
  };
}

export async function analyzeTeam(
  team: Team,
  deps: AnalyzeTeamDeps,
  options: SimulationSelectionOptions = {},
): Promise<AnalysisReport> {
  const referenceAwareTeam = hydrateTeamWithReferenceSets(team, deps);
  const validation = await deps.validator.validateTeam(referenceAwareTeam, team.format);
  const workingTeam = validation.normalizedTeam ?? referenceAwareTeam;

  await preloadUsageAnalytics(workingTeam.format);

  const roles = summarizeRoles(workingTeam, deps.dex);
  const weaknessAnalysis = analyzeWeaknesses(workingTeam, deps.dex);
  const speedAnalysis = analyzeSpeed(workingTeam, deps.dex, roles);
  const synergyAnalysis = analyzeSynergy(workingTeam, deps.dex, roles);
  const bssAnalysis = analyzeBssPlan(workingTeam, deps.dex, roles, speedAnalysis.speed);
  const simulation = await getSimulationAnalysis(workingTeam, deps, options);

  const simulationIssues: TeamIssue[] = simulation.enabled && typeof simulation.winRate === 'number'
    ? (simulation.winRate < 0.45
      ? [{
          code: 'simulation-matchups-rough',
          severity: 'warning',
          summary: 'Sim-backed matchup spread looks rough',
          details: `This team only reached about ${Math.round(simulation.winRate * 100)}% across ${simulation.iterations} games against the selected benchmark rotation (${describeSimulationPool(simulation)}).`,
          memberNames: workingTeam.members.map((member) => member.species),
        }]
      : simulation.winRate >= 0.6
        ? [{
            code: 'simulation-matchups-solid',
            severity: 'info',
            summary: 'Sim-backed matchup spread looks solid',
            details: `This team reached about ${Math.round(simulation.winRate * 100)}% across ${simulation.iterations} games against the selected benchmark rotation (${describeSimulationPool(simulation)}).`,
            memberNames: workingTeam.members.map((member) => member.species),
          }]
        : [])
    : [];

  const battlePlan = {
    ...bssAnalysis.battlePlan,
    notes: uniqueStrings([
      ...bssAnalysis.battlePlan.notes,
      simulation.enabled && typeof simulation.winRate === 'number'
        ? `Simulation snapshot into the selected benchmark rotation (${describeSimulationPool(simulation)}) landed around ${Math.round(simulation.winRate * 100)}% over ${simulation.iterations} games.`
        : '',
      ...simulation.notes,
    ]),
  };

  const issues = [
    ...weaknessAnalysis.issues,
    ...speedAnalysis.issues,
    ...synergyAnalysis.issues,
    ...bssAnalysis.issues,
    ...simulationIssues,
  ].sort((left, right) => {
    const rank = { error: 0, warning: 1, info: 2 } as const;
    return rank[left.severity] - rank[right.severity];
  });

  const baseReport = {
    format: workingTeam.format,
    legality: {
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
    },
    profile: bssAnalysis.profile,
    roles,
    weaknesses: weaknessAnalysis.weaknesses,
    speed: speedAnalysis.speed,
    synergy: synergyAnalysis.synergy,
    battlePlan,
    threats: bssAnalysis.threats,
    archetypes: bssAnalysis.archetypes,
    simulation,
    issues,
  };

  const score = computeStructuralScore(workingTeam, baseReport);
  const completionSuggestions = buildCompletionSuggestions(workingTeam, { ...baseReport, score, suggestions: [] }, deps.dex, deps.validator);
  const patchSuggestions = buildPatchSuggestions(workingTeam, { ...baseReport, score, suggestions: [] }, deps.dex, deps.validator);
  const suggestions = (
    workingTeam.members.length < 6
      ? [...completionSuggestions, ...patchSuggestions]
      : [...patchSuggestions, ...completionSuggestions]
  ).slice(0, 3);

  return {
    ...baseReport,
    score,
    suggestions,
  } satisfies AnalysisReport;
}
