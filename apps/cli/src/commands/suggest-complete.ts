import type { Command } from 'commander';

import { createService, formatSuggestions, readTeamText } from '../shared.js';

export function registerSuggestCompleteCommand(program: Command): void {
  program
    .command('suggest-complete')
    .description('Complete a partial team core with role-based suggestions.')
    .option('-f, --file <path>', 'Path to a team text file')
    .option('--format <format>', 'Showdown format id', 'gen9ou')
    .action(async (options: { file?: string; format: string }) => {
      const service = createService();
      const teamText = await readTeamText(options.file);
      const team = service.importShowdown(teamText, options.format);
      const report = await service.analyze(team);

      console.log(formatSuggestions(report.suggestions));
    });
}
