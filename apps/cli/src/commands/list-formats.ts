import type { Command } from 'commander';

import { listShowdownFormats } from '@pokemon/showdown-adapter';

export function registerListFormatsCommand(program: Command): void {
  program
    .command('list-formats')
    .description('List available Pokémon Showdown battle formats.')
    .option('-q, --query <text>', 'Filter formats by id, name, section, or aliases like BSS and Battle Stadium')
    .option('--section <name>', 'Only show one section, such as Champions')
    .option('--search-only', 'Only show ladder or search-visible formats')
    .option('--challenge-only', 'Only show challenge-usable formats')
    .option('--json', 'Print raw JSON output')
    .action((options: { query?: string; section?: string; searchOnly?: boolean; challengeOnly?: boolean; json?: boolean }) => {
      const sectionNeedle = options.section?.trim().toLowerCase();
      const formats = listShowdownFormats({
        query: options.query,
        onlySearch: options.searchOnly,
        onlyChallenge: options.challengeOnly,
      }).filter((format) => !sectionNeedle || format.section.toLowerCase().includes(sectionNeedle));

      if (options.json) {
        console.log(JSON.stringify(formats, null, 2));
        return;
      }

      let currentSection = '';
      for (const format of formats) {
        if (format.section !== currentSection) {
          currentSection = format.section;
          console.log(`\n=== ${currentSection} ===`);
        }

        const flags = [
          format.searchShow ? 'search' : null,
          format.challengeShow ? 'challenge' : null,
          format.tournamentShow ? 'tour' : null,
        ].filter(Boolean).join(',');

        console.log(`${format.id.padEnd(32)} ${format.name} [${flags}]`);
      }
    });
}
