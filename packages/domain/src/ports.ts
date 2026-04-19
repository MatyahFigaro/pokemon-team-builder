import type { MatchupRequest, MatchupSummary } from './battle.js';
import type { PokemonSet, Team, FormatId, StatsTable } from './team.js';

export interface SpeciesInfo {
  id: string;
  name: string;
  types: string[];
  baseStats: StatsTable;
  abilities: string[];
  tier?: string;
  bst: number;
}

export interface FormatMechanicsInfo {
  tera: boolean;
  mega: boolean;
  dynamax: boolean;
  zMoves: boolean;
  primary: 'tera' | 'mega' | 'dynamax' | 'z-moves' | 'none';
  notes: string[];
}

export interface BattleProfile extends SpeciesInfo {
  baseSpecies: string;
  ability: string;
  item?: string;
  isMega: boolean;
}

export interface SpeciesDexPort {
  getSpecies(name: string): SpeciesInfo | null;
  getBattleProfile(set: PokemonSet, format?: FormatId): BattleProfile | null;
  getFormatMechanics(format: FormatId): FormatMechanicsInfo;
  getMatchupMultiplier(attackingType: string, set: PokemonSet, format?: FormatId): number;
  listAvailableSpecies(format: FormatId): SpeciesInfo[];
  listTypes(): string[];
  getTypeEffectiveness(attackingType: string, defendingTypes: readonly string[]): number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalizedTeam?: Team;
}

export interface ValidationPort {
  validateTeam(team: Team, format: FormatId): Promise<ValidationResult> | ValidationResult;
}

export interface TeamCodecPort {
  parseShowdown(teamText: string, format?: FormatId): Team;
  exportShowdown(team: Team): string;
}

export interface SimulationPort {
  simulateMatchup(request: MatchupRequest): Promise<MatchupSummary>;
}
