import type { AnalysisReport, SpeciesDexPort, Suggestion, Team, ValidationPort } from '@pokemon/domain';
import { getSpeciesUsage, getUsageWeight } from '@pokemon/storage';

import { getCompetitiveSetPreview, prioritizePreviewableCandidates, type PreviewRoleHint } from './legal-preview.js';

const HAZARD_CONTROL_MOVES = ['Defog', 'Rapid Spin', 'Mortal Spin', 'Court Change'];
const DISRUPTION_MOVES = ['Taunt', 'Encore', 'Haze', 'Clear Smog', 'Thunder Wave', 'Yawn', 'Roar', 'Whirlwind', 'Dragon Tail'];
const PIVOT_MOVES = ['U-turn', 'Volt Switch', 'Parting Shot', 'Flip Turn', 'Baton Pass', 'Teleport', 'Chilly Reception'];

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function canLearnAnyMove(speciesName: string, moveNames: string[], dex: SpeciesDexPort): boolean {
  return moveNames.some((moveName) => dex.canLearnMove(speciesName, moveName));
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

function buildCompetitiveSetLines(
  exampleOptions: string[],
  team: Team,
  dex: SpeciesDexPort,
  validator: ValidationPort,
  roleHint: PreviewRoleHint = 'default',
): string[] {
  return prioritizePreviewableCandidates(exampleOptions, team.format, dex, validator, { roleHint })
    .map((name) => getCompetitiveSetPreview(name, team.format, dex, validator, { roleHint }))
    .filter((value): value is string => Boolean(value))
    .slice(0, 2)
    .map((preview) => `Sample competitive set: ${preview}`);
}

function getBringAnchors(team: Team, report: AnalysisReport): string[] {
  const wanted = new Set([...report.battlePlan.leadCandidates, ...report.battlePlan.likelyPicks].map(normalize));
  return Array.from(new Set(
    team.members
      .filter((member) => wanted.has(normalize(member.name || member.species)))
      .map((member) => member.species),
  )).slice(0, 3);
}

function scoreAgainstThreat(candidateName: string, threatName: string, dex: SpeciesDexPort): number {
  const candidate = dex.getSpecies(candidateName);
  const threat = dex.getSpecies(threatName);
  if (!candidate || !threat) return 0;

  let score = 0;
  const threatIsPhysical = threat.baseStats.atk >= threat.baseStats.spa;

  for (const type of threat.types) {
    const multiplier = dex.getTypeEffectiveness(type, candidate.types);
    if (multiplier === 0 || abilityCouldGrantImmunity(candidate.abilities, type, dex)) score += 6;
    else if (multiplier < 1) score += 4;
    else if (multiplier > 1) score -= 4;
  }

  if (candidate.baseStats.spe >= threat.baseStats.spe + 5) score += 5;

  if (threatIsPhysical && candidate.baseStats.hp + candidate.baseStats.def >= 190) score += 4;
  if (!threatIsPhysical && candidate.baseStats.hp + candidate.baseStats.spd >= 190) score += 4;

  if (candidate.types.some((type) => dex.getTypeEffectiveness(type, threat.types) > 1 && !abilityCouldGrantImmunity(threat.abilities, type, dex))) {
    score += 5;
  }

  return score;
}

function getThreatAnswerBoost(candidateName: string, report: AnalysisReport, dex: SpeciesDexPort): number {
  return report.threats.topPressureThreats.reduce((score, threat) => {
    const pressureWeight = threat.pressure === 'high' ? 1.25 : 1;
    const usageWeight = 0.75 + getUsageWeight(report.format, threat.species);
    return score + scoreAgainstThreat(candidateName, threat.species, dex) * pressureWeight * usageWeight;
  }, 0);
}

function buildBringPlanLines(exampleOptions: string[], report: AnalysisReport): string[] {
  if (report.profile.style !== 'bss') return [];

  const lead = report.battlePlan.leadCandidates[0] ?? report.battlePlan.likelyPicks[0];
  const backline = report.battlePlan.likelyPicks.filter((name) => normalize(name) !== normalize(lead)).slice(0, 2);

  return exampleOptions.slice(0, 2).map((name) => {
    const trio = Array.from(new Set([lead, name, ...backline].filter(Boolean) as string[])).slice(0, 3);
    return trio.length >= 2
      ? `Bring-3 fit: ${trio.join(' / ')}.`
      : `${name} fits the current BSS bring plan well.`;
  });
}

function rankCompletionCandidates(team: Team, report: AnalysisReport, dex: SpeciesDexPort, need: string): string[] {
  const legalPool = dex.listAvailableSpecies(team.format);
  const existing = new Set(team.members.map((member) => normalize(member.species)));
  const topWeakType = report.weaknesses.find((entry) => entry.weakCount >= 2)?.type;
  const anchorSpecies = getBringAnchors(team, report);
  const anchorTypes = new Set(anchorSpecies.flatMap((name) => dex.getSpecies(name)?.types ?? []));
  const weakArchetypes = report.archetypes.weakMatchups.map((entry) => normalize(entry));

  return legalPool
    .filter((species) => !existing.has(normalize(species.name)))
    .map((species) => {
      let score = 0;
      const usageRecord = getSpeciesUsage(team.format, species.name);
      const usageWeight = getUsageWeight(team.format, species.name);
      const usageMoveNames = new Set((usageRecord?.moves ?? []).map((move) => normalize(move.name)));
      const teammateSynergyHits = (usageRecord?.teammates ?? []).filter((ally) => team.members.some((member) => normalize(member.species) === normalize(ally.name))).length;

      if (need.includes('speed')) score += species.baseStats.spe >= 120 ? 12 : species.baseStats.spe >= 100 ? 8 : 0;
      if (need.includes('pivot') && canLearnAnyMove(species.name, PIVOT_MOVES, dex)) score += 10;
      if (need.includes('hazard') && canLearnAnyMove(species.name, HAZARD_CONTROL_MOVES, dex)) score += 8;
      if (need.includes('pivot') && PIVOT_MOVES.some((move) => usageMoveNames.has(normalize(move)))) score += 4;
      if (need.includes('hazard') && HAZARD_CONTROL_MOVES.some((move) => usageMoveNames.has(normalize(move)))) score += 4;
      if (species.bst >= 540) score += 6;
      if (Math.max(species.baseStats.atk, species.baseStats.spa) >= 120) score += 4;
      score += Math.round(usageWeight * (report.profile.style === 'bss' ? 12 : 8));
      score += teammateSynergyHits * (report.profile.style === 'bss' ? 3 : 2);

      if (topWeakType) {
        const multiplier = dex.getTypeEffectiveness(topWeakType, species.types);
        if (multiplier === 0 || abilityCouldGrantImmunity(species.abilities, topWeakType, dex)) score += 10;
        else if (multiplier < 1) score += 6;
      }

      if (report.profile.style === 'bss') {
        score += getThreatAnswerBoost(species.name, report, dex);
        score += species.types.filter((type) => !anchorTypes.has(type)).length * 2;

        if (need.includes('pivot') && species.baseStats.hp + Math.max(species.baseStats.def, species.baseStats.spd) >= 190) score += 4;
        if (need.includes('speed') && Math.max(species.baseStats.atk, species.baseStats.spa) >= 120) score += 4;
        if (canLearnAnyMove(species.name, DISRUPTION_MOVES, dex) && weakArchetypes.some((entry) => entry.includes('setup') || entry.includes('trick'))) {
          score += 6;
        }
      }

      return { name: species.name, score };
    })
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 3)
    .map((entry) => entry.name);
}

