import { promises as fs } from 'node:fs';

import type { Command } from 'commander';

import { createService, formatBringPlan, readTeamText } from '../shared.js';

export function registerSimMatchupCommand(program: Command): void {
  program
    .command('sim-matchup')
    .description('Estimate matchup pace, speed pressure, and likely winning lines from preview.')
    .requiredOption('-o, --opponent <path>', 'Path to the opponent preview team text file')
    .option('-f, --file <path>', 'Path to your team text file')
    .option('--format <format>', 'Showdown format id', 'gen9ou')
    .option('--json', 'Print raw JSON instead of a formatted report')
    .action(async (options: { opponent: string; file?: string; format: string; json?: boolean }) => {
      const service = createService();
      const teamText = await readTeamText(options.file);
      const opponentText = await fs.readFile(options.opponent, 'utf8');
      const team = service.importShowdown(teamText, options.format);
      const opponent = service.importShowdown(opponentText, options.format);
      const plan = await service.planBringFromPreview(team, opponent);

      console.log(options.json ? JSON.stringify(plan, null, 2) : formatBringPlan(plan));
    });
}
