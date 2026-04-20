import type { Command } from 'commander';

import { createCliProgress, createService, describeSimTeamSelection, formatSuggestions, parseSimulationTeamCount, readTeamText, selectSuggestionsByMode } from '../shared.js';

export function registerSuggestCommand(program: Command): void {
  program
    .command('suggest')
    .alias('recommend')
    .description('Get actionable team suggestions from the CLI.')
    .option('-f, --file <path>', 'Path to a team text file')
    .option('--format <format>', 'Showdown format id', 'gen9ou')
    .option('--mode <mode>', 'Suggestion mode: auto, patch, or complete', 'auto')
    .option('--json', 'Print raw JSON instead of formatted output')
    .option('--explain', 'Show fuller reasoning for each suggestion')
    .option('--sim-teams <count|all>', 'How many benchmark teams to use for simulation; defaults to 1', '1')
    .action(async (options: { file?: string; format: string; mode?: string; json?: boolean; explain?: boolean; simTeams?: string }) => {
      const progress = createCliProgress('Generating suggestions', !options.json);

      try {
        progress.step('Loading team input', { current: 1, total: 4, detail: options.file ? 'from file' : 'from stdin' });
        const service = createService();
        const teamText = await readTeamText(options.file);

        progress.step('Parsing Showdown import', { current: 2, total: 4, detail: options.format });
        const team = service.importShowdown(teamText, options.format);
        const simTeams = parseSimulationTeamCount(options.simTeams);

        progress.step('Analyzing team and matchups', { current: 3, total: 4, detail: describeSimTeamSelection(simTeams) });
        const report = await service.analyze(team, {
          simTeams,
        });
        const mode = options.mode === 'patch' || options.mode === 'complete' ? options.mode : 'auto';
        const suggestions = selectSuggestionsByMode(report.suggestions, mode);

        progress.step('Rendering suggestions', { current: 4, total: 4, detail: mode });
        console.log(options.json ? JSON.stringify(suggestions, null, 2) : formatSuggestions(suggestions, options.explain));
        progress.succeed('Suggestions ready');
      } catch (error) {
        progress.fail('Suggestion generation failed');
        throw error;
      }
    });
}
