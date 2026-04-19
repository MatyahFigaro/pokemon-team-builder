import { createRequire } from 'node:module';

import type { SpeciesDexPort, SpeciesInfo } from '@pokemon/domain';

const require = createRequire(import.meta.url);
const showdown = require('pokemon-showdown') as any;
const { Dex } = showdown;


void Dex.includeModData();

const ALL_TYPES = [
  'Normal',
  'Fire',
  'Water',
  'Electric',
  'Grass',
  'Ice',
  'Fighting',
  'Poison',
  'Ground',
  'Flying',
  'Psychic',
  'Bug',
  'Rock',
  'Ghost',
  'Dragon',
  'Dark',
  'Steel',
  'Fairy',
];

export interface ShowdownFormatInfo {
  id: string;
  name: string;
  section: string;
  searchShow: boolean;
  challengeShow: boolean;
  tournamentShow: boolean;
}

export interface ListFormatsOptions {
  query?: string;
  onlySearch?: boolean;
  onlyChallenge?: boolean;
}

export interface ListPokemonOptions {
  format: string;
  query?: string;
  limit?: number;
}

export interface FormatPokemonInfo {
  id: string;
  name: string;
  types: string[];
  tier?: string;
}

export interface FormatPokemonListResult {
  requestedFormat: string;
  resolvedFormat: string;
  total: number;
  warning?: string;
  pokemon: FormatPokemonInfo[];
}

interface ShowdownFormatWithAliases extends ShowdownFormatInfo {
  aliases: string[];
}

const FALLBACK_CHAMPIONS_FORMATS: ShowdownFormatInfo[] = [
  {
    id: 'gen9championsou',
    name: '[Gen 9 Champions] OU',
    section: 'Champions',
    searchShow: true,
    challengeShow: true,
    tournamentShow: true,
  },
  {
    id: 'gen9championsbssregma',
    name: '[Gen 9 Champions] BSS Reg M-A',
    section: 'Champions',
    searchShow: true,
    challengeShow: true,
    tournamentShow: true,
  },
  {
    id: 'gen9championsvgc2026regma',
    name: '[Gen 9 Champions] VGC 2026 Reg M-A',
    section: 'Champions',
    searchShow: true,
    challengeShow: true,
    tournamentShow: true,
  },
  {
    id: 'gen9championsvgc2026regmabo3',
    name: '[Gen 9 Champions] VGC 2026 Reg M-A (Bo3)',
    section: 'Champions',
    searchShow: true,
    challengeShow: true,
    tournamentShow: true,
  },
  {
    id: 'gen9championscustomgame',
    name: '[Gen 9 Champions] Custom Game',
    section: 'Champions',
    searchShow: false,
    challengeShow: true,
    tournamentShow: true,
  },
  {
    id: 'gen9championsdraft',
    name: '[Gen 9 Champions] Draft',
    section: 'Champions',
    searchShow: false,
    challengeShow: true,
    tournamentShow: true,
  },
];

const FORMAT_VALIDATION_FALLBACKS: Record<string, {resolvedFormat: string; warning: string}> = {
  gen9championsou: {
    resolvedFormat: 'gen9ou',
    warning: 'Exact Champions rules are not available in the installed Showdown package; using gen9ou for legality checks.',
  },
  gen9championsbssregma: {
    resolvedFormat: 'gen9bssregg',
    warning: 'Exact Champions BSS rules are not available in the installed Showdown package; using gen9bssregg for legality checks.',
  },
  gen9championsvgc2026regma: {
    resolvedFormat: 'gen9vgc2025regg',
    warning: 'Exact Champions VGC rules are not available in the installed Showdown package; using gen9vgc2025regg for legality checks.',
  },
  gen9championsvgc2026regmabo3: {
    resolvedFormat: 'gen9vgc2025reggbo3',
    warning: 'Exact Champions VGC Bo3 rules are not available in the installed Showdown package; using gen9vgc2025reggbo3 for legality checks.',
  },
  gen9championscustomgame: {
    resolvedFormat: 'gen9customgame',
    warning: 'Exact Champions Custom Game rules are not available in the installed Showdown package; using gen9customgame for legality checks.',
  },
};

