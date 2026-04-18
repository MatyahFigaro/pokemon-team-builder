import type { Command } from 'commander';

import { createService, formatAnalysisReport, readTeamText } from '../shared.js';

export function registerAnalyzeCommand(program: Command): void {
  program
    .command('analyze')
    .description('Analyze a Pokémon team from Showdown import text.')
    .option('-f, --file <path>', 'Path to a team text file')
    .option('--format <format>', 'Showdown format id', 'gen9ou')
    .option('--json', 'Print raw JSON instead of a formatted report')
    .action(async (options: { file?: string; format: string; json?: boolean }) => {
      const service = createService();
      const teamText = await readTeamText(options.file);
      const team = service.importShowdown(teamText, options.format);
      const report = await service.analyze(team);

      console.log(options.json ? JSON.stringify(report, null, 2) : formatAnalysisReport(report));
    });
}
