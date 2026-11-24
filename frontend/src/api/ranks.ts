/** Estructura de grados (disciplinas, programas, grados, temario), exámenes y progreso */
import { api } from './client';
import type { DisplayStyle } from './types';
import type { DisciplineProgress, RankEvent } from './members';

export type RankKind = 'kyu' | 'dan' | 'belt' | 'other';
export type ReqCategory = 'technique' | 'kata' | 'sparring' | 'theory' | 'conduct' | 'other';

export type RankFull = {
  id: number; discipline_id: number; track_id: number; name: string; short_name: string | null; level: number; kind: RankKind;
  color: string; stripe_color: string | null; max_stripes: number; min_months: number | null; min_classes: number | null; min_age: number | null;
  requires_exam: number; exam_fee: number | null; description: string | null; active: number; requirements_count?: number; students_count?: number;
};
export type Track = { id: number; discipline_id: number; name: string; min_age: number | null; max_age: number | null; display_style: DisplayStyle; sort_order: number; active: number; ranks: RankFull[] };
export type DisciplineFull = { id: number; name: string; style: string | null; color: string | null; active: number; tracks: Track[] };
export type RequirementDef = { id: number; category: ReqCategory; name: string; description: string | null; video_url: string | null; sort_order: number; mandatory: number };
export type RankInput = Partial<Omit<RankFull, 'id' | 'discipline_id' | 'level' | 'requires_exam' | 'active' | 'requirements_count' | 'students_count'>> & { requires_exam?: boolean; active?: boolean };

export type ExamStatus = 'planned' | 'open' | 'closed' | 'completed' | 'cancelled';
export type ExamRow = { id: number; title: string; discipline_id: number; discipline: string; exam_date: string; start_time: string | null; status: ExamStatus; examiner_name: string | null; candidates_count: number; passed_count: number };
export type CandidateStatus = 'registered' | 'passed' | 'failed' | 'absent' | 'withdrawn';
export type Candidate = {
  id: number; user_id: number; first_name: string; last_name: string | null; photo_url: string | null; status: CandidateStatus; score: number | null; feedback: string | null;
  from_rank_id: number | null; from_rank: string | null; from_color: string | null; target_rank_id: number; target_rank: string; target_color: string;
  charge_id: number | null; fee_status: string | null; result_at: string | null;
};
export type ExamDetail = {
  id: number; discipline_id: number; discipline: string; title: string; exam_date: string; start_time: string | null; location_id: number | null;
  examiner_name: string | null; examiner_user_id: number | null; registration_deadline: string | null; status: ExamStatus; notes: string | null;
  candidates_count: number; candidates: Candidate[];
};
export type ExamInput = {
  discipline_id?: number; title?: string; exam_date?: string; start_time?: string | null; examiner_name?: string | null; examiner_user_id?: number | null;
  registration_deadline?: string | null; status?: ExamStatus; notes?: string | null;
};
export type Eligible = {
  user_id: number; first_name: string; last_name: string | null; photo_url: string | null; discipline_id: number; discipline: string;
  current_rank: string; color: string; stripes: number; next_rank_id: number; next_rank: string; next_color: string;
  months_in_rank: number; next_min_months: number | null; classes_in_rank: number; next_min_classes: number | null; next_exam_date: string | null;
  req_total: number; req_approved: number; eligible: boolean;
};
export type MyExam = {
  exam_id: number; title: string; exam_date: string; start_time: string | null; exam_status: ExamStatus; discipline: string; candidate_id: number;
  status: CandidateStatus; score: number | null; feedback: string | null; target_rank: string; target_color: string; charge_id: number | null; fee_status: string | null; fee: number | null;
};

export const ranksApi = {
  structure: (includeInactive = false) => api.get<DisciplineFull[]>('/ranks/structure', includeInactive ? { include_inactive: true } : undefined),
  rank: (id: number) => api.get<RankFull & { requirements: RequirementDef[] }>(`/ranks/${id}`),
  createRank: (b: RankInput & { track_id: number; name: string }) => api.post<RankFull>('/ranks', b),
  updateRank: (id: number, b: RankInput) => api.patch<RankFull>(`/ranks/${id}`, b),
  reorder: (trackId: number, rankIds: number[]) => api.post('/ranks/reorder', { track_id: trackId, rank_ids: rankIds }),
  deactivateRank: (id: number) => api.del(`/ranks/${id}`),

  createTrack: (b: { discipline_id: number; name: string; min_age?: number | null; max_age?: number | null; display_style?: DisplayStyle }) => api.post('/ranks/tracks', b),
  updateTrack: (id: number, b: { name?: string; min_age?: number | null; max_age?: number | null; display_style?: DisplayStyle; active?: boolean }) => api.patch(`/ranks/tracks/${id}`, b),

  createDiscipline: (b: { name: string; style?: string | null; color?: string | null; display_style?: DisplayStyle }) => api.post('/disciplines', b),
  updateDiscipline: (id: number, b: { name?: string; style?: string | null; color?: string | null; active?: boolean }) => api.patch(`/disciplines/${id}`, b),

  addRequirement: (rankId: number, b: Partial<Omit<RequirementDef, 'id' | 'mandatory'>> & { name: string; mandatory?: boolean }) => api.post(`/ranks/${rankId}/requirements`, b),
  updateRequirement: (id: number, b: Partial<Omit<RequirementDef, 'id' | 'mandatory'>> & { mandatory?: boolean }) => api.patch(`/ranks/requirements/${id}`, b),
  deleteRequirement: (id: number) => api.del(`/ranks/requirements/${id}`),

  exams: (status?: ExamStatus | 'upcoming', disciplineId?: number) => api.get<ExamRow[]>('/exams', { status, discipline_id: disciplineId }),
  exam: (id: number) => api.get<ExamDetail>(`/exams/${id}`),
  createExam: (b: ExamInput & { discipline_id: number; title: string; exam_date: string }) => api.post<ExamDetail>('/exams', b),
  updateExam: (id: number, b: ExamInput) => api.patch<ExamDetail>(`/exams/${id}`, b),
  addCandidates: (id: number, userIds: number[], chargeFee = true) =>
    api.post<{ added: { user_id: number; target_rank: string }[]; skipped: { user_id: number; reason: string }[] }>(`/exams/${id}/candidates`, { user_ids: userIds, charge_fee: chargeFee }),
  setResult: (id: number, candidateId: number, b: { status: CandidateStatus; score?: number | null; feedback?: string | null; certificate_number?: string | null }) =>
    api.put<{ promoted: boolean; rank: string }>(`/exams/${id}/candidates/${candidateId}`, b),
  removeCandidate: (id: number, candidateId: number) => api.del(`/exams/${id}/candidates/${candidateId}`),
  myExams: (userId?: number) => api.get<MyExam[]>('/exams/mine', userId ? { user_id: userId } : undefined),

  eligible: (disciplineId?: number, includeNear = false) => api.get<Eligible[]>('/progress/eligible', { discipline_id: disciplineId, include_near: includeNear || undefined }),
  myProgress: (userId?: number) => api.get<{ disciplines: DisciplineProgress[]; history: RankEvent[] }>('/progress/mine', userId ? { user_id: userId } : undefined),
};
