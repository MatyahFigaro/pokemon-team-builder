import { promises as fs } from 'node:fs';

import type { Command } from 'commander';

import { createCliProgress, createService, formatBringPlan, readTeamText } from '../shared.js';

export function registerPreviewPlanCommand(program: Command): void {
  program
    .command('preview-plan')
    .description('Recommend the best BSS lead and bring-3 line from team preview.')
    .option('-f, --file <path>', 'Path to your team text file')
    .option('-o, --opponent <path>', 'Path to the opponent preview team text file')
    .option('--format <format>', 'Showdown format id', 'gen9ou')
    .option('--json', 'Print raw JSON instead of a formatted report')
    .action(async (options: { file?: string; opponent?: string; format: string; json?: boolean }) => {
      const progress = createCliProgress('Planning preview bring', !options.json);

      try {
        progress.step('Loading your team', { current: 1, total: 4, detail: options.file ? 'from file' : 'from stdin' });
        const service = createService();
        const teamText = await readTeamText(options.file);
        const team = service.importShowdown(teamText, options.format);

        let opponent = null;
        if (options.opponent) {
          progress.step('Loading opponent preview', { current: 2, total: 4, detail: options.format });
          const opponentText = await fs.readFile(options.opponent, 'utf8');
          opponent = service.importShowdown(opponentText, options.format);
        }

        progress.step('Scoring lead and backline plans', { current: 3, total: 4 });
        const plan = await service.planBringFromPreview(team, opponent);

        progress.step('Rendering preview plan', { current: 4, total: 4 });
        console.log(options.json ? JSON.stringify(plan, null, 2) : formatBringPlan(plan));
        progress.succeed('Preview plan ready');
      } catch (error) {
        progress.fail('Preview planning failed');
        throw error;
      }
    });
}
