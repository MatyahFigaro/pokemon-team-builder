import type { AnalysisReport, Suggestion, Team, TeamCodecPort } from '@pokemon/domain';

import {
  buildWithConstraints,
  optimizeTeamSets,
  planBringFromPreview,
  scoutLiveMeta,
  type BuildConstraints,
  type ConstrainedBuildReport,
  type MetaScoutingReport,
  type PreviewMatchupPlan,
  type TeamSetOptimizationReport,
} from './advanced-features.js';
import { analyzeTeam, type AnalyzeTeamDeps, type SimulationSelectionOptions } from './analyze-team.js';

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

  analyze(team: Team, options: SimulationSelectionOptions = {}): Promise<AnalysisReport> {
    return analyzeTeam(team, this.deps, options);
  }

  async suggestPatch(team: Team, options: SimulationSelectionOptions = {}): Promise<Suggestion[]> {
    const report = await this.analyze(team, options);
    return report.suggestions;
  }

  planBringFromPreview(team: Team, opponent?: Team | null): Promise<PreviewMatchupPlan> {
    return planBringFromPreview(team, opponent ?? null, this.deps);
  }

  optimizeSets(team: Team, options: SimulationSelectionOptions = {}): Promise<TeamSetOptimizationReport> {
    return optimizeTeamSets(team, this.deps, options);
  }

  scoutMeta(format: string): Promise<MetaScoutingReport> {
    return scoutLiveMeta(format, this.deps.dex);
  }

  buildWithConstraints(constraints: BuildConstraints): Promise<ConstrainedBuildReport> {
    return buildWithConstraints(constraints, this.deps);
  }
}
