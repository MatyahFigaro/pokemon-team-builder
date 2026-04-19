import { promises as fs } from 'node:fs';

import type { Command } from 'commander';

import { createService, formatBringPlan, readTeamText } from '../shared.js';

export function registerPreviewPlanCommand(program: Command): void {
  program
    .command('preview-plan')
    .description('Recommend the best BSS lead and bring-3 line from team preview.')
    .option('-f, --file <path>', 'Path to your team text file')
    .option('-o, --opponent <path>', 'Path to the opponent preview team text file')
    .option('--format <format>', 'Showdown format id', 'gen9ou')
    .option('--json', 'Print raw JSON instead of a formatted report')
    .action(async (options: { file?: string; opponent?: string; format: string; json?: boolean }) => {
      const service = createService();
      const teamText = await readTeamText(options.file);
      const team = service.importShowdown(teamText, options.format);

      let opponent = null;
      if (options.opponent) {
        const opponentText = await fs.readFile(options.opponent, 'utf8');
        opponent = service.importShowdown(opponentText, options.format);
      }

      const plan = await service.planBringFromPreview(team, opponent);
      console.log(options.json ? JSON.stringify(plan, null, 2) : formatBringPlan(plan));
    });
}
