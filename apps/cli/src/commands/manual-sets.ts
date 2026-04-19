import type { Command } from 'commander';

import { getManualSetsPath, importManualSets, listManualSets } from '@pokemon/storage';

import { createService, readTeamText } from '../shared.js';

function parseCsvList(value?: string): string[] | undefined {
  if (!value) return undefined;

  const values = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return values.length ? values : undefined;
}

export function registerManualSetsCommand(program: Command): void {
  const manualSets = program
    .command('manual-sets')
    .description('Store and inspect manually curated sets that the engine can reuse by format.');

  manualSets
    .command('import')
    .description('Import one or more Showdown sets into the manual set registry for a format.')
    .requiredOption('--format <format>', 'Showdown format id')
    .option('-f, --file <path>', 'Path to a Showdown set or team text file')
    .option('--label <label>', 'Optional label for the imported sets')
    .option('--notes <notes>', 'Optional notes stored with the imported sets')
    .option('--roles <roles>', 'Comma-separated role tags such as pivot, wallbreaker, speed-control')
    .option('--styles <styles>', 'Comma-separated style tags such as balance, bulky-offense, rain')
    .action(async (options: { format: string; file?: string; label?: string; notes?: string; roles?: string; styles?: string }) => {
      const service = createService();
      const teamText = await readTeamText(options.file);
      const team = service.importShowdown(teamText, options.format);
      const result = importManualSets(options.format, team.members, {
        label: options.label,
        notes: options.notes,
        roles: parseCsvList(options.roles),
        styles: parseCsvList(options.styles),
        source: options.file ? `file:${options.file}` : 'stdin',
      });

      console.log(`Saved ${result.saved} set(s) to ${result.path}`);
    });

  manualSets
    .command('list')
    .description('List manual sets stored for a format or species.')
    .option('--format <format>', 'Filter by format')
    .option('--species <species>', 'Filter by species')
    .option('--json', 'Print raw JSON output')
    .action((options: { format?: string; species?: string; json?: boolean }) => {
      const records = listManualSets({
        format: options.format,
        species: options.species,
      });

      if (options.json) {
        console.log(JSON.stringify({ path: getManualSetsPath(), sets: records }, null, 2));
        return;
      }

      console.log(`Manual set file: ${getManualSetsPath()}`);
      console.log(`Stored sets: ${records.length}`);

      for (const record of records) {
        const moves = record.set.moves.join(' / ');
        const label = record.label ? ` [${record.label}]` : '';
        console.log(`- ${record.format}: ${record.species}${label}`);
        console.log(`  ${record.set.item ? `${record.set.species} @ ${record.set.item}` : record.set.species}`);
        if (record.set.ability) console.log(`  Ability: ${record.set.ability}`);
        if (record.set.nature) console.log(`  Nature: ${record.set.nature}`);
        if (record.roles?.length) console.log(`  Roles: ${record.roles.join(', ')}`);
        if (record.styles?.length) console.log(`  Styles: ${record.styles.join(', ')}`);
        console.log(`  Moves: ${moves}`);
      }
    });

  manualSets
    .command('path')
    .description('Show the storage file used for manual sets.')
    .action(() => {
      console.log(getManualSetsPath());
    });
}
