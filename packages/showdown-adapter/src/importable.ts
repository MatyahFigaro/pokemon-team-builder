import { createRequire } from 'node:module';

import type { FormatId, Team, TeamCodecPort } from '@pokemon/domain';

import { fromShowdownSet, toShowdownTeam } from './mappers.js';

const require = createRequire(import.meta.url);
const showdown = require('pokemon-showdown') as typeof import('pokemon-showdown');
const { Teams } = showdown;

export class ShowdownTeamCodecAdapter implements TeamCodecPort {
  parseShowdown(teamText: string, format: FormatId = 'gen9ou'): Team {
    const parsed = Teams.import(teamText, true);
    if (!parsed) {
      throw new Error('Unable to parse Showdown team text.');
    }

    return {
      format,
      members: parsed.map(fromShowdownSet),
      source: 'showdown-import',
    };
  }

  exportShowdown(team: Team): string {
    return Teams.export(toShowdownTeam(team) as never).trim();
  }
}