function getRoleHintForNeed(need: string): PreviewRoleHint {
  if (need.includes('speed')) return 'speed';
  if (need.includes('pivot')) return 'pivot';
  if (need.includes('hazard')) return 'hazard-control';
  return 'default';
}

export function buildCompletionSuggestions(team: Team, report: AnalysisReport, dex: SpeciesDexPort, validator: ValidationPort): Suggestion[] {
  const missingSlots = Math.max(0, 6 - team.members.length);
  if (missingSlots === 0) return [];

  const nextNeed = report.synergy.missingRoles[0] ?? (!report.speed.hasSpeedControl ? 'speed control' : 'pivot');
  const speedNeed = !report.speed.hasSpeedControl ? 'speed control' : null;
  const uniqueNeeds = Array.from(new Set([nextNeed, speedNeed].filter(Boolean) as string[])).slice(0, 2);
  const topThreats = report.threats.topPressureThreats.slice(0, 2).map((entry) => entry.species).join(', ');

  return uniqueNeeds.map((need, index) => {
    const roleHint = getRoleHintForNeed(need);
    const exampleOptions = prioritizePreviewableCandidates(rankCompletionCandidates(team, report, dex, need), team.format, dex, validator, { roleHint });

    return {
      kind: 'complete',
      title: `Complete the team with ${need}`,
      rationale: report.profile.style === 'bss'
        ? `The structure is still missing ${missingSlots} slot(s), so the next addition should improve an actual bring-3 game plan rather than just fill a generic role.`
        : `The structure is still missing ${missingSlots} slot(s), so the next addition should be a competitive role-filler that also patches live matchup pressure.`,
      priority: index === 0 ? 'high' : 'medium',
      changes: [
        `Add a member that provides ${need}.`,
        report.profile.style === 'bss'
          ? 'Build toward a trio that can actually be brought from preview, not just six individually strong names.'
          : 'Choose something legal in the current format that also softens your biggest repeated weakness.',
        ...(topThreats ? [`Prefer a slot that also gives you play into ${topThreats}.`] : []),
        ...buildBringPlanLines(exampleOptions, report),
        ...buildCompetitiveSetLines(exampleOptions, team, dex, validator, roleHint),
      ],
      exampleOptions,
    } satisfies Suggestion;
  });
}
