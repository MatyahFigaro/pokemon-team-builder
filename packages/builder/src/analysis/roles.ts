import type { PokemonSet, RoleSummary, SpeciesDexPort, Team, TeamRole } from '@pokemon/domain';

const hazardSetterMoves = new Set(['stealth rock', 'spikes', 'toxic spikes', 'sticky web']);
const hazardRemovalMoves = new Set(['defog', 'rapid spin', 'mortal spin', 'court change', 'tidy up']);
const pivotMoves = new Set(['u-turn', 'volt switch', 'flip turn', 'teleport', 'parting shot', 'baton pass']);
const setupMoves = new Set([
  'swords dance',
  'nasty plot',
  'dragon dance',
  'quiver dance',
  'calm mind',
  'bulk up',
  'shell smash',
  'agility',
  'iron defense',
  'trailblaze',
]);
const speedControlMoves = new Set(['tailwind', 'thunder wave', 'icy wind', 'trick room', 'electroweb']);
const clericMoves = new Set(['heal bell', 'aromatherapy', 'wish']);

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function getMoveInfos(set: PokemonSet, dex: SpeciesDexPort) {
  return set.moves
    .map((move) => dex.getMove(move))
    .filter((move): move is NonNullable<ReturnType<SpeciesDexPort['getMove']>> => Boolean(move));
}

function hasHazardSetterMove(set: PokemonSet, dex: SpeciesDexPort): boolean {
  return getMoveInfos(set, dex).some((move) => ['stealthrock', 'spikes', 'toxicspikes', 'stickyweb'].includes(normalize(move.sideCondition)));
}

function hasHazardRemovalMove(set: PokemonSet, dex: SpeciesDexPort): boolean {
  return getMoveInfos(set, dex).some((move) => hazardRemovalMoves.has(normalize(move.name)) || (move.shortDesc ?? '').toLowerCase().includes('hazards'));
}

function hasPivotMove(set: PokemonSet, dex: SpeciesDexPort): boolean {
  return getMoveInfos(set, dex).some((move) => Boolean(move.selfSwitch)) || set.moves.map(normalize).some((move) => pivotMoves.has(move));
}

function hasSetupMove(set: PokemonSet, dex: SpeciesDexPort): boolean {
  return getMoveInfos(set, dex).some((move) => {
    const boosts = Object.values(move.boosts ?? {});
    return boosts.some((value) => value > 0) && move.category === 'Status';
  }) || set.moves.map(normalize).some((move) => setupMoves.has(move));
}

function hasSpeedControlMove(set: PokemonSet, dex: SpeciesDexPort): boolean {
  return getMoveInfos(set, dex).some((move) => move.status === 'par' || speedControlMoves.has(normalize(move.name))) || set.moves.map(normalize).some((move) => speedControlMoves.has(move));
}

function hasClericMove(set: PokemonSet, dex: SpeciesDexPort): boolean {
  return getMoveInfos(set, dex).some((move) => clericMoves.has(normalize(move.name))) || set.moves.map(normalize).some((move) => clericMoves.has(move));
}

function getAbilityAdjustedOffense(stat: number, ability: string, item: string): number {
  const id = normalize(ability);
  const heldItem = normalize(item);

  if (id === 'huge power' || id === 'pure power') return stat * 2;
  if (id === 'gorilla tactics' || heldItem === 'choice band' || heldItem === 'choice specs') return stat * 1.5;
  if (['tough claws', 'adaptability', 'sheer force', 'supreme overlord', 'transistor', 'dragon\'s maw', 'fairy aura', 'dark aura'].includes(id)) return stat * 1.2;
  if (id === 'protosynthesis' || id === 'quark drive') return stat * 1.15;

  return stat;
}

export function detectRolesForSet(set: PokemonSet, dex: SpeciesDexPort, format?: string): TeamRole[] {
  const roles = new Set<TeamRole>();
  const moveIds = set.moves.map(normalize);
  const item = normalize(set.item);
  const profile = dex.getBattleProfile(set, format);

  if (hasHazardSetterMove(set, dex) || moveIds.some((move) => hazardSetterMoves.has(move))) roles.add('hazard-setter');
  if (hasHazardRemovalMove(set, dex)) roles.add('hazard-removal');
  if (hasPivotMove(set, dex)) roles.add('pivot');
  if (hasSetupMove(set, dex)) roles.add('setup-sweeper');
  if (hasSpeedControlMove(set, dex) || item === 'choice scarf') roles.add('speed-control');
  if (item === 'choice scarf') roles.add('scarfer');
  if (hasClericMove(set, dex)) roles.add('cleric');
  if (moveIds[0] === 'stealth rock' || moveIds[0] === 'spikes') roles.add('lead');

  if (profile) {
    const physicalPower = getAbilityAdjustedOffense(profile.baseStats.atk, profile.ability, set.item ?? '');
    const specialPower = getAbilityAdjustedOffense(profile.baseStats.spa, profile.ability, set.item ?? '');

    if (physicalPower >= specialPower) {
      roles.add('physical-attacker');
    } else {
      roles.add('special-attacker');
    }

    if (physicalPower >= 120 || specialPower >= 120) {
      roles.add('wallbreaker');
    }

    if (profile.baseStats.hp + profile.baseStats.def >= 190) {
      roles.add('physical-wall');
    }

    if (profile.baseStats.hp + profile.baseStats.spd >= 190) {
      roles.add('special-wall');
    }
  }

  return [...roles];
}

export function summarizeRoles(team: Team, dex: SpeciesDexPort): RoleSummary[] {
  return team.members.map((member) => ({
    member: member.name || member.species,
    roles: detectRolesForSet(member, dex, team.format),
  }));
}
