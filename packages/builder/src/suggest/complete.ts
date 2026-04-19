import type { AnalysisReport, SpeciesDexPort, Suggestion, Team, ValidationPort } from '@pokemon/domain';
import { defaultBssMeta } from '@pokemon/storage';

import { getCompetitiveSetPreview, prioritizePreviewableCandidates } from './legal-preview.js';

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
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

function buildCompetitiveSetLines(exampleOptions: string[], team: Team, validator: ValidationPort): string[] {
  return prioritizePreviewableCandidates(exampleOptions, team.format, validator)
    .map((name) => getCompetitiveSetPreview(name, team.format, validator))
    .filter((value): value is string => Boolean(value))
    .slice(0, 2)
    .map((preview) => `Sample competitive set: ${preview}`);
}

function rankCompletionCandidates(team: Team, report: AnalysisReport, dex: SpeciesDexPort, need: string): string[] {
  const legalPool = dex.listAvailableSpecies(team.format);
  const existing = new Set(team.members.map((member) => normalize(member.species)));
  const topWeakType = report.weaknesses.find((entry) => entry.weakCount >= 2)?.type;

  return legalPool
    .filter((species) => !existing.has(normalize(species.name)))
    .map((species) => {
      let score = 0;

      if (need.includes('speed')) score += species.baseStats.spe >= 120 ? 12 : species.baseStats.spe >= 100 ? 8 : 0;
      if (need.includes('pivot')) score += defaultBssMeta.suggestedPivots.some((name) => normalize(name).includes(normalize(species.name)) || normalize(species.name).includes(normalize(name)) ) ? 10 : 0;
      if (need.includes('hazard')) score += defaultBssMeta.suggestedRemoval.some((name) => normalize(name).includes(normalize(species.name)) || normalize(species.name).includes(normalize(name)) ) ? 10 : 0;
      if (species.bst >= 540) score += 6;
      if (Math.max(species.baseStats.atk, species.baseStats.spa) >= 120) score += 4;

      if (topWeakType) {
        const multiplier = dex.getTypeEffectiveness(topWeakType, species.types);
        if (multiplier === 0 || abilityCouldGrantImmunity(species.abilities, topWeakType, dex)) score += 10;
        else if (multiplier < 1) score += 6;
      }

      return { name: species.name, score };
    })
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 3)
    .map((entry) => entry.name);
}

export function buildCompletionSuggestions(team: Team, report: AnalysisReport, dex: SpeciesDexPort, validator: ValidationPort): Suggestion[] {
  const missingSlots = Math.max(0, 6 - team.members.length);
  if (missingSlots === 0) return [];

  const nextNeed = report.synergy.missingRoles[0] ?? (!report.speed.hasSpeedControl ? 'speed control' : 'pivot');
  const speedNeed = !report.speed.hasSpeedControl ? 'speed control' : null;
  const uniqueNeeds = Array.from(new Set([nextNeed, speedNeed].filter(Boolean) as string[])).slice(0, 2);

  return uniqueNeeds.map((need, index) => {
    const exampleOptions = prioritizePreviewableCandidates(rankCompletionCandidates(team, report, dex, need), team.format, validator);

    return {
      kind: 'complete',
      title: `Complete the team with ${need}`,
      rationale: `The structure is still missing ${missingSlots} slot(s), so the next addition should be a competitive role-filler that also patches live matchup pressure.`,
      priority: index === 0 ? 'high' : 'medium',
      changes: [
        `Add a member that provides ${need}.`,
        'Choose something legal in the current format that also softens your biggest repeated weakness.',
        ...buildCompetitiveSetLines(exampleOptions, team, validator),
      ],
      exampleOptions,
    } satisfies Suggestion;
  });
}
