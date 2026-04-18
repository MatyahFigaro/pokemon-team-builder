import type { PokemonSet, RoleSummary, SpeciesDexPort, TeamRole } from '@pokemon/domain';

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

export function detectRolesForSet(set: PokemonSet, dex: SpeciesDexPort): TeamRole[] {
  const roles = new Set<TeamRole>();
  const moveIds = set.moves.map(normalize);
  const item = normalize(set.item);
  const species = dex.getSpecies(set.species);

  if (moveIds.some((move) => hazardSetterMoves.has(move))) roles.add('hazard-setter');
  if (moveIds.some((move) => hazardRemovalMoves.has(move))) roles.add('hazard-removal');
  if (moveIds.some((move) => pivotMoves.has(move))) roles.add('pivot');
  if (moveIds.some((move) => setupMoves.has(move))) roles.add('setup-sweeper');
  if (moveIds.some((move) => speedControlMoves.has(move)) || item === 'choice scarf') roles.add('speed-control');
  if (item === 'choice scarf') roles.add('scarfer');
  if (moveIds.some((move) => clericMoves.has(move))) roles.add('cleric');
  if (moveIds[0] === 'stealth rock' || moveIds[0] === 'spikes') roles.add('lead');

  if (species) {
    if (species.baseStats.atk >= species.baseStats.spa) {
      roles.add('physical-attacker');
    } else {
      roles.add('special-attacker');
    }

    if (species.baseStats.atk >= 120 || species.baseStats.spa >= 120) {
      roles.add('wallbreaker');
    }

    if (species.baseStats.hp + species.baseStats.def >= 190) {
      roles.add('physical-wall');
    }

    if (species.baseStats.hp + species.baseStats.spd >= 190) {
      roles.add('special-wall');
    }
  }

  return [...roles];
}

export function summarizeRoles(team: { members: PokemonSet[] }, dex: SpeciesDexPort): RoleSummary[] {
  return team.members.map((member) => ({
    member: member.name || member.species,
    roles: detectRolesForSet(member, dex),
  }));
}
