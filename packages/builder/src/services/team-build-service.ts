import type { AnalysisReport, Suggestion, Team, TeamCodecPort } from '@pokemon/domain';

import { analyzeTeam, type AnalyzeTeamDeps } from './analyze-team.js';

export interface TeamBuildServiceDeps extends AnalyzeTeamDeps {
  codec?: TeamCodecPort;
}

export class TeamBuildService {
  constructor(private readonly deps: TeamBuildServiceDeps) {}

  importShowdown(teamText: string, format = 'gen9ou'): Team {
    if (!this.deps.codec) {
      throw new Error('No team codec adapter configured.');
    }

    return this.deps.codec.parseShowdown(teamText, format);
  }

  exportShowdown(team: Team): string {
    if (!this.deps.codec) {
      throw new Error('No team codec adapter configured.');
    }

    return this.deps.codec.exportShowdown(team);
  }

  analyze(team: Team): Promise<AnalysisReport> {
    return analyzeTeam(team, this.deps);
  }

  async suggestPatch(team: Team): Promise<Suggestion[]> {
    const report = await this.analyze(team);
    return report.suggestions;
  }
}
