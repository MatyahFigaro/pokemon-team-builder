import type { AnalysisReport, SimulationPort, SpeciesDexPort, Team, ValidationPort } from '@pokemon/domain';
import { preloadUsageAnalytics } from '@pokemon/storage';

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

  const issues = [
    ...weaknessAnalysis.issues,
    ...speedAnalysis.issues,
    ...synergyAnalysis.issues,
    ...bssAnalysis.issues,
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
    battlePlan: bssAnalysis.battlePlan,
    threats: bssAnalysis.threats,
    archetypes: bssAnalysis.archetypes,
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
