import type { AnalysisReport, Suggestion, Team, TeamIssue } from '@pokemon/domain';

const weaknessExamples: Record<string, string[]> = {
  Electric: ['Clodsire', 'Great Tusk', 'Gastrodon'],
  Fairy: ['Gholdengo', 'Corviknight', 'Kingambit'],
  Water: ['Rillaboom', 'Ogerpon-Wellspring', 'Rotom-Wash'],
  Fire: ['Heatran', 'Dragonite', 'Rotom-Wash'],
  Ground: ['Landorus-Therian', 'Gliscor', 'Corviknight'],
  Ice: ['Kingambit', 'Heatran', 'Scizor'],
};

const threatCounterExamples: Record<string, string[]> = {
  'Dragonite': ['Dondozo', 'Primarina', 'Weavile'],
  'Kingambit': ['Great Tusk', 'Iron Hands', 'Hisuian Arcanine'],
  'Flutter Mane': ['Kingambit', 'Gholdengo', 'Heatran'],
  'Miraidon': ['Clodsire', 'Ting-Lu', 'Gastrodon'],
  'Koraidon': ['Dondozo', 'Landorus-Therian', 'Primarina'],
  'Zacian-Crowned': ['Skeledirge', 'Dondozo', 'Heatran'],
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

  const hazardIssue = report.issues.find((issue) => issue.code === 'missing-hazard-removal' || issue.code === 'bss-hazard-sensitive-no-removal');
  if (hazardIssue) {
    const isBss = report.profile.style === 'bss';

    suggestions.push({
      kind: 'patch',
      title: isBss ? 'Consider selective hazard control' : 'Add reliable hazard removal',
      rationale: isBss
        ? 'Removal is usually optional in BSS, but this build has specific hazard-sensitive pieces that can justify one control slot.'
        : 'The current team can be overwhelmed by Stealth Rock and Spikes over longer games.',
      priority: isBss ? 'medium' : 'high',
      targetSlot: getTargetSlot(team, hazardIssue),
      changes: isBss
        ? [
            'Only add removal if it fits one of your likely bring-3 lines.',
            'Prefer a remover that also preserves Multiscale, Focus Sash, or patches a key matchup.',
          ]
        : [
            'Turn one low-impact slot into a Defog or Rapid Spin user.',
            'Prefer a remover that also patches one of your repeated weaknesses.',
          ],
      exampleOptions: ['Great Tusk', 'Corviknight', 'Iron Treads'],
    });
  }

  const topThreat = report.threats.topPressureThreats[0];
  if (topThreat && topThreat.pressure === 'high') {
    suggestions.push({
      kind: 'replace',
      title: `Add a clearer answer to ${topThreat.species}`,
      rationale: 'Species-level BSS threat scoring suggests this matchup remains shaky even when exact opposing sets are unknown.',
      priority: 'high',
      changes: [
        'Replace one passive slot with a sturdier check or revenge killer for this threat.',
        'Prefer a candidate that also improves your bring-3 flexibility and speed benchmarks.',
      ],
      exampleOptions: threatCounterExamples[topThreat.species] ?? ['Great Tusk', 'Heatran', 'Kingambit'],
    });
  }

  const matchupIssue = report.issues.find((issue) => issue.code === 'bss-matchup-cluster-weak');
  if (matchupIssue) {
    suggestions.push({
      kind: 'patch',
      title: 'Patch the weakest preview cluster',
      rationale: 'The team looks uncomfortable into several recurring BSS archetypes rather than just one isolated threat.',
      priority: 'high',
      changes: [
        `Focus on improving these matchups first: ${report.archetypes.weakMatchups.join(', ') || 'rough archetypes'}.`,
        'Use one slot to add either disruption, a sturdier pivot, or a better dedicated breaker depending on the cluster.',
      ],
      exampleOptions: ['Taunt user', 'bulky pivot', 'strong breaker'],
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
    const isBss = report.profile.style === 'bss';

    suggestions.push({
      kind: 'patch',
      title: isBss ? 'Improve speed control or priority' : 'Improve speed control',
      rationale: isBss
        ? 'BSS endgames often hinge on either a fast closer or a strong priority backstop.'
        : 'The team risks losing momentum against offensive builds and late-game sweepers.',
      priority: 'medium',
      changes: isBss
        ? [
            'Add a Choice Scarf user, a naturally fast revenge killer, or a high-value priority user.',
            'If the team is bulky, Taunt or Thunder Wave can also function as emergency tempo control.',
          ]
        : [
            'Add a Choice Scarf user or a naturally fast revenge killer.',
            'If the team is bulky, consider Thunder Wave or Tailwind support instead.',
          ],
      exampleOptions: isBss ? ['Dragonite', 'Kingambit', 'Rillaboom'] : ['Dragapult', 'Iron Valiant', 'Meowscarada'],
    });
  }

  const disruptionIssue = report.issues.find((issue) => issue.code === 'bss-disruption-low');
  if (disruptionIssue) {
    suggestions.push({
      kind: 'set-adjustment',
      title: 'Add one emergency stop button',
      rationale: 'BSS rewards having at least one reliable answer to setup or volatile positioning turns.',
      priority: 'medium',
      changes: [
        'Fit Taunt, Haze, Encore, phazing, or status utility on one likely bring-3 slot.',
        'Prefer the change on a Pokémon you already want to select often in preview.',
      ],
      exampleOptions: ['Taunt Heatran', 'Haze Primarina', 'Encore support'],
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
