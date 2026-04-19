export interface UsageChoiceRecord {
  name: string;
  usage: number;
}

export interface UsageSpeciesRecord {
  species: string;
  usage: number;
  abilities?: UsageChoiceRecord[];
  items?: UsageChoiceRecord[];
  moves?: UsageChoiceRecord[];
  teammates?: UsageChoiceRecord[];
  tags?: string[];
}

export interface UsageAnalyticsSnapshot {
  source: string;
  updatedAt: string;
  formatHints: string[];
  species: UsageSpeciesRecord[];
}

interface SmogonChaosEntry {
  'Raw count'?: number;
  Abilities?: Record<string, number>;
  Items?: Record<string, number>;
  Moves?: Record<string, number>;
  Teammates?: Record<string, number>;
}

interface SmogonChaosResponse {
  info?: Record<string, unknown>;
  data?: Record<string, SmogonChaosEntry>;
}

const STATS_BASE_URL = process.env.POKEMON_STATS_BASE_URL ?? 'https://www.smogon.com/stats';
const usageCache = new Map<string, UsageAnalyticsSnapshot | null>();
const pendingCache = new Map<string, Promise<UsageAnalyticsSnapshot | null>>();

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function toId(value: string | undefined): string {
  return normalize(value).replace(/[^a-z0-9]/g, '');
}

function getMonthCandidates(limit = 8): string[] {
  const months: string[] = [];
  const now = new Date();

  for (let index = 1; index <= limit; index += 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`);
  }

  return months;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'pokemon-team-builder/0.1' },
    });

    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'pokemon-team-builder/0.1' },
    });

    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  }
}

function normalizeUsage(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return value <= 1 ? Math.round(value * 1000) / 10 : Math.round(value * 10) / 10;
}

function toChoiceRecords(values?: Record<string, number>): UsageChoiceRecord[] {
  return Object.entries(values ?? {})
    .map(([name, usage]) => ({ name, usage: normalizeUsage(usage) }))
    .filter((entry) => entry.usage > 0)
    .sort((left, right) => right.usage - left.usage)
    .slice(0, 12);
}

function inferFormatPatterns(format: string): RegExp[] {
  const id = toId(format);

  if (id.includes('championsbss') || id.includes('bss') || id.includes('battlestadium')) {
    return [/^gen9bssreg[a-z]+-0\.json$/i, /^gen9bss-0\.json$/i];
  }

  if (id.includes('championsou') || id.endsWith('ou') || id.includes('gen9ou')) {
    return [/^gen9ou-0\.json$/i];
  }

  if (id.includes('vgc') || id.includes('doubles')) {
    return [/^gen9vgc.*-0\.json$/i];
  }

  return [new RegExp(`^${id}-0\\.json$`, 'i')];
}

function pickBestStatsFile(format: string, files: string[]): string | null {
  const formatId = toId(format);
  const direct = files.find((file) => toId(file.replace(/-0\.json$/i, '')) === formatId);
  if (direct) return direct;

  for (const pattern of inferFormatPatterns(format)) {
    const matches = files.filter((file) => pattern.test(file)).sort((left, right) => right.localeCompare(left));
    if (matches.length > 0) return matches[0] ?? null;
  }

  return null;
}

async function resolveStatsUrl(format: string): Promise<string | null> {
  for (const month of getMonthCandidates()) {
    const listingUrl = `${STATS_BASE_URL}/${month}/chaos/`;
    const html = await fetchText(listingUrl);
    if (!html) continue;

    const files = Array.from(html.matchAll(/href="([^"]+\.json)"/g))
      .map((match) => match[1])
      .filter((value): value is string => Boolean(value));
    const targetFile = pickBestStatsFile(format, files);
    if (targetFile) return `${listingUrl}${targetFile}`;
  }

  return null;
}

function buildSnapshotFromChaos(format: string, sourceUrl: string, payload: SmogonChaosResponse): UsageAnalyticsSnapshot | null {
  const entries = Object.entries(payload.data ?? {});
  if (entries.length === 0) return null;

  const totalRawCount = entries.reduce((sum, [, entry]) => sum + (entry['Raw count'] ?? 0), 0);
  const species = entries
    .map(([name, entry]) => ({
      species: name,
      usage: totalRawCount > 0 ? Math.round((((entry['Raw count'] ?? 0) / totalRawCount) * 100) * 10) / 10 : 0,
      abilities: toChoiceRecords(entry.Abilities),
      items: toChoiceRecords(entry.Items),
      moves: toChoiceRecords(entry.Moves),
      teammates: toChoiceRecords(entry.Teammates),
    }))
    .filter((entry) => entry.usage > 0)
    .sort((left, right) => right.usage - left.usage);

  if (species.length === 0) return null;

  const updatedAt = sourceUrl.match(/stats\/([0-9]{4}-[0-9]{2})\//)?.[1] ?? 'unknown';
  return {
    source: sourceUrl,
    updatedAt,
    formatHints: [normalize(format)],
    species,
  } satisfies UsageAnalyticsSnapshot;
}

export async function preloadUsageAnalytics(format: string): Promise<UsageAnalyticsSnapshot | null> {
  const key = normalize(format);
  if (usageCache.has(key)) return usageCache.get(key) ?? null;
  if (pendingCache.has(key)) return pendingCache.get(key) ?? null;

  const pending = (async () => {
    const sourceUrl = await resolveStatsUrl(format);
    if (!sourceUrl) {
      usageCache.set(key, null);
      pendingCache.delete(key);
      return null;
    }

    const payload = await fetchJson<SmogonChaosResponse>(sourceUrl);
    const snapshot = payload ? buildSnapshotFromChaos(format, sourceUrl, payload) : null;
    usageCache.set(key, snapshot);
    pendingCache.delete(key);
    return snapshot;
  })();

  pendingCache.set(key, pending);
  return pending;
}

export function getUsageAnalyticsForFormat(format: string): UsageAnalyticsSnapshot | null {
  return usageCache.get(normalize(format)) ?? null;
}

export function getSpeciesUsage(format: string, speciesName: string): UsageSpeciesRecord | null {
  const snapshot = getUsageAnalyticsForFormat(format);
  if (!snapshot) return null;

  const speciesId = toId(speciesName);
  return snapshot.species.find((record) => toId(record.species) === speciesId) ?? null;
}

export function getUsageWeight(format: string, speciesName: string): number {
  const snapshot = getUsageAnalyticsForFormat(format);
  const record = getSpeciesUsage(format, speciesName);
  if (!snapshot || !record) return 0;

  const peakUsage = snapshot.species[0]?.usage ?? 1;
  return Math.max(0, Math.min(1, record.usage / peakUsage));
}

export function getTopUsageThreatNames(format: string, limit = 15): string[] {
  const snapshot = getUsageAnalyticsForFormat(format);
  if (!snapshot) return [];

  return snapshot.species
    .slice()
    .sort((left, right) => right.usage - left.usage)
    .slice(0, Math.max(1, limit))
    .map((record) => record.species);
}

export function getTopUsageNames(records?: UsageChoiceRecord[], limit = 6): string[] {
  return (records ?? [])
    .slice()
    .sort((left, right) => right.usage - left.usage)
    .slice(0, Math.max(1, limit))
    .map((record) => record.name);
}
