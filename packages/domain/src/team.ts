export type FormatId = string;
export type PokemonType = string;
export type StatId = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';

export interface StatsTable {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export type TeamRole =
  | 'lead'
  | 'pivot'
  | 'wallbreaker'
  | 'physical-attacker'
  | 'special-attacker'
  | 'physical-wall'
  | 'special-wall'
  | 'hazard-setter'
  | 'hazard-removal'
  | 'speed-control'
  | 'setup-sweeper'
  | 'cleric'
  | 'scarfer';

export interface PokemonSet {
  species: string;
  name?: string;
  item?: string;
  ability?: string;
  nature?: string;
  level?: number;
  gender?: string;
  teraType?: string;
  moves: string[];
  evs?: Partial<StatsTable>;
  ivs?: Partial<StatsTable>;
  roles?: TeamRole[];
}

export interface Team {
  format: FormatId;
  members: PokemonSet[];
  source?: 'showdown-import' | 'manual' | 'generated' | 'manual-benchmark';
  notes?: string[];
}
