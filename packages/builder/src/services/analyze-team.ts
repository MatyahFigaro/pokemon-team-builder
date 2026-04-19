import type { AnalysisReport, SpeciesDexPort, Team, ValidationPort } from '@pokemon/domain';

import { analyzeBssPlan } from '../analysis/bss.js';
import { summarizeRoles } from '../analysis/roles.js';
import { analyzeSpeed } from '../analysis/speed.js';
import { analyzeSynergy } from '../analysis/synergy.js';
import { analyzeWeaknesses } from '../analysis/weaknesses.js';
import { computeStructuralScore } from '../scoring/structural.js';
import { buildCompletionSuggestions } from '../suggest/complete.js';
import { buildPatchSuggestions } from '../suggest/patch.js';

export interface AnalyzeTeamDeps {
  dex: SpeciesDexPort;
  validator: ValidationPort;
}

export async function analyzeTeam(team: Team, deps: AnalyzeTeamDeps): Promise<AnalysisReport> {
  const validation = await deps.validator.validateTeam(team, team.format);
  const workingTeam = validation.normalizedTeam ?? team;

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
    issues,
  };

  const score = computeStructuralScore(workingTeam, baseReport);
  const suggestions = [
    ...buildPatchSuggestions(workingTeam, { ...baseReport, score, suggestions: [] }),
    ...buildCompletionSuggestions(workingTeam, { ...baseReport, score, suggestions: [] }),
  ].slice(0, 3);

  return {
    ...baseReport,
    score,
    suggestions,
  } satisfies AnalysisReport;
}