const legalPokemonCache = new Map<string, FormatPokemonInfo[]>();

function buildAliases(format: { id: string; name: string; section?: string | null }): string[] {
  const haystack = `${format.id} ${format.name} ${format.section ?? ''}`.toLowerCase();
  const aliases: string[] = [];

  if (haystack.includes('bss')) {
    aliases.push('battle stadium singles');
  }

  if (haystack.includes('vgc')) {
    aliases.push('battle stadium doubles');
  }

  if (haystack.includes('reg')) {
    aliases.push('regulation');
  }

  return aliases;
}

export function listShowdownFormats(options: ListFormatsOptions = {}): ShowdownFormatInfo[] {
  const needle = options.query?.trim().toLowerCase();

  const runtimeFormats: ShowdownFormatInfo[] = (Dex.formats.all() as any[])
    .filter((format: any) => format.effectType === 'Format' && format.exists)
    .filter((format: any) => format.searchShow || format.challengeShow || format.tournamentShow)
    .map((format: any) => ({
      id: format.id,
      name: format.name,
      section: format.section ?? 'Other',
      searchShow: Boolean(format.searchShow),
      challengeShow: Boolean(format.challengeShow),
      tournamentShow: Boolean(format.tournamentShow),
    }));

  const hasChampionsSection = runtimeFormats.some(
    (format: ShowdownFormatInfo) => format.section === 'Champions' || format.name.toLowerCase().includes('champions'),
  );

  const mergedFormats = hasChampionsSection
    ? runtimeFormats
    : [...runtimeFormats, ...FALLBACK_CHAMPIONS_FORMATS];

  return mergedFormats
    .map((format: ShowdownFormatInfo) => ({
      ...format,
      aliases: buildAliases(format),
    }))
    .filter((format: ShowdownFormatWithAliases) => {
      if (options.onlySearch && !format.searchShow) return false;
      if (options.onlyChallenge && !format.challengeShow) return false;
      if (!needle) return true;

      return [format.id, format.name, format.section, ...format.aliases]
        .some((value: string) => value.toLowerCase().includes(needle));
    })
    .map(({ aliases: _aliases, ...format }: ShowdownFormatWithAliases) => format)
    .sort((left: ShowdownFormatInfo, right: ShowdownFormatInfo) => left.section.localeCompare(right.section) || left.name.localeCompare(right.name));
}

export function resolveFormatForValidation(formatId: string): {
  requestedFormat: string;
  resolvedFormat: string;
  warning?: string;
} {
  const direct = Dex.formats.get(formatId);
  if (direct.exists && direct.effectType === 'Format') {
    return {
      requestedFormat: formatId,
      resolvedFormat: direct.id,
    };
  }

  const fallback = FORMAT_VALIDATION_FALLBACKS[formatId];
  if (!fallback) {
    throw new Error(`Format ${formatId} is not available for legality checks in the installed Showdown package.`);
  }

  const resolved = Dex.formats.get(fallback.resolvedFormat);
  if (!resolved.exists || resolved.effectType !== 'Format') {
    throw new Error(`Fallback format ${fallback.resolvedFormat} is unavailable.`);
  }

  return {
    requestedFormat: formatId,
    resolvedFormat: resolved.id,
    warning: fallback.warning,
  };
}

function getProbeMoves(dex: any, species: any): string[] {
  const preferredMoves = ['protect', 'earthquake', 'thunderbolt', 'shadowball', 'moonblast', 'closecombat', 'tackle'];
  const learnsetData = dex.species.getLearnsetData(species.id) as { learnset?: Record<string, unknown> } | null;
  const learnset: string[] = Object.keys(learnsetData?.learnset ?? {});

  const chosenMoveId = preferredMoves.find((moveId) => learnset.includes(moveId)) ?? learnset[0];
  if (!chosenMoveId) return [];

  const move = dex.moves.get(chosenMoveId);
  return [move.exists ? move.name : chosenMoveId];
}

