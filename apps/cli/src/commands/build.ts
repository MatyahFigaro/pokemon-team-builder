import type { Command } from 'commander';

import { createService, formatConstrainedBuild, readTeamText } from '../shared.js';

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
    .action(async (options: {
      file?: string;
      format: string;
      core?: string;
      style?: 'balance' | 'hyper-offense' | 'bulky-offense' | 'stall' | 'trick-room' | 'rain' | 'sun' | 'sand';
      avoid?: string;
      allowRestricted?: boolean;
      json?: boolean;
    }) => {
      const service = createService();
      const anchors = splitList(options.core);

      if (options.file) {
        const teamText = await readTeamText(options.file);
        const team = service.importShowdown(teamText, options.format);
        for (const member of team.members) {
          if (!anchors.includes(member.species)) anchors.push(member.species);
        }
      }

      const report = await service.buildWithConstraints({
        format: options.format,
        coreSpecies: anchors,
        style: options.style,
        avoidSpecies: splitList(options.avoid),
        allowRestricted: options.allowRestricted,
      });

      console.log(options.json ? JSON.stringify(report, null, 2) : formatConstrainedBuild(report));
    });
}
