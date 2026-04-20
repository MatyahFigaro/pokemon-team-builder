import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Team } from '@pokemon/domain';

export interface ManualBenchmarkTeamRecord {
  id: string;
  format: string;
  label?: string;
  notes?: string;
  source?: string;
  createdAt: string;
  updatedAt: string;
  team: Team;
}

interface ManualBenchmarkTeamRegistry {
  version: 1;
  teams: ManualBenchmarkTeamRecord[];
}

const STORAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MANUAL_BENCHMARK_TEAM_PATH = resolve(STORAGE_ROOT, 'data/manual-benchmark-teams.json');

function toId(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function ensureManualBenchmarkTeamFile(): void {
  mkdirSync(dirname(MANUAL_BENCHMARK_TEAM_PATH), { recursive: true });

  if (!existsSync(MANUAL_BENCHMARK_TEAM_PATH)) {
    writeFileSync(MANUAL_BENCHMARK_TEAM_PATH, JSON.stringify({ version: 1, teams: [] }, null, 2) + '\n', 'utf8');
  }
}

function normalizeTeam(raw: Team | undefined, format: string): Team | null {
  if (!raw?.members?.length) return null;

  const members = raw.members
    .map((member) => ({
      ...member,
      species: String(member.species ?? '').trim(),
      moves: Array.isArray(member.moves) ? member.moves.map((move) => String(move).trim()).filter(Boolean).slice(0, 4) : [],
    }))
    .filter((member) => member.species && member.moves.length > 0)
    .slice(0, 6);

  if (members.length === 0) return null;

  return {
    format,
    source: raw.source ?? 'manual-benchmark',
    members,
  } satisfies Team;
}

function buildRecordId(format: string, team: Team, label?: string): string {
  const speciesKey = team.members.map((member) => toId(member.species)).join('-');
  return [toId(format), speciesKey || 'empty', toId(label) || 'default'].join('::');
}

function normalizeRecord(raw: unknown, index: number): ManualBenchmarkTeamRecord | null {
  if (!raw || typeof raw !== 'object') return null;

  const candidate = raw as Record<string, unknown>;
  const format = String(candidate.format ?? '').trim();
  const team = normalizeTeam(candidate.team as Team | undefined, format);
  if (!format || !team) return null;

  const label = typeof candidate.label === 'string' ? candidate.label.trim() || undefined : undefined;
  const now = new Date().toISOString();

  return {
    id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : `${buildRecordId(format, team, label)}::${index}`,
    format,
    label,
    notes: typeof candidate.notes === 'string' ? candidate.notes.trim() || undefined : undefined,
    source: typeof candidate.source === 'string' ? candidate.source.trim() || undefined : 'manual-benchmark',
    createdAt: typeof candidate.createdAt === 'string' && candidate.createdAt.trim() ? candidate.createdAt : now,
    updatedAt: typeof candidate.updatedAt === 'string' && candidate.updatedAt.trim() ? candidate.updatedAt : now,
    team,
  };
}

function loadRegistry(): ManualBenchmarkTeamRegistry {
  ensureManualBenchmarkTeamFile();

  try {
    const raw = JSON.parse(readFileSync(MANUAL_BENCHMARK_TEAM_PATH, 'utf8')) as { version?: number; teams?: unknown[] } | unknown[];
    const entries = Array.isArray(raw) ? raw : (raw.teams ?? []);

    return {
      version: 1,
      teams: entries
        .map((entry, index) => normalizeRecord(entry, index))
        .filter((entry): entry is ManualBenchmarkTeamRecord => Boolean(entry)),
    };
  } catch {
    return { version: 1, teams: [] };
  }
}

function saveRegistry(registry: ManualBenchmarkTeamRegistry): void {
  ensureManualBenchmarkTeamFile();
  writeFileSync(MANUAL_BENCHMARK_TEAM_PATH, JSON.stringify(registry, null, 2) + '\n', 'utf8');
}

export function getManualBenchmarkTeamsPath(): string {
  ensureManualBenchmarkTeamFile();
  return MANUAL_BENCHMARK_TEAM_PATH;
}

export function listManualBenchmarkTeams(options: { format?: string; label?: string } = {}): ManualBenchmarkTeamRecord[] {
  const formatId = toId(options.format);
  const labelId = toId(options.label);

  return loadRegistry().teams.filter((record) => {
    if (formatId && toId(record.format) !== formatId) return false;
    if (labelId && toId(record.label) !== labelId) return false;
    return true;
  });
}

export function importManualBenchmarkTeams(
  format: string,
  teams: Team[],
  options: { label?: string; notes?: string; source?: string } = {},
): { saved: number; path: string } {
  const registry = loadRegistry();
  const now = new Date().toISOString();
  let saved = 0;

  for (const candidate of teams) {
    const team = normalizeTeam(candidate, format);
    if (!team) continue;

    const id = buildRecordId(format, team, options.label);
    const record: ManualBenchmarkTeamRecord = {
      id,
      format,
      label: options.label,
      notes: options.notes,
      source: options.source ?? 'manual-benchmark-import',
      createdAt: now,
      updatedAt: now,
      team: {
        ...team,
        source: 'manual-benchmark',
      },
    };

    const existingIndex = registry.teams.findIndex((entry) => entry.id === id);
    const existingRecord = existingIndex >= 0 ? registry.teams[existingIndex] : undefined;

    if (existingRecord) {
      registry.teams[existingIndex] = {
        ...existingRecord,
        ...record,
        createdAt: existingRecord.createdAt,
      };
    } else {
      registry.teams.push(record);
    }

    saved += 1;
  }

  saveRegistry(registry);
  return { saved, path: MANUAL_BENCHMARK_TEAM_PATH };
}

export function deleteManualBenchmarkTeams(
  options: { id?: string; format?: string; label?: string; all?: boolean } = {},
): { removed: number; path: string } {
  const hasFilter = Boolean(options.id || options.format || options.label || options.all);
  if (!hasFilter) {
    return { removed: 0, path: MANUAL_BENCHMARK_TEAM_PATH };
  }

  const id = toId(options.id);
  const formatId = toId(options.format);
  const labelId = toId(options.label);
  const registry = loadRegistry();

  const filtered = registry.teams.filter((record) => {
    if (id) return toId(record.id) !== id;

    const matchesFormat = formatId ? toId(record.format) === formatId : true;
    const matchesLabel = labelId ? toId(record.label) === labelId : true;

    return !(matchesFormat && matchesLabel);
  });

  const removed = registry.teams.length - filtered.length;
  if (removed > 0) {
    saveRegistry({ version: 1, teams: filtered });
  }

  return { removed, path: MANUAL_BENCHMARK_TEAM_PATH };
}
