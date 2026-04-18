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

export interface ScoreBreakdown {
  total: number;
  offense: number;
  defense: number;
  utility: number;
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
  roles: RoleSummary[];
  weaknesses: WeaknessSummary[];
  speed: SpeedSummary;
  synergy: SynergySummary;
  issues: TeamIssue[];
  score: ScoreBreakdown;
  suggestions: Suggestion[];
}
