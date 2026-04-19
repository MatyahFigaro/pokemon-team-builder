import type { Command } from 'commander';

import { createService, formatSuggestions, readTeamText, selectSuggestionsByMode } from '../shared.js';

export function registerSuggestPatchCommand(program: Command): void {
  program
    .command('suggest-patch')
    .description('Suggest a deterministic patch for a Pokémon team.')
    .option('-f, --file <path>', 'Path to a team text file')
    .option('--format <format>', 'Showdown format id', 'gen9ou')
    .option('--json', 'Print raw JSON instead of formatted output')
    .option('--explain', 'Show fuller reasoning for each suggestion')
    .action(async (options: { file?: string; format: string; json?: boolean; explain?: boolean }) => {
      const service = createService();
      const teamText = await readTeamText(options.file);
      const team = service.importShowdown(teamText, options.format);
      const suggestions = selectSuggestionsByMode(await service.suggestPatch(team), 'patch');

      console.log(options.json ? JSON.stringify(suggestions, null, 2) : formatSuggestions(suggestions, options.explain));
    });
}
