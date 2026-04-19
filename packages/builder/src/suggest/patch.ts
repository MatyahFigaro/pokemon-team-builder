import type { AnalysisReport, SpeciesDexPort, Suggestion, Team, TeamIssue, ValidationPort } from '@pokemon/domain';
import { defaultBssMeta } from '@pokemon/storage';

import { getCompetitiveSetPreview, prioritizePreviewableCandidates } from './legal-preview.js';

const knownRemovalLabels = [...defaultBssMeta.suggestedRemoval, 'Great Tusk', 'Corviknight', 'Iron Treads', 'Mandibuzz'];
const knownDisruptionLabels = ['Heatran', 'Primarina', 'Grimmsnarl', 'Whimsicott', 'Corviknight', 'Gyarados'];

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function getTargetSlot(team: Team, issue?: TeamIssue): number | undefined {
  const memberName = issue?.memberNames?.[0];
  if (!memberName) return undefined;

  const index = team.members.findIndex((member) => (member.name || member.species) === memberName);
  return index >= 0 ? index + 1 : undefined;
}

function getAbilityText(abilityName: string, dex: SpeciesDexPort): string {
  const ability = dex.getAbility(abilityName);
  return `${ability?.shortDesc ?? ''} ${ability?.desc ?? ''}`.toLowerCase();
}

function abilityCouldGrantImmunity(abilities: string[], attackingType: string, dex: SpeciesDexPort): boolean {
  const typeId = attackingType.toLowerCase();

  return abilities.some((abilityName) => {
    const text = getAbilityText(abilityName, dex);
    return text.includes(`immune to ${typeId}`)
      || text.includes(`${typeId} immunity`)
      || text.includes(`${typeId}-type moves and restores`)
      || text.includes(`${typeId}-type moves and raises`)
      || text.includes(`draws ${typeId} moves to itself`);
  });
}

function hasPowerAbility(abilities: string[], dex: SpeciesDexPort): boolean {
  return abilities.some((abilityName) => {
    const text = getAbilityText(abilityName, dex);
    return text.includes('attack is doubled')
      || text.includes('special attack is doubled')
      || text.includes('power multiplied by 1.3')
      || text.includes('power multiplied by 1.5')
      || text.includes('offensive stat is multiplied by 1.5')
      || text.includes('attack is raised by 1 stage')
      || text.includes('special attack is raised by 1 stage');
  });
}

function resolveSpeciesLabel(label: string, legalNames: string[]): string | null {
  const id = normalize(label);
  const exact = legalNames.find((name) => normalize(name) === id);
  if (exact) return exact;

  const suffix = legalNames.find((name) => id.endsWith(normalize(name)));
  return suffix ?? null;
}

function scoreCandidate(
  candidateName: string,
  team: Team,
  report: AnalysisReport,
  dex: SpeciesDexPort,
  options: { threatenedType?: string; threatName?: string; preferSpeed?: boolean; preferBulk?: boolean },
): number {
  const species = dex.getSpecies(candidateName);
  if (!species) return -999;

  let score = 0;
  const teamTypeSet = new Set(team.members.flatMap((member) => dex.getSpecies(member.species)?.types ?? []));

  if (report.profile.style === 'bss') score += species.bst >= 540 ? 8 : species.bst >= 500 ? 4 : 0;
  score += Math.max(species.baseStats.atk, species.baseStats.spa) >= 120 ? 4 : 0;
  score += hasPowerAbility(species.abilities, dex) ? 3 : 0;

  if (options.preferSpeed) {
    score += species.baseStats.spe >= 120 ? 10 : species.baseStats.spe >= 100 ? 7 : species.baseStats.spe >= 90 ? 4 : 0;
  }

  if (options.preferBulk) {
    score += species.baseStats.hp + Math.max(species.baseStats.def, species.baseStats.spd) >= 190 ? 6 : 0;
  }

  if (options.threatenedType) {
    const multiplier = dex.getTypeEffectiveness(options.threatenedType, species.types);
    if (multiplier === 0 || abilityCouldGrantImmunity(species.abilities, options.threatenedType, dex)) {
      score += 14;
    } else if (multiplier < 1) {
      score += 8;
    } else if (multiplier > 1) {
      score -= 8;
    }
  }

  if (options.threatName) {
    const threat = dex.getSpecies(options.threatName);
    if (threat) {
      for (const type of threat.types) {
        const multiplier = dex.getTypeEffectiveness(type, species.types);
        if (multiplier === 0 || abilityCouldGrantImmunity(species.abilities, type, dex)) score += 5;
        else if (multiplier < 1) score += 3;
      }

      if (species.baseStats.spe >= threat.baseStats.spe + 5) score += 6;
      if (species.types.some((type) => dex.getTypeEffectiveness(type, threat.types) > 1 && !abilityCouldGrantImmunity(threat.abilities, type, dex))) {
        score += 6;
      }
    }
  }

  const newTypes = species.types.filter((type) => !teamTypeSet.has(type)).length;
  score += newTypes * 2;

  return score;
}

