import type { Command } from 'commander';

import { createService, formatSuggestions, readTeamText, selectSuggestionsByMode } from '../shared.js';

export function registerSuggestCommand(program: Command): void {
  program
    .command('suggest')
    .alias('recommend')
    .description('Get actionable team suggestions from the CLI.')
    .option('-f, --file <path>', 'Path to a team text file')
    .option('--format <format>', 'Showdown format id', 'gen9ou')
    .option('--mode <mode>', 'Suggestion mode: auto, patch, or complete', 'auto')
    .option('--json', 'Print raw JSON instead of formatted output')
    .option('--explain', 'Show fuller reasoning for each suggestion')
    .action(async (options: { file?: string; format: string; mode?: string; json?: boolean; explain?: boolean }) => {
      const service = createService();
      const teamText = await readTeamText(options.file);
      const team = service.importShowdown(teamText, options.format);
      const report = await service.analyze(team);
      const mode = options.mode === 'patch' || options.mode === 'complete' ? options.mode : 'auto';
      const suggestions = selectSuggestionsByMode(report.suggestions, mode);

      console.log(options.json ? JSON.stringify(suggestions, null, 2) : formatSuggestions(suggestions, options.explain));
    });
}