export function listPokemonForFormat(options: ListPokemonOptions): FormatPokemonListResult {
  const resolved = resolveFormatForValidation(options.format);
  const query = options.query?.trim().toLowerCase();
  const limit = Math.max(1, options.limit ?? 50);
  const format = Dex.formats.get(resolved.resolvedFormat);
  const dex = Dex.forFormat(format);
  const validator = showdown.TeamValidator.get(resolved.resolvedFormat);

  if (!legalPokemonCache.has(resolved.resolvedFormat)) {
    const legalSpecies: FormatPokemonInfo[] = [];

    for (const species of dex.species.all() as any[]) {
      if (!species.exists) continue;

      const ability = (Object.values(species.abilities ?? {}) as string[]).find(Boolean);
      const moves = getProbeMoves(dex, species);
      if (!ability || moves.length === 0) continue;

      const set = {
        species: species.name,
        ability,
        moves,
        level: 50,
        evs: { hp: 1 },
      };

      const problems = validator.validateSet(set, {});
      if (problems?.length) continue;

      legalSpecies.push({
        id: species.id,
        name: species.name,
        types: [...species.types],
        tier: species.tier,
      });
    }

    legalSpecies.sort((left, right) => left.name.localeCompare(right.name));
    legalPokemonCache.set(resolved.resolvedFormat, legalSpecies);
  }

  const allPokemon = legalPokemonCache.get(resolved.resolvedFormat) ?? [];
  const filteredPokemon = allPokemon
    .filter((species) => {
      if (!query) return true;
      return [species.id, species.name, species.tier ?? '', ...species.types]
        .some((value) => value.toLowerCase().includes(query));
    })
    .slice(0, limit);

  return {
    requestedFormat: resolved.requestedFormat,
    resolvedFormat: resolved.resolvedFormat,
    total: allPokemon.length,
    warning: resolved.warning,
    pokemon: filteredPokemon,
  };
}

export class ShowdownDexAdapter implements SpeciesDexPort {
  getSpecies(name: string): SpeciesInfo | null {
    const species = Dex.species.get(name);
    if (!species.exists) return null;

    const baseStats = {
      hp: species.baseStats.hp,
      atk: species.baseStats.atk,
      def: species.baseStats.def,
      spa: species.baseStats.spa,
      spd: species.baseStats.spd,
      spe: species.baseStats.spe,
    };

    return {
      id: species.id,
      name: species.name,
      types: [...species.types],
      baseStats,
      abilities: (Object.values(species.abilities ?? {}) as string[]).filter(Boolean),
      tier: species.tier,
      bst: Object.values(baseStats).reduce((sum, value) => sum + value, 0),
    };
  }

  listAvailableSpecies(format: string): SpeciesInfo[] {
    const resolved = resolveFormatForValidation(format);
    const formatInfo = Dex.formats.get(resolved.resolvedFormat);
    const moddedDex = Dex.forFormat(formatInfo);

    const availableSpecies: SpeciesInfo[] = [];

    for (const entry of listPokemonForFormat({
      format: resolved.resolvedFormat,
      limit: 5000,
    }).pokemon) {
      const species = moddedDex.species.get(entry.name);
      if (!species.exists) continue;

      const baseStats = {
        hp: species.baseStats.hp,
        atk: species.baseStats.atk,
        def: species.baseStats.def,
        spa: species.baseStats.spa,
        spd: species.baseStats.spd,
        spe: species.baseStats.spe,
      };

      availableSpecies.push({
        id: species.id,
        name: species.name,
        types: [...species.types],
        baseStats,
        abilities: (Object.values(species.abilities ?? {}) as string[]).filter(Boolean),
        tier: species.tier,
        bst: Object.values(baseStats).reduce((sum, value) => sum + value, 0),
      });
    }

    return availableSpecies;
  }

  listTypes(): string[] {
    return [...ALL_TYPES];
  }

  getTypeEffectiveness(attackingType: string, defendingTypes: readonly string[]): number {
    const defense = [...defendingTypes];

    if (!Dex.getImmunity(attackingType, defense)) {
      return 0;
    }

    const effectiveness = Dex.getEffectiveness(attackingType, defense);
    return Math.pow(2, effectiveness);
  }
}
