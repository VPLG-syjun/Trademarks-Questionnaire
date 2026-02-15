// 데이터 타입 정의
export type DataType = 'text' | 'date' | 'number' | 'currency';
export type RuleType = 'question_answer' | 'calculated' | 'always';
export type ConditionOperator = '==' | '!=' | 'contains' | 'not_contains' | 'in' | 'not_in' | '>=' | '<=' | '>' | '<';

// 템플릿 카테고리
export type TemplateCategory = '투자' | '법인설립' | '근로계약' | '기타';

// 변환 규칙 인터페이스
export interface TransformationRule {
  type: 'format' | 'calculate' | 'concat' | 'conditional' | 'lookup';
  config: {
    format?: string; // 날짜/숫자 포맷
    formula?: string; // 계산식
    separator?: string; // 연결 구분자
    sources?: string[]; // 연결할 필드들
    conditions?: Array<{
      when: string;
      then: string;
    }>;
    lookupTable?: Record<string, string>;
  };
}

// 템플릿 인터페이스
export interface Template {
  id: string;
  name: string; // 템플릿 이름 (예: "투자계약서_시드")
  displayName: string; // 화면 표시명 (예: "투자계약서 (시드 라운드)")
  category: TemplateCategory;
  filename: string; // 저장된 파일명
  filePath: string; // 파일 경로
  uploadedAt: string; // ISO date string
  updatedAt: string; // ISO date string
  isActive: boolean;
}

// 템플릿 변수 인터페이스
export interface TemplateVariable {
  id: string;
  templateId: string;
  variableName: string; // 변수명 (예: "회사명", "대표이사명")
  variableKey: string; // 템플릿의 실제 키 (예: "{companyName}")
  questionIds: string[]; // 매핑된 설문 질문 ID 배열
  dataType: DataType;
  isRequired: boolean;
  defaultValue?: string;
  transformationRule?: TransformationRule;
}

// 템플릿 선택 규칙 인터페이스
export interface TemplateRule {
  id: string;
  templateId: string;
  ruleType: RuleType;
  questionId?: string; // 조건 질문 ID
  conditionOperator?: ConditionOperator;
  conditionValue?: string; // JSON string for arrays, plain string for simple values
  priority: number; // 낮을수록 먼저 평가
}

// API용 DTO
export interface CreateTemplateDTO {
  name: string;
  displayName: string;
  category: TemplateCategory;
  filename: string;
  filePath: string;
}

export interface UpdateTemplateDTO {
  name?: string;
  displayName?: string;
  category?: TemplateCategory;
  filename?: string;
  filePath?: string;
  isActive?: boolean;
}

export interface CreateTemplateVariableDTO {
  templateId: string;
  variableName: string;
  variableKey: string;
  questionIds: string[];
  dataType: DataType;
  isRequired: boolean;
  defaultValue?: string;
  transformationRule?: TransformationRule;
}

export interface CreateTemplateRuleDTO {
  templateId: string;
  ruleType: RuleType;
  questionId?: string;
  conditionOperator?: ConditionOperator;
  conditionValue?: string;
  priority?: number;
}

// 템플릿 with 관계 데이터
export interface TemplateWithRelations extends Template {
  variables: TemplateVariable[];
  rules: TemplateRule[];
}

// 설문 답변으로부터 템플릿 선택 결과
export interface TemplateSelectionResult {
  selectedTemplates: Template[];
  matchedRules: Array<{
    template: Template;
    rule: TemplateRule;
    matchScore: number;
  }>;
}