function rankFromLegalPool(
  team: Team,
  report: AnalysisReport,
  dex: SpeciesDexPort,
  options: { threatenedType?: string; threatName?: string; preferSpeed?: boolean; preferBulk?: boolean },
  preferredLabels?: string[],
): string[] {
  const legalPool = dex.listAvailableSpecies(team.format);
  const teamSpecies = new Set(team.members.map((member) => normalize(member.species)));
  const legalNames = legalPool.map((species) => species.name);

  const candidateNames = preferredLabels?.length
    ? preferredLabels
        .map((label) => resolveSpeciesLabel(label, legalNames))
        .filter((name): name is string => Boolean(name))
    : legalNames;

  return Array.from(new Set(candidateNames))
    .filter((name) => !teamSpecies.has(normalize(name)))
    .map((name) => ({ name, score: scoreCandidate(name, team, report, dex, options) }))
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 3)
    .map((entry) => entry.name);
}

function buildCompetitiveSetLines(exampleOptions: string[], team: Team, validator: ValidationPort): string[] {
  return prioritizePreviewableCandidates(exampleOptions, team.format, validator)
    .map((name) => getCompetitiveSetPreview(name, team.format, validator))
    .filter((value): value is string => Boolean(value))
    .slice(0, 2)
    .map((preview) => `Sample competitive set: ${preview}`);
}

