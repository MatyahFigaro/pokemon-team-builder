import type { SpeciesDexPort, Team, ValidationPort } from '@pokemon/domain';
import { getTopUsageNames, getTopUsageThreatNames, getUsageAnalyticsForFormat, listManualBenchmarkTeams, type UsageSpeciesRecord } from '@pokemon/storage';

import { getCompetitiveSet, type PreviewRoleHint } from '../suggest/legal-preview.js';

type BenchmarkStyle = 'balance' | 'hyper-offense' | 'bulky-offense' | 'stall' | 'trick-room' | 'rain' | 'sun' | 'sand';

interface BuildStrongThreatSimulationOptions {
  maxTeams?: number | 'all';
  roleHintResolver?: (speciesName: string, style?: BenchmarkStyle) => PreviewRoleHint;
}

const FALLBACK_BENCHMARK_SHELLS: string[][] = [
  ['Dragonite', 'Gholdengo', 'Kingambit', 'Garchomp', 'Primarina', 'Volcarona'],
  ['Great Tusk', 'Gholdengo', 'Dragonite', 'Kingambit', 'Primarina', 'Iron Valiant'],
  ['Torkoal', 'Hatterene', 'Primarina', 'Kingambit', 'Dragonite', 'Ursaluna'],
  ['Pelipper', 'Barraskewda', 'Gholdengo', 'Dragonite', 'Rillaboom', 'Kingambit'],
  ['Garganacl', 'Corviknight', 'Primarina', 'Gholdengo', 'Dragonite', 'Kingambit'],
];

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function toId(value: string | undefined): string {
  return normalize(value).replace(/[^a-z0-9]/g, '');
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function isBssLikeFormat(format: string): boolean {
  const id = toId(format);
  return id.includes('bss') || id.includes('battlestadium') || id.includes('championsbss');
}

function getDefaultRoleHint(speciesName: string, dex: SpeciesDexPort, style?: BenchmarkStyle): PreviewRoleHint {
  const species = dex.getSpecies(speciesName);
  if (!species) return 'default';

  const abilityIds = species.abilities.map(toId);

  if (style === 'rain' && (species.types.includes('Water') || abilityIds.some((id) => id === 'drizzle' || id === 'swiftswim'))) return 'offense';
  if (style === 'sun' && (species.types.includes('Fire') || species.types.includes('Grass') || abilityIds.some((id) => id === 'drought' || id === 'chlorophyll' || id === 'solarpower' || id === 'protosynthesis'))) return 'offense';
  if (style === 'trick-room' || species.baseStats.spe <= 70) return 'bulky';
  if (species.baseStats.spe >= 100 || Math.max(species.baseStats.atk, species.baseStats.spa) >= 120) return 'offense';
  if (species.baseStats.hp + Math.max(species.baseStats.def, species.baseStats.spd) >= 190) return 'bulky';

  return 'default';
}

function buildUsageTeammateMap(records: UsageSpeciesRecord[] | undefined): Map<string, string[]> {
  return new Map((records ?? []).map((entry) => [
    toId(entry.species),
    getTopUsageNames(entry.teammates, 4),
  ]));
}

function expandUsageShell(
  anchor: string,
  teammateMap: Map<string, string[]>,
  topPool: string[],
  targetSize: number,
): string[] {
  const lineup: string[] = [];
  const queue: string[] = [];

  const add = (speciesName: string) => {
    if (!speciesName || lineup.some((candidate) => toId(candidate) === toId(speciesName))) return;
    lineup.push(speciesName);
    queue.push(speciesName);
  };

  add(anchor);

  while (queue.length > 0 && lineup.length < targetSize) {
    const current = queue.shift() ?? '';
    const preferred = uniqueStrings([...(teammateMap.get(toId(current)) ?? []), ...topPool]);

    for (const candidate of preferred) {
      add(candidate);
      if (lineup.length >= targetSize) break;
    }
  }

  for (const candidate of topPool) {
    add(candidate);
    if (lineup.length >= targetSize) break;
  }

  return lineup.slice(0, targetSize);
}

function inferBenchmarkStyle(lineup: string[], dex: SpeciesDexPort): BenchmarkStyle | undefined {
  let fastCount = 0;
  let bulkyCount = 0;
  let waterCount = 0;
  let fireGrassSunCount = 0;
  let trickRoomLean = 0;

  for (const speciesName of lineup) {
    const species = dex.getSpecies(speciesName);
    if (!species) continue;

    const abilityIds = species.abilities.map(toId);
    if (species.baseStats.spe >= 100) fastCount += 1;
    if (species.baseStats.hp + Math.max(species.baseStats.def, species.baseStats.spd) >= 190) bulkyCount += 1;
    if (species.types.includes('Water') || abilityIds.some((id) => id === 'drizzle' || id === 'swiftswim')) waterCount += 1;
    if (species.types.includes('Fire') || species.types.includes('Grass') || abilityIds.some((id) => id === 'drought' || id === 'chlorophyll' || id === 'protosynthesis')) fireGrassSunCount += 1;
    if (species.baseStats.spe <= 70) trickRoomLean += 1;
  }

  if (waterCount >= 3) return 'rain';
  if (fireGrassSunCount >= 3) return 'sun';
  if (trickRoomLean >= 4) return 'trick-room';
  if (fastCount >= 4 && bulkyCount <= 2) return 'hyper-offense';
  if (bulkyCount >= 4) return 'bulky-offense';
  return 'balance';
}

export function buildStrongThreatSimulationTeams(
  format: string,
  dex: SpeciesDexPort,
  validator: ValidationPort,
  options: BuildStrongThreatSimulationOptions = {},
): Team[] {
  const maxTeams = options.maxTeams === 'all'
    ? Number.POSITIVE_INFINITY
    : Math.max(1, Math.floor(options.maxTeams ?? 1));
  const manualTeams = listManualBenchmarkTeams({ format })
    .slice(0, maxTeams)
    .map((record) => ({
      ...record.team,
      format,
      source: 'manual-benchmark' as const,
    }));

  if (manualTeams.length > 0) {
    return manualTeams;
  }

  const snapshot = getUsageAnalyticsForFormat(format);
  const topPool = uniqueStrings(
    snapshot?.species?.length
      ? snapshot.species.slice(0, 16).map((entry) => entry.species)
      : getTopUsageThreatNames(format, 16),
  );
  const teammateMap = buildUsageTeammateMap(snapshot?.species);
  const targetSize = 6;

  const seedAnchors = uniqueStrings([
    ...(snapshot?.species.slice(0, Math.max(6, maxTeams * 2)).map((entry) => entry.species) ?? []),
    ...(snapshot?.species.slice(0, 3).flatMap((entry) => getTopUsageNames(entry.teammates, 2)) ?? []),
    ...topPool.slice(0, maxTeams + 1),
  ]);

  const rawLineups = [
    ...seedAnchors.map((anchor) => expandUsageShell(anchor, teammateMap, topPool, targetSize)),
    topPool.slice(0, targetSize),
    ...FALLBACK_BENCHMARK_SHELLS,
  ];

  return rawLineups
    .map((lineup) => uniqueStrings(lineup))
    .filter((lineup) => lineup.length >= 3)
    .filter((lineup, index, array) => array.findIndex((candidate) => candidate.map(toId).join('|') === lineup.map(toId).join('|')) === index)
    .map((lineup) => {
      const style = inferBenchmarkStyle(lineup, dex);
      const roleHintResolver = options.roleHintResolver ?? ((speciesName: string, currentStyle?: BenchmarkStyle) => getDefaultRoleHint(speciesName, dex, currentStyle));

      return {
        format,
        source: 'generated' as const,
        members: lineup
          .map((speciesName) => getCompetitiveSet(speciesName, format, dex, validator, {
            roleHint: roleHintResolver(speciesName, style),
            style,
          }))
          .filter((set): set is NonNullable<typeof set> => Boolean(set))
          .slice(0, targetSize),
      } satisfies Team;
    })
    .filter((candidate) => candidate.members.length >= 3)
    .slice(0, maxTeams);
}
