import type { AnalysisReport, Suggestion, Team } from '@pokemon/domain';

export function buildCompletionSuggestions(team: Team, report: AnalysisReport): Suggestion[] {
  const missingSlots = Math.max(0, 6 - team.members.length);
  if (missingSlots === 0) return [];

  const nextNeed = report.synergy.missingRoles[0] ?? 'speed control';

  return [
    {
      kind: 'complete',
      title: `Complete the team with ${nextNeed}`,
      rationale: `The structure is still missing ${missingSlots} slot(s), so the highest-value addition is a role filler rather than a niche pick.`,
      priority: 'high',
      changes: [
        `Add a member that provides ${nextNeed}.`,
        'Choose something that also softens your biggest repeated weakness.',
      ],
      exampleOptions: ['Great Tusk', 'Corviknight', 'Dragapult'],
    },
  ];
}
