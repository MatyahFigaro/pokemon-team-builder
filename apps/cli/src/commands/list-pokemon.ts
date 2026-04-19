import type { Command } from 'commander';

import { listPokemonForFormat } from '@pokemon/showdown-adapter';

export function registerListPokemonCommand(program: Command): void {
  program
    .command('list-pokemon')
    .description('List Pokémon that are legal in a given format.')
    .requiredOption('-f, --format <format>', 'Showdown format id, such as gen9bssregg')
    .option('-q, --query <text>', 'Filter Pokémon by name, type, or tier')
    .option('-l, --limit <number>', 'Maximum number of Pokémon to print', '50')
    .option('--json', 'Print raw JSON output')
    .action((options: { format: string; query?: string; limit?: string; json?: boolean }) => {
      const result = listPokemonForFormat({
        format: options.format,
        query: options.query,
        limit: Number(options.limit ?? '50'),
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`Requested format: ${result.requestedFormat}`);
      console.log(`Resolved format:  ${result.resolvedFormat}`);
      console.log(`Legal species:    ${result.total}`);

      if (result.warning) {
        console.log(`Note:             ${result.warning}`);
      }

      for (const species of result.pokemon) {
        const tier = species.tier ? ` [${species.tier}]` : '';
        console.log(`${species.name.padEnd(24)} ${species.types.join('/')} ${tier}`.trimEnd());
      }
    });
}
