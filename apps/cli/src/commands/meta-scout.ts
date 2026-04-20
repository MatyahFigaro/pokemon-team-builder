import type { Command } from 'commander';

import { createCliProgress, createService, formatMetaScouting } from '../shared.js';

export function registerMetaScoutCommand(program: Command): void {
  program
    .command('meta-scout')
    .description('Show live usage-based threats, cores, and anti-meta ideas for a format.')
    .option('--format <format>', 'Showdown format id', 'gen9ou')
    .option('--json', 'Print raw JSON instead of a formatted report')
    .action(async (options: { format: string; json?: boolean }) => {
      const progress = createCliProgress('Scouting live meta', !options.json);

      try {
        progress.step('Loading live ladder data', { current: 1, total: 3, detail: options.format });
        const service = createService();
        const report = await service.scoutMeta(options.format);

        progress.step('Compiling threats and cores', { current: 2, total: 3, detail: report.source });
        progress.step('Rendering meta report', { current: 3, total: 3 });
        console.log(options.json ? JSON.stringify(report, null, 2) : formatMetaScouting(report));
        progress.succeed('Meta scouting complete');
      } catch (error) {
        progress.fail('Meta scouting failed');
        throw error;
      }
    });
}