export function buildPatchSuggestions(team: Team, report: AnalysisReport, dex: SpeciesDexPort, validator: ValidationPort): Suggestion[] {
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

  const topWeakType = report.weaknesses.find((entry) => entry.weakCount >= 2)?.type;
  const hazardIssue = report.issues.find((issue) => (issue.code === 'missing-hazard-removal' || issue.code === 'bss-hazard-sensitive-no-removal') && issue.severity !== 'info');
  if (hazardIssue) {
    const isBss = report.profile.style === 'bss';

    const exampleOptions = prioritizePreviewableCandidates(
      rankFromLegalPool(team, report, dex, { threatenedType: topWeakType, preferBulk: true }, knownRemovalLabels),
      team.format,
      validator,
    );

    suggestions.push({
      kind: 'patch',
      title: isBss ? 'Consider selective hazard control' : 'Add reliable hazard removal',
      rationale: isBss
        ? 'Removal is usually optional in BSS, but this build has specific hazard-sensitive pieces that can justify one control slot.'
        : 'The current team can be overwhelmed by Stealth Rock and Spikes over longer games.',
      priority: isBss ? 'medium' : 'high',
      targetSlot: getTargetSlot(team, hazardIssue),
      changes: [
        ...(isBss
          ? [
              'Only add removal if it fits one of your likely bring-3 lines.',
              'Prefer a remover that is legal in this format and also patches one of your live weakness clusters.',
            ]
          : [
              'Turn one low-impact slot into a legal Defog or Rapid Spin user.',
              'Prefer a remover that also patches one of your repeated weaknesses.',
            ]),
        ...buildCompetitiveSetLines(exampleOptions, team, validator),
      ],
      exampleOptions,
    });
  }

  const topThreat = report.threats.topPressureThreats[0];
  if (topThreat && (topThreat.pressure === 'high' || topThreat.pressure === 'moderate')) {
    const exampleOptions = prioritizePreviewableCandidates(
      rankFromLegalPool(team, report, dex, { threatName: topThreat.species, preferBulk: true, preferSpeed: true }),
      team.format,
      validator,
    );

    suggestions.push({
      kind: 'replace',
      title: `Add a clearer answer to ${topThreat.species}`,
      rationale: 'Species-level threat scoring suggests this matchup remains shaky even when exact opposing sets are unknown.',
      priority: topThreat.pressure === 'high' ? 'high' : 'medium',
      changes: [
        'Replace one passive slot with a sturdier check or revenge killer for this threat.',
        'Prefer a legal candidate that both resists its usual pressure and threatens it back.',
        ...buildCompetitiveSetLines(exampleOptions, team, validator),
      ],
      exampleOptions,
    });
  }

  const matchupIssue = report.issues.find((issue) => issue.code === 'bss-matchup-cluster-weak');
  if (matchupIssue) {
    const exampleOptions = prioritizePreviewableCandidates(
      rankFromLegalPool(team, report, dex, { preferBulk: true, preferSpeed: true }, defaultBssMeta.suggestedPivots),
      team.format,
      validator,
    );

    suggestions.push({
      kind: 'patch',
      title: 'Patch the weakest preview cluster',
      rationale: 'The team looks uncomfortable into several recurring BSS archetypes rather than just one isolated threat.',
      priority: 'high',
      changes: [
        `Focus on improving these matchups first: ${report.archetypes.weakMatchups.join(', ') || 'rough archetypes'}.`,
        'Use one slot to add either disruption, a sturdier pivot, or a better dedicated breaker depending on the cluster.',
        ...buildCompetitiveSetLines(exampleOptions, team, validator),
      ],
      exampleOptions,
    });
  }

  const pressureIssue = report.issues.find((issue) => issue.code.startsWith('type-pressure-'));
  if (pressureIssue) {
    const threatenedType = pressureIssue.relatedTypes?.[0] ?? topWeakType ?? 'Electric';
    const exampleOptions = prioritizePreviewableCandidates(
      rankFromLegalPool(team, report, dex, { threatenedType, preferBulk: true }),
      team.format,
      validator,
    );

    suggestions.push({
      kind: 'replace',
      title: `Patch the ${threatenedType} matchup`,
      rationale: 'Too many slots fold to the same attacking type, which makes the team easy to target in preview and play.',
      priority: 'high',
      targetSlot: getTargetSlot(team, pressureIssue),
      changes: [
        'Replace one exposed slot with a format-legal answer that actually resists or blanks this pressure line.',
        'Favor secondary utility such as pivoting, hazards, or recovery.',
        ...buildCompetitiveSetLines(exampleOptions, team, validator),
      ],
      exampleOptions,
    });
  }

  if (report.speed.fastCount === 0 || !report.speed.hasSpeedControl) {
    const isBss = report.profile.style === 'bss';

    const exampleOptions = prioritizePreviewableCandidates(
      rankFromLegalPool(team, report, dex, { preferSpeed: true }, defaultBssMeta.suggestedSpeedControl),
      team.format,
      validator,
    );

    suggestions.push({
      kind: 'patch',
      title: isBss ? 'Improve speed control or priority' : 'Improve speed control',
      rationale: isBss
        ? 'BSS endgames often hinge on either a fast closer or a strong priority backstop.'
        : 'The team risks losing momentum against offensive builds and late-game sweepers.',
      priority: 'medium',
      changes: [
        ...(isBss
          ? [
              'Add a legal fast closer, Choice Scarf line, or high-value priority user.',
              'If the team is bulky, Taunt or Thunder Wave can also function as emergency tempo control.',
            ]
          : [
              'Add a Choice Scarf user or a naturally fast revenge killer.',
              'If the team is bulky, consider Thunder Wave or Tailwind support instead.',
            ]),
        ...buildCompetitiveSetLines(exampleOptions, team, validator),
      ],
      exampleOptions,
    });
  }

  const disruptionIssue = report.issues.find((issue) => issue.code === 'bss-disruption-low');
  if (disruptionIssue) {
    const exampleOptions = prioritizePreviewableCandidates(
      rankFromLegalPool(team, report, dex, { preferBulk: true }, knownDisruptionLabels),
      team.format,
      validator,
    );

    suggestions.push({
      kind: 'set-adjustment',
      title: 'Add one emergency stop button',
      rationale: 'BSS rewards having at least one reliable answer to setup or volatile positioning turns.',
      priority: 'medium',
      changes: [
        'Fit Taunt, Haze, Encore, phazing, or status utility on one likely bring-3 slot.',
        'Prefer the change on a legal Pokémon you already want to select often in preview.',
        ...buildCompetitiveSetLines(exampleOptions, team, validator),
      ],
      exampleOptions,
    });
  }

  if (suggestions.length === 0) {
    const exampleOptions = prioritizePreviewableCandidates(
      rankFromLegalPool(team, report, dex, { preferBulk: true, preferSpeed: true }, defaultBssMeta.suggestedPivots),
      team.format,
      validator,
    );

    suggestions.push({
      kind: 'patch',
      title: 'Refine the weakest slot',
      rationale: 'The structure is stable enough for focused set tuning instead of major surgery.',
      priority: 'low',
      changes: [
        'Upgrade one slot to add either momentum or extra defensive utility.',
        'Prefer an adjustment that keeps your current game plan intact and improves at least one live matchup.',
        ...buildCompetitiveSetLines(exampleOptions, team, validator),
      ],
      exampleOptions,
    });
  }

  return suggestions.slice(0, 3);
}
