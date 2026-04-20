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
  requiredItem?: string;
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

export interface MoveInfo {
  id: string;
  name: string;
  type: string;
  category: string;
  priority: number;
  basePower?: number;
  target?: string;
  flags: string[];
  shortDesc?: string;
  selfSwitch?: boolean | string;
  sideCondition?: string;
  status?: string;
  volatileStatus?: string;
  boosts?: Record<string, number>;
}

export interface AbilityInfo {
  id: string;
  name: string;
  shortDesc?: string;
  desc?: string;
  rating?: number;
}

export interface ItemInfo {
  id: string;
  name: string;
  shortDesc?: string;
  desc?: string;
  megaStone?: string;
  megaEvolves?: string;
}

export interface SpeciesDexPort {
  getSpecies(name: string): SpeciesInfo | null;
  getMove(name: string): MoveInfo | null;
  getAbility(name: string): AbilityInfo | null;
  getItem(name: string): ItemInfo | null;
  getBattleProfile(set: PokemonSet, format?: FormatId): BattleProfile | null;
  getFormatMechanics(format: FormatId): FormatMechanicsInfo;
  getMatchupMultiplier(attackingType: string, set: PokemonSet, format?: FormatId): number;
  canLearnMove(speciesName: string, moveName: string): boolean;
  getLearnableMoves(speciesName: string): MoveInfo[];
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

export interface ValidationSetResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalizedSet?: PokemonSet;
}

export interface ValidationPort {
  validateTeam(team: Team, format: FormatId): Promise<ValidationResult> | ValidationResult;
  validateSet(set: PokemonSet, format: FormatId): Promise<ValidationSetResult> | ValidationSetResult;
}

export interface TeamCodecPort {
  parseShowdown(teamText: string, format?: FormatId): Team;
  exportShowdown(team: Team): string;
}

export interface SimulationPort {
  simulateMatchup(request: MatchupRequest): Promise<MatchupSummary>;
  simulateMatchups?(requests: MatchupRequest[], options?: { concurrency?: number }): Promise<MatchupSummary[]>;
}
