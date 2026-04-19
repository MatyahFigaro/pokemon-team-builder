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

function isChampionsLikeFormat(format: FormatId): boolean {
  return toId(format).includes('champions');
}

function normalizeEvsForFormat(evs: PokemonSet['evs'] | undefined, format: FormatId): PokemonSet['evs'] | undefined {
  if (!evs) return undefined;
  if (!isChampionsLikeFormat(format)) return evs;

  const values = Object.values(evs).filter((value): value is number => typeof value === 'number' && value > 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  const needsConversion = values.some((value) => value > 32) || total > 66;
  if (!needsConversion) return evs;

  const converted: NonNullable<PokemonSet['evs']> = {};
  for (const [stat, value] of Object.entries(evs) as Array<[keyof NonNullable<PokemonSet['evs']>, number | undefined]>) {
    if (!value || value <= 0) continue;
    converted[stat] = Math.min(32, Math.max(2, Math.round(value / 8)));
  }

  let convertedTotal = Object.values(converted).reduce((sum, value) => sum + (value ?? 0), 0);
  const statOrder: Array<keyof NonNullable<PokemonSet['evs']>> = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

  while (convertedTotal > 66) {
    const nextStat = statOrder.find((stat) => (converted[stat] ?? 0) > 0);
    if (!nextStat) break;
    converted[nextStat] = Math.max(0, (converted[nextStat] ?? 0) - 1);
    convertedTotal -= 1;
  }

  return converted;
}

function normalizeSetForValidation(set: PokemonSet, format: FormatId): PokemonSet {
  const species = Dex.species.get(set.species);
  if (!species.exists) return set;

  const normalizedBase: PokemonSet = {
    ...set,
    evs: normalizeEvsForFormat(set.evs, format),
  };

  const requiredItem = species.requiredItem ?? species.requiredItems?.[0];
  const battleOnlyBase = typeof species.battleOnly === 'string'
    ? species.battleOnly
    : Array.isArray(species.battleOnly)
      ? species.battleOnly[0]
      : undefined;
  const baseName = battleOnlyBase ?? species.baseSpecies;

  if (!requiredItem) {
    return normalizedBase;
  }

  if (!baseName || toId(baseName) === toId(species.name)) {
    return {
      ...normalizedBase,
      item: normalizedBase.item ?? requiredItem,
    };
  }

  const baseSpecies = Dex.species.get(baseName);
  if (!baseSpecies.exists) {
    return {
      ...normalizedBase,
      item: normalizedBase.item ?? requiredItem,
    };
  }

  const knownAbilities = (Object.values(baseSpecies.abilities ?? {}) as string[]).filter(Boolean);
  const requestedAbility = String(normalizedBase.ability ?? '').trim();
  const ability = requestedAbility && knownAbilities.some((name) => toId(name) === toId(requestedAbility))
    ? requestedAbility
    : knownAbilities[0] ?? requestedAbility;

  return {
    ...normalizedBase,
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
      const normalized = normalizeSetForValidation(set, format);
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
    const normalizedMembers = team.members.map((member) => normalizeSetForValidation(member, workingFormat));
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
