import { createRequire } from 'node:module';

import type { FormatId, PokemonSet, Team, ValidationPort, ValidationResult, ValidationSetResult } from '@pokemon/domain';

import { resolveFormatForValidation } from './dex.js';
import { fromShowdownSet, toShowdownTeam } from './mappers.js';

const require = createRequire(import.meta.url);
const showdown = require('pokemon-showdown') as any;
const { TeamValidator, Dex } = showdown;

function toId(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeSetForValidation(set: PokemonSet): PokemonSet {
  const species = Dex.species.get(set.species);
  if (!species.exists) return set;

  const requiredItem = species.requiredItem ?? species.requiredItems?.[0];
  const battleOnlyBase = typeof species.battleOnly === 'string'
    ? species.battleOnly
    : Array.isArray(species.battleOnly)
      ? species.battleOnly[0]
      : undefined;
  const baseName = battleOnlyBase ?? species.baseSpecies;

  if (!requiredItem) {
    return set;
  }

  if (!baseName || toId(baseName) === toId(species.name)) {
    return {
      ...set,
      item: set.item ?? requiredItem,
    };
  }

  const baseSpecies = Dex.species.get(baseName);
  if (!baseSpecies.exists) {
    return {
      ...set,
      item: set.item ?? requiredItem,
    };
  }

  const knownAbilities = (Object.values(baseSpecies.abilities ?? {}) as string[]).filter(Boolean);
  const requestedAbility = String(set.ability ?? '').trim();
  const ability = requestedAbility && knownAbilities.some((name) => toId(name) === toId(requestedAbility))
    ? requestedAbility
    : knownAbilities[0] ?? requestedAbility;

  return {
    ...set,
    species: baseSpecies.name,
    item: requiredItem,
    ability,
  };
}

export class ShowdownValidationAdapter implements ValidationPort {
  validateSet(set: PokemonSet, format: FormatId): ValidationSetResult {
    try {
      const resolved = resolveFormatForValidation(format);
      const validator = TeamValidator.get(resolved.resolvedFormat);
      const normalized = normalizeSetForValidation(set);
      const showdownSet = {
        ...normalized,
        moves: [...normalized.moves],
        evs: normalized.evs ? { ...normalized.evs } : undefined,
        ivs: normalized.ivs ? { ...normalized.ivs } : undefined,
      };
      const problems = validator.validateSet(showdownSet as never, {}) ?? [];

      return {
        valid: problems.length === 0,
        errors: problems,
        warnings: resolved.warning ? [resolved.warning] : [],
        normalizedSet: fromShowdownSet(showdownSet),
      };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Unknown Showdown set validation error.'],
        warnings: [],
        normalizedSet: set,
      };
    }
  }

  validateTeam(team: Team, format: FormatId): ValidationResult {
    const workingFormat = format || team.format;
    const normalizedMembers = team.members.map((member) => normalizeSetForValidation(member));
    const showdownTeam = toShowdownTeam({
      ...team,
      members: normalizedMembers,
    });

    try {
      const resolved = resolveFormatForValidation(workingFormat);
      const validator = TeamValidator.get(resolved.resolvedFormat);
      const problems = validator.validateTeam(showdownTeam as never) ?? [];

      return {
        valid: problems.length === 0,
        errors: problems,
        warnings: resolved.warning ? [resolved.warning] : [],
        normalizedTeam: {
          ...team,
          format: workingFormat,
          members: showdownTeam.map(fromShowdownSet),
        },
      };
    } catch (error) {
      return {
        valid: false,
        errors: [error instanceof Error ? error.message : 'Unknown Showdown validation error.'],
        warnings: [],
        normalizedTeam: team,
      };
    }
  }
}
