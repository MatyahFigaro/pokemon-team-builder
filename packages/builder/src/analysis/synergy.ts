import type { RoleSummary, SpeciesDexPort, SynergySummary, Team, TeamIssue } from '@pokemon/domain';

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function isBssFormat(format: string): boolean {
  const id = normalize(format);
  return id.includes('bss') || id.includes('battlestadium') || id.includes('championsbss');
}

function getHazardSensitivity(team: Team, dex: SpeciesDexPort): { sensitive: boolean; reasons: string[] } {
  const reasons: string[] = [];
  let rockWeakCount = 0;

  for (const member of team.members) {
    const profile = dex.getBattleProfile(member, team.format);
    if (!profile) continue;

    const rockMultiplier = dex.getMatchupMultiplier('Rock', member, team.format);
    if (rockMultiplier >= 4) {
      reasons.push(`${profile.name} is 4x weak to Stealth Rock.`);
    }
    if (normalize(profile.ability) === 'multiscale') {
      reasons.push(`${profile.name} wants Multiscale intact.`);
    }
    if (normalize(member.item) === 'focus sash') {
      reasons.push(`${profile.name} relies on Focus Sash staying unbroken.`);
    }
    if (rockMultiplier > 1) {
      rockWeakCount += 1;
    }
  }

  if (rockWeakCount >= 3) {
    reasons.push('Several members are meaningfully chipped by Stealth Rock.');
  }

  return {
    sensitive: reasons.length > 0,
    reasons,
  };
}

export function analyzeSynergy(team: Team, dex: SpeciesDexPort, roles: RoleSummary[]): {
  synergy: SynergySummary;
  issues: TeamIssue[];
} {
  const uniqueTypes = new Set<string>();
  const primaryTypes = new Map<string, number>();

  for (const member of team.members) {
    const profile = dex.getBattleProfile(member, team.format);
    if (!profile) continue;

    for (const type of profile.types) uniqueTypes.add(type);

    const primary = profile.types[0];
    if (primary) {
      primaryTypes.set(primary, (primaryTypes.get(primary) ?? 0) + 1);
    }
  }

  const hasHazardSetter = roles.some((entry) => entry.roles.includes('hazard-setter'));
  const hasHazardRemoval = roles.some((entry) => entry.roles.includes('hazard-removal'));
  const pivotCount = roles.filter((entry) => entry.roles.includes('pivot')).length;
  const formatIsBss = isBssFormat(team.format);
  const hazardSensitivity = getHazardSensitivity(team, dex);

  const missingRoles: string[] = [];
  if (!hasHazardSetter) missingRoles.push('hazard setter');
  if (!hasHazardRemoval && (!formatIsBss || hazardSensitivity.sensitive)) missingRoles.push('hazard removal');
  if (pivotCount === 0) missingRoles.push('pivot');

  const duplicatePrimaryTypes = [...primaryTypes.entries()]
    .filter(([, count]) => count >= 3)
    .map(([type]) => type);

  const issues: TeamIssue[] = [];
  if (!hasHazardRemoval) {
    if (!formatIsBss) {
      issues.push({
        code: 'missing-hazard-removal',
        severity: 'warning',
        summary: 'The team has no hazard removal.',
        details: 'Spikes and Stealth Rock will wear this team down quickly.',
      });
    } else if (hazardSensitivity.sensitive) {
      issues.push({
        code: 'bss-hazard-sensitive-no-removal',
        severity: hazardSensitivity.reasons.some((reason) => reason.includes('4x')) || hazardSensitivity.reasons.length >= 2 ? 'warning' : 'info',
        summary: 'This BSS team is more hazard-sensitive than usual.',
        details: `Removal is optional in BSS, but this roster has specific reasons to value it: ${hazardSensitivity.reasons.slice(0, 2).join(' ')}`,
      });
    }
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
