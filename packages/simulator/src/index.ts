export interface BatchSimulationOptions {
  iterations: number;
  concurrency?: number;
}

export interface MatchupAggregate {
  label: string;
  winRate: number;
}
