import type { RoleSummary, SpeciesDexPort, SynergySummary, Team, TeamIssue } from '@pokemon/domain';

export function analyzeSynergy(team: Team, dex: SpeciesDexPort, roles: RoleSummary[]): {
  synergy: SynergySummary;
  issues: TeamIssue[];
} {
  const uniqueTypes = new Set<string>();
  const primaryTypes = new Map<string, number>();

  for (const member of team.members) {
    const species = dex.getSpecies(member.species);
    if (!species) continue;

    for (const type of species.types) uniqueTypes.add(type);

    const primary = species.types[0];
    if (primary) {
      primaryTypes.set(primary, (primaryTypes.get(primary) ?? 0) + 1);
    }
  }

  const hasHazardSetter = roles.some((entry) => entry.roles.includes('hazard-setter'));
  const hasHazardRemoval = roles.some((entry) => entry.roles.includes('hazard-removal'));
  const pivotCount = roles.filter((entry) => entry.roles.includes('pivot')).length;

  const missingRoles: string[] = [];
  if (!hasHazardSetter) missingRoles.push('hazard setter');
  if (!hasHazardRemoval) missingRoles.push('hazard removal');
  if (pivotCount === 0) missingRoles.push('pivot');

  const duplicatePrimaryTypes = [...primaryTypes.entries()]
    .filter(([, count]) => count >= 3)
    .map(([type]) => type);

  const issues: TeamIssue[] = [];
  if (!hasHazardRemoval) {
    issues.push({
      code: 'missing-hazard-removal',
      severity: 'warning',
      summary: 'The team has no hazard removal.',
      details: 'Spikes and Stealth Rock will wear this team down quickly.',
    });
  }

  if (duplicatePrimaryTypes.length > 0) {
    issues.push({
      code: 'duplicate-primary-types',
      severity: 'warning',
      summary: 'The team repeats primary types too heavily.',
      details: `Repeated primary types: ${duplicatePrimaryTypes.join(', ')}.`,
      relatedTypes: duplicatePrimaryTypes,
    });
  }

  return {
    synergy: {
      uniqueTypes: [...uniqueTypes].sort(),
      duplicatePrimaryTypes,
      hasHazardSetter,
      hasHazardRemoval,
      pivotCount,
      missingRoles,
    },
    issues,
  };
}
