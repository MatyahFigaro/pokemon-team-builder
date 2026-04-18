import type { AnalysisReport, Suggestion, Team, TeamIssue } from '@pokemon/domain';

const weaknessExamples: Record<string, string[]> = {
  Electric: ['Clodsire', 'Great Tusk', 'Gastrodon'],
  Fairy: ['Gholdengo', 'Corviknight', 'Kingambit'],
  Water: ['Rillaboom', 'Ogerpon-Wellspring', 'Rotom-Wash'],
  Fire: ['Heatran', 'Dragonite', 'Rotom-Wash'],
  Ground: ['Landorus-Therian', 'Gliscor', 'Corviknight'],
  Ice: ['Kingambit', 'Heatran', 'Scizor'],
};

function getTargetSlot(team: Team, issue?: TeamIssue): number | undefined {
  const memberName = issue?.memberNames?.[0];
  if (!memberName) return undefined;

  const index = team.members.findIndex((member) => (member.name || member.species) === memberName);
  return index >= 0 ? index + 1 : undefined;
}

export function buildPatchSuggestions(team: Team, report: AnalysisReport): Suggestion[] {
  const suggestions: Suggestion[] = [];

  if (!report.legality.valid) {
    suggestions.push({
      kind: 'set-adjustment',
      title: 'Resolve legality issues first',
      rationale: 'Illegal sets distort the rest of the analysis and should be fixed before optimization.',
      priority: 'high',
      changes: report.legality.errors.slice(0, 3),
    });
  }

  const hazardIssue = report.issues.find((issue) => issue.code === 'missing-hazard-removal');
  if (hazardIssue) {
    suggestions.push({
      kind: 'patch',
      title: 'Add reliable hazard removal',
      rationale: 'The current team can be overwhelmed by Stealth Rock and Spikes over longer games.',
      priority: 'high',
      targetSlot: getTargetSlot(team, hazardIssue),
      changes: [
        'Turn one low-impact slot into a Defog or Rapid Spin user.',
        'Prefer a remover that also patches one of your repeated weaknesses.',
      ],
      exampleOptions: ['Great Tusk', 'Corviknight', 'Iron Treads'],
    });
  }

  const pressureIssue = report.issues.find((issue) => issue.code.startsWith('type-pressure-'));
  if (pressureIssue) {
    const threatenedType = pressureIssue.relatedTypes?.[0] ?? 'Electric';
    suggestions.push({
      kind: 'replace',
      title: `Patch the ${threatenedType} matchup`,
      rationale: 'Too many slots fold to the same attacking type, which makes the team easy to target in preview and play.',
      priority: 'high',
      targetSlot: getTargetSlot(team, pressureIssue),
      changes: [
        `Replace one exposed slot with a sturdier ${threatenedType === 'Electric' ? 'Ground' : 'Steel or bulky neutral'} answer.`,
        'Favor secondary utility such as pivoting, hazards, or recovery.',
      ],
      exampleOptions: weaknessExamples[threatenedType] ?? ['Great Tusk', 'Gholdengo', 'Dragonite'],
    });
  }

  if (report.speed.fastCount === 0 || !report.speed.hasSpeedControl) {
    suggestions.push({
      kind: 'patch',
      title: 'Improve speed control',
      rationale: 'The team risks losing momentum against offensive builds and late-game sweepers.',
      priority: 'medium',
      changes: [
        'Add a Choice Scarf user or a naturally fast revenge killer.',
        'If the team is bulky, consider Thunder Wave or Tailwind support instead.',
      ],
      exampleOptions: ['Dragapult', 'Iron Valiant', 'Meowscarada'],
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      kind: 'patch',
      title: 'Refine the weakest slot',
      rationale: 'The structure is stable enough for focused set tuning instead of major surgery.',
      priority: 'low',
      changes: [
        'Upgrade one slot to add either momentum or extra defensive utility.',
        'Prefer an adjustment that keeps your current game plan intact.',
      ],
      exampleOptions: ['Choice Scarf tweak', 'Knock Off support', 'Reliable recovery'],
    });
  }

  return suggestions.slice(0, 3);
}
