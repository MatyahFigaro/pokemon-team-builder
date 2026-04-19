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

function buildThreatSimulationTeam(team: Team, deps: AnalyzeTeamDeps): Team | null {
  const snapshot = getUsageAnalyticsForFormat(team.format);
  const topCluster = snapshot?.species.length
    ? uniqueStrings(
      snapshot.species.slice(0, 4).flatMap((entry, index) => [
        entry.species,
        ...getTopUsageNames(entry.teammates, index === 0 ? 2 : 1),
      ]),
    )
    : getTopUsageThreatNames(team.format, 6);

  const members = topCluster
    .map((speciesName) => getCompetitiveSet(speciesName, team.format, deps.dex, deps.validator, {
      roleHint: 'default',
    }))
    .filter((set): set is NonNullable<typeof set> => Boolean(set))
    .slice(0, 3);

  if (members.length === 0) return null;

  return {
    format: team.format,
    source: 'generated',
    members,
  };
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

  const opponent = buildThreatSimulationTeam(team, deps);
  if (!opponent) {
    return {
      enabled: false,
      opponentModel: 'live threat cluster unavailable',
      opponentPreview: [],
      iterations: 0,
      notes: [],
    };
  }

  const iterations = isBssLikeFormat(team.format) ? 5 : 3;
  const summary = await deps.simulator.simulateMatchup({
    format: team.format,
    team,
    opponent,
    iterations,
  });

  return {
    enabled: true,
    opponentModel: 'live threat cluster',
    opponentPreview: opponent.members.map((member) => member.species),
    iterations: summary.iterations,
    wins: summary.wins,
    losses: summary.losses,
    draws: summary.draws,
    winRate: summary.winRate,
    notes: summary.notes,
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
