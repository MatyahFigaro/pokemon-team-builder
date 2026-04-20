import { promises as fs } from 'node:fs';

import type { Command } from 'commander';

import { createCliProgress, createService, formatBringPlan, readTeamText } from '../shared.js';

export function registerSimMatchupCommand(program: Command): void {
  program
    .command('sim-matchup')
    .description('Estimate matchup pace, speed pressure, and likely winning lines from preview.')
    .requiredOption('-o, --opponent <path>', 'Path to the opponent preview team text file')
    .option('-f, --file <path>', 'Path to your team text file')
    .option('--format <format>', 'Showdown format id', 'gen9ou')
    .option('--json', 'Print raw JSON instead of a formatted report')
    .action(async (options: { opponent: string; file?: string; format: string; json?: boolean }) => {
      const progress = createCliProgress('Simulating preview matchup', !options.json);

      try {
        progress.step('Loading both preview teams', { current: 1, total: 4, detail: options.format });
        const service = createService();
        const teamText = await readTeamText(options.file);
        const opponentText = await fs.readFile(options.opponent, 'utf8');

        progress.step('Parsing Showdown imports', { current: 2, total: 4 });
        const team = service.importShowdown(teamText, options.format);
        const opponent = service.importShowdown(opponentText, options.format);

        progress.step('Running matchup planning', { current: 3, total: 4 });
        const plan = await service.planBringFromPreview(team, opponent);

        progress.step('Rendering matchup output', { current: 4, total: 4 });
        console.log(options.json ? JSON.stringify(plan, null, 2) : formatBringPlan(plan));
        progress.succeed('Matchup plan ready');
      } catch (error) {
        progress.fail('Matchup simulation failed');
        throw error;
      }
    });
}
