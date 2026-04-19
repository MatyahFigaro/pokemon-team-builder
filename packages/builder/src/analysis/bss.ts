import type {
  BattlePlanSummary,
  FormatProfileSummary,
  RoleSummary,
  SpeciesDexPort,
  Team,
  TeamIssue,
  ThreatCoverageSummary,
  ThreatPressureSummary,
} from '@pokemon/domain';
import { defaultBssMeta } from '@pokemon/storage';

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function isBssFormat(format: string): boolean {
  const id = normalize(format);
  return id.includes('bss') || id.includes('battlestadium') || id.includes('championsbss');
}

const priorityMoves = new Set([
  'extreme speed',
  'espeed',
  'sucker punch',
  'grassy glide',
  'ice shard',
  'mach punch',
  'vacuum wave',
  'shadow sneak',
  'aqua jet',
  'accelerock',
  'first impression',
]);

const disruptionMoves = new Set([
  'taunt',
  'haze',
  'encore',
  'clear smog',
  'yawn',
  'will-o-wisp',
  'thunder wave',
  'roar',
  'whirlwind',
  'dragon tail',
]);

function hasTaggedMove(moves: string[], pool: Set<string>): boolean {
  return moves.some((move) => pool.has(move));
}

function scoreLead(member: Team['members'][number], roles: RoleSummary, dex: SpeciesDexPort): number {
  const species = dex.getSpecies(member.species);
  if (!species) return 0;

  const moves = member.moves.map(normalize);
  let score = 0;

  if (roles.roles.includes('lead')) score += 4;
  if (roles.roles.includes('pivot')) score += 3;
  if (roles.roles.includes('hazard-setter')) score += 2;
  if (roles.roles.includes('speed-control')) score += 2;
  if (moves.includes('fake out')) score += 3;
  if (moves.includes('taunt')) score += 2;
  if (hasTaggedMove(moves, disruptionMoves)) score += 2;
  if (hasTaggedMove(moves, priorityMoves)) score += 1;
  if (species.baseStats.spe >= 95) score += 2;
  if (species.baseStats.hp + species.baseStats.def >= 185) score += 1;

  return score;
}

function scorePick(member: Team['members'][number], roles: RoleSummary, dex: SpeciesDexPort): number {
  const species = dex.getSpecies(member.species);
  if (!species) return 0;

  const moves = member.moves.map(normalize);
  let score = 0;
  if (roles.roles.includes('wallbreaker')) score += 4;
  if (roles.roles.includes('setup-sweeper')) score += 3;
  if (roles.roles.includes('speed-control')) score += 3;
  if (roles.roles.includes('pivot')) score += 2;
  if (hasTaggedMove(moves, priorityMoves)) score += 2;
  if (species.baseStats.spe >= 100) score += 2;
  if (species.bst >= 540) score += 2;
  if (species.baseStats.hp + Math.max(species.baseStats.def, species.baseStats.spd) >= 190) score += 1;

  return score;
}

function getSpeedControlRating(fastestBaseSpeed: number, hasSpeedControl: boolean): 'poor' | 'fair' | 'good' {
  if (fastestBaseSpeed >= 120 || (fastestBaseSpeed >= 100 && hasSpeedControl)) return 'good';
  if (fastestBaseSpeed >= 100 || hasSpeedControl) return 'fair';
  return 'poor';
}

function getTeraDependency(team: Team, roles: RoleSummary[], dex: SpeciesDexPort): 'low' | 'medium' | 'high' {
  const offTypeTeras = team.members.filter((member) => {
    const tera = member.teraType;
    if (!tera) return false;
    const species = dex.getSpecies(member.species);
    return species ? !species.types.includes(tera) : false;
  }).length;

  const setupCount = roles.filter((entry) => entry.roles.includes('setup-sweeper')).length;

  if (offTypeTeras >= 3 && setupCount >= 2) return 'high';
  if (offTypeTeras >= 2 || setupCount >= 2) return 'medium';
  return 'low';
}

