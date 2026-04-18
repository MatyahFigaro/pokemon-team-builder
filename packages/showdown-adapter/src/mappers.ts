import type { PokemonSet as DomainPokemonSet, Team } from '@pokemon/domain';

type ShowdownStats = Partial<Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>;

interface ShowdownPokemonSet {
  name?: string;
  species: string;
  item?: string;
  ability?: string;
  nature?: string;
  level?: number;
  gender?: string;
  teraType?: string;
  moves?: string[];
  evs?: ShowdownStats;
  ivs?: ShowdownStats;
}

export function fromShowdownSet(set: ShowdownPokemonSet): DomainPokemonSet {
  return {
    species: set.species,
    name: set.name,
    item: set.item,
    ability: set.ability,
    nature: set.nature,
    level: set.level,
    gender: set.gender,
    teraType: set.teraType,
    moves: set.moves ?? [],
    evs: set.evs,
    ivs: set.ivs,
  };
}

export function toShowdownSet(set: DomainPokemonSet): ShowdownPokemonSet {
  return {
    name: set.name,
    species: set.species,
    item: set.item,
    ability: set.ability,
    nature: set.nature,
    level: set.level,
    gender: set.gender,
    teraType: set.teraType,
    moves: [...set.moves],
    evs: set.evs,
    ivs: set.ivs,
  };
}

export function toShowdownTeam(team: Team): ShowdownPokemonSet[] {
  return team.members.map(toShowdownSet);
}
