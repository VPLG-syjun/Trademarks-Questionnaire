import { QuestionSection } from '../types/survey';

export const BASE_PRICE = 0; // 기본 서비스 금액 (USD)

export const questionSections: QuestionSection[] = [
  {
    id: 'basic',
    title: '기본 정보',
    description: '',
    questions: [
      // TODO: 상표 등록 관련 기본 정보 질문 추가
    ],
  },
  // TODO: 추가 섹션 정의
];

export default questionSections;
