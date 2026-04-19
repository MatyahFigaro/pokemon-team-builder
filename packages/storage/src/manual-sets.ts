import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PokemonSet, TeamRole } from '@pokemon/domain';

export interface ManualSetRecord {
  id: string;
  format: string;
  species: string;
  label?: string;
  notes?: string;
  source?: string;
  roles?: TeamRole[];
  styles?: string[];
  createdAt: string;
  updatedAt: string;
  set: PokemonSet;
}

interface ManualSetRegistry {
  version: 1;
  sets: ManualSetRecord[];
}

const STORAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MANUAL_SET_PATH = resolve(STORAGE_ROOT, 'data/manual-sets.json');

const VALID_TEAM_ROLES = new Set<TeamRole>([
  'lead',
  'pivot',
  'wallbreaker',
  'physical-attacker',
  'special-attacker',
  'physical-wall',
  'special-wall',
  'hazard-setter',
  'hazard-removal',
  'speed-control',
  'setup-sweeper',
  'cleric',
  'scarfer',
]);

function toId(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeStringList(values: unknown): string[] {
  if (Array.isArray(values)) {
    return Array.from(new Set(values.map((value) => String(value).trim()).filter(Boolean)));
  }

  if (typeof values === 'string') {
    return Array.from(new Set(values.split(/[\n,;|]/).map((value) => value.trim()).filter(Boolean)));
  }

  return [];
}

function normalizeRoles(values: unknown): TeamRole[] {
  return normalizeStringList(values)
    .map((value) => value.toLowerCase().replace(/\s+/g, '-') as TeamRole)
    .filter((value): value is TeamRole => VALID_TEAM_ROLES.has(value));
}

function buildStatKey(stats: PokemonSet['evs'] | PokemonSet['ivs'] | undefined): string {
  if (!stats) return '';

  return (Object.entries(stats) as Array<[string, number | undefined]>)
    .filter(([, value]) => typeof value === 'number' && value > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([stat, value]) => `${stat}${value}`)
    .join('-');
}

function ensureManualSetFile(): void {
  mkdirSync(dirname(MANUAL_SET_PATH), { recursive: true });

  if (!existsSync(MANUAL_SET_PATH)) {
    writeFileSync(MANUAL_SET_PATH, JSON.stringify({ version: 1, sets: [] }, null, 2) + '\n', 'utf8');
  }
}

function isChampionsLikeFormat(format: string): boolean {
  return toId(format).includes('champions');
}

function convertStatsForFormat(stats: PokemonSet['evs'] | undefined, format: string): PokemonSet['evs'] | undefined {
  if (!stats) return undefined;
  if (!isChampionsLikeFormat(format)) return stats;

  const values = Object.values(stats).filter((value): value is number => typeof value === 'number' && value > 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  const needsConversion = values.some((value) => value > 32) || total > 66;
  if (!needsConversion) return stats;

  const converted: NonNullable<PokemonSet['evs']> = {};
  for (const [stat, value] of Object.entries(stats) as Array<[keyof NonNullable<PokemonSet['evs']>, number | undefined]>) {
    if (!value || value <= 0) continue;
    converted[stat] = Math.min(32, Math.max(2, Math.round(value / 8)));
  }

  let convertedTotal = Object.values(converted).reduce((sum, value) => sum + (value ?? 0), 0);
  const statOrder: Array<keyof NonNullable<PokemonSet['evs']>> = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

  while (convertedTotal > 66) {
    const nextStat = statOrder.find((stat) => (converted[stat] ?? 0) > 0);
    if (!nextStat) break;
    converted[nextStat] = Math.max(0, (converted[nextStat] ?? 0) - 1);
    convertedTotal -= 1;
  }

  return converted;
}

function normalizeSet(raw: Partial<PokemonSet> | undefined, format: string): PokemonSet | null {
  if (!raw) return null;

  const species = String(raw.species ?? '').trim();
  const moves = Array.isArray(raw.moves)
    ? raw.moves.map((move) => String(move).trim()).filter(Boolean)
    : [];

  if (!species || moves.length === 0) return null;

  const roles = normalizeRoles(raw.roles);

  return {
    species,
    name: typeof raw.name === 'string' ? raw.name.trim() || undefined : undefined,
    item: typeof raw.item === 'string' ? raw.item.trim() || undefined : undefined,
    ability: typeof raw.ability === 'string' ? raw.ability.trim() || undefined : undefined,
    nature: typeof raw.nature === 'string' ? raw.nature.trim() || undefined : undefined,
    level: typeof raw.level === 'number' ? raw.level : undefined,
    gender: typeof raw.gender === 'string' ? raw.gender.trim() || undefined : undefined,
    teraType: typeof raw.teraType === 'string' ? raw.teraType.trim() || undefined : undefined,
    moves,
    evs: convertStatsForFormat(raw.evs, format),
    ivs: raw.ivs,
    roles: roles.length ? roles : undefined,
  };
}

function buildRecordId(format: string, set: PokemonSet, label?: string, styles: string[] = []): string {
  const moveKey = [...set.moves].map((move) => toId(move)).sort().join('-');
  const roleKey = (set.roles ?? []).map((role) => toId(role)).sort().join('-');
  const styleKey = styles.map((style) => toId(style)).sort().join('-');

  return [
    toId(format) || 'all',
    toId(set.species),
    toId(set.item) || 'noitem',
    toId(set.ability) || 'noability',
    toId(set.nature) || 'nonature',
    toId(set.teraType) || 'notera',
    buildStatKey(set.evs) || 'noevs',
    buildStatKey(set.ivs) || 'defaultivs',
    moveKey || 'nomoves',
    roleKey || 'noroles',
    styleKey || 'nostyles',
    toId(label) || 'default',
  ].join('::');
}

function normalizeRecord(raw: unknown, index: number): ManualSetRecord | null {
  if (!raw || typeof raw !== 'object') return null;

  const candidate = raw as Record<string, unknown>;
  const format = String(candidate.format ?? '').trim();
  const set = normalizeSet((candidate.set as Partial<PokemonSet> | undefined) ?? (candidate as Partial<PokemonSet>), format);

  if (!set || !format) return null;

  const roles = Array.from(new Set([...(set.roles ?? []), ...normalizeRoles(candidate.roles)])) as TeamRole[];
  const styles = normalizeStringList(candidate.styles ?? candidate.style);
  const normalizedSet: PokemonSet = {
    ...set,
    roles: roles.length ? roles : undefined,
  };
  const label = typeof candidate.label === 'string' ? candidate.label.trim() || undefined : undefined;
  const now = new Date().toISOString();

  return {
    id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : `${buildRecordId(format, normalizedSet, label, styles)}::${index}`,
    format,
    species: typeof candidate.species === 'string' && candidate.species.trim() ? candidate.species.trim() : normalizedSet.species,
    label,
    notes: typeof candidate.notes === 'string' ? candidate.notes.trim() || undefined : undefined,
    source: typeof candidate.source === 'string' ? candidate.source.trim() || undefined : 'manual',
    roles: roles.length ? roles : undefined,
    styles: styles.length ? styles : undefined,
    createdAt: typeof candidate.createdAt === 'string' && candidate.createdAt.trim() ? candidate.createdAt : now,
    updatedAt: typeof candidate.updatedAt === 'string' && candidate.updatedAt.trim() ? candidate.updatedAt : now,
    set: normalizedSet,
  };
}

function loadRegistry(): ManualSetRegistry {
  ensureManualSetFile();

  try {
    const raw = JSON.parse(readFileSync(MANUAL_SET_PATH, 'utf8')) as { version?: number; sets?: unknown[] } | unknown[];
    const entries = Array.isArray(raw) ? raw : (raw.sets ?? []);

    return {
      version: 1,
      sets: entries
        .map((entry, index) => normalizeRecord(entry, index))
        .filter((entry): entry is ManualSetRecord => Boolean(entry)),
    };
  } catch {
    return { version: 1, sets: [] };
  }
}

function saveRegistry(registry: ManualSetRegistry): void {
  ensureManualSetFile();
  writeFileSync(MANUAL_SET_PATH, JSON.stringify(registry, null, 2) + '\n', 'utf8');
}

export function getManualSetsPath(): string {
  ensureManualSetFile();
  return MANUAL_SET_PATH;
}

export function listManualSets(options: { format?: string; species?: string } = {}): ManualSetRecord[] {
  const formatId = toId(options.format);
  const speciesId = toId(options.species);

  return loadRegistry().sets.filter((record) => {
    if (formatId && toId(record.format) !== formatId) return false;
    if (speciesId && toId(record.species) !== speciesId && toId(record.set.species) !== speciesId) return false;
    return true;
  });
}

export function importManualSets(
  format: string,
  sets: PokemonSet[],
  options: { label?: string; notes?: string; source?: string; roles?: TeamRole[] | string[]; styles?: string[] } = {},
): { saved: number; path: string } {
  const registry = loadRegistry();
  const now = new Date().toISOString();
  let saved = 0;

  for (const candidate of sets) {
    const set = normalizeSet(candidate, format);
    if (!set) continue;

    const roles = Array.from(new Set([...(set.roles ?? []), ...normalizeRoles(options.roles)])) as TeamRole[];
    const styles = normalizeStringList(options.styles);
    const normalizedSet: PokemonSet = {
      ...set,
      roles: roles.length ? roles : undefined,
    };

    const id = buildRecordId(format, normalizedSet, options.label, styles);
    const record: ManualSetRecord = {
      id,
      format,
      species: normalizedSet.species,
      label: options.label,
      notes: options.notes,
      source: options.source ?? 'manual-import',
      roles: roles.length ? roles : undefined,
      styles: styles.length ? styles : undefined,
      createdAt: now,
      updatedAt: now,
      set: normalizedSet,
    };

    const existingIndex = registry.sets.findIndex((entry) => entry.id === id);
    const existingRecord = existingIndex >= 0 ? registry.sets[existingIndex] : undefined;

    if (existingRecord) {
      registry.sets[existingIndex] = {
        ...existingRecord,
        ...record,
        createdAt: existingRecord.createdAt,
      };
    } else {
      registry.sets.push(record);
    }

    saved += 1;
  }

  saveRegistry(registry);
  return { saved, path: MANUAL_SET_PATH };
}
