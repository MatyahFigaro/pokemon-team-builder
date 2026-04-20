import type { Command } from 'commander';

import { createCliProgress, createService, describeSimTeamSelection, formatAnalysisReport, parseSimulationTeamCount, readTeamText } from '../shared.js';

export function registerAnalyzeCommand(program: Command): void {
  program
    .command('analyze')
    .description('Analyze a Pokémon team from Showdown import text.')
    .option('-f, --file <path>', 'Path to a team text file')
    .option('--format <format>', 'Showdown format id', 'gen9ou')
    .option('--json', 'Print raw JSON instead of a formatted report')
    .option('--explain', 'Show fuller reasoning in the report')
    .option('--sim-teams <count|all>', 'How many benchmark teams to use for simulation; defaults to 1', '1')
    .action(async (options: { file?: string; format: string; json?: boolean; explain?: boolean; simTeams?: string }) => {
      const progress = createCliProgress('Analyzing team', !options.json);

      try {
        progress.step('Loading team input', { current: 1, total: 4, detail: options.file ? 'from file' : 'from stdin' });
        const service = createService();
        const teamText = await readTeamText(options.file);

        progress.step('Parsing Showdown import', { current: 2, total: 4, detail: options.format });
        const team = service.importShowdown(teamText, options.format);
        const simTeams = parseSimulationTeamCount(options.simTeams);

        progress.step('Running checks and benchmark sims', { current: 3, total: 4, detail: describeSimTeamSelection(simTeams) });
        const report = await service.analyze(team, {
          simTeams,
        });

        progress.step('Rendering report', { current: 4, total: 4 });
        console.log(options.json ? JSON.stringify(report, null, 2) : formatAnalysisReport(report, options.explain));
        progress.succeed('Analysis complete');
      } catch (error) {
        progress.fail('Analysis failed');
        throw error;
      }
    });
}
