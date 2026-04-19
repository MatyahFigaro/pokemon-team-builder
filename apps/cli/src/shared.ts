import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { promisify } from 'node:util';

import type { AnalysisReport, Suggestion, Team } from '@pokemon/domain';
import type { ConstrainedBuildReport, MetaScoutingReport, PreviewMatchupPlan, TeamSetOptimizationReport } from '@pokemon/builder';
import { TeamBuildService } from '@pokemon/builder';
import { createShowdownPorts } from '@pokemon/showdown-adapter';

const execFileAsync = promisify(execFile);

interface CoachingContext {
  action: 'build' | 'analyze' | 'simulate';
  format?: string;
  style?: string;
  anchors?: string[];
  missingRoles?: string[];
  issues?: string[];
  notes?: string[];
  recommendations?: Array<{
    species?: string;
    title?: string;
    rationale?: string;
    reasons?: string[];
  }>;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildCoachingNotes(context: CoachingContext): string[] {
  const notes: string[] = [];
  const leadRecommendation = context.recommendations?.[0];

  if (context.action === 'build') {
    if (leadRecommendation?.species) {
      notes.push(`${leadRecommendation.species} is the cleanest next add because it patches the shell without warping your bring-3 plan.`);
    }

    if ((context.missingRoles?.length ?? 0) > 0) {
      notes.push(`Keep the next slots focused on ${context.missingRoles?.slice(0, 2).join(' and ')} instead of duplicating overlap.`);
    }
  }

  if (context.action === 'analyze' && (context.issues?.length ?? 0) > 0) {
    notes.push(`The biggest structural pressure point right now is ${context.issues?.[0]?.toLowerCase() ?? 'the current matchup spread'}.`);
  }

  if (context.action === 'simulate') {
    notes.push('Use the sim notes to choose a low-risk lead and preserve your speed control for the midgame.');
  }

  if ((context.notes ?? []).some((note) => note.toLowerCase().includes('mega'))) {
    notes.push('Treat Mega slots as matchup tools, not automatic brings every game.');
  }

  if ((context.notes ?? []).some((note) => note.toLowerCase().includes('hazard'))) {
    notes.push('Avoid spending multiple team slots on passive hazard overlap unless the shell is built to exploit it.');
  }

  if ((context.notes ?? []).some((note) => note.toLowerCase().includes('simulation'))) {
    notes.push('Lean on the sim-backed options first when two candidates look close on paper.');
  }

  return uniqueStrings(notes).slice(0, 3);
}

const CLIPBOARD_COMMANDS: Array<{ command: string; args: string[] }> = [
  { command: 'wl-paste', args: ['--no-newline'] },
  { command: 'xclip', args: ['-selection', 'clipboard', '-o'] },
  { command: 'xsel', args: ['--clipboard', '--output'] },
  { command: 'pbpaste', args: [] },
  { command: 'powershell', args: ['-NoProfile', '-Command', 'Get-Clipboard'] },
  { command: 'powershell.exe', args: ['-NoProfile', '-Command', 'Get-Clipboard'] },
];

export function createService(): TeamBuildService {
  return new TeamBuildService(createShowdownPorts());
}

export async function readClipboardText(): Promise<string> {
  for (const entry of CLIPBOARD_COMMANDS) {
    try {
      const result = await execFileAsync(entry.command, entry.args, { maxBuffer: 1024 * 1024 });
      const text = result.stdout?.toString() ?? '';
      if (text.trim()) return text;
    } catch {
      // Try the next known clipboard command for this platform.
    }
  }

  throw new Error('Could not read clipboard contents. On Linux, install wl-clipboard, xclip, or xsel, or pipe the Showdown text through stdin.');
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

export function formatSuggestions(suggestions: Suggestion[], explain = true): string {
  if (suggestions.length === 0) {
    return 'No suggestions generated.';
  }

  return suggestions
    .map((suggestion, index) => {
      const lines = [
        `${index + 1}. ${suggestion.title} [${suggestion.priority}]`,
      ];

      if (explain) {
        lines.push(`   Why: ${suggestion.rationale}`);
      }

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

export function formatAnalysisReport(report: AnalysisReport, explain = false): string {
  const coachNotes = buildCoachingNotes({
    action: 'analyze',
    format: report.format,
    issues: report.issues.map((issue) => issue.summary),
    notes: report.battlePlan.notes,
    recommendations: report.suggestions.map((suggestion) => ({
      title: suggestion.title,
      rationale: suggestion.rationale,
    })),
  });

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
    ? report.issues.map((issue) => explain ? `- [${issue.severity}] ${issue.summary} — ${issue.details}` : `- [${issue.severity}] ${issue.summary}`).join('\n')
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
  const simulationLine = report.simulation.enabled && typeof report.simulation.winRate === 'number'
    ? `${Math.round(report.simulation.winRate * 100)}% over ${report.simulation.iterations} games vs ${report.simulation.opponentPreview.join(', ') || report.simulation.opponentModel}`
    : 'unavailable';

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
    `Simulation: ${simulationLine}`,
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
    formatSuggestions(report.suggestions, true),
    ...(coachNotes.length ? ['', 'Coach notes', ...coachNotes.map((note: string) => `- ${note}`)] : []),
    ...(explain && report.battlePlan.notes.length
      ? ['', 'Explain', ...report.battlePlan.notes.map((note) => `- ${note}`)]
      : []),
  ].join('\n');
}

export function formatBringPlan(plan: PreviewMatchupPlan): string {
  const coachNotes = buildCoachingNotes({
    action: 'simulate',
    notes: [...plan.reasons, ...plan.speedNotes, ...plan.winConditions],
  });

  return [
    `Recommended lead: ${plan.recommendedLead}`,
    `Best three to bring: ${plan.recommendedBring.join(', ') || 'None'}`,
    `Bench order: ${plan.benchOrder.join(', ') || 'None'}`,
    `Likely opponent leads: ${plan.opponentLikelyLeads.join(', ') || 'Unknown'}`,
    `Likely opponent backlines: ${plan.opponentBacklinePatterns.join(' | ') || 'Unknown'}`,
    `Match pace: ${plan.pace}`,
    '',
    'Speed notes',
    ...(plan.speedNotes.length ? plan.speedNotes.map((note) => `- ${note}`) : ['- None']),
    '',
    'Damage notes',
    ...(plan.damageNotes.length ? plan.damageNotes.map((note) => `- ${note}`) : ['- None']),
    '',
    'Win conditions',
    ...(plan.winConditions.length ? plan.winConditions.map((note) => `- ${note}`) : ['- None']),
    '',
    'Why this line',
    ...(plan.reasons.length ? plan.reasons.map((note) => `- ${note}`) : ['- None']),
    ...(coachNotes.length ? ['', 'Coach notes', ...coachNotes.map((note: string) => `- ${note}`)] : []),
  ].join('\n');
}

export function formatOptimizationReport(report: TeamSetOptimizationReport): string {
  if (report.entries.length === 0) {
    return 'No obvious set optimizations were found.';
  }

  return report.entries.map((entry, index) => [
    `${index + 1}. ${entry.member}`,
    `   Summary: ${entry.summary}`,
    ...entry.changes.map((change) => `   - ${change}`),
    `   Preview: ${entry.preview}`,
  ].join('\n')).join('\n\n');
}

export function formatMetaScouting(report: MetaScoutingReport): string {
  return [
    `Format: ${report.format}`,
    `Usage source: ${report.source}`,
    `Resolved ladder: ${report.resolvedFormat ?? 'unknown'}${report.exactMatch ? ' (exact)' : ' (proxy)'}`,
    `Updated: ${report.updatedAt}`,
    '',
    'Notes',
    ...(report.notes.length ? report.notes.map((note) => `- ${note}`) : ['- None']),
    '',
    'Top threats',
    ...(report.topThreats.length
      ? report.topThreats.map((entry) => `- ${entry.species} (${entry.rank ? `#${entry.rank}` : `${entry.usage}%`}): ${entry.commonMoves.join(', ') || 'no move sample'}${entry.commonTera ? ` | Tera ${entry.commonTera}` : ''}`)
      : ['- None']),
    '',
    'Common cores',
    ...(report.commonCores.length ? report.commonCores.map((core) => `- ${core}`) : ['- None']),
    '',
    'Anti-meta ideas',
    ...(report.antiMetaIdeas.length ? report.antiMetaIdeas.map((idea) => `- ${idea}`) : ['- None']),
  ].join('\n');
}

export function formatConstrainedBuild(report: ConstrainedBuildReport): string {
  const coachNotes = buildCoachingNotes({
    action: 'build',
    format: report.format,
    style: report.style,
    anchors: report.anchors,
    missingRoles: report.missingRoles,
    notes: report.notes,
    recommendations: report.recommendations.map((entry) => ({
      species: entry.species,
      reasons: entry.reasons,
    })),
  });

  return [
    `Format: ${report.format}`,
    `Style: ${report.style}`,
    `Anchors: ${report.anchors.join(', ') || 'None supplied'}`,
    `Missing roles: ${report.missingRoles.join(', ') || 'None'}`,
    '',
    'Recommended additions',
    ...(report.recommendations.length
      ? report.recommendations.map((entry, index) => `${index + 1}. ${entry.species} (${entry.score})\n   Why: ${entry.reasons.join('; ')}${entry.preview ? `\n   Preview: ${entry.preview}` : ''}`)
      : ['- None']),
    '',
    'Notes',
    ...(report.notes.length ? report.notes.map((note) => `- ${note}`) : ['- None']),
    ...(coachNotes.length ? ['', 'Coach notes', ...coachNotes.map((note: string) => `- ${note}`)] : []),
  ].join('\n');
}

export function serializeTeam(team: Team): string {
  return JSON.stringify(team, null, 2);
}
