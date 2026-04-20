import type { Command } from 'commander';

import { createCliProgress, createService, describeSimTeamSelection, formatConstrainedBuild, parseSimulationTeamCount, readTeamText } from '../shared.js';

function splitList(value?: string): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function registerBuildCommand(program: Command): void {
  program
    .command('build')
    .description('Build around a favorite mon or core with style and pool constraints.')
    .option('-f, --file <path>', 'Optional partial team text file to use as the core')
    .option('--format <format>', 'Showdown format id', 'gen9ou')
    .option('--core <species>', 'Comma-separated anchor species using exact legal names from list-pokemon, including full Mega names, for example Dragonite,Charizard-Mega-X')
    .option('--style <style>', 'Preferred style: balance, hyper-offense, bulky-offense, stall, trick-room, rain, sun, sand')
    .option('--avoid <species>', 'Comma-separated species to avoid')
    .option('--allow-restricted', 'Allow restricted high-BST options')
    .option('--json', 'Print raw JSON instead of a formatted report')
    .option('--sim-teams <count|all>', 'How many benchmark teams to use for simulation; defaults to 1', '1')
    .action(async (options: {
      file?: string;
      format: string;
      core?: string;
      style?: 'balance' | 'hyper-offense' | 'bulky-offense' | 'stall' | 'trick-room' | 'rain' | 'sun' | 'sand';
      avoid?: string;
      allowRestricted?: boolean;
      json?: boolean;
      simTeams?: string;
    }) => {
      const progress = createCliProgress('Building around your core', !options.json);

      try {
        progress.step('Preparing requested core', { current: 1, total: 4, detail: options.style ?? 'flex' });
        const service = createService();
        const anchors = splitList(options.core);

        if (options.file) {
          progress.step('Loading partial team input', { current: 2, total: 4, detail: options.format });
          const teamText = await readTeamText(options.file);
          const team = service.importShowdown(teamText, options.format);
          for (const member of team.members) {
            if (!anchors.includes(member.species)) anchors.push(member.species);
          }
        }

        const simTeams = parseSimulationTeamCount(options.simTeams);
        progress.step('Scoring candidates and running sims', { current: 3, total: 4, detail: describeSimTeamSelection(simTeams) });
        const report = await service.buildWithConstraints({
          format: options.format,
          coreSpecies: anchors,
          style: options.style,
          avoidSpecies: splitList(options.avoid),
          allowRestricted: options.allowRestricted,
          simTeams,
        });

        progress.step('Rendering build report', { current: 4, total: 4 });
        console.log(options.json ? JSON.stringify(report, null, 2) : formatConstrainedBuild(report));
        progress.succeed('Build complete');
      } catch (error) {
        progress.fail('Build failed');
        throw error;
      }
    });
}
