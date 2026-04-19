import type { Command } from 'commander';

import { createService, formatOptimizationReport, readTeamText, serializeTeam } from '../shared.js';

export function registerOptimizeCommand(program: Command): void {
  program
    .command('optimize')
    .description('Suggest legal set improvements for an existing team.')
    .option('-f, --file <path>', 'Path to a team text file')
    .option('--format <format>', 'Showdown format id', 'gen9ou')
    .option('--json', 'Print raw JSON instead of formatted output')
    .option('--export <format>', 'Export format: text, showdown, or json', 'text')
    .action(async (options: { file?: string; format: string; json?: boolean; export?: string }) => {
      const service = createService();
      const teamText = await readTeamText(options.file);
      const team = service.importShowdown(teamText, options.format);
      const report = await service.optimizeSets(team);

      if (options.json || options.export === 'json') {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      if (options.export === 'showdown') {
        console.log(service.exportShowdown(report.optimizedTeam));
        return;
      }

      if (options.export === 'team-json') {
        console.log(serializeTeam(report.optimizedTeam));
        return;
      }

      console.log(formatOptimizationReport(report));
    });
}
