// Mirrors docs/API_CONTRACT.md. Change both together.

export type Role = "mine_manager" | "safety_officer" | "regulator";
export type Severity = "info" | "warning" | "critical";
export type Band = "low" | "medium" | "high";

export interface User {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  mine_id: number | null;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Obligation {
  id: number;
  mine_id: number;
  title: string;
  clause_ref: string;
  act: string;
  owner_role: string;
  frequency: string;
  evidence_type: string;
  due_date: string | null;
  status: string;
  risk_score: number | null;
  evidence_count: number;
  last_evidence_at: string | null;
}

export interface Alert {
  id: number;
  mine_id: number;
  obligation_id: number | null;
  severity: Severity;
  message: string;
  clause_ref: string | null;
  source: string;
  created_at: string;
  acknowledged_by: number | null;
}

export interface Reading {
  sensor_type: string;
  value: number;
  unit: string;
  recorded_at: string;
}

export interface WindowStats {
  mean: number;
  max: number;
  z_max: number;
  threshold: number;
  breaching: boolean;
}

export interface SensorWindow {
  mine_id: number;
  sensor_type: string;
  window_minutes: number;
  readings: Reading[];
  stats: WindowStats;
  clause: { clause_ref: string; act: string; text: string } | null;
}

export interface FeatureContribution {
  feature: string;
  value: number;
  contribution: number;
}

export interface Risk {
  obligation_id?: number | null;
  mine_id?: number | null;
  score: number;
  band: Band;
  top_features: FeatureContribution[];
  computed_at: string;
}

export interface GeoBreach {
  mine_id: number;
  lease: GeoJSON.Polygon;
  excavation: GeoJSON.Polygon | null;
  outside: GeoJSON.Polygon | null;
  area_outside_m2: number;
  breach: boolean;
  clause_ref: string | null;
}

export interface Citation {
  clause_ref: string;
  act: string;
  evidence_ids: number[];
  figure: string;
}

export interface DraftSection {
  heading: string;
  body: string;
  citations: Citation[];
}

export interface StatutoryReturn {
  id: number;
  mine_id: number;
  period: string;
  return_type: string;
  draft_json: {
    sections: DraftSection[];
    evidence_count: number;
    obligations_covered: number;
    generated_at: string;
    note: string;
  } | null;
  signed_by: number | null;
  signature_name: string | null;
  signed_at: string | null;
  locked: boolean;
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  first_broken: { evidence_id: number; expected: string; found: string } | null;
}
