import type { AnalysisReport, SimulationAnalysisSummary, SimulationPort, SpeciesDexPort, Team, TeamIssue, ValidationPort } from '@pokemon/domain';
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

export interface AnalyzeTeamDeps {
  dex: SpeciesDexPort;
  validator: ValidationPort;
  simulator?: SimulationPort;
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

function buildThreatSimulationTeams(team: Team, deps: AnalyzeTeamDeps): Team[] {
  const snapshot = getUsageAnalyticsForFormat(team.format);
  const lineups: string[][] = [];

  if (snapshot?.species.length) {
    for (const entry of snapshot.species.slice(0, 6)) {
      const lineup = uniqueStrings([entry.species, ...getTopUsageNames(entry.teammates, 2)]).slice(0, 3);
      if (lineup.length >= 2) lineups.push(lineup);
    }

    const topNames = uniqueStrings(snapshot.species.slice(0, 9).map((entry) => entry.species));
    for (let index = 0; index < topNames.length; index += 3) {
      const lineup = uniqueStrings(topNames.slice(index, index + 3));
      if (lineup.length >= 2) lineups.push(lineup);
    }
  } else {
    const threats = getTopUsageThreatNames(team.format, 9);
    for (let index = 0; index < threats.length; index += 3) {
      const lineup = uniqueStrings(threats.slice(index, index + 3));
      if (lineup.length >= 2) lineups.push(lineup);
    }
  }

  return lineups
    .filter((lineup, index, array) => array.findIndex((candidate) => candidate.map(toId).join('|') === lineup.map(toId).join('|')) === index)
    .slice(0, isBssLikeFormat(team.format) ? 4 : 3)
    .map((lineup) => ({
      format: team.format,
      source: 'generated' as const,
      members: lineup
        .map((speciesName) => getCompetitiveSet(speciesName, team.format, deps.dex, deps.validator, {
          roleHint: 'default',
        }))
        .filter((set): set is NonNullable<typeof set> => Boolean(set))
        .slice(0, 3),
    }))
    .filter((candidate) => candidate.members.length >= 2);
}

async function getSimulationAnalysis(team: Team, deps: AnalyzeTeamDeps): Promise<SimulationAnalysisSummary> {
  if (!deps.simulator) {
    return {
      enabled: false,
      opponentModel: 'simulator unavailable',
      opponentPreview: [],
      iterations: 0,
      notes: [],
    };
  }

  const opponents = buildThreatSimulationTeams(team, deps);
  if (opponents.length === 0) {
    return {
      enabled: false,
      opponentModel: 'live threat rotation unavailable',
      opponentPreview: [],
      iterations: 0,
      notes: [],
    };
  }

  const iterationsPerOpponent = isBssLikeFormat(team.format) ? 2 : 1;
  const summaries = await Promise.all(opponents.map((opponent) => deps.simulator?.simulateMatchup({
    format: team.format,
    team,
    opponent,
    iterations: iterationsPerOpponent,
  })));

  const wins = summaries.reduce((sum, summary) => sum + (summary?.wins ?? 0), 0);
  const losses = summaries.reduce((sum, summary) => sum + (summary?.losses ?? 0), 0);
  const draws = summaries.reduce((sum, summary) => sum + (summary?.draws ?? 0), 0);
  const iterations = summaries.reduce((sum, summary) => sum + (summary?.iterations ?? 0), 0);
  const opponentPreview = uniqueStrings(opponents.flatMap((opponent) => opponent.members.map((member) => member.species))).slice(0, 6);
  const winRate = iterations > 0 ? (wins + (draws * 0.5)) / iterations : 0.5;

  return {
    enabled: true,
    opponentModel: `live threat rotation (${opponents.length} shells)`,
    opponentPreview,
    iterations,
    wins,
    losses,
    draws,
    winRate,
    notes: uniqueStrings(summaries.flatMap((summary) => summary?.notes ?? [])).slice(0, 5),
  };
}

export async function analyzeTeam(team: Team, deps: AnalyzeTeamDeps): Promise<AnalysisReport> {
  const referenceAwareTeam = hydrateTeamWithReferenceSets(team, deps);
  const validation = await deps.validator.validateTeam(referenceAwareTeam, team.format);
  const workingTeam = validation.normalizedTeam ?? referenceAwareTeam;

  await preloadUsageAnalytics(workingTeam.format);

  const roles = summarizeRoles(workingTeam, deps.dex);
  const weaknessAnalysis = analyzeWeaknesses(workingTeam, deps.dex);
  const speedAnalysis = analyzeSpeed(workingTeam, deps.dex, roles);
  const synergyAnalysis = analyzeSynergy(workingTeam, deps.dex, roles);
  const bssAnalysis = analyzeBssPlan(workingTeam, deps.dex, roles, speedAnalysis.speed);
  const simulation = await getSimulationAnalysis(workingTeam, deps);

  const simulationIssues: TeamIssue[] = simulation.enabled && typeof simulation.winRate === 'number'
    ? (simulation.winRate < 0.45
      ? [{
          code: 'simulation-matchups-rough',
          severity: 'warning',
          summary: 'Sim-backed matchup spread looks rough',
          details: `This team only reached about ${Math.round(simulation.winRate * 100)}% across ${simulation.iterations} games into the live threat cluster (${simulation.opponentPreview.join(', ') || simulation.opponentModel}).`,
          memberNames: workingTeam.members.map((member) => member.species),
        }]
      : simulation.winRate >= 0.6
        ? [{
            code: 'simulation-matchups-solid',
            severity: 'info',
            summary: 'Sim-backed matchup spread looks solid',
            details: `This team reached about ${Math.round(simulation.winRate * 100)}% across ${simulation.iterations} games into the live threat cluster (${simulation.opponentPreview.join(', ') || simulation.opponentModel}).`,
            memberNames: workingTeam.members.map((member) => member.species),
          }]
        : [])
    : [];

  const battlePlan = {
    ...bssAnalysis.battlePlan,
    notes: uniqueStrings([
      ...bssAnalysis.battlePlan.notes,
      simulation.enabled && typeof simulation.winRate === 'number'
        ? `Simulation snapshot versus ${simulation.opponentPreview.join(', ') || simulation.opponentModel} landed around ${Math.round(simulation.winRate * 100)}% over ${simulation.iterations} games.`
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
