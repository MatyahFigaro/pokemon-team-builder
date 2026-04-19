import type { RoleSummary, SpeciesDexPort, SynergySummary, Team, TeamIssue } from '@pokemon/domain';

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function isBssFormat(format: string): boolean {
  const id = normalize(format);
  return id.includes('bss') || id.includes('battlestadium') || id.includes('championsbss');
}

function getHazardSensitivity(team: Team, dex: SpeciesDexPort): { notable: boolean; sensitive: boolean; reasons: string[] } {
  const reasons: string[] = [];
  let rockWeakCount = 0;
  let severeRockWeakCount = 0;
  let focusSashCount = 0;
  let multiscaleCount = 0;

  for (const member of team.members) {
    const profile = dex.getBattleProfile(member, team.format);
    if (!profile) continue;

    const rockMultiplier = dex.getMatchupMultiplier('Rock', member, team.format);
    if (rockMultiplier >= 4) {
      severeRockWeakCount += 1;
      reasons.push(`${profile.name} is 4x weak to Stealth Rock.`);
    }
    if (normalize(profile.ability) === 'multiscale') {
      multiscaleCount += 1;
      reasons.push(`${profile.name} wants Multiscale intact.`);
    }
    if (normalize(member.item) === 'focus sash') {
      focusSashCount += 1;
    }
    if (rockMultiplier > 1) {
      rockWeakCount += 1;
    }
  }

  if (rockWeakCount >= 3) {
    reasons.push('Several members are meaningfully chipped by Stealth Rock.');
  }

  if (focusSashCount >= 2) {
    reasons.push('Multiple members rely on Focus Sash staying unbroken.');
  } else if (focusSashCount === 1 && (multiscaleCount > 0 || severeRockWeakCount > 0 || rockWeakCount >= 3)) {
    reasons.push('A Focus Sash slot is especially vulnerable to hazard chip here.');
  }

  const score = severeRockWeakCount * 2
    + multiscaleCount * 2
    + (rockWeakCount >= 3 ? 2 : 0)
    + (focusSashCount >= 2 ? 2 : (focusSashCount === 1 && reasons.some((reason) => reason.includes('Focus Sash')) ? 1 : 0));

  return {
    notable: score >= 2,
    sensitive: score >= 3,
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
    } else if (hazardSensitivity.notable) {
      issues.push({
        code: 'bss-hazard-sensitive-no-removal',
        severity: hazardSensitivity.sensitive ? 'warning' : 'info',
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