function evaluateThreatPressure(
  threatName: string,
  team: Team,
  dex: SpeciesDexPort,
  hasSpeedControl: boolean,
): ThreatPressureSummary | null {
  const threat = dex.getSpecies(threatName);
  if (!threat) return null;

  const threatTypes = threat.types;
  const threatSpeed = threat.baseStats.spe;
  const threatIsPhysical = threat.baseStats.atk >= threat.baseStats.spa;

  let hasResist = false;
  let hasFastCheck = false;
  let hasBulkyCheck = false;
  let hasOffensiveAnswer = false;

  for (const member of team.members) {
    const species = dex.getSpecies(member.species);
    if (!species) continue;

    const incomingMultipliers = threatTypes.map((type) => dex.getTypeEffectiveness(type, species.types));
    if (incomingMultipliers.some((multiplier) => multiplier === 0 || multiplier < 1)) {
      hasResist = true;
    }

    if (species.baseStats.spe >= threatSpeed + 5) {
      hasFastCheck = true;
    }

    if (threatIsPhysical && species.baseStats.hp + species.baseStats.def >= 190) {
      hasBulkyCheck = true;
    }

    if (!threatIsPhysical && species.baseStats.hp + species.baseStats.spd >= 190) {
      hasBulkyCheck = true;
    }

    if (species.types.some((type) => dex.getTypeEffectiveness(type, threat.types) > 1)) {
      hasOffensiveAnswer = true;
    }
  }

  if (hasSpeedControl && threatSpeed >= 100) {
    hasFastCheck = true;
  }

  const answerCount = [hasResist, hasFastCheck, hasBulkyCheck, hasOffensiveAnswer].filter(Boolean).length;
  const pressure = answerCount >= 3 ? 'low' : answerCount >= 2 ? 'moderate' : 'high';

  const reasons: string[] = [];
  if (!hasResist) reasons.push('No clear resistance or immunity to likely STAB pressure.');
  if (!hasFastCheck) reasons.push('No clear speed advantage into this threat.');
  if (!hasBulkyCheck) reasons.push('No obvious bulky pivot or defensive check.');
  if (!hasOffensiveAnswer) reasons.push('No obvious super effective offensive answer.');

  return {
    species: threat.name,
    pressure,
    reasons,
  };
}

