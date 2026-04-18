import type { Command } from 'commander';

import { createService, readTeamText } from '../shared.js';

export function registerNormalizeCommand(program: Command): void {
  program
    .command('normalize')
    .description('Parse Showdown team text and export it back in normalized format.')
    .option('-f, --file <path>', 'Path to a team text file')
    .option('--format <format>', 'Showdown format id', 'gen9ou')
    .action(async (options: { file?: string; format: string }) => {
      const service = createService();
      const teamText = await readTeamText(options.file);
      const team = service.importShowdown(teamText, options.format);

      console.log(service.exportShowdown(team));
    });
}
