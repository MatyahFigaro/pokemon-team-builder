import type { Command } from 'commander';

import { createService, formatSuggestions, readTeamText, selectSuggestionsByMode } from '../shared.js';

export function registerSuggestCompleteCommand(program: Command): void {
  program
    .command('suggest-complete')
    .description('Complete a partial team core with role-based suggestions.')
    .option('-f, --file <path>', 'Path to a team text file')
    .option('--format <format>', 'Showdown format id', 'gen9ou')
    .option('--json', 'Print raw JSON instead of formatted output')
    .option('--explain', 'Show fuller reasoning for each suggestion')
    .action(async (options: { file?: string; format: string; json?: boolean; explain?: boolean }) => {
      const service = createService();
      const teamText = await readTeamText(options.file);
      const team = service.importShowdown(teamText, options.format);
      const report = await service.analyze(team);
      const suggestions = selectSuggestionsByMode(report.suggestions, 'complete');

      console.log(options.json ? JSON.stringify(suggestions, null, 2) : formatSuggestions(suggestions, options.explain));
    });
}
