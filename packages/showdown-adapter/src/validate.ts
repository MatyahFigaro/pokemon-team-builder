import { createRequire } from 'node:module';

import type { FormatId, PokemonSet, Team, ValidationPort, ValidationResult, ValidationSetResult } from '@pokemon/domain';

import { resolveFormatForValidation } from './dex.js';
import { fromShowdownSet, toShowdownTeam } from './mappers.js';

const require = createRequire(import.meta.url);
const showdown = require('pokemon-showdown') as any;
const { TeamValidator } = showdown;

export class ShowdownValidationAdapter implements ValidationPort {
  validateSet(set: PokemonSet, format: FormatId): ValidationSetResult {
    try {
      const resolved = resolveFormatForValidation(format);
      const validator = TeamValidator.get(resolved.resolvedFormat);
      const showdownSet = {
        ...set,
        moves: [...set.moves],
        evs: set.evs ? { ...set.evs } : undefined,
        ivs: set.ivs ? { ...set.ivs } : undefined,
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
    const showdownTeam = toShowdownTeam(team);

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
