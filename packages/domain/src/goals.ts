export interface BuildGoals {
  playstyle?: 'offense' | 'balance' | 'bulky-offense' | 'stall' | 'weather' | 'trick-room';
  preferredTypes?: string[];
  avoidTypes?: string[];
  notes?: string[];
}

export interface ParsedIntent {
  action: 'analyze' | 'patch' | 'complete' | 'simulate' | 'explain';
  goals?: BuildGoals;
  rawText: string;
}
