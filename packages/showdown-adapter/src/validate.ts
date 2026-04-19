import { createRequire } from 'node:module';

import type { FormatId, Team, ValidationPort, ValidationResult } from '@pokemon/domain';

import { resolveFormatForValidation } from './dex.js';
import { fromShowdownSet, toShowdownTeam } from './mappers.js';

const require = createRequire(import.meta.url);
const showdown = require('pokemon-showdown') as any;
const { TeamValidator } = showdown;

export class ShowdownValidationAdapter implements ValidationPort {
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
