import type { Command } from 'commander';

import { createCliProgress, createService, describeSimTeamSelection, formatSuggestions, parseSimulationTeamCount, readTeamText, selectSuggestionsByMode } from '../shared.js';

export function registerSuggestCompleteCommand(program: Command): void {
  program
    .command('suggest-complete')
    .description('Complete a partial team core with role-based suggestions.')
    .option('-f, --file <path>', 'Path to a team text file')
    .option('--format <format>', 'Showdown format id', 'gen9ou')
    .option('--json', 'Print raw JSON instead of formatted output')
    .option('--explain', 'Show fuller reasoning for each suggestion')
    .option('--sim-teams <count|all>', 'How many benchmark teams to use for simulation; defaults to 1', '1')
    .action(async (options: { file?: string; format: string; json?: boolean; explain?: boolean; simTeams?: string }) => {
      const progress = createCliProgress('Completing team core', !options.json);

      try {
        progress.step('Loading team input', { current: 1, total: 4, detail: options.file ? 'from file' : 'from stdin' });
        const service = createService();
        const teamText = await readTeamText(options.file);

        progress.step('Parsing Showdown import', { current: 2, total: 4, detail: options.format });
        const team = service.importShowdown(teamText, options.format);
        const simTeams = parseSimulationTeamCount(options.simTeams);

        progress.step('Finding best completion paths', { current: 3, total: 4, detail: describeSimTeamSelection(simTeams) });
        const report = await service.analyze(team, {
          simTeams,
        });
        const suggestions = selectSuggestionsByMode(report.suggestions, 'complete');

        progress.step('Rendering completion output', { current: 4, total: 4 });
        console.log(options.json ? JSON.stringify(suggestions, null, 2) : formatSuggestions(suggestions, options.explain));
        progress.succeed('Completion suggestions ready');
      } catch (error) {
        progress.fail('Completion suggestion generation failed');
        throw error;
      }
    });
}
