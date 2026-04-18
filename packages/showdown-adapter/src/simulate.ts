import type { MatchupSummary, SimulationPort } from '@pokemon/domain';

export class ShowdownSimulationAdapter implements SimulationPort {
  async simulateMatchup(): Promise<MatchupSummary> {
    throw new Error('Simulation is intentionally left out of the MVP. Add it later behind this adapter.');
  }
}
