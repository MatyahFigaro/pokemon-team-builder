import type { Command } from 'commander';

import { createService, formatSuggestions, readTeamText } from '../shared.js';

export function registerSuggestPatchCommand(program: Command): void {
  program
    .command('suggest-patch')
    .description('Suggest a deterministic patch for a Pokémon team.')
    .option('-f, --file <path>', 'Path to a team text file')
    .option('--format <format>', 'Showdown format id', 'gen9ou')
    .action(async (options: { file?: string; format: string }) => {
      const service = createService();
      const teamText = await readTeamText(options.file);
      const team = service.importShowdown(teamText, options.format);
      const suggestions = await service.suggestPatch(team);

      console.log(formatSuggestions(suggestions));
    });
}
