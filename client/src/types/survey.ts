// 질문 유형 정의
export type QuestionType = 'text' | 'email' | 'tel' | 'number' | 'date' | 'yesno' | 'dropdown' | 'radio' | 'checkbox' | 'repeatable_group';

// 반복 그룹 내 필드 조건부 표시 규칙
export interface GroupFieldConditional {
  fieldId: string;    // 같은 그룹 내 다른 필드 ID
  values: string[];   // 해당 값일 때만 표시
}

// 반복 그룹 내 필드 정의
export interface RepeatableField {
  id: string;           // 필드 ID (예: 'name', 'address', 'email')
  type: 'text' | 'email' | 'tel' | 'number' | 'date' | 'dropdown';
  label: string;        // 필드 라벨
  placeholder?: string;
  required: boolean;
  options?: QuestionOption[]; // dropdown용
  conditionalOn?: GroupFieldConditional; // 그룹 내 조건부 표시
}

// 반복 그룹 항목 데이터
export interface RepeatableGroupItem {
  [fieldId: string]: string;
}

// 선택 옵션 (dropdown, radio, checkbox용)
export interface QuestionOption {
  value: string;
  label: string;
  price?: number; // 이 옵션 선택 시 추가 금액
}

// 조건부 표시 규칙
export interface ConditionalRule {
  questionId: string; // 의존하는 질문 ID
  values?: string[];   // 해당 값일 때만 표시
  minGroupCount?: number; // 반복 그룹의 최소 항목 수 조건
  requiresIndividualFounder?: boolean; // founders 중 individual이 1명 이상 필요
}

// 동적 드롭다운 옵션 소스
export type DynamicOptionsSource = 'directors_founders_officers';

// 질문 정의
export interface Question {
  id: string;
  type: QuestionType;
  text: string;
  description?: string;      // 질문 설명
  placeholder?: string;
  required: boolean;
  options?: QuestionOption[]; // dropdown, radio, checkbox용
  dynamicOptionsSource?: DynamicOptionsSource; // 동적 드롭다운 옵션 소스
  conditionalOn?: ConditionalRule; // 조건부 표시
  priceEffect?: {             // 가격에 영향
    type: 'fixed' | 'perAnswer';
    values?: Record<string, number>; // 답변별 금액
  };
  validation?: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
  };
  documentField?: string; // DOCX 템플릿에서 사용할 필드명

  // repeatable_group 전용 속성
  groupFields?: RepeatableField[];  // 그룹 내 필드들
  minItems?: number;                // 최소 항목 수 (기본: 1)
  maxItems?: number;                // 최대 항목 수 (기본: 10)
  addButtonText?: string;           // 추가 버튼 텍스트
  itemLabel?: string;               // 각 항목 라벨 (예: '이사', '창업자')
  pricePerItem?: number;            // 항목당 추가 금액 (첫 번째 항목 이후)
}

// 질문 그룹 (섹션)
export interface QuestionSection {
  id: string;
  title: string;
  description?: string;
  questions: Question[];
}

// 설문 응답
export interface SurveyAnswer {
  questionId: string;
  value: string | string[] | RepeatableGroupItem[];
  price?: number;
}

// 관리자가 설정하는 날짜 변수
export interface AdminDates {
  COIDate?: string;   // Certificate of Incorporation 날짜
  SIGNDate?: string;  // 서명 날짜
}

// 관리자가 설정하는 값 변수
export interface AdminValues {
  authorizedShares?: string;  // 수권주식수 (Authorized Shares)
  parValue?: string;          // 액면가 (Par Value)
  fairMarketValue?: string;   // 공정시장가치 (Fair Market Value)
}

// 설문 제출 데이터
export interface Survey {
  id: string;
  customerInfo: {
    name: string;
    email: string;
    phone?: string;
    company?: string;
  };
  answers: SurveyAnswer[];
  totalPrice: number;
  status: 'in_progress' | 'pending' | 'approved' | 'rejected';
  completedSectionIndex?: number;  // 완료된 마지막 섹션 인덱스 (작성중일 때)
  adminNotes?: string;
  adminDates?: AdminDates;    // 관리자가 설정하는 날짜들
  adminValues?: AdminValues;  // 관리자가 설정하는 값들
  createdAt: string;
  updatedAt?: string;         // 마지막 업데이트 시간
  reviewedAt?: string;
  documentGeneratedAt?: string;
}

export interface CreateSurveyDTO {
  id?: string;  // 기존 작성중 설문 ID (있으면 해당 설문을 pending으로 변경)
  customerInfo: {
    name: string;
    email: string;
    phone?: string;
    company?: string;
  };
  answers: SurveyAnswer[];
  totalPrice: number;
}

export interface SurveyStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  totalRevenue: number;
}
