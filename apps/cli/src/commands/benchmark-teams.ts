import type { Command } from 'commander';

import { deleteManualBenchmarkTeams, getManualBenchmarkTeamsPath, importManualBenchmarkTeams, listManualBenchmarkTeams } from '@pokemon/storage';

import { createService, readClipboardText, readTeamText } from '../shared.js';

function splitShowdownTeams(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const parts = normalized
    .split(/^={3,}.*={3,}\s*$/gm)
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length ? parts : [normalized];
}

export function registerBenchmarkTeamsCommand(program: Command): void {
  const benchmarkTeams = program
    .command('benchmark-teams')
    .description('Manage manually curated Showdown teams used as simulation benchmarks by format.');

  benchmarkTeams
    .command('import')
    .description('Import one or more Showdown teams as benchmark opponents for a format.')
    .requiredOption('--format <format>', 'Showdown format id')
    .option('-f, --file <path>', 'Path to a Showdown team export file')
    .option('-c, --clipboard', 'Read Showdown team text directly from the system clipboard')
    .option('--label <label>', 'Optional label for the imported benchmark teams')
    .option('--notes <notes>', 'Optional notes stored with the imported teams')
    .action(async (options: { format: string; file?: string; clipboard?: boolean; label?: string; notes?: string }) => {
      if (options.file && options.clipboard) {
        throw new Error('Choose either --file or --clipboard, not both.');
      }

      const rawText = options.clipboard ? await readClipboardText() : await readTeamText(options.file);
      const service = createService();
      const teams = splitShowdownTeams(rawText).map((teamText) => service.importShowdown(teamText, options.format));
      const result = importManualBenchmarkTeams(options.format, teams, {
        label: options.label,
        notes: options.notes,
        source: options.clipboard ? 'clipboard' : options.file ? `file:${options.file}` : 'stdin',
      });

      console.log(`Saved ${result.saved} benchmark team(s) to ${result.path}`);
    });

  benchmarkTeams
    .command('list')
    .description('List benchmark teams stored for a format.')
    .option('--format <format>', 'Filter by format')
    .option('--label <label>', 'Filter by label')
    .option('--json', 'Print raw JSON output')
    .action((options: { format?: string; label?: string; json?: boolean }) => {
      const records = listManualBenchmarkTeams({
        format: options.format,
        label: options.label,
      });

      if (options.json) {
        console.log(JSON.stringify({ path: getManualBenchmarkTeamsPath(), teams: records }, null, 2));
        return;
      }

      console.log(`Benchmark team file: ${getManualBenchmarkTeamsPath()}`);
      console.log(`Stored teams: ${records.length}`);

      for (const record of records) {
        const names = record.team.members.map((member) => member.species).join(', ');
        const label = record.label ? ` [${record.label}]` : '';
        console.log(`- ${record.format}${label}`);
        console.log(`  ID: ${record.id}`);
        console.log(`  Members: ${names}`);
        if (record.updatedAt) console.log(`  Updated: ${record.updatedAt}`);
      }
    });

  benchmarkTeams
    .command('remove')
    .description('Remove benchmark teams by id or by filter.')
    .option('--id <id>', 'Delete one exact stored team id')
    .option('--format <format>', 'Filter by format')
    .option('--label <label>', 'Filter by label')
    .option('--all', 'Remove every matching record')
    .action((options: { id?: string; format?: string; label?: string; all?: boolean }) => {
      if (!options.id && !options.format && !options.label && !options.all) {
        throw new Error('Provide --id or at least one filter such as --format.');
      }

      const result = deleteManualBenchmarkTeams(options);
      console.log(`Removed ${result.removed} benchmark team(s) from ${result.path}`);
    });

  benchmarkTeams
    .command('path')
    .description('Show the storage file used for benchmark teams.')
    .action(() => {
      console.log(getManualBenchmarkTeamsPath());
    });
}
