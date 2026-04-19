import type { PokemonSet, RoleSummary, SpeciesDexPort, Team, TeamRole } from '@pokemon/domain';

type ResolvedMoveInfo = Exclude<ReturnType<SpeciesDexPort['getMove']>, null>;

const fallbackHazardSetterMoves = new Set(['stealth rock', 'spikes', 'toxic spikes', 'sticky web']);
const fallbackClericMoves = new Set(['heal bell', 'aromatherapy', 'wish']);

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function getMoveInfos(set: PokemonSet, dex: SpeciesDexPort): ResolvedMoveInfo[] {
  return set.moves
    .map((move) => dex.getMove(move))
    .filter((move): move is ResolvedMoveInfo => Boolean(move));
}

function isHazardSetterMoveInfo(move: ResolvedMoveInfo): boolean {
  return ['stealthrock', 'spikes', 'toxicspikes', 'stickyweb'].includes(normalize(move.sideCondition));
}

function isHazardRemovalMoveInfo(move: ResolvedMoveInfo): boolean {
  const desc = (move.shortDesc ?? '').toLowerCase();
  return desc.includes('hazards') || desc.includes('spikes') || move.id === 'courtchange' || move.id === 'tidyup';
}

function isPivotMoveInfo(move: ResolvedMoveInfo): boolean {
  const desc = (move.shortDesc ?? '').toLowerCase();
  return Boolean(move.selfSwitch) || desc.includes('switches out') || move.id === 'batonpass';
}

function isSetupMoveInfo(move: ResolvedMoveInfo): boolean {
  const boosts = Object.entries(move.boosts ?? {});
  const hasPositiveBoost = boosts.some(([, value]) => value > 0);
  const desc = (move.shortDesc ?? '').toLowerCase();

  return (hasPositiveBoost && (move.category === 'Status' || move.target === 'self'))
    || desc.includes("raises the user's attack")
    || desc.includes("raises the user's special attack")
    || desc.includes("raises the user's sp. atk")
    || desc.includes("raises the user's speed")
    || desc.includes("raises the user's defense")
    || desc.includes("raises the user's sp. def");
}

function isSpeedControlMoveInfo(move: ResolvedMoveInfo): boolean {
  const desc = (move.shortDesc ?? '').toLowerCase();
  return move.status === 'par'
    || move.id === 'tailwind'
    || move.id === 'trickroom'
    || move.id === 'electroweb'
    || move.id === 'icywind'
    || desc.includes("lowers the target's speed")
    || desc.includes('paralyzes the target')
    || desc.includes('slower pokemon move first')
    || desc.includes("the user's side's speed is doubled");
}

function isClericMoveInfo(move: ResolvedMoveInfo): boolean {
  const desc = (move.shortDesc ?? '').toLowerCase();
  return fallbackClericMoves.has(normalize(move.name))
    || desc.includes("cures the user's party")
    || desc.includes('replacement');
}

function hasHazardSetterMove(set: PokemonSet, dex: SpeciesDexPort): boolean {
  return getMoveInfos(set, dex).some(isHazardSetterMoveInfo);
}

function hasHazardRemovalMove(set: PokemonSet, dex: SpeciesDexPort): boolean {
  return getMoveInfos(set, dex).some(isHazardRemovalMoveInfo);
}

function hasPivotMove(set: PokemonSet, dex: SpeciesDexPort): boolean {
  return getMoveInfos(set, dex).some(isPivotMoveInfo);
}

function hasSetupMove(set: PokemonSet, dex: SpeciesDexPort): boolean {
  return getMoveInfos(set, dex).some(isSetupMoveInfo);
}

function hasSpeedControlMove(set: PokemonSet, dex: SpeciesDexPort): boolean {
  return getMoveInfos(set, dex).some(isSpeedControlMoveInfo);
}

function hasClericMove(set: PokemonSet, dex: SpeciesDexPort): boolean {
  return getMoveInfos(set, dex).some(isClericMoveInfo);
}

function getAbilityAdjustedOffense(stat: number, ability: string, item: string, dex: SpeciesDexPort): number {
  const heldItem = normalize(item);
  const abilityText = `${dex.getAbility(ability)?.shortDesc ?? ''} ${dex.getAbility(ability)?.desc ?? ''}`.toLowerCase();

  if (abilityText.includes('attack is doubled') || abilityText.includes('special attack is doubled')) return stat * 2;
  if (heldItem === 'choice band' || heldItem === 'choice specs' || abilityText.includes('offensive stat is multiplied by 1.5') || abilityText.includes('power multiplied by 1.5')) return stat * 1.5;
  if (abilityText.includes('power multiplied by 1.3') || abilityText.includes('power multiplied by 1.33')) return stat * 1.2;
  if (abilityText.includes('attack is raised by 1 stage') || abilityText.includes('special attack is raised by 1 stage') || abilityText.includes('raises its attack by 1 stage') || abilityText.includes('raises its special attack by 1 stage')) return stat * 1.15;

  return stat;
}

export function detectRolesForSet(set: PokemonSet, dex: SpeciesDexPort, format?: string): TeamRole[] {
  const roles = new Set<TeamRole>();
  const moveIds = set.moves.map(normalize);
  const item = normalize(set.item);
  const profile = dex.getBattleProfile(set, format);

  if (hasHazardSetterMove(set, dex) || moveIds.some((move) => fallbackHazardSetterMoves.has(move))) roles.add('hazard-setter');
  if (hasHazardRemovalMove(set, dex)) roles.add('hazard-removal');
  if (hasPivotMove(set, dex)) roles.add('pivot');
  if (hasSetupMove(set, dex)) roles.add('setup-sweeper');
  if (hasSpeedControlMove(set, dex) || item === 'choice scarf') roles.add('speed-control');
  if (item === 'choice scarf') roles.add('scarfer');
  if (hasClericMove(set, dex)) roles.add('cleric');
  if (moveIds[0] === 'stealth rock' || moveIds[0] === 'spikes') roles.add('lead');

  if (profile) {
    const physicalPower = getAbilityAdjustedOffense(profile.baseStats.atk, profile.ability, set.item ?? '', dex);
    const specialPower = getAbilityAdjustedOffense(profile.baseStats.spa, profile.ability, set.item ?? '', dex);

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
