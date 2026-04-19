import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { promises as fs } from 'node:fs';

import type { Command } from 'commander';

import { listPokemonForFormat } from '@pokemon/showdown-adapter';

import { createService, formatAnalysisReport, formatBringPlan, formatConstrainedBuild, formatMetaScouting, formatOptimizationReport, formatSuggestions } from '../shared.js';

export function registerInteractiveCommand(program: Command): void {
  program
    .command('interactive')
    .alias('wizard')
    .description('Run the CLI in an interactive guided mode.')
    .action(async () => {
      const rl = createInterface({ input, output });
      const service = createService();

      const printPokemonList = (formatId: string, query?: string): void => {
        const result = listPokemonForFormat({
          format: formatId,
          query: query?.trim() || undefined,
          limit: 5000,
        });

        console.log(`Requested format: ${result.requestedFormat}`);
        console.log(`Resolved format:  ${result.resolvedFormat}`);
        console.log(`Legal species:    ${result.total}`);

        if (result.warning) {
          console.log(`Note:             ${result.warning}`);
        }

        for (const species of result.pokemon) {
          console.log(species.name);
        }
      };

      try {
        const action = (await rl.question('Action (analyze/suggest/optimize/preview/meta/build/list-pokemon): ')).trim().toLowerCase();
        const format = (await rl.question('Format [gen9championsbssregma]: ')).trim() || 'gen9championsbssregma';

        if (action === 'list' || action === 'pokemon' || action === 'list-pokemon') {
          const query = (await rl.question('Optional filter for names/types/tier: ')).trim();
          printPokemonList(format, query);
          return;
        }

        if (action === 'meta') {
          const report = await service.scoutMeta(format);
          console.log(formatMetaScouting(report));
          return;
        }

        if (action === 'build') {
          const showLegal = (await rl.question('Show legal anchor names first? (y/N): ')).trim().toLowerCase();

          if (showLegal === 'y' || showLegal === 'yes') {
            const query = (await rl.question('Optional filter for names/types/tier: ')).trim();
            printPokemonList(format, query);
          }

          const core = (await rl.question('Anchor species (comma-separated, full Mega names allowed): ')).trim();
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

        console.log('Unsupported action. Try analyze, suggest, optimize, preview, meta, build, or list-pokemon.');
      } finally {
        rl.close();
      }
    });
}
