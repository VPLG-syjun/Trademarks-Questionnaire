import { Survey, CreateSurveyDTO, SurveyStats, SurveyAnswer, AdminDates, AdminValues } from '../types/survey';

const API_BASE = '/api';

export async function fetchSurveys(status?: string): Promise<Survey[]> {
  const url = status ? `${API_BASE}/surveys?status=${status}` : `${API_BASE}/surveys`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('설문 목록을 불러오는데 실패했습니다.');
  return response.json();
}

export async function fetchSurvey(id: string): Promise<Survey> {
  const response = await fetch(`${API_BASE}/surveys/${id}`);
  if (!response.ok) throw new Error('설문을 불러오는데 실패했습니다.');
  return response.json();
}

export async function createSurvey(data: CreateSurveyDTO): Promise<{ id: string; message: string }> {
  const response = await fetch(`${API_BASE}/surveys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '설문 제출에 실패했습니다.');
  }
  return response.json();
}

// 작성중 설문 자동 저장 (새로 생성하거나 기존 설문 업데이트)
export interface AutoSaveDTO {
  id?: string;  // 기존 설문 ID (없으면 새로 생성)
  customerInfo: {
    name?: string;
    email: string;
    phone?: string;
    company?: string;
  };
  answers: SurveyAnswer[];
  totalPrice: number;
  completedSectionIndex: number;  // 완료된 마지막 섹션 인덱스
}

export async function autoSaveSurvey(data: AutoSaveDTO): Promise<{ id: string; message: string }> {
  const response = await fetch(`${API_BASE}/surveys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, action: 'autosave' }),
  });
  if (!response.ok) {
    const text = await response.text();
    console.error('[AutoSave API] Error response:', response.status, text);
    try {
      const error = JSON.parse(text);
      throw new Error(error.details || error.error || '자동 저장에 실패했습니다.');
    } catch {
      throw new Error(`자동 저장 실패 (${response.status}): ${text.substring(0, 100)}`);
    }
  }
  return response.json();
}

// 이메일로 작성중인 설문 찾기
export interface FindByEmailResponse {
  found: boolean;
  survey: Survey | null;
}

export async function findSurveyByEmail(email: string): Promise<FindByEmailResponse> {
  const response = await fetch(`${API_BASE}/surveys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, action: 'findByEmail' }),
  });
  if (!response.ok) {
    const text = await response.text();
    console.error('[FindByEmail API] Error response:', response.status, text);
    try {
      const error = JSON.parse(text);
      throw new Error(error.details || error.error || '설문 검색에 실패했습니다.');
    } catch {
      throw new Error(`설문 검색 실패 (${response.status}): ${text.substring(0, 100)}`);
    }
  }
  return response.json();
}

export interface UpdateSurveyData {
  status?: string;
  adminNotes?: string;
  answers?: SurveyAnswer[];
  adminDates?: AdminDates;
  adminValues?: AdminValues;
}

export async function updateSurvey(
  id: string,
  data: UpdateSurveyData
): Promise<{ message: string; survey?: Survey }> {
  const response = await fetch(`${API_BASE}/surveys/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('설문 업데이트에 실패했습니다.');
  return response.json();
}

export async function deleteSurvey(id: string): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE}/surveys/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('설문 삭제에 실패했습니다.');
  return response.json();
}

export async function generatePDF(id: string): Promise<{ message: string; fileName: string }> {
  const response = await fetch(`${API_BASE}/surveys/${id}/generate-pdf`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('PDF 생성에 실패했습니다.');
  return response.json();
}

export function getDownloadURL(id: string): string {
  return `${API_BASE}/surveys/${id}/download`;
}

export async function fetchStats(): Promise<SurveyStats> {
  const response = await fetch(`${API_BASE}/surveys/stats/overview`);
  if (!response.ok) throw new Error('통계를 불러오는데 실패했습니다.');
  return response.json();
}

// ============================================
// Template & Document Generation APIs
// ============================================

export interface Template {
  id: string;
  name: string;
  displayName: string;
  category: string;
  isActive: boolean;
  repeatForPersons?: boolean;  // 인원별 반복 생성 여부
  personTypeFilter?: 'all' | 'individual' | 'corporation' | 'individual_founder' | 'corporation_founder';  // 인원 필터
}

export interface TemplateSelection {
  required: Template[];
  suggested: Template[];
  optional: Template[];
}

export interface DocumentResult {
  templateId: string;
  templateName: string;
  filename: string;
  status: 'success' | 'error';
  error?: string;
  missingVariables?: string[];
}

export interface GenerateDocumentsResponse {
  success: boolean;
  documents: DocumentResult[];
  zipFile: string;
  downloadUrl: string;
  generationId: string;
  stats: {
    total: number;
    successful: number;
    failed: number;
  };
  error?: string;
}

export async function selectTemplates(surveyId: string): Promise<TemplateSelection> {
  const response = await fetch(`${API_BASE}/templates/select`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ surveyId }),
  });
  if (!response.ok) throw new Error('템플릿 선택에 실패했습니다.');
  return response.json();
}

export async function generateDocuments(
  surveyId: string,
  selectedTemplates: string[],
  overrideVariables?: Record<string, string>,
  repeatForSelections?: Record<string, number[]>  // 템플릿ID별 선택된 인원 인덱스 (0-based)
): Promise<GenerateDocumentsResponse> {
  const response = await fetch(`${API_BASE}/admin/generate-documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      surveyId,
      selectedTemplates,
      overrideVariables,
      repeatForSelections,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || '문서 생성에 실패했습니다.');
  }

  return data;
}

export function getDocumentDownloadURL(downloadId: string): string {
  return `${API_BASE}/admin/download/${downloadId}`;
}

// Manual Variables for Document Generation
export interface ManualVariable {
  variableName: string;
  dataType: string;
  transformRule: string;
  required: boolean;
  defaultValue?: string;
  usedInTemplates: string[];
  sourceType?: 'manual' | 'admin';  // 'manual' = 직접 입력, 'admin' = 관리자 설정값
  questionId?: string;
}

export interface ManualVariablesResponse {
  variables: ManualVariable[];
  totalCount: number;
  requiredCount: number;
}

export async function getManualVariables(templateIds: string[]): Promise<ManualVariablesResponse> {
  const response = await fetch(`${API_BASE}/templates/variables`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'getManual', templateIds }),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || '직접 입력 변수 조회에 실패했습니다.');
  }

  return response.json();
}
