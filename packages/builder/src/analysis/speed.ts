import type { RoleSummary, SpeciesDexPort, SpeedSummary, Team, TeamIssue } from '@pokemon/domain';

export function analyzeSpeed(team: Team, dex: SpeciesDexPort, roles: RoleSummary[]): {
  speed: SpeedSummary;
  issues: TeamIssue[];
} {
  const speeds = team.members
    .map((member) => dex.getSpecies(member.species)?.baseStats.spe ?? 0)
    .filter((value) => value > 0);

  const slowCount = speeds.filter((value) => value < 70).length;
  const mediumCount = speeds.filter((value) => value >= 70 && value < 100).length;
  const fastCount = speeds.filter((value) => value >= 100).length;
  const fastestBaseSpeed = speeds.length ? Math.max(...speeds) : 0;
  const averageBaseSpeed = speeds.length ? Math.round(speeds.reduce((sum, value) => sum + value, 0) / speeds.length) : 0;
  const hasSpeedControl = roles.some((entry) => entry.roles.includes('speed-control'));

  const issues: TeamIssue[] = [];
  if (fastCount === 0) {
    issues.push({
      code: 'speed-tier-low',
      severity: 'warning',
      summary: 'The team has no naturally fast member.',
      details: 'Add a revenge killer, Choice Scarf user, or explicit speed-control slot.',
    });
  }

  if (!hasSpeedControl) {
    issues.push({
      code: 'missing-speed-control',
      severity: 'info',
      summary: 'The team lacks explicit speed control.',
      details: 'Consider a scarfer, paralysis support, Tailwind, or Trick Room plan.',
    });
  }

  return {
    speed: {
      slowCount,
      mediumCount,
      fastCount,
      fastestBaseSpeed,
      averageBaseSpeed,
      hasSpeedControl,
    },
    issues,
  };
}
