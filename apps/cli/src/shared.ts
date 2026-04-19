import { promises as fs } from 'node:fs';

import type { AnalysisReport, Suggestion } from '@pokemon/domain';
import { TeamBuildService } from '@pokemon/builder';
import { createShowdownPorts } from '@pokemon/showdown-adapter';

export function createService(): TeamBuildService {
  return new TeamBuildService(createShowdownPorts());
}

export async function readTeamText(file?: string): Promise<string> {
  if (file) {
    return fs.readFile(file, 'utf8');
  }

  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  throw new Error('Provide a team with --file or pipe Showdown text through stdin.');
}

export function selectSuggestionsByMode(
  suggestions: Suggestion[],
  mode: 'auto' | 'patch' | 'complete',
): Suggestion[] {
  if (mode === 'patch') {
    const patchOnly = suggestions.filter((suggestion) => suggestion.kind !== 'complete');
    return (patchOnly.length ? patchOnly : suggestions).slice(0, 3);
  }

  if (mode === 'complete') {
    const completeOnly = suggestions.filter((suggestion) => suggestion.kind === 'complete');
    return (completeOnly.length ? completeOnly : suggestions).slice(0, 3);
  }

  const completeFirst = [
    ...suggestions.filter((suggestion) => suggestion.kind === 'complete'),
    ...suggestions.filter((suggestion) => suggestion.kind !== 'complete'),
  ];

  return (completeFirst.length ? completeFirst : suggestions).slice(0, 3);
}

export function formatSuggestions(suggestions: Suggestion[]): string {
  if (suggestions.length === 0) {
    return 'No suggestions generated.';
  }

  return suggestions
    .map((suggestion, index) => {
      const lines = [
        `${index + 1}. ${suggestion.title} [${suggestion.priority}]`,
        `   Why: ${suggestion.rationale}`,
      ];

      for (const change of suggestion.changes) {
        lines.push(`   - ${change}`);
      }

      if (suggestion.exampleOptions?.length) {
        lines.push(`   Examples: ${suggestion.exampleOptions.join(', ')}`);
      }

      return lines.join('\n');
    })
    .join('\n\n');
}

export function formatAnalysisReport(report: AnalysisReport): string {
  const topWeaknesses = report.weaknesses
    .filter((entry) => entry.weakCount >= 2)
    .slice(0, 3)
    .map((entry) => `${entry.type} (${entry.weakCount} weak)`)
    .join(', ') || 'None';

  const legalityNotes = report.legality.warnings.length
    ? [
        '',
        'Legality notes',
        ...report.legality.warnings.map((warning) => `- ${warning}`),
      ]
    : [];

  const issueLines = report.issues.length
    ? report.issues.map((issue) => `- [${issue.severity}] ${issue.summary}`).join('\n')
    : '- No major structural issues found.';

  const topThreats = report.threats.topPressureThreats
    .slice(0, 3)
    .map((threat) => `${threat.species} (${threat.pressure})`)
    .join(', ') || 'None';

  const activeMechanics = [
    report.profile.mechanics.tera ? 'Tera' : null,
    report.profile.mechanics.mega ? 'Mega' : null,
    report.profile.mechanics.dynamax ? 'Dynamax' : null,
    report.profile.mechanics.zMoves ? 'Z-Moves' : null,
  ].filter(Boolean).join(', ') || 'None';

  const bestArchetypes = report.archetypes.bestMatchups.join(', ') || 'None';
  const weakArchetypes = report.archetypes.weakMatchups.join(', ') || 'None';

  return [
    `Format: ${report.format}`,
    `Legality: ${report.legality.valid ? 'valid' : 'invalid'}`,
    ...legalityNotes,
    `Profile: ${report.profile.style} bring ${report.profile.bringCount} pick ${report.profile.pickCount} at level ${report.profile.levelCap}`,
    `Mechanics: ${activeMechanics}`,
    `Score: ${report.score.total}/100`,
    `Speed: avg ${report.speed.averageBaseSpeed}, fastest ${report.speed.fastestBaseSpeed} (${report.battlePlan.speedControlRating})`,
    `Hazards: setter=${report.synergy.hasHazardSetter} removal=${report.synergy.hasHazardRemoval}`,
    `Likely leads: ${report.battlePlan.leadCandidates.join(', ') || 'None'}`,
    `Likely picks: ${report.battlePlan.likelyPicks.join(', ') || 'None'}`,
    `Tera dependency: ${report.battlePlan.teraDependency === 'not-applicable' ? 'n/a' : report.battlePlan.teraDependency}`,
    `Threat coverage: ${report.threats.coverageScore}/100 from ${report.threats.consideredThreatCount} evaluated threats`,
    `Best archetypes: ${bestArchetypes}`,
    `Weak archetypes: ${weakArchetypes}`,
    `Top pressure threats: ${topThreats}`,
    `Top weakness pressure: ${topWeaknesses}`,
    '',
    'Issues',
    issueLines,
    '',
    'Suggestions',
    formatSuggestions(report.suggestions),
  ].join('\n');
}
