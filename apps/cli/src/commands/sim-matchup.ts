import type { Command } from 'commander';

export function registerSimMatchupCommand(program: Command): void {
  program
    .command('sim-matchup')
    .description('Reserved for later simulation-backed matchup analysis.')
    .action(() => {
      console.log('Simulation is not part of the MVP yet. The adapter hook is ready for the next phase.');
    });
}
