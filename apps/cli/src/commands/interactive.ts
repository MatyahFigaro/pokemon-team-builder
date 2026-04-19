import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { promises as fs } from 'node:fs';

import type { Command } from 'commander';

import { createService, formatAnalysisReport, formatBringPlan, formatConstrainedBuild, formatMetaScouting, formatOptimizationReport, formatSuggestions } from '../shared.js';

export function registerInteractiveCommand(program: Command): void {
  program
    .command('interactive')
    .alias('wizard')
    .description('Run the CLI in an interactive guided mode.')
    .action(async () => {
      const rl = createInterface({ input, output });
      const service = createService();

      try {
        const action = (await rl.question('Action (analyze/suggest/optimize/preview/meta/build): ')).trim().toLowerCase();
        const format = (await rl.question('Format [gen9championsbssregma]: ')).trim() || 'gen9championsbssregma';

        if (action === 'meta') {
          const report = await service.scoutMeta(format);
          console.log(formatMetaScouting(report));
          return;
        }

        if (action === 'build') {
          const core = (await rl.question('Anchor species (comma-separated): ')).trim();
          const style = (await rl.question('Style (balance/hyper-offense/bulky-offense/trick-room/rain): ')).trim() as 'balance' | 'hyper-offense' | 'bulky-offense' | 'trick-room' | 'rain';
          const report = await service.buildWithConstraints({
            format,
            coreSpecies: core.split(',').map((entry) => entry.trim()).filter(Boolean),
            style,
          });
          console.log(formatConstrainedBuild(report));
          return;
        }

        const file = (await rl.question('Team file path: ')).trim();
        const teamText = await fs.readFile(file, 'utf8');
        const team = service.importShowdown(teamText, format);

        if (action === 'analyze') {
          console.log(formatAnalysisReport(await service.analyze(team), true));
          return;
        }

        if (action === 'suggest') {
          const report = await service.analyze(team);
          console.log(formatSuggestions(report.suggestions, true));
          return;
        }

        if (action === 'optimize') {
          const report = await service.optimizeSets(team);
          console.log(formatOptimizationReport(report));
          return;
        }

        if (action === 'preview') {
          const opponentFile = (await rl.question('Opponent preview file path (optional): ')).trim();
          const opponent = opponentFile
            ? service.importShowdown(await fs.readFile(opponentFile, 'utf8'), format)
            : null;
          const plan = await service.planBringFromPreview(team, opponent);
          console.log(formatBringPlan(plan));
          return;
        }

        console.log('Unsupported action. Try analyze, suggest, optimize, preview, meta, or build.');
      } finally {
        rl.close();
      }
    });
}
