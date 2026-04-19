import type { Command } from 'commander';

import { createService, formatMetaScouting } from '../shared.js';

export function registerMetaScoutCommand(program: Command): void {
  program
    .command('meta-scout')
    .description('Show live usage-based threats, cores, and anti-meta ideas for a format.')
    .option('--format <format>', 'Showdown format id', 'gen9ou')
    .option('--json', 'Print raw JSON instead of a formatted report')
    .action(async (options: { format: string; json?: boolean }) => {
      const service = createService();
      const report = await service.scoutMeta(options.format);
      console.log(options.json ? JSON.stringify(report, null, 2) : formatMetaScouting(report));
    });
}
