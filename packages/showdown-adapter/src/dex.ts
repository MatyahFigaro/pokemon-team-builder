import { createRequire } from 'node:module';

import type { SpeciesDexPort, SpeciesInfo } from '@pokemon/domain';

const require = createRequire(import.meta.url);
const showdown = require('pokemon-showdown') as typeof import('pokemon-showdown');
const { Dex } = showdown;

void Dex.includeData();

const ALL_TYPES = [
  'Normal',
  'Fire',
  'Water',
  'Electric',
  'Grass',
  'Ice',
  'Fighting',
  'Poison',
  'Ground',
  'Flying',
  'Psychic',
  'Bug',
  'Rock',
  'Ghost',
  'Dragon',
  'Dark',
  'Steel',
  'Fairy',
];

export class ShowdownDexAdapter implements SpeciesDexPort {
  getSpecies(name: string): SpeciesInfo | null {
    const species = Dex.species.get(name);
    if (!species.exists) return null;

    const baseStats = {
      hp: species.baseStats.hp,
      atk: species.baseStats.atk,
      def: species.baseStats.def,
      spa: species.baseStats.spa,
      spd: species.baseStats.spd,
      spe: species.baseStats.spe,
    };

    return {
      id: species.id,
      name: species.name,
      types: [...species.types],
      baseStats,
      abilities: Object.values(species.abilities ?? {}).filter(Boolean),
      tier: species.tier,
      bst: Object.values(baseStats).reduce((sum, value) => sum + value, 0),
    };
  }

  listTypes(): string[] {
    return [...ALL_TYPES];
  }

  getTypeEffectiveness(attackingType: string, defendingTypes: readonly string[]): number {
    const defense = [...defendingTypes];

    if (!Dex.getImmunity(attackingType, defense)) {
      return 0;
    }

    const effectiveness = Dex.getEffectiveness(attackingType, defense);
    return Math.pow(2, effectiveness);
  }
}
