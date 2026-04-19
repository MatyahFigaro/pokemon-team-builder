import type { AnalysisReport, ScoreBreakdown, Team } from '@pokemon/domain';

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function computeStructuralScore(team: Team, report: Omit<AnalysisReport, 'score' | 'suggestions'>): ScoreBreakdown {
  let offense = 55;
  let defense = 55;
  let utility = 55;
  const notes: string[] = [];

  if (team.members.length === 6) {
    utility += 8;
    notes.push('Full team size bonus.');
  } else {
    utility -= 12;
    notes.push('Incomplete team penalty.');
  }

  if (report.profile.style === 'bss') {
    if (report.synergy.hasHazardSetter) utility += 4;
    if (report.synergy.hasHazardRemoval) utility += 2;
  } else {
    if (report.synergy.hasHazardSetter) utility += 6;
    if (report.synergy.hasHazardRemoval) utility += 8;
  }
  if (report.speed.fastCount > 0) offense += 6;
  if (report.speed.hasSpeedControl) offense += 5;
  if (report.synergy.uniqueTypes.length >= 8) defense += 5;

  if (report.profile.style === 'bss') {
    notes.push('BSS format profile applied.');
    defense += Math.round((report.threats.coverageScore - 50) / 10);
    offense += report.battlePlan.speedControlRating === 'good' ? 4 : report.battlePlan.speedControlRating === 'poor' ? -4 : 1;
    utility += report.battlePlan.leadCandidates.length >= 2 ? 3 : 0;
    utility += Math.min(4, report.synergy.pivotCount * 2);
    utility -= report.profile.mechanics.tera && report.battlePlan.teraDependency === 'high' ? 3 : 0;
  }

  for (const issue of report.issues) {
    if (issue.severity === 'error') {
      offense -= 6;
      defense -= 8;
      utility -= 8;
    } else if (issue.severity === 'warning') {
      offense -= 3;
      defense -= 4;
      utility -= 4;
    } else {
      utility -= 1;
    }
  }

  const total = clamp(offense * 0.35 + defense * 0.35 + utility * 0.3);

  return {
    total,
    offense: clamp(offense),
    defense: clamp(defense),
    utility: clamp(utility),
    notes,
  };
}
