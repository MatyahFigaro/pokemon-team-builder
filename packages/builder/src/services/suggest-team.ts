import type { Suggestion, Team } from '@pokemon/domain';

import type { AnalyzeTeamDeps } from './analyze-team.js';
import { analyzeTeam } from './analyze-team.js';

export async function suggestTeamPatch(team: Team, deps: AnalyzeTeamDeps): Promise<Suggestion[]> {
  const report = await analyzeTeam(team, deps);
  return report.suggestions;
}
