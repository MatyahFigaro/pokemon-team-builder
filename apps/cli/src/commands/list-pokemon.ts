import type { Command } from 'commander';

import { listPokemonForFormat } from '@pokemon/showdown-adapter';

export function registerListPokemonCommand(program: Command): void {
  program
    .command('list-pokemon')
    .description('List all Pokémon legal in a given format so the exact names can be reused in build --core.')
    .requiredOption('-f, --format <format>', 'Showdown format id, such as gen9bssregg')
    .option('-q, --query <text>', 'Filter Pokémon by name, type, or tier')
    .option('-l, --limit <number>', 'Maximum number of Pokémon to print (default: all)', '5000')
    .option('--names-only', 'Print only legal species names, one per line for easy --core copy/paste')
    .option('--json', 'Print raw JSON output')
    .action((options: { format: string; query?: string; limit?: string; namesOnly?: boolean; json?: boolean }) => {
      const result = listPokemonForFormat({
        format: options.format,
        query: options.query,
        limit: Number(options.limit ?? '5000'),
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (options.namesOnly) {
        for (const species of result.pokemon) {
          console.log(species.name);
        }
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