export function analyzeBssPlan(
  team: Team,
  dex: SpeciesDexPort,
  roles: RoleSummary[],
  speed: { fastestBaseSpeed: number; hasSpeedControl: boolean },
): {
  profile: FormatProfileSummary;
  battlePlan: BattlePlanSummary;
  threats: ThreatCoverageSummary;
  issues: TeamIssue[];
} {
  const style = isBssFormat(team.format) ? 'bss' : 'standard';

  const mechanics = dex.getFormatMechanics(team.format);

  const profile: FormatProfileSummary = {
    style,
    bringCount: style === 'bss' ? defaultBssMeta.bringCount : 6,
    pickCount: style === 'bss' ? defaultBssMeta.pickCount : 6,
    levelCap: style === 'bss' ? defaultBssMeta.levelCap : 100,
    mechanics,
    speedBenchmarks: style === 'bss' ? defaultBssMeta.speedBenchmarks : [],
  };

  const rankedMembers = team.members
    .map((member) => {
      const roleSummary = roles.find((entry) => entry.member === (member.name || member.species)) ?? {
        member: member.name || member.species,
        roles: [],
      };

      return {
        name: member.name || member.species,
        leadScore: scoreLead(member, roleSummary, dex),
        pickScore: scorePick(member, roleSummary, dex),
      };
    });

  const leadCandidates = [...rankedMembers]
    .sort((left, right) => right.leadScore - left.leadScore)
    .slice(0, Math.min(3, rankedMembers.length))
    .map((entry) => entry.name);

  const likelyPicks = [...rankedMembers]
    .sort((left, right) => right.pickScore - left.pickScore)
    .slice(0, Math.min(profile.pickCount, rankedMembers.length))
    .map((entry) => entry.name);

  const speedControlRating = getSpeedControlRating(speed.fastestBaseSpeed, speed.hasSpeedControl);
  const teraDependency = mechanics.tera ? getTeraDependency(team, roles, dex) : 'not-applicable';
  const priorityCount = team.members.filter((member) => hasTaggedMove(member.moves.map(normalize), priorityMoves)).length;
  const disruptionCount = team.members.filter((member) => hasTaggedMove(member.moves.map(normalize), disruptionMoves)).length;

  const legalPool = dex.listAvailableSpecies(team.format);
  const poolThreatNames = legalPool
    .filter((species) => species.bst >= 570 || Math.max(species.baseStats.atk, species.baseStats.spa) >= 125 || species.baseStats.spe >= 110)
    .slice(0, 60)
    .map((species) => species.name);

  const threatCandidates = Array.from(new Set([
    ...defaultBssMeta.topThreats.map((threat) => threat.species),
    ...poolThreatNames,
  ]));

  const threatSummaries = threatCandidates
    .map((species) => evaluateThreatPressure(species, team, dex, speed.hasSpeedControl))
    .filter((entry): entry is ThreatPressureSummary => Boolean(entry));

  const coverageScore = Math.round(
    threatSummaries.reduce((sum, threat) => {
      if (threat.pressure === 'low') return sum + 1;
      if (threat.pressure === 'moderate') return sum + 0.5;
      return sum;
    }, 0) / Math.max(1, threatSummaries.length) * 100,
  );

  const topPressureThreats = threatSummaries
    .filter((threat) => threat.pressure !== 'low')
    .sort((left, right) => {
      const rank = { high: 0, moderate: 1, low: 2 } as const;
      return rank[left.pressure] - rank[right.pressure] || left.species.localeCompare(right.species);
    })
    .slice(0, 5);

  const notes: string[] = [
    `Threat scoring includes ${legalPool.length} legal species from the active format, even when exact sets are unknown.`,
    `Active mechanics: ${[
      mechanics.tera ? 'Tera' : null,
      mechanics.mega ? 'Mega' : null,
      mechanics.dynamax ? 'Dynamax' : null,
      mechanics.zMoves ? 'Z-Moves' : null,
    ].filter(Boolean).join(', ') || 'none'}.`,
    ...mechanics.notes,
  ];

  for (const core of defaultBssMeta.commonCores) {
    if (core.members.every((member) => team.members.some((slot) => slot.species === member))) {
      notes.push(`Detected common BSS-style core: ${core.name}.`);
    }
  }

  if (priorityCount > 0) {
    notes.push(`Priority is present on ${priorityCount} slot(s), which helps short BSS endgames.`);
  }

  if (disruptionCount > 0) {
    notes.push(`Emergency disruption is present on ${disruptionCount} slot(s).`);
  }

  const threats: ThreatCoverageSummary = {
    poolSize: legalPool.length,
    consideredThreatCount: threatSummaries.length,
    coverageScore,
    topPressureThreats,
    notes,
  };

  const issues: TeamIssue[] = [];

  if (style === 'bss' && speedControlRating === 'poor') {
    issues.push({
      code: 'bss-speed-benchmark-low',
      severity: 'warning',
      summary: 'The team falls below common BSS speed benchmarks.',
      details: 'BSS teams usually want at least one strong speed-control piece or a naturally fast pick for the bring-3 phase.',
    });
  }

  if (style === 'bss' && coverageScore < 55) {
    issues.push({
      code: 'bss-threat-coverage-low',
      severity: 'warning',
      summary: 'The team looks exposed to several format threats.',
      details: 'Species-level threat scoring suggests too many legal threats pressure this structure even without exact set knowledge.',
      memberNames: topPressureThreats.map((threat) => threat.species),
    });
  }

  if (style === 'bss' && priorityCount === 0 && speedControlRating !== 'good') {
    issues.push({
      code: 'bss-emergency-control-low',
      severity: 'info',
      summary: 'The team lacks strong emergency speed or priority insurance.',
      details: 'In BSS, short bring-3 games are easier to stabilize when you have either real speed control or at least one strong priority user.',
    });
  }

  if (style === 'bss' && disruptionCount === 0) {
    issues.push({
      code: 'bss-disruption-low',
      severity: 'info',
      summary: 'The team has limited anti-setup disruption.',
      details: 'Taunt, Haze, Encore, phazing, or status utility can be very useful emergency tools in BSS.',
    });
  }

  if (style === 'bss' && !mechanics.tera && team.members.some((member) => member.teraType)) {
    issues.push({
      code: 'format-no-tera',
      severity: 'info',
      summary: 'This format does not use Terastallization.',
      details: 'Tera Type lines on imported sets do not represent an in-battle mechanic here.',
    });
  }

  if (style === 'bss' && teraDependency === 'high') {
    issues.push({
      code: 'bss-tera-dependency-high',
      severity: 'info',
      summary: 'The current structure appears somewhat Tera-dependent.',
      details: 'Several win lines rely on off-type Tera choices rather than stable baseline positioning.',
    });
  }

  return {
    profile,
    battlePlan: {
      leadCandidates,
      likelyPicks,
      speedControlRating,
      teraDependency,
      notes,
    },
    threats,
    issues,
  };
}
