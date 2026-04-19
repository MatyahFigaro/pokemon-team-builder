import { createRequire } from 'node:module';

import type { AbilityInfo, BattleProfile, FormatMechanicsInfo, ItemInfo, MoveInfo, PokemonSet, SpeciesDexPort, SpeciesInfo } from '@pokemon/domain';

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
const formatMechanicsCache = new Map<string, FormatMechanicsInfo>();

const ABILITY_IMMUNITIES: Record<string, string[]> = {
  levitate: ['Ground'],
  flashfire: ['Fire'],
  waterabsorb: ['Water'],
  stormdrain: ['Water'],
  dryskin: ['Water'],
  voltabsorb: ['Electric'],
  motordrive: ['Electric'],
  lightningrod: ['Electric'],
  sapsipper: ['Grass'],
  eartheater: ['Ground'],
  wellbakedbody: ['Fire'],
};

const ABILITY_TYPE_MODIFIERS: Record<string, Partial<Record<string, number>>> = {
  thickfat: { Fire: 0.5, Ice: 0.5 },
  heatproof: { Fire: 0.5 },
  dryskin: { Fire: 1.25 },
  fluffy: { Fire: 2 },
};

function toId(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

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

function ruleTextForFormat(format: any): string[] {
  const ruleTable = typeof Dex.formats.getRuleTable === 'function' ? Dex.formats.getRuleTable(format) : null;
  return [
    ...(format.ruleset ?? []),
    ...(format.banlist ?? []),
    ...(format.restricted ?? []),
    ...(ruleTable ? [...ruleTable.keys()] : []),
  ].map((value) => String(value));
}

function formatHasRuleHint(format: any, ...needles: string[]): boolean {
  const haystack = ruleTextForFormat(format).map(toId);
  return needles.some((needle) => {
    const target = toId(needle);
    return haystack.some((value) => value.includes(target));
  });
}

function isMechanicSetLegal(formatId: string, set: Record<string, unknown>, disallowedPatterns: RegExp[]): boolean {
  const validator = showdown.TeamValidator.get(formatId);
  const problems = validator.validateSet(set, {}) ?? [];

  if (problems.length === 0) return true;

  return !problems.some((problem: string) => disallowedPatterns.some((pattern) => pattern.test(problem)));
}

function detectFormatMechanics(formatId: string): FormatMechanicsInfo {
  const resolved = resolveFormatForValidation(formatId);
  const format = Dex.formats.get(resolved.resolvedFormat);
  const formatKey = `${resolved.requestedFormat}::${resolved.resolvedFormat}`;

  if (formatMechanicsCache.has(formatKey)) {
    return formatMechanicsCache.get(formatKey)!;
  }

  const mod = toId(format.mod);
  const id = toId(format.id);
  const tera = (mod === 'gen9' || formatHasRuleHint(format, 'terastalclause', 'teratypepreview'))
    && !formatHasRuleHint(format, 'notera', '-terastalclause');

  const mega = isMechanicSetLegal(
    resolved.resolvedFormat,
    {
      species: 'Charizard',
      ability: 'Blaze',
      item: 'Charizardite X',
      moves: ['Flamethrower'],
      level: 50,
      evs: { hp: 1 },
    },
    [/item .* does not exist/i, /mega-.* does not exist/i],
  );

  const zMoves = isMechanicSetLegal(
    resolved.resolvedFormat,
    {
      species: 'Garchomp',
      ability: 'Rough Skin',
      item: 'Groundium Z',
      moves: ['Earthquake'],
      level: 50,
      evs: { hp: 1 },
    },
    [/item .* does not exist/i, /z/i],
  );

  const dynamax = mod === 'gen8' && !formatHasRuleHint(format, 'dynamaxclause', '-dynamax');

  const primary: FormatMechanicsInfo['primary'] = tera
    ? 'tera'
    : mega
      ? 'mega'
      : dynamax
        ? 'dynamax'
        : zMoves
          ? 'z-moves'
          : 'none';

  const notes: string[] = [];
  if (resolved.warning) {
    notes.push(resolved.warning);
  }
  if (id.includes('champions') && !tera) {
    notes.push('This Champions format does not use Terastallization.');
  }

  const mechanics = { tera, mega, dynamax, zMoves, primary, notes } satisfies FormatMechanicsInfo;
  formatMechanicsCache.set(formatKey, mechanics);
  return mechanics;
}

function buildMoveInfo(move: any): MoveInfo {
  return {
    id: move.id,
    name: move.name,
    type: move.type,
    category: move.category,
    priority: Number(move.priority ?? 0),
    target: move.target,
    flags: Object.keys(move.flags ?? {}),
    shortDesc: move.shortDesc,
    selfSwitch: move.selfSwitch,
    sideCondition: move.sideCondition,
    status: move.status,
    volatileStatus: move.volatileStatus,
    boosts: move.boosts ?? move.self?.boosts,
  };
}

function buildAbilityInfo(ability: any): AbilityInfo {
  return {
    id: ability.id,
    name: ability.name,
    shortDesc: ability.shortDesc,
    desc: ability.desc,
    rating: ability.rating,
  };
}

function buildItemInfo(item: any): ItemInfo {
  return {
    id: item.id,
    name: item.name,
    shortDesc: item.shortDesc,
    desc: item.desc,
    megaStone: item.megaStone,
    megaEvolves: item.megaEvolves,
  };
}

function getAbilityMatchupModifier(attackingType: string, abilityName: string): number {
  const ability = Dex.abilities.get(abilityName);
  const typeId = attackingType.toLowerCase();
  const text = `${ability.shortDesc ?? ''} ${ability.desc ?? ''}`.toLowerCase();

  if (
    text.includes(`immune to ${typeId}`)
    || text.includes(`${typeId} immunity`)
    || text.includes(`${typeId}-type moves and`)
  ) {
    return 0;
  }

  if (text.includes(`double damage from ${typeId} moves`) || text.includes(`2x damage from ${typeId} moves`)) {
    return 2;
  }

  if (text.includes(`1.25x by ${typeId}`) || text.includes(`power of ${typeId}-type moves is multiplied by 1.25`)) {
    return 1.25;
  }

  if (
    text.includes(`${typeId}-type moves against this pokemon deal damage with a halved offensive stat`)
    || text.includes(`if a pokemon uses a ${typeId}-type attack against this pokemon, that pokemon's offensive stat is halved`)
  ) {
    return 0.5;
  }

  const abilityId = toId(abilityName);
  if ((ABILITY_IMMUNITIES[abilityId] ?? []).some((type) => toId(type) === toId(attackingType))) {
    return 0;
  }

  return ABILITY_TYPE_MODIFIERS[abilityId]?.[attackingType] ?? 1;
}

function buildSpeciesInfo(species: any): SpeciesInfo {
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

function resolveBattleSpecies(set: PokemonSet, format?: string): any | null {
  const species = Dex.species.get(set.species);
  if (!species.exists) return null;

  if (!format) return species;

  const mechanics = detectFormatMechanics(format);
  if (!mechanics.mega) return species;

  const item = Dex.items.get(set.item ?? '');
  const baseSpecies = toId(species.baseSpecies || species.name);

  if (item.exists && item.megaStone && toId(item.megaEvolves) === baseSpecies) {
    const megaSpecies = Dex.species.get(item.megaStone);
    if (megaSpecies.exists) return megaSpecies;
  }

  return species;
}

function resolveActiveAbility(species: any, set: PokemonSet): string {
  const requestedAbility = String(set.ability ?? '').trim();
  const knownAbilities = (Object.values(species.abilities ?? {}) as string[]).filter(Boolean);

  if (requestedAbility && knownAbilities.some((ability) => toId(ability) === toId(requestedAbility))) {
    return requestedAbility;
  }

  return requestedAbility || knownAbilities[0] || '';
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

    return buildSpeciesInfo(species);
  }

  getMove(name: string): MoveInfo | null {
    const move = Dex.moves.get(name);
    if (!move.exists) return null;
    return buildMoveInfo(move);
  }

  getAbility(name: string): AbilityInfo | null {
    const ability = Dex.abilities.get(name);
    if (!ability.exists) return null;
    return buildAbilityInfo(ability);
  }

  getItem(name: string): ItemInfo | null {
    const item = Dex.items.get(name);
    if (!item.exists) return null;
    return buildItemInfo(item);
  }

  getBattleProfile(set: PokemonSet, format?: string): BattleProfile | null {
    const species = resolveBattleSpecies(set, format);
    if (!species?.exists) return null;

    const info = buildSpeciesInfo(species);

    return {
      ...info,
      baseSpecies: species.baseSpecies || species.name,
      ability: resolveActiveAbility(species, set),
      item: set.item,
      isMega: Boolean(species.isMega),
    };
  }

  getFormatMechanics(format: string): FormatMechanicsInfo {
    return detectFormatMechanics(format);
  }

  getMatchupMultiplier(attackingType: string, set: PokemonSet, format?: string): number {
    const profile = this.getBattleProfile(set, format);
    if (!profile) return 1;

    const baseMultiplier = this.getTypeEffectiveness(attackingType, profile.types);
    if (baseMultiplier === 0) return 0;

    const abilityModifier = getAbilityMatchupModifier(attackingType, profile.ability);
    if (abilityModifier === 0) return 0;

    return baseMultiplier * abilityModifier;
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

      availableSpecies.push(buildSpeciesInfo(species));
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
