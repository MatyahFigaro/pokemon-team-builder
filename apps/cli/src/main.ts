#!/usr/bin/env node

import { Command } from 'commander';

import { registerAnalyzeCommand } from './commands/analyze.js';
import { registerNormalizeCommand } from './commands/normalize.js';
import { registerSimMatchupCommand } from './commands/sim-matchup.js';
import { registerSuggestCompleteCommand } from './commands/suggest-complete.js';
import { registerSuggestPatchCommand } from './commands/suggest-patch.js';

const program = new Command();

program
  .name('pokemon-team-builder')
  .description('CLI-first Pokémon team analysis and patching tool')
  .version('0.1.0');

registerAnalyzeCommand(program);
registerSuggestPatchCommand(program);
registerSuggestCompleteCommand(program);
registerSimMatchupCommand(program);
registerNormalizeCommand(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unknown CLI error');
  process.exitCode = 1;
});
