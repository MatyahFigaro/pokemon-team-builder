import type { FormatMechanicsInfo } from './ports.js';
import type { FormatId, TeamRole } from './team.js';

export type IssueSeverity = 'info' | 'warning' | 'error';
export type SuggestionKind = 'patch' | 'replace' | 'complete' | 'set-adjustment';

export interface TeamIssue {
  code: string;
  severity: IssueSeverity;
  summary: string;
  details: string;
  memberNames?: string[];
  relatedTypes?: string[];
}

export interface LegalitySummary {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface RoleSummary {
  member: string;
  roles: TeamRole[];
  notes?: string[];
}

export interface WeaknessSummary {
  type: string;
  weakCount: number;
  resistCount: number;
  immuneCount: number;
  pressure: 'low' | 'moderate' | 'high';
}

export interface SpeedSummary {
  slowCount: number;
  mediumCount: number;
  fastCount: number;
  fastestBaseSpeed: number;
  averageBaseSpeed: number;
  hasSpeedControl: boolean;
}

export interface SynergySummary {
  uniqueTypes: string[];
  duplicatePrimaryTypes: string[];
  hasHazardSetter: boolean;
  hasHazardRemoval: boolean;
  pivotCount: number;
  missingRoles: string[];
}

export interface FormatProfileSummary {
  style: 'standard' | 'bss';
  bringCount: number;
  pickCount: number;
  levelCap: number;
  mechanics: FormatMechanicsInfo;
  speedBenchmarks: Array<{ label: string; value: number }>;
}

export interface BattlePlanSummary {
  leadCandidates: string[];
  likelyPicks: string[];
  speedControlRating: 'poor' | 'fair' | 'good';
  teraDependency: 'low' | 'medium' | 'high' | 'not-applicable';
  notes: string[];
}

export interface ThreatPressureSummary {
  species: string;
  pressure: 'low' | 'moderate' | 'high';
  reasons: string[];
  usagePercent?: number;
}

export interface ThreatCoverageSummary {
  poolSize: number;
  consideredThreatCount: number;
  coverageScore: number;
  topPressureThreats: ThreatPressureSummary[];
  notes: string[];
}

export interface ArchetypeMatchupSummary {
  archetype: string;
  rating: 'good' | 'even' | 'rough';
  score: number;
  likelyBring: string[];
  reasons: string[];
}

export interface ArchetypeMatrixSummary {
  summaries: ArchetypeMatchupSummary[];
  bestMatchups: string[];
  weakMatchups: string[];
  notes: string[];
}

export interface ScoreBreakdown {
  total: number;
  offense: number;
  defense: number;
  utility: number;
  notes: string[];
}

export interface SimulationAnalysisSummary {
  enabled: boolean;
  opponentModel: string;
  opponentPreview: string[];
  iterations: number;
  wins?: number;
  losses?: number;
  draws?: number;
  winRate?: number;
  movePredictionAccuracy?: number;
  switchPredictionAccuracy?: number;
  turnBreakdown: string[];
  damageHighlights: string[];
  switchPredictions: string[];
  notes: string[];
}

export interface Suggestion {
  kind: SuggestionKind;
  title: string;
  rationale: string;
  priority: 'low' | 'medium' | 'high';
  targetSlot?: number;
  changes: string[];
  exampleOptions?: string[];
}

export interface AnalysisReport {
  format: FormatId;
  legality: LegalitySummary;
  profile: FormatProfileSummary;
  roles: RoleSummary[];
  weaknesses: WeaknessSummary[];
  speed: SpeedSummary;
  synergy: SynergySummary;
  battlePlan: BattlePlanSummary;
  threats: ThreatCoverageSummary;
  archetypes: ArchetypeMatrixSummary;
  simulation: SimulationAnalysisSummary;
  issues: TeamIssue[];
  score: ScoreBreakdown;
  suggestions: Suggestion[];
}
