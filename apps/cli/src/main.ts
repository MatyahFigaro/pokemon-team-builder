#!/usr/bin/env node

import { Command } from 'commander';

import { registerAnalyzeCommand } from './commands/analyze.js';
import { registerBuildCommand } from './commands/build.js';
import { registerInteractiveCommand } from './commands/interactive.js';
import { registerListFormatsCommand } from './commands/list-formats.js';
import { registerListPokemonCommand } from './commands/list-pokemon.js';
import { registerMetaScoutCommand } from './commands/meta-scout.js';
import { registerNormalizeCommand } from './commands/normalize.js';
import { registerOptimizeCommand } from './commands/optimize.js';
import { registerPreviewPlanCommand } from './commands/preview-plan.js';
import { registerSimMatchupCommand } from './commands/sim-matchup.js';
import { registerSuggestCommand } from './commands/suggest.js';
import { registerSuggestCompleteCommand } from './commands/suggest-complete.js';
import { registerSuggestPatchCommand } from './commands/suggest-patch.js';

const program = new Command();

program
  .name('pokemon-team-builder')
  .description('CLI-first Pokémon team analysis and patching tool')
  .version('0.1.0');

registerAnalyzeCommand(program);
registerBuildCommand(program);
registerInteractiveCommand(program);
registerListFormatsCommand(program);
registerListPokemonCommand(program);
registerMetaScoutCommand(program);
registerOptimizeCommand(program);
registerPreviewPlanCommand(program);
registerSuggestCommand(program);
registerSuggestPatchCommand(program);
registerSuggestCompleteCommand(program);
registerSimMatchupCommand(program);
registerNormalizeCommand(program);

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unknown CLI error');
  process.exitCode = 1;
});
