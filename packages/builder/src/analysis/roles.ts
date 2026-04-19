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

  if (moveIds.some((move) => hazardSetterMoves.has(move))) roles.add('hazard-setter');
  if (moveIds.some((move) => hazardRemovalMoves.has(move))) roles.add('hazard-removal');
  if (moveIds.some((move) => pivotMoves.has(move))) roles.add('pivot');
  if (moveIds.some((move) => setupMoves.has(move))) roles.add('setup-sweeper');
  if (moveIds.some((move) => speedControlMoves.has(move)) || item === 'choice scarf') roles.add('speed-control');
  if (item === 'choice scarf') roles.add('scarfer');
  if (moveIds.some((move) => clericMoves.has(move))) roles.add('cleric');
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
