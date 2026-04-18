import type { SpeciesDexPort, Team, TeamIssue, WeaknessSummary } from '@pokemon/domain';

export function analyzeWeaknesses(team: Team, dex: SpeciesDexPort): {
  weaknesses: WeaknessSummary[];
  issues: TeamIssue[];
} {
  const issues: TeamIssue[] = [];
  const summaries = dex.listTypes().map((type) => {
    let weakCount = 0;
    let resistCount = 0;
    let immuneCount = 0;
    const weakMembers: string[] = [];

    for (const member of team.members) {
      const species = dex.getSpecies(member.species);
      if (!species) continue;

      const multiplier = dex.getTypeEffectiveness(type, species.types);
      if (multiplier === 0) {
        immuneCount += 1;
      } else if (multiplier > 1) {
        weakCount += 1;
        weakMembers.push(member.name || member.species);
      } else if (multiplier < 1) {
        resistCount += 1;
      }
    }

    const pressure = weakCount >= 4 ? 'high' : weakCount >= 3 ? 'moderate' : 'low';

    if (weakCount >= 3) {
      issues.push({
        code: `type-pressure-${type.toLowerCase()}`,
        severity: weakCount >= 4 ? 'error' : 'warning',
        summary: `Too many members are weak to ${type}.`,
        details: `${weakCount} team members are exposed to ${type}-type pressure.`,
        memberNames: weakMembers,
        relatedTypes: [type],
      });
    }

    return {
      type,
      weakCount,
      resistCount,
      immuneCount,
      pressure,
    } satisfies WeaknessSummary;
  });

  summaries.sort((left, right) => right.weakCount - left.weakCount || left.type.localeCompare(right.type));

  return {
    weaknesses: summaries,
    issues,
  };
}
