import type { FormatId, Team } from './team.js';

export interface MatchupRequest {
  format: FormatId;
  team: Team;
  opponent: Team;
  iterations: number;
}

export interface MatchupSummary {
  iterations: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  notes: string[];
}
