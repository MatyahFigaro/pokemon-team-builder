import type { Command } from 'commander';

import { createCliProgress, createService, describeSimTeamSelection, formatOptimizationReport, parseSimulationTeamCount, readTeamText, serializeTeam } from '../shared.js';

export function registerOptimizeCommand(program: Command): void {
  program
    .command('optimize')
    .description('Suggest legal set improvements for an existing team.')
    .option('-f, --file <path>', 'Path to a team text file')
    .option('--format <format>', 'Showdown format id', 'gen9ou')
    .option('--json', 'Print raw JSON instead of formatted output')
    .option('--export <format>', 'Export format: text, showdown, or json', 'text')
    .option('--sim-teams <count|all>', 'How many benchmark teams to use for simulation; defaults to 1', '1')
    .action(async (options: { file?: string; format: string; json?: boolean; export?: string; simTeams?: string }) => {
      const progress = createCliProgress('Optimizing team sets', !(options.json || options.export === 'json'));

      try {
        progress.step('Loading team input', { current: 1, total: 4, detail: options.file ? 'from file' : 'from stdin' });
        const service = createService();
        const teamText = await readTeamText(options.file);

        progress.step('Parsing Showdown import', { current: 2, total: 4, detail: options.format });
        const team = service.importShowdown(teamText, options.format);
        const simTeams = parseSimulationTeamCount(options.simTeams);

        progress.step('Tuning sets and running checks', { current: 3, total: 4, detail: describeSimTeamSelection(simTeams) });
        const report = await service.optimizeSets(team, {
          simTeams,
        });

        progress.step('Rendering optimized output', { current: 4, total: 4, detail: options.export ?? 'text' });
        if (options.json || options.export === 'json') {
          console.log(JSON.stringify(report, null, 2));
          progress.succeed('Optimization complete');
          return;
        }

        if (options.export === 'showdown') {
          console.log(service.exportShowdown(report.optimizedTeam));
          progress.succeed('Optimization complete');
          return;
        }

        if (options.export === 'team-json') {
          console.log(serializeTeam(report.optimizedTeam));
          progress.succeed('Optimization complete');
          return;
        }

        console.log(formatOptimizationReport(report));
        progress.succeed('Optimization complete');
      } catch (error) {
        progress.fail('Optimization failed');
        throw error;
      }
    });
}
