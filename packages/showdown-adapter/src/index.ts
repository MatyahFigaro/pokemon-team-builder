import { ShowdownDexAdapter } from './dex.js';
import { ShowdownTeamCodecAdapter } from './importable.js';
import { ShowdownSimulationAdapter } from './simulate.js';
import { ShowdownValidationAdapter } from './validate.js';

export * from './dex.js';
export * from './importable.js';
export * from './simulate.js';
export * from './validate.js';

export function createShowdownPorts() {
  return {
    dex: new ShowdownDexAdapter(),
    codec: new ShowdownTeamCodecAdapter(),
    validator: new ShowdownValidationAdapter(),
    simulator: new ShowdownSimulationAdapter(),
  };
}
