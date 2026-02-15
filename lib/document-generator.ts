/**
 * 설문 답변을 템플릿 변수로 변환하는 핵심 로직
 * lib/document-generator.ts
 */

// ============================================
// 타입 정의
// ============================================

export interface SurveyResponse {
  questionId: string;
  value: string | string[] | Array<Record<string, string>>;  // 반복 그룹은 객체 배열
  price?: number;
}

export interface VariableMapping {
  id?: string;
  variableName: string;
  questionId: string;      // '__manual__' | '__calculated__' | 실제 질문 ID
  dataType: 'text' | 'list' | 'date' | 'number' | 'currency' | 'email' | 'phone';
  transformRule: string;
  required: boolean;
  defaultValue?: string;
  formula?: string;        // 계산된 값일 때 사용할 수식 (예: "{authorizedShares} * {parValue}")
}

export interface TransformOptions {
  documentNumber?: string;
  locale?: string;
  timezone?: string;
}

// 템플릿 선택 관련 타입
export interface RuleCondition {
  questionId: string;
  operator: '==' | '!=' | 'contains' | 'not_contains' | 'in' | '>' | '>=' | '<' | '<=';
  value: string;
  valueType?: 'literal' | 'question';  // 'literal' = 직접 입력값, 'question' = 다른 질문 참조
  valueQuestionId?: string;            // valueType이 'question'일 때 참조할 질문 ID
  sourceType?: 'question' | 'computed';  // 'question' = 설문 질문, 'computed' = 계산된 변수 (directorsCount 등)
}

export interface SelectionRule {
  id?: string;
  conditions: RuleCondition[];
  logicalOperator?: 'AND' | 'OR';      // 조건 간 논리 연산자 (기본값: AND)
  priority: number;
  isAlwaysInclude: boolean;
  isManualOnly: boolean;
}

export interface Template {
  id: string;
  name: string;
  displayName: string;
  category: string;
  rules?: SelectionRule[];
  variables?: VariableMapping[];
  isActive: boolean;
  repeatForPersons?: boolean;  // 인원별 반복 생성 여부
  personTypeFilter?: 'all' | 'individual' | 'corporation' | 'individual_founder' | 'corporation_founder';
  // 인원별 생성 필터:
  // - 'all': 모든 인원
  // - 'individual': 개인 주주 + 이사 + 임원 (IA, IPAA용 - 법인 주주 제외)
  // - 'individual_founder': 개인 주주만 (CSPA, RSPA용)
  // - 'corporation': 법인만 (이사/임원 제외, 구버전 호환)
  // - 'corporation_founder': 법인 주주만 (CSPA Entity용)
}

export interface TemplateSelection {
  required: Template[];   // 필수 템플릿 (규칙 100% 충족 또는 "항상 사용")
  suggested: Template[];  // 추천 템플릿 (규칙 부분 충족)
  optional: Template[];   // 선택적 템플릿 (매뉴얼 선택용)
}

export interface RuleEvaluationResult {
  templateId: string;
  score: number;           // 0.0 ~ 1.0
  matchedRules: number;
  totalRules: number;
  isAlwaysInclude: boolean;
  isManualOnly: boolean;
}

// ============================================
// 숫자 → 한글 변환 유틸리티
// ============================================

const KOREAN_NUMBERS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const KOREAN_UNITS = ['', '십', '백', '천'];
const KOREAN_BIG_UNITS = ['', '만', '억', '조', '경'];

/**
 * 숫자를 한글로 변환
 * @example numberToKorean(10000000) → "일천만"
 * @example numberToKorean(12345678) → "일천이백삼십사만오천육백칠십팔"
 */
export function numberToKorean(num: number | string): string {
  const n = typeof num === 'string' ? parseInt(num.replace(/[^0-9]/g, ''), 10) : num;

  if (isNaN(n) || n === 0) return '영';
  if (n < 0) return '마이너스 ' + numberToKorean(-n);

  let result = '';
  let numStr = n.toString();

  // 4자리씩 끊어서 처리 (만, 억, 조, 경 단위)
  const chunks: number[] = [];
  while (numStr.length > 0) {
    chunks.unshift(parseInt(numStr.slice(-4), 10) || 0);
    numStr = numStr.slice(0, -4);
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk === 0) continue;

    const bigUnitIndex = chunks.length - 1 - i;
    const bigUnit = KOREAN_BIG_UNITS[bigUnitIndex];

    // 정확히 1이고 만/억/조/경 단위가 있는 경우: "일만" → "만"
    if (chunk === 1 && bigUnitIndex > 0) {
      result += bigUnit;
    } else {
      const chunkStr = convertChunk(chunk);
      result += chunkStr + bigUnit;
    }
  }

  return result || '영';
}

function convertChunk(num: number): string {
  if (num === 0) return '';

  let result = '';
  const numStr = num.toString().padStart(4, '0');

  for (let i = 0; i < 4; i++) {
    const digit = parseInt(numStr[i], 10);
    if (digit === 0) continue;

    const unitIndex = 3 - i;

    // 1의 경우 특수 처리 (일십 → 십, 일백 → 백, 일천 → 천)
    if (digit === 1 && unitIndex > 0) {
      result += KOREAN_UNITS[unitIndex];
    } else {
      result += KOREAN_NUMBERS[digit] + KOREAN_UNITS[unitIndex];
    }
  }

  return result;
}

/**
 * 숫자를 한글 금액으로 변환 (원 단위 포함)
 * @example numberToKoreanCurrency(10000000) → "일천만원"
 */
export function numberToKoreanCurrency(num: number | string): string {
  return numberToKorean(num) + '원';
}

/**
 * 숫자를 콤마 형식으로 변환
 * @example formatNumberWithComma(10000000) → "10,000,000"
 * @example formatNumberWithComma(0.0001) → "0.0001"
 */
export function formatNumberWithComma(num: number | string): string {
  const n = typeof num === 'string' ? parseFloat(num.replace(/[^0-9.-]/g, '')) : num;
  if (isNaN(n)) return '0';

  // 소수점 이하 자릿수 계산 (작은 숫자 보존)
  const numStr = n.toString();
  const decimalIndex = numStr.indexOf('.');
  const decimalPlaces = decimalIndex >= 0 ? numStr.length - decimalIndex - 1 : 0;

  // 정수이거나 소수점 2자리 이하면 기본 처리
  if (decimalPlaces <= 2) {
    return n.toLocaleString('en-US');
  }

  // 소수점이 많은 경우 (0.0001 등) 원래 자릿수 유지
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  });
}

// ============================================
// 숫자 → 영어 변환 유틸리티
// ============================================

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALES = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];

/**
 * 숫자를 영어로 변환
 * @example numberToEnglish(1000000) → "One Million"
 * @example numberToEnglish(12345) → "Twelve Thousand Three Hundred Forty Five"
 */
export function numberToEnglish(num: number | string): string {
  const n = typeof num === 'string' ? parseInt(num.replace(/[^0-9]/g, ''), 10) : num;

  if (isNaN(n)) return '';
  if (n === 0) return 'Zero';
  if (n < 0) return 'Negative ' + numberToEnglish(-n);

  const words: string[] = [];
  let numStr = n.toString();

  // 3자리씩 끊어서 처리
  const chunks: number[] = [];
  while (numStr.length > 0) {
    chunks.unshift(parseInt(numStr.slice(-3), 10) || 0);
    numStr = numStr.slice(0, -3);
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk === 0) continue;

    const scaleIndex = chunks.length - 1 - i;
    const chunkWords = convertEnglishChunk(chunk);

    if (chunkWords) {
      words.push(chunkWords);
      if (SCALES[scaleIndex]) {
        words.push(SCALES[scaleIndex]);
      }
    }
  }

  return words.join(' ') || 'Zero';
}

function convertEnglishChunk(num: number): string {
  if (num === 0) return '';

  const words: string[] = [];

  // 백의 자리
  const hundreds = Math.floor(num / 100);
  if (hundreds > 0) {
    words.push(ONES[hundreds] + ' Hundred');
  }

  // 십의 자리와 일의 자리
  const remainder = num % 100;
  if (remainder > 0) {
    if (remainder < 20) {
      words.push(ONES[remainder]);
    } else {
      const tens = Math.floor(remainder / 10);
      const ones = remainder % 10;
      words.push(TENS[tens] + (ones > 0 ? ' ' + ONES[ones] : ''));
    }
  }

  return words.join(' ');
}

/**
 * 숫자를 영어 달러 금액으로 변환
 * @example numberToEnglishCurrency(1000000) → "One Million Dollars"
 */
export function numberToEnglishCurrency(num: number | string): string {
  const n = typeof num === 'string' ? parseInt(num.replace(/[^0-9]/g, ''), 10) : num;
  if (n === 1) return 'One Dollar';
  return numberToEnglish(n) + ' Dollars';
}

/**
 * 숫자를 영어 서수로 변환
 * @example numberToOrdinal(1) → "First"
 * @example numberToOrdinal(2) → "Second"
 * @example numberToOrdinal(21) → "Twenty First"
 */
export function numberToOrdinal(num: number | string): string {
  const n = typeof num === 'string' ? parseInt(num.replace(/[^0-9]/g, ''), 10) : num;

  if (isNaN(n) || n < 1) return '';

  // 1-19의 서수
  const ORDINALS_ONES = [
    '', 'First', 'Second', 'Third', 'Fourth', 'Fifth',
    'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth',
    'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth',
    'Sixteenth', 'Seventeenth', 'Eighteenth', 'Nineteenth'
  ];

  // 10단위 서수
  const ORDINALS_TENS = [
    '', '', 'Twentieth', 'Thirtieth', 'Fortieth', 'Fiftieth',
    'Sixtieth', 'Seventieth', 'Eightieth', 'Ninetieth'
  ];

  // 10단위 기본형 (합성용)
  const TENS_BASE = [
    '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty',
    'Sixty', 'Seventy', 'Eighty', 'Ninety'
  ];

  if (n < 20) {
    return ORDINALS_ONES[n];
  }

  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    if (ones === 0) {
      return ORDINALS_TENS[tens];
    }
    return TENS_BASE[tens] + ' ' + ORDINALS_ONES[ones];
  }

  // 100 이상은 기본 숫자 + "th" (간단한 처리)
  // 예: 100 → "One Hundredth", 101 → "One Hundred First"
  if (n % 100 === 0) {
    return numberToEnglish(n / 100) + ' Hundredth';
  }

  const hundreds = Math.floor(n / 100);
  const remainder = n % 100;
  return numberToEnglish(hundreds) + ' Hundred ' + numberToOrdinal(remainder);
}

// ============================================
// 날짜 변환 유틸리티
// ============================================

const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const MONTH_NAMES_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

/**
 * 날짜를 지정된 형식으로 변환
 * @param value - 날짜 문자열 또는 Date 객체
 * @param format - 출력 형식
 *
 * 지원 형식:
 * - 'YYYY-MM-DD' → 2026-01-31
 * - 'YYYY년 MM월 DD일' → 2026년 01월 31일
 * - 'MM/DD/YYYY' → 01/31/2026
 * - 'MMM D, YYYY' → Jan 31, 2026
 * - 'YYYY.MM.DD' → 2026.01.31
 */
export function formatDate(value: string | Date | undefined, format: string = 'YYYY-MM-DD'): string {
  if (!value) return '';

  const date = typeof value === 'string' ? new Date(value) : value;

  if (isNaN(date.getTime())) return value?.toString() || '';

  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  const pad = (n: number) => n.toString().padStart(2, '0');

  switch (format) {
    case 'YYYY-MM-DD':
      return `${year}-${pad(month)}-${pad(day)}`;

    case 'YYYY년 MM월 DD일':
      return `${year}년 ${pad(month)}월 ${pad(day)}일`;

    case 'MM/DD/YYYY':
      return `${pad(month)}/${pad(day)}/${year}`;

    case 'MMM D, YYYY':
      return `${MONTH_NAMES_SHORT[month - 1]} ${day}, ${year}`;

    case 'YYYY.MM.DD':
      return `${year}.${pad(month)}.${pad(day)}`;

    case 'DD/MM/YYYY':
      return `${pad(day)}/${pad(month)}/${year}`;

    default:
      // 커스텀 형식 지원
      return format
        .replace('YYYY', year.toString())
        .replace('MM', pad(month))
        .replace('DD', pad(day))
        .replace('MMMM', MONTH_NAMES_EN[month - 1])
        .replace('MMM', MONTH_NAMES_SHORT[month - 1])
        .replace('M', month.toString())
        .replace('D', day.toString());
  }
}

/**
 * 현재 날짜를 지정된 형식으로 반환
 */
export function getCurrentDate(format: string = 'YYYY-MM-DD'): string {
  return formatDate(new Date(), format);
}

/**
 * 현재 시간을 반환
 * @param format - 'HH:mm' | 'HH:mm:ss' | 'h:mm A'
 */
export function getCurrentTime(format: string = 'HH:mm'): string {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();

  const pad = (n: number) => n.toString().padStart(2, '0');

  switch (format) {
    case 'HH:mm':
      return `${pad(hours)}:${pad(minutes)}`;

    case 'HH:mm:ss':
      return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

    case 'h:mm A':
      const h = hours % 12 || 12;
      const ampm = hours < 12 ? 'AM' : 'PM';
      return `${h}:${pad(minutes)} ${ampm}`;

    default:
      return `${pad(hours)}:${pad(minutes)}`;
  }
}

// ============================================
// 전화번호 변환 유틸리티
// ============================================

/**
 * 전화번호 형식 정리
 * @param phone - 전화번호 문자열
 * @param format - 'dashed' | 'dotted' | 'none'
 *
 * @example formatPhone('01012345678', 'dashed') → '010-1234-5678'
 * @example formatPhone('021234567', 'dashed') → '02-123-4567'
 */
export function formatPhone(phone: string | undefined, format: string = 'dashed'): string {
  if (!phone) return '';

  // 숫자만 추출
  const digits = phone.replace(/[^0-9]/g, '');

  if (digits.length < 9) return phone;

  let formatted: string;

  // 서울 지역번호 (02)
  if (digits.startsWith('02')) {
    if (digits.length === 9) {
      formatted = `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    } else {
      formatted = `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
    }
  }
  // 휴대폰 또는 기타 지역번호
  else if (digits.length === 10) {
    formatted = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  } else if (digits.length === 11) {
    formatted = `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  } else {
    formatted = phone;
  }

  // 형식에 따라 구분자 변경
  switch (format) {
    case 'dashed':
      return formatted;
    case 'dotted':
      return formatted.replace(/-/g, '.');
    case 'none':
      return digits;
    default:
      return formatted;
  }
}

// ============================================
// 텍스트 변환 유틸리티
// ============================================

/**
 * Title Case 변환 (사람 이름에 사용)
 * @example toTitleCase('john doe') → 'John Doe'
 * @example toTitleCase('JOHN DOE') → 'John Doe'
 */
export function toTitleCase(text: string | undefined): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Capitalize 변환 (회사명, 법인명에 사용 - 각 단어 첫 글자 대문자, 나머지 유지)
 * @example capitalize('acme corporation') → 'Acme Corporation'
 * @example capitalize('quantum capital') → 'Quantum Capital'
 * @example capitalize('tech ventures LLC') → 'Tech Ventures LLC'
 */
export function capitalize(text: string | undefined): string {
  if (!text) return '';
  return text
    .split(' ')
    .map(word => {
      if (!word) return '';
      // 모두 대문자인 단어(약어)는 유지 (LLC, INC, CO 등)
      if (word === word.toUpperCase() && word.length <= 4) {
        return word;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/**
 * 금액을 $1,000 형식으로 변환
 * @example formatCurrency(10000) → '$10,000'
 * @example formatCurrency('5000') → '$5,000'
 */
export function formatCurrency(value: string | number | undefined): string {
  if (value === undefined || value === null || value === '') return '$0';
  const num = typeof value === 'string' ? parseFloat(value.replace(/[^0-9.-]/g, '')) : value;
  if (isNaN(num)) return '$0';
  return '$' + formatNumberWithComma(num);
}

/**
 * 텍스트 변환 규칙 적용
 */
export function transformText(text: string | undefined, rule: string): string {
  if (!text) return '';

  switch (rule) {
    case 'uppercase':
      return text.toUpperCase();

    case 'lowercase':
      return text.toLowerCase();

    case 'capitalize':
      return capitalize(text);

    case 'title':
      return toTitleCase(text);

    case 'trim':
      return text.trim();

    default:
      return text;
  }
}

/**
 * 데이터 타입과 변환 규칙에 따라 값을 변환
 * @param value - 원본 값
 * @param dataType - 데이터 타입 (number, currency, date, text 등)
 * @param transformRule - 변환 규칙
 * @returns 변환된 값
 */
export function applyTransformRule(
  value: string,
  dataType: string,
  transformRule: string
): string {
  if (!value) return value;

  switch (dataType) {
    case 'number':
      switch (transformRule) {
        case 'comma':
          return formatNumberWithComma(value);
        case 'number_english':
          return numberToEnglish(value);
        case 'ordinal_english':
          return numberToOrdinal(value);
        default:
          return value;
      }

    case 'currency':
      switch (transformRule) {
        case 'comma_dollar':
          return '$' + formatNumberWithComma(value);
        case 'comma_dollar_cents':
          const numVal = parseFloat(value.replace(/[^0-9.-]/g, ''));
          return '$' + numVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        case 'number_english':
          return numberToEnglishCurrency(value);
        case 'number_korean':
          return numberToKoreanCurrency(value);
        case 'comma_won':
          return formatNumberWithComma(value) + '원';
        default:
          return '$' + formatNumberWithComma(value);
      }

    case 'date':
      return formatDate(value, transformRule || 'YYYY-MM-DD');

    case 'phone':
      return formatPhone(value, transformRule || 'dashed');

    case 'text':
    default:
      return transformText(value, transformRule || 'none');
  }
}

// ============================================
// 리스트 포맷팅 유틸리티
// ============================================

/**
 * 배열을 "A and B" 또는 "A, B, and C" 형식으로 변환
 * @example formatListAnd(['John']) → 'John'
 * @example formatListAnd(['John', 'Jane']) → 'John and Jane'
 * @example formatListAnd(['John', 'Jane', 'Bob']) → 'John, Jane, and Bob'
 */
export function formatListAnd(items: string[]): string {
  if (!items || items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * 배열을 "A or B" 또는 "A, B, or C" 형식으로 변환
 * @example formatListOr(['John', 'Jane', 'Bob']) → 'John, Jane, or Bob'
 */
export function formatListOr(items: string[]): string {
  if (!items || items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`;
}

/**
 * 배열을 콤마로 구분된 문자열로 변환
 * @example formatListComma(['John', 'Jane', 'Bob']) → 'John, Jane, Bob'
 */
export function formatListComma(items: string[]): string {
  if (!items || items.length === 0) return '';
  return items.join(', ');
}

/**
 * 배열을 줄바꿈으로 구분된 문자열로 변환
 * @example formatListNewline(['John', 'Jane']) → 'John\nJane'
 */
export function formatListNewline(items: string[]): string {
  if (!items || items.length === 0) return '';
  return items.join('\n');
}

/**
 * 배열에서 헬퍼 변수들을 생성
 * @param baseName - 기본 변수명
 * @param items - 배열 값
 * @returns 헬퍼 변수 객체
 *
 * 생성되는 변수:
 * - {baseName}Count: 항목 수
 * - {baseName}Formatted: "A, B, and C" 형식
 * - {baseName}List: "A, B, C" 형식
 * - {baseName}First: 첫 번째 항목
 * - {baseName}Last: 마지막 항목
 * - hasMultiple{BaseName}: 2개 이상인지 여부 (문자열 "true"/"false")
 * - hasSingle{BaseName}: 1개인지 여부
 * - {baseName}1, {baseName}2, ...: 개별 항목 접근
 */
export function generateArrayHelperVariables(
  baseName: string,
  items: string[]
): Record<string, string | Array<{ value: string; isFirst: boolean; isLast: boolean; index: number }>> {
  const result: Record<string, string | Array<{ value: string; isFirst: boolean; isLast: boolean; index: number }>> = {};
  const capitalizedName = baseName.charAt(0).toUpperCase() + baseName.slice(1);

  // 기본 헬퍼 변수
  result[`${baseName}Count`] = items.length.toString();
  result[`${baseName}Formatted`] = formatListAnd(items);
  result[`${baseName}List`] = formatListComma(items);
  result[`${baseName}OrList`] = formatListOr(items);

  if (items.length > 0) {
    result[`${baseName}First`] = items[0];
    result[`${baseName}Last`] = items[items.length - 1];
  }

  // 조건부 플래그 (docxtemplater에서 사용)
  result[`hasMultiple${capitalizedName}`] = items.length >= 2 ? 'true' : '';
  result[`hasSingle${capitalizedName}`] = items.length === 1 ? 'true' : '';
  result[`hasNo${capitalizedName}`] = items.length === 0 ? 'true' : '';

  // 개별 항목 접근 (1-indexed)
  items.forEach((item, index) => {
    result[`${baseName}${index + 1}`] = item;
  });

  // 반복문용 배열 (docxtemplater loop)
  result[baseName] = items.map((item, index) => ({
    value: item,
    isFirst: index === 0,
    isLast: index === items.length - 1,
    index: index + 1,
  }));

  return result;
}

// ============================================
// 이름 → 직책 조회 유틸리티
// ============================================

/**
 * 직책 약어를 공식 명칭으로 변환
 */
const ROLE_FULL_NAMES: Record<string, string> = {
  'CEO': 'Chief Executive Officer',
  'CFO': 'Chief Financial Officer',
  'Corporate Secretary': 'Corporate Secretary',
  'CS': 'Corporate Secretary',
  'Director': 'Director',
  'Founder': 'Shareholder',
  'Chairman': 'Chairman of the Board',
};

/**
 * 임원(Officer) 직책 목록 - BankConsent 등에서 사용
 */
const OFFICER_ROLES = ['CEO', 'CFO', 'Corporate Secretary'];

/**
 * 설문 응답에서 특정 이름의 모든 직책 조회
 * @param name - 조회할 이름
 * @param responses - 설문 응답 배열
 * @returns 직책 배열 (예: ['CEO', 'CFO', 'Director'])
 */
export function getRolesForName(
  name: string,
  responses: SurveyResponse[]
): string[] {
  if (!name || !name.trim()) return [];

  const normalizedName = name.trim().toLowerCase();
  const roles: string[] = [];

  const getAnswer = (questionId: string): string | undefined => {
    const answer = responses.find(r => r.questionId === questionId);
    return typeof answer?.value === 'string' ? answer.value : undefined;
  };

  // CEO 확인
  const ceoName = getAnswer('ceoName')?.trim();
  if (ceoName && ceoName.toLowerCase() === normalizedName) {
    roles.push('CEO');
  }

  // CFO 확인
  const cfoName = getAnswer('cfoName')?.trim();
  if (cfoName && cfoName.toLowerCase() === normalizedName) {
    roles.push('CFO');
  }

  // Corporate Secretary 확인
  const csName = getAnswer('csName')?.trim();
  if (csName && csName.toLowerCase() === normalizedName) {
    roles.push('Corporate Secretary');
  }

  // Chairman 확인
  const chairmanName = getAnswer('chairmanName')?.trim();
  if (chairmanName && chairmanName.toLowerCase() === normalizedName) {
    roles.push('Chairman');
  }

  // Director 확인
  const directorsResponse = responses.find(r => r.questionId === 'directors');
  if (directorsResponse && Array.isArray(directorsResponse.value)) {
    const directors = directorsResponse.value as Array<{ name?: string }>;
    const isDirector = directors.some(d => d.name?.trim().toLowerCase() === normalizedName);
    if (isDirector) {
      roles.push('Director');
    }
  }

  // Founder 확인
  const foundersResponse = responses.find(r => r.questionId === 'founders');
  if (foundersResponse && Array.isArray(foundersResponse.value)) {
    const founders = foundersResponse.value as Array<{ name?: string }>;
    const isFounder = founders.some(f => f.name?.trim().toLowerCase() === normalizedName);
    if (isFounder) {
      roles.push('Founder');
    }
  }

  return roles;
}

/**
 * 직책 배열을 공식 명칭 문자열로 변환
 * @param roles - 직책 배열 (예: ['CEO', 'CFO'])
 * @returns 공식 명칭 문자열 (예: 'Chief Executive Officer and Chief Financial Officer')
 */
export function formatRolesAsTitle(roles: string[]): string {
  if (!roles || roles.length === 0) return '';

  // 직책을 공식 명칭으로 변환
  const fullNames = roles.map(role => ROLE_FULL_NAMES[role] || role);

  // 중복 제거
  const uniqueNames = [...new Set(fullNames)];

  // "A and B" 또는 "A, B, and C" 형식으로 결합
  return formatListAnd(uniqueNames);
}

/**
 * 특정 이름의 직책을 공식 명칭 문자열로 반환
 * @param name - 조회할 이름
 * @param responses - 설문 응답 배열
 * @returns 공식 명칭 문자열 (예: 'Chief Executive Officer and Chief Financial Officer')
 *
 * 우선순위: Officer 직책 (CEO, CFO, Corporate Secretary) 먼저, 없으면 Director
 */
export function getTitleForName(
  name: string,
  responses: SurveyResponse[]
): string {
  const allRoles = getRolesForName(name, responses);

  // 1. 먼저 Officer 직책만 필터링
  const officerRoles = allRoles.filter(role => OFFICER_ROLES.includes(role));

  // 2. Officer 직책이 있으면 그것만 반환
  if (officerRoles.length > 0) {
    return formatRolesAsTitle(officerRoles);
  }

  // 3. Officer 직책이 없으면 Director 확인
  if (allRoles.includes('Director')) {
    return ROLE_FULL_NAMES['Director'] || 'Director';
  }

  // 4. 아무 직책도 없으면 빈 문자열
  return '';
}

// ============================================
// 문서번호 생성 유틸리티
// ============================================

/**
 * 문서번호 생성
 * @param prefix - 접두사 (예: 'DOC', 'INV')
 * @param includeDate - 날짜 포함 여부
 *
 * @example generateDocumentNumber('DOC') → 'DOC-20260131-A1B2C3'
 */
export function generateDocumentNumber(prefix: string = 'DOC', includeDate: boolean = true): string {
  const randomPart = Math.random().toString(36).substring(2, 8).toUpperCase();

  if (includeDate) {
    const date = new Date();
    const dateStr = `${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}`;
    return `${prefix}-${dateStr}-${randomPart}`;
  }

  return `${prefix}-${randomPart}`;
}

// ============================================
// 수식 평가 유틸리티
// ============================================

/**
 * 수식에서 변수를 값으로 치환하고 계산
 * @param formula - 수식 문자열 (예: "{authorizedShares} * {parValue}")
 * @param variables - 현재까지 변환된 변수 객체
 * @returns 계산 결과 또는 오류 시 빈 문자열
 *
 * 지원 연산자: +, -, *, /, (, )
 * 변수 형식: {변수명}
 */
export function evaluateFormula(
  formula: string,
  variables: Record<string, string>
): string {
  if (!formula || !formula.trim()) {
    console.warn('[evaluateFormula] Empty formula');
    return '';
  }

  try {
    // 변수 치환: {변수명} → 숫자값
    let expression = formula;
    const variablePattern = /\{([^}]+)\}/g;
    const matches: Array<{ varName: string; value: string | undefined; numValue: number }> = [];

    // 모든 변수를 먼저 찾기
    let match;
    while ((match = variablePattern.exec(formula)) !== null) {
      const varName = match[1];
      const value = variables[varName];
      let numValue = 0;

      if (value !== undefined && value !== '') {
        // 콤마와 달러 기호 제거하고 숫자로 변환
        const cleanValue = value.replace(/[$,]/g, '');
        numValue = parseFloat(cleanValue);
        if (isNaN(numValue)) {
          numValue = 0;
        }
      }

      matches.push({ varName, value, numValue });
    }

    // 디버깅 로그
    console.log('[evaluateFormula] Formula:', formula);
    console.log('[evaluateFormula] Variables found:', matches);

    // 변수 치환 (모든 occurrence 교체를 위해 replaceAll 사용)
    for (const { varName, numValue } of matches) {
      const placeholder = `{${varName}}`;
      // replaceAll을 사용하여 모든 occurrence 교체
      expression = expression.split(placeholder).join(numValue.toString());
    }

    console.log('[evaluateFormula] Expression after substitution:', expression);

    // 허용된 문자만 있는지 확인 (보안)
    if (!/^[\d\s+\-*/().]+$/.test(expression)) {
      console.warn('[evaluateFormula] Invalid expression (contains disallowed chars):', expression);
      return '';
    }

    // 수식 계산 (안전한 eval 대체)
    const result = evaluateMathExpression(expression);

    console.log('[evaluateFormula] Result:', result);

    if (isNaN(result) || !isFinite(result)) {
      console.warn('[evaluateFormula] Result is NaN or Infinite');
      return '';
    }

    return result.toString();
  } catch (error) {
    console.error('[evaluateFormula] Error:', error);
    return '';
  }
}

/**
 * 안전한 수학 표현식 계산 (eval 대신 사용)
 */
function evaluateMathExpression(expression: string): number {
  // 공백 제거
  expression = expression.replace(/\s+/g, '');

  // 재귀적으로 괄호 먼저 처리
  while (expression.includes('(')) {
    expression = expression.replace(/\(([^()]+)\)/g, (_, inner) => {
      return evaluateMathExpression(inner).toString();
    });
  }

  // 덧셈/뺄셈 처리 (낮은 우선순위)
  // 음수 처리를 위해 시작 부분의 마이너스는 제외
  const addSubMatch = expression.match(/(.+?)([+\-])(?!$)(.+)/);
  if (addSubMatch) {
    const [, left, operator, right] = addSubMatch;
    // 연산자 뒤에 바로 숫자가 오는지 확인 (예: 5*-3 방지)
    if (!/[+\-*/]$/.test(left)) {
      const leftVal = evaluateMathExpression(left);
      const rightVal = evaluateMathExpression(right);
      return operator === '+' ? leftVal + rightVal : leftVal - rightVal;
    }
  }

  // 곱셈/나눗셈 처리 (높은 우선순위)
  const mulDivMatch = expression.match(/(.+?)([*/])(.+)/);
  if (mulDivMatch) {
    const [, left, operator, right] = mulDivMatch;
    const leftVal = evaluateMathExpression(left);
    const rightVal = evaluateMathExpression(right);
    return operator === '*' ? leftVal * rightVal : leftVal / rightVal;
  }

  // 숫자만 남은 경우
  return parseFloat(expression) || 0;
}

// ============================================
// 메인 변환 함수
// ============================================

/**
 * 설문 답변을 템플릿 변수로 변환
 *
 * @param responses - 설문 답변 배열
 * @param variableMappings - 템플릿 변수 매핑 정의
 * @param options - 추가 옵션
 *
 * @returns 변수명: 값 형태의 객체
 */
export function transformSurveyToVariables(
  responses: SurveyResponse[],
  variableMappings: VariableMapping[],
  options: TransformOptions = {}
): Record<string, string> {
  const result: Record<string, string> = {};

  // 1. 특수 변수 자동 생성 (영문 템플릿용)
  result['currentDate'] = getCurrentDate('MMM D, YYYY');
  result['currentDateShort'] = getCurrentDate('MM/DD/YYYY');
  result['currentDateISO'] = getCurrentDate('YYYY-MM-DD');
  result['currentTime'] = getCurrentTime('h:mm A');
  result['documentNumber'] = options.documentNumber || generateDocumentNumber('FR');
  result['currentYear'] = new Date().getFullYear().toString();

  // 한글 날짜 (필요한 경우)
  result['currentDateKR'] = getCurrentDate('YYYY년 MM월 DD일');

  // 3. 관리자 설정 날짜 (COIDate, SIGNDate) 처리
  const coiDateResponse = responses.find(r => r.questionId === '__COIDate');
  if (coiDateResponse?.value) {
    const rawValue = coiDateResponse.value;
    const coiDateValue: string = typeof rawValue === 'string'
      ? rawValue
      : Array.isArray(rawValue) && rawValue.length > 0
        ? String(rawValue[0])
        : new Date().toISOString();

    result['COIDate'] = formatDate(coiDateValue, 'MMM D, YYYY');
    result['COIDateShort'] = formatDate(coiDateValue, 'MM/DD/YYYY');
    result['COIDateISO'] = formatDate(coiDateValue, 'YYYY-MM-DD');
    result['COIDateKR'] = formatDate(coiDateValue, 'YYYY년 MM월 DD일');
  } else {
    result['COIDate'] = getCurrentDate('MMM D, YYYY');
    result['COIDateShort'] = getCurrentDate('MM/DD/YYYY');
    result['COIDateISO'] = getCurrentDate('YYYY-MM-DD');
    result['COIDateKR'] = getCurrentDate('YYYY년 MM월 DD일');
  }

  const signDateResponse = responses.find(r => r.questionId === '__SIGNDate');
  if (signDateResponse?.value) {
    const rawValue = signDateResponse.value;
    const signDateValue: string = typeof rawValue === 'string'
      ? rawValue
      : Array.isArray(rawValue) && rawValue.length > 0
        ? String(rawValue[0])
        : new Date().toISOString();

    result['SIGNDate'] = formatDate(signDateValue, 'MMM D, YYYY');
    result['signDate'] = result['SIGNDate'];
    result['SignDate'] = result['SIGNDate'];
    result['SIGNDateShort'] = formatDate(signDateValue, 'MM/DD/YYYY');
    result['SIGNDateISO'] = formatDate(signDateValue, 'YYYY-MM-DD');
    result['SIGNDateKR'] = formatDate(signDateValue, 'YYYY년 MM월 DD일');
    result['SIGNYear'] = formatDate(signDateValue, 'YYYY');
  } else {
    result['SIGNDate'] = getCurrentDate('MMM D, YYYY');
    result['signDate'] = result['SIGNDate'];
    result['SignDate'] = result['SIGNDate'];
    result['SIGNDateShort'] = getCurrentDate('MM/DD/YYYY');
    result['SIGNDateISO'] = getCurrentDate('YYYY-MM-DD');
    result['SIGNDateKR'] = getCurrentDate('YYYY년 MM월 DD일');
    result['SIGNYear'] = getCurrentDate('YYYY');
  }

  // 3b. Cashin 날짜 및 SHSIGNDate (설문 응답에서 가져옴)
  const cashinResponse = responses.find(r => r.questionId === 'cashin');
  if (cashinResponse?.value) {
    const rawValue = cashinResponse.value;
    const cashinValue: string = typeof rawValue === 'string'
      ? rawValue
      : Array.isArray(rawValue) && rawValue.length > 0
        ? String(rawValue[0])
        : '';

    if (cashinValue) {
      // cashin 날짜 저장
      result['cashin'] = formatDate(cashinValue, 'MMM D, YYYY');
      result['Cashin'] = result['cashin'];
      result['cashinShort'] = formatDate(cashinValue, 'MM/DD/YYYY');
      result['cashinISO'] = formatDate(cashinValue, 'YYYY-MM-DD');

      // SHSIGNDate 계산:
      // - cashin 날짜가 15일 이전(1-14일): 같은 달의 마지막 영업일
      // - cashin 날짜가 15일 이후(15-31일): 다음 달의 마지막 영업일
      try {
        // 날짜 파싱 (YYYY-MM-DD 형식 또는 Date 객체로 처리)
        let cashinYear: number, cashinMonth: number, dayOfMonth: number;

        if (cashinValue.includes('-')) {
          const dateParts = cashinValue.split('-');
          cashinYear = parseInt(dateParts[0], 10);
          cashinMonth = parseInt(dateParts[1], 10) - 1; // 0-indexed
          dayOfMonth = parseInt(dateParts[2], 10);
        } else {
          // 다른 형식인 경우 Date 객체로 파싱
          const parsedDate = new Date(cashinValue);
          cashinYear = parsedDate.getFullYear();
          cashinMonth = parsedDate.getMonth();
          dayOfMonth = parsedDate.getDate();
        }

        // NaN 체크
        if (isNaN(cashinYear) || isNaN(cashinMonth) || isNaN(dayOfMonth)) {
          console.log(`[transformSurveyToVariables] Invalid cashin date format: ${cashinValue}`);
        } else {
          // 대상 월 결정 (15일 이전이면 같은 달, 15일 이후면 다음 달)
          let targetMonth = dayOfMonth < 15 ? cashinMonth : cashinMonth + 1;
          let targetYear = cashinYear;

          // 연도 넘김 처리 (12월 15일 이후면 다음 해 1월)
          if (targetMonth > 11) {
            targetMonth = 0;
            targetYear = cashinYear + 1;
          }

          // 대상 월의 마지막 날 (다음 달 0일 = 이번 달 마지막 날)
          const lastDayOfMonth = new Date(targetYear, targetMonth + 1, 0);
          // 마지막 영업일 계산 (토요일=6, 일요일=0 제외)
          while (lastDayOfMonth.getDay() === 0 || lastDayOfMonth.getDay() === 6) {
            lastDayOfMonth.setDate(lastDayOfMonth.getDate() - 1);
          }

          result['SHSIGNDate'] = formatDate(lastDayOfMonth.toISOString(), 'MMM D, YYYY');
          result['SHSIGNDateShort'] = formatDate(lastDayOfMonth.toISOString(), 'MM/DD/YYYY');
          result['SHSIGNDateISO'] = formatDate(lastDayOfMonth.toISOString(), 'YYYY-MM-DD');
          console.log(`[transformSurveyToVariables] Cashin: ${cashinValue}, SHSIGNDate: ${result['SHSIGNDate']}`);
        }
      } catch (e) {
        console.log(`[transformSurveyToVariables] Error calculating SHSIGNDate from cashin: ${cashinValue}`, e);
      }
    }
  }

  // 4. 회사 주소 처리 (미국 주소 우선, 없으면 한국 주소)
  const hasUSAddressResponse = responses.find(r => r.questionId === 'hasUSAddress');
  const usAddressResponse = responses.find(r => r.questionId === 'usAddress');
  const krAddressResponse = responses.find(r => r.questionId === 'krAddress');

  const hasUSAddress = hasUSAddressResponse?.value === 'yes';
  const usAddress = typeof usAddressResponse?.value === 'string' ? usAddressResponse.value.trim() : '';
  const krAddress = typeof krAddressResponse?.value === 'string' ? krAddressResponse.value.trim() : '';

  // companyAddress: 미국 주소가 있으면 미국 주소, 없으면 한국 주소
  const companyAddress = (hasUSAddress && usAddress) ? usAddress : krAddress;
  result['companyAddress'] = companyAddress;
  result['CompanyAddress'] = companyAddress;

  // 개별 주소도 저장
  result['usAddress'] = usAddress;
  result['USAddress'] = usAddress;
  result['krAddress'] = krAddress;
  result['KRAddress'] = krAddress;
  result['hasUSAddress'] = hasUSAddress ? 'true' : '';

  console.log(`[transformSurveyToVariables] Company address: hasUS=${hasUSAddress}, selected="${companyAddress}"`);

  // 4b. 모든 설문 응답을 변수로 자동 생성 (questionId = 변수명)
  // 반복 그룹, 관리자 값(__로 시작)은 별도 처리되므로 제외
  for (const response of responses) {
    const questionId = response.questionId;
    const value = response.value;

    // 관리자 값은 별도 처리
    if (questionId.startsWith('__')) continue;

    // 반복 그룹(객체 배열)은 별도 처리
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') continue;

    // 단순 문자열 값
    if (typeof value === 'string') {
      // 회사/법인 이름 필드는 Capitalize 적용
      const companyNameFields = ['companyname', 'companyname1', 'companyname2', 'companyname3', 'corporationname', 'businessname', 'entityname'];
      // 사람 이름 필드는 Title Case 적용
      const personNameFields = ['ceoname', 'cfoname', 'csname', 'agentname', 'registeredagentname', 'incorporatorname'];

      const questionIdLower = questionId.toLowerCase();
      let formattedValue = value;

      if (companyNameFields.includes(questionIdLower)) {
        formattedValue = capitalize(value);
      } else if (personNameFields.includes(questionIdLower)) {
        formattedValue = toTitleCase(value);
      }

      result[questionId] = formattedValue;
      // 첫글자 대문자 버전도 생성
      const capitalizedKey = questionId.charAt(0).toUpperCase() + questionId.slice(1);
      result[capitalizedKey] = formattedValue;
    }
    // 문자열 배열 (체크박스 등)
    else if (Array.isArray(value)) {
      const stringArray = value as string[];
      result[questionId] = stringArray.join(', ');
      result[`${questionId}List`] = stringArray.join(', ');
      result[`${questionId}Formatted`] = formatListAnd(stringArray);
      // 첫글자 대문자 버전
      const capitalizedKey = questionId.charAt(0).toUpperCase() + questionId.slice(1);
      result[capitalizedKey] = result[questionId];
    }
  }

  console.log('[transformSurveyToVariables] Auto-generated variables from responses:', Object.keys(result).length);

  // 5. 반복 그룹 데이터 처리 (directors, founders 등)
  console.log('[transformSurveyToVariables] Step 5: Processing repeating groups');
  console.log('[transformSurveyToVariables] All responses questionIds:', responses.map(r => r.questionId));

  for (const response of responses) {
    const value = response.value;

    // 배열이면서 객체 배열인 경우 (반복 그룹)
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
      const groupItems = value as Array<Record<string, string>>;
      const baseName = response.questionId;
      console.log(`[transformSurveyToVariables] Found repeating group: ${baseName}, items:`, JSON.stringify(groupItems));

      // 그룹 개수
      result[`${baseName}Count`] = groupItems.length.toString();

      // 조건부 플래그
      const capitalizedName = baseName.charAt(0).toUpperCase() + baseName.slice(1);
      result[`hasMultiple${capitalizedName}`] = groupItems.length >= 2 ? 'true' : '';
      result[`hasSingle${capitalizedName}`] = groupItems.length === 1 ? 'true' : '';

      // 각 필드별 배열 생성 (예: directorsName, directorsEmail 등)
      // 숫자 필드 (콤마 포맷팅 적용)
      const numericFields = ['cash'];
      // 이름 필드 (Title Case 적용) - Director, Officer, Founder(Individual) 이름
      const nameFields = ['name', 'ceoname'];
      const fieldNames = Object.keys(groupItems[0] || {});
      for (const fieldName of fieldNames) {
        const isNumericField = numericFields.includes(fieldName.toLowerCase());
        const isNameField = nameFields.includes(fieldName.toLowerCase());
        const fieldValues = groupItems.map((item, itemIndex) => {
          const val = item[fieldName] || '';
          // 숫자 필드(cash)인 경우 $1,000 형식으로 포맷팅
          if (isNumericField && val) {
            const numVal = parseFloat(val.replace(/,/g, ''));
            if (!isNaN(numVal)) {
              return formatCurrency(numVal);
            }
          }
          // 이름 필드인 경우 Title Case 적용
          // 단, Founder의 경우 Individual 타입일 때만 적용 (법인명은 제외)
          if (isNameField && val) {
            // ceoName은 항상 Title Case (법인 대표이사 이름)
            if (fieldName.toLowerCase() === 'ceoname') {
              return toTitleCase(val);
            }
            // name 필드: Founder의 경우 type에 따라 다른 포맷 적용
            if (fieldName.toLowerCase() === 'name') {
              const itemType = item['type']?.toLowerCase();
              // founders 그룹이고 법인(corporation)인 경우 Capitalize 적용
              if (baseName === 'founders' && itemType === 'corporation') {
                return capitalize(val); // 법인명은 Capitalize
              }
              return toTitleCase(val); // 개인 이름은 Title Case
            }
          }
          return val;
        });
        const fieldCapitalized = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);

        // 필드별 포맷팅된 목록
        result[`${baseName}${fieldCapitalized}Formatted`] = formatListAnd(fieldValues);
        result[`${baseName}${fieldCapitalized}List`] = formatListComma(fieldValues);
        result[`${baseName}${fieldCapitalized}OrList`] = formatListOr(fieldValues);

        // 개별 항목 접근 (1-indexed, 기존 템플릿 호환)
        const singular = baseName.slice(0, -1); // founders -> founder
        const singularCapitalized = singular.charAt(0).toUpperCase() + singular.slice(1); // Founder

        fieldValues.forEach((val, idx) => {
          // 기본 변수 설정 (원래 방식 - 안정적)
          result[`${singular}${idx + 1}${fieldCapitalized}`] = val;
          result[`${singularCapitalized}${idx + 1}${fieldCapitalized}`] = val;
          result[`${baseName}${idx + 1}${fieldCapitalized}`] = val;

          // 디버그 로깅
          if (fieldName.toLowerCase() === 'cash') {
            console.log(`[transformSurveyToVariables] Set ${singularCapitalized}${idx + 1}${fieldCapitalized} = "${val}"`);
          }
        });
      }

      // 반복문용 배열 데이터 (docxtemplater loop 용)
      // 문자열이 아닌 배열은 별도로 저장 (나중에 docxtemplater에 전달)
      (result as Record<string, unknown>)[baseName] = groupItems.map((item, index) => {
        // 숫자 필드에 콤마 포맷팅, 이름 필드에 Title Case 적용
        const formattedItem: Record<string, string | number | boolean> = {};
        const itemType = item['type']?.toLowerCase();

        for (const [key, val] of Object.entries(item)) {
          if (numericFields.includes(key.toLowerCase()) && val) {
            // cash 필드는 $1,000 형식으로 포맷팅
            const numVal = parseFloat(val.replace(/,/g, ''));
            if (!isNaN(numVal)) {
              formattedItem[key] = formatCurrency(numVal);
            } else {
              formattedItem[key] = val;
            }
          } else if (nameFields.includes(key.toLowerCase()) && val) {
            // ceoName은 항상 Title Case
            if (key.toLowerCase() === 'ceoname') {
              formattedItem[key] = toTitleCase(val);
            } else if (key.toLowerCase() === 'name') {
              // founders 법인은 Capitalize 적용
              if (baseName === 'founders' && itemType === 'corporation') {
                formattedItem[key] = capitalize(val);
              } else {
                formattedItem[key] = toTitleCase(val);
              }
            } else {
              formattedItem[key] = val;
            }
          } else {
            formattedItem[key] = val;
          }
        }
        // founders 그룹인 경우 isCorporation, isIndividual boolean 필드 추가
        const isCorporation = baseName === 'founders' && itemType === 'corporation';
        const isIndividual = baseName === 'founders' && itemType !== 'corporation';

        // founders 전용 별칭 추가 (FounderName, FounderCeoName 등)
        const founderAliases = baseName === 'founders' ? {
          FounderName: formattedItem['name'] || '',
          founderName: formattedItem['name'] || '',
          FounderCeoName: formattedItem['ceoName'] || formattedItem['ceoname'] || '',
          founderCeoName: formattedItem['ceoName'] || formattedItem['ceoname'] || '',
          FounderAddress: formattedItem['address'] || '',
          founderAddress: formattedItem['address'] || '',
          FounderEmail: formattedItem['email'] || '',
          founderEmail: formattedItem['email'] || '',
          FounderCash: formattedItem['cash'] || '',
          founderCash: formattedItem['cash'] || '',
        } : {};

        return {
          ...formattedItem,
          ...founderAliases,
          index: index + 1,
          isFirst: index === 0,
          isLast: index === groupItems.length - 1,
          // founders 전용 boolean 필드 (조건부 서명란 등에 사용)
          ...(baseName === 'founders' ? {
            isCorporation,
            isIndividual,
          } : {}),
        };
      });

      // 단수형 변수 추가 (첫 번째 항목 참조) - founderName, directorName 등
      // 인덱스 없는 변수는 첫 번째 항목을 가리킴
      if (groupItems.length > 0) {
        const firstItem = groupItems[0];
        const singular = baseName.slice(0, -1); // founders -> founder
        const singularCap = singular.charAt(0).toUpperCase() + singular.slice(1); // Founder

        for (const fieldName of Object.keys(firstItem)) {
          const val = firstItem[fieldName] || '';
          const fieldCap = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
          let formattedVal = val;

          // 포맷팅 적용
          if (fieldName.toLowerCase() === 'cash' && val) {
            const numVal = parseFloat(val.replace(/,/g, ''));
            if (!isNaN(numVal)) formattedVal = formatCurrency(numVal);
          } else if (fieldName.toLowerCase() === 'name' && val) {
            const itemType = firstItem['type']?.toLowerCase();
            if (baseName === 'founders' && itemType === 'corporation') {
              formattedVal = capitalize(val);
            } else {
              formattedVal = toTitleCase(val);
            }
          } else if (fieldName.toLowerCase() === 'ceoname' && val) {
            formattedVal = toTitleCase(val);
          }

          // founderName, FounderName, foundername 등
          result[`${singular}${fieldCap}`] = formattedVal;
          result[`${singularCap}${fieldCap}`] = formattedVal;
          result[`${singular}${fieldName}`] = formattedVal;
        }

        // founder, Founder 변수 (첫 번째 founder의 name)
        const firstName = firstItem['name'] || '';
        const firstType = firstItem['type']?.toLowerCase();
        const formattedFirstName = (baseName === 'founders' && firstType === 'corporation')
          ? capitalize(firstName)
          : toTitleCase(firstName);
        result[singular] = formattedFirstName;
        result[singularCap] = formattedFirstName;

        // founders 전용: Individual/Corporation 별도 변수
        if (baseName === 'founders') {
          // 첫 번째 Individual founder 찾기
          const individualFounder = groupItems.find(item => item['type']?.toLowerCase() !== 'corporation');
          if (individualFounder) {
            const indivName = toTitleCase(individualFounder['name'] || '');
            const indivAddress = individualFounder['address'] || '';
            const indivEmail = individualFounder['email'] || '';
            const indivCash = individualFounder['cash'] || '';
            const formattedIndivCash = indivCash ? formatCurrency(parseFloat(indivCash.replace(/,/g, ''))) : '';

            result['individualFounderName'] = indivName;
            result['IndividualFounderName'] = indivName;
            result['individualFounderAddress'] = indivAddress;
            result['IndividualFounderAddress'] = indivAddress;
            result['individualFounderEmail'] = indivEmail;
            result['IndividualFounderEmail'] = indivEmail;
            result['individualFounderCash'] = formattedIndivCash;
            result['IndividualFounderCash'] = formattedIndivCash;
          }

          // 첫 번째 Corporation founder 찾기
          const corpFounder = groupItems.find(item => item['type']?.toLowerCase() === 'corporation');
          if (corpFounder) {
            const corpName = capitalize(corpFounder['name'] || '');
            const corpCeoName = toTitleCase(corpFounder['ceoName'] || corpFounder['ceoname'] || '');
            const corpAddress = corpFounder['address'] || '';
            const corpEmail = corpFounder['email'] || '';
            const corpCash = corpFounder['cash'] || '';
            const formattedCorpCash = corpCash ? formatCurrency(parseFloat(corpCash.replace(/,/g, ''))) : '';

            result['corporationFounderName'] = corpName;
            result['CorporationFounderName'] = corpName;
            result['corporationFounderCeoName'] = corpCeoName;
            result['CorporationFounderCeoName'] = corpCeoName;
            result['corporationFounderAddress'] = corpAddress;
            result['CorporationFounderAddress'] = corpAddress;
            result['corporationFounderEmail'] = corpEmail;
            result['CorporationFounderEmail'] = corpEmail;
            result['corporationFounderCash'] = formattedCorpCash;
            result['CorporationFounderCash'] = formattedCorpCash;
          }
        }
      }
    }
  }

  // 6. 관리자 설정 값 (Authorized Shares, Par Value, Fair Market Value) 처리
  const authSharesResponse = responses.find(r => r.questionId === '__authorizedShares');
  if (authSharesResponse?.value) {
    const rawValue = authSharesResponse.value;
    const authSharesValue: string = typeof rawValue === 'string'
      ? rawValue
      : Array.isArray(rawValue) && rawValue.length > 0
        ? String(rawValue[0])
        : '0';

    const numValue = parseFloat(authSharesValue.replace(/,/g, ''));
    result['authorizedShares'] = formatNumberWithComma(numValue);
    result['authorizedSharesRaw'] = numValue.toString();
    result['authorizedSharesEnglish'] = numberToEnglish(numValue);
  }

  const parValueResponse = responses.find(r => r.questionId === '__parValue');
  if (parValueResponse?.value) {
    const rawValue = parValueResponse.value;
    const parVal: string = typeof rawValue === 'string'
      ? rawValue
      : Array.isArray(rawValue) && rawValue.length > 0
        ? String(rawValue[0])
        : '0';

    result['parValue'] = parVal;
    result['parValueDollar'] = '$' + parVal;
    result['PV'] = '$' + parVal;
  }

  const fmvResponse = responses.find(r => r.questionId === '__fairMarketValue');
  if (fmvResponse?.value) {
    const rawValue = fmvResponse.value;
    const fmvVal: string = typeof rawValue === 'string'
      ? rawValue
      : Array.isArray(rawValue) && rawValue.length > 0
        ? String(rawValue[0])
        : '0';

    // 모든 금액은 $1,000 형식으로 통일
    const fmvFormatted = formatCurrency(fmvVal);
    result['fairMarketValue'] = fmvFormatted;
    result['fairMarketValueDollar'] = fmvFormatted;
    result['FMV'] = fmvFormatted;
  }

  // 5b. Officer 이름에 Title Case 적용 (CEO, CFO, CS, Chairman)
  const officerNameFields = ['ceoName', 'cfoName', 'csName', 'chairmanName'];
  for (const fieldId of officerNameFields) {
    const response = responses.find(r => r.questionId === fieldId);
    if (response?.value && typeof response.value === 'string') {
      const titleCaseName = toTitleCase(response.value.trim());
      // 다양한 변수명 버전 지원
      result[fieldId] = titleCaseName;
      // 대문자 시작 버전 (CeoName, CfoName 등)
      const capitalizedKey = fieldId.charAt(0).toUpperCase() + fieldId.slice(1);
      result[capitalizedKey] = titleCaseName;
      // 대문자 약어 버전 (CEOName, CFOName, CSName)
      if (fieldId === 'ceoName') {
        result['CEOName'] = titleCaseName;
        result['CEONAME'] = titleCaseName;
      } else if (fieldId === 'cfoName') {
        result['CFOName'] = titleCaseName;
        result['CFONAME'] = titleCaseName;
      } else if (fieldId === 'csName') {
        result['CSName'] = titleCaseName;
        result['CSNAME'] = titleCaseName;
      } else if (fieldId === 'chairmanName') {
        result['ChairmanName'] = titleCaseName;
        result['CHAIRMANNAME'] = titleCaseName;
      }
    }
  }

  // 7. 매핑된 변수 처리 (계산 변수 제외)
  for (const mapping of variableMappings) {
    const variableKey = mapping.variableName;

    // 자동 생성 변수 (__auto__): 이미 생성된 값에 변환 규칙만 적용
    if (mapping.questionId === '__auto__') {
      if (result[variableKey]) {
        const originalValue = result[variableKey];
        const transformedValue = applyTransformRule(originalValue, mapping.dataType, mapping.transformRule);
        result[variableKey] = transformedValue;
        console.log(`[transformSurveyToVariables] Applied transform to auto-gen variable: ${variableKey} "${originalValue}" -> "${transformedValue}"`);
      } else {
        console.log(`[transformSurveyToVariables] Auto-gen variable not found: ${variableKey}`);
      }
      continue;
    }

    // 직접 입력인 경우
    if (mapping.questionId === '__manual__') {
      // 이미 값이 있으면 건너뛰기 (반복 그룹에서 생성된 값 보존)
      if (result[variableKey]) {
        console.log(`[transformSurveyToVariables] Skipping __manual__ variable: ${variableKey} (already has value)`);
        continue;
      }
      if (mapping.defaultValue) {
        result[variableKey] = mapping.defaultValue;
      }
      continue;
    }

    // 계산된 값인 경우 나중에 처리
    if (mapping.questionId === '__calculated__') {
      continue;
    }

    // 반복 그룹 필드 매핑 처리 (__founders.cash, __directors.name 등)
    if (mapping.questionId.startsWith('__') && mapping.questionId.includes('.')) {
      const [groupPart, fieldName] = mapping.questionId.substring(2).split('.');
      // groupPart: "founders" or "directors"
      // fieldName: "cash", "name", "email", etc.

      if (groupPart && fieldName) {
        const fieldCapitalized = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);

        // 변환 규칙에 따라 적절한 자동 생성 변수 참조
        let sourceVariable: string;
        switch (mapping.transformRule) {
          case 'list_or':
            sourceVariable = `${groupPart}${fieldCapitalized}OrList`;
            break;
          case 'list_comma':
            sourceVariable = `${groupPart}${fieldCapitalized}List`;
            break;
          case 'list_and':
          default:
            sourceVariable = `${groupPart}${fieldCapitalized}Formatted`;
            break;
        }

        // 이미 생성된 자동 변수에서 값 가져오기
        if (result[sourceVariable]) {
          result[variableKey] = result[sourceVariable];
        } else {
          result[variableKey] = mapping.defaultValue || '';
        }
        continue;
      }
    }

    // 반복 그룹 Count 매핑 처리 (__foundersCount, __directorsCount)
    if (mapping.questionId === '__foundersCount' || mapping.questionId === '__directorsCount') {
      const countVar = mapping.questionId.substring(2); // "foundersCount" or "directorsCount"
      if (result[countVar]) {
        result[variableKey] = result[countVar];
      } else {
        result[variableKey] = mapping.defaultValue || '0';
      }
      continue;
    }

    // 개별 항목 매핑 처리 (__founder.1.cash, __director.2.name 등)
    const individualMatch = mapping.questionId.match(/^__(founder|director)\.(\d+)\.(\w+)$/);
    if (individualMatch) {
      const [, singular, indexStr, fieldName] = individualMatch;
      const index = parseInt(indexStr, 10);
      const fieldCapitalized = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
      const singularCapitalized = singular.charAt(0).toUpperCase() + singular.slice(1);

      // Founder1Cash, Director2Name 형식의 변수 참조
      const sourceVariable = `${singularCapitalized}${index}${fieldCapitalized}`;

      if (result[sourceVariable]) {
        result[variableKey] = result[sourceVariable];
      } else {
        // 소문자 버전도 시도 (founder1Cash)
        const lowerSourceVariable = `${singular}${index}${fieldCapitalized}`;
        if (result[lowerSourceVariable]) {
          result[variableKey] = result[lowerSourceVariable];
        } else {
          result[variableKey] = mapping.defaultValue || '';
        }
      }
      continue;
    }

    // 답변 찾기
    const response = responses.find(r => r.questionId === mapping.questionId);
    const rawValue = response?.value;

    // 값이 없으면 기본값 사용
    if (!rawValue && mapping.defaultValue) {
      result[variableKey] = mapping.defaultValue;
      continue;
    }

    // 값이 없으면 빈 문자열
    if (!rawValue) {
      result[variableKey] = '';
      continue;
    }

    // 배열인 경우
    if (Array.isArray(rawValue)) {
      // 반복 그룹 (객체 배열)인 경우 - 섹션 4에서 이미 처리됨, 스킵
      if (rawValue.length > 0 && typeof rawValue[0] === 'object') {
        // 반복 그룹은 이미 자동 처리되었으므로 변수 매핑에서 건너뛰기
        // directors, founders 등의 반복 그룹 데이터
        continue;
      }

      // 일반 문자열 배열인 경우 헬퍼 변수 생성 및 리스트 포맷팅 적용
      const stringArray = rawValue as string[];
      const helpers = generateArrayHelperVariables(variableKey, stringArray);
      for (const [key, val] of Object.entries(helpers)) {
        if (typeof val === 'string') {
          result[key] = val;
        } else {
          // 배열은 docxtemplater용으로 별도 저장 (나중에 처리)
          (result as Record<string, unknown>)[key] = val;
        }
      }

      // 변환 규칙에 따른 기본값 설정
      let transformedValue: string;
      switch (mapping.transformRule) {
        case 'list_and':
          transformedValue = formatListAnd(stringArray);
          break;
        case 'list_or':
          transformedValue = formatListOr(stringArray);
          break;
        case 'list_comma':
          transformedValue = formatListComma(stringArray);
          break;
        case 'list_newline':
          transformedValue = formatListNewline(stringArray);
          break;
        default:
          // 기본값: "A, B, and C" 형식
          transformedValue = formatListAnd(stringArray);
      }
      result[variableKey] = transformedValue;
      continue;
    }

    // 단일 값인 경우
    const value = rawValue;

    // 데이터 타입에 따른 변환
    let transformedValue: string;

    switch (mapping.dataType) {
      case 'date':
        transformedValue = formatDate(value, mapping.transformRule || 'YYYY-MM-DD');
        break;

      case 'number':
        switch (mapping.transformRule) {
          case 'comma':
            transformedValue = formatNumberWithComma(value);
            break;
          case 'number_english':
            transformedValue = numberToEnglish(value);
            break;
          case 'ordinal_english':
            transformedValue = numberToOrdinal(value);
            break;
          default:
            transformedValue = value;
        }
        break;

      case 'currency':
        switch (mapping.transformRule) {
          case 'number_english':
            transformedValue = numberToEnglishCurrency(value);
            break;
          case 'number_korean':
            transformedValue = numberToKoreanCurrency(value);
            break;
          case 'comma_dollar':
            transformedValue = '$' + formatNumberWithComma(value);
            break;
          case 'comma_dollar_cents':
            const numVal = parseFloat(value.replace(/[^0-9.-]/g, ''));
            transformedValue = '$' + numVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            break;
          case 'comma_won':
            transformedValue = formatNumberWithComma(value) + '원';
            break;
          default:
            transformedValue = '$' + formatNumberWithComma(value);
        }
        break;

      case 'phone':
        transformedValue = formatPhone(value, mapping.transformRule || 'dashed');
        break;

      case 'email':
        transformedValue = value.toLowerCase().trim();
        break;

      case 'text':
      default:
        transformedValue = transformText(value, mapping.transformRule || 'none');
        break;
    }

    result[variableKey] = transformedValue;
  }

  // 8. 계산 변수 처리 (다른 변수들이 모두 처리된 후)
  console.log('[transformSurveyToVariables] Step 6: Processing calculated variables');
  console.log('[transformSurveyToVariables] Available variables for formula:', {
    Founder1Cash: result['Founder1Cash'],
    founder1Cash: result['founder1Cash'],
    FMV: result['FMV'],
    fairMarketValue: result['fairMarketValue'],
  });

  for (const mapping of variableMappings) {
    if (mapping.questionId !== '__calculated__') continue;
    if (!mapping.formula) {
      console.warn(`[transformSurveyToVariables] Calculated variable ${mapping.variableName} has no formula`);
      continue;
    }

    const variableKey = mapping.variableName;
    console.log(`[transformSurveyToVariables] Processing calculated variable: ${variableKey}, formula: ${mapping.formula}`);

    // 수식 평가
    const calculatedValue = evaluateFormula(mapping.formula, result);
    console.log(`[transformSurveyToVariables] Calculated value for ${variableKey}:`, calculatedValue);

    if (calculatedValue) {
      // 데이터 타입에 따른 변환 적용
      let transformedValue: string;

      switch (mapping.dataType) {
        case 'number':
          switch (mapping.transformRule) {
            case 'comma':
              transformedValue = formatNumberWithComma(calculatedValue);
              break;
            case 'number_english':
              transformedValue = numberToEnglish(calculatedValue);
              break;
            case 'ordinal_english':
              transformedValue = numberToOrdinal(calculatedValue);
              break;
            default:
              transformedValue = calculatedValue;
          }
          break;

        case 'currency':
          switch (mapping.transformRule) {
            case 'number_english':
              transformedValue = numberToEnglishCurrency(calculatedValue);
              break;
            case 'number_korean':
              transformedValue = numberToKoreanCurrency(calculatedValue);
              break;
            case 'comma_dollar':
              transformedValue = '$' + formatNumberWithComma(calculatedValue);
              break;
            case 'comma_dollar_cents':
              const numVal = parseFloat(calculatedValue);
              transformedValue = '$' + numVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              break;
            case 'comma_won':
              transformedValue = formatNumberWithComma(calculatedValue) + '원';
              break;
            default:
              transformedValue = '$' + formatNumberWithComma(calculatedValue);
          }
          break;

        default:
          transformedValue = calculatedValue;
      }

      result[variableKey] = transformedValue;
    } else if (mapping.defaultValue) {
      result[variableKey] = mapping.defaultValue;
    }
  }

  // 9. BankConsent 이름에 대한 직책 자동 생성
  // BankConsent (회사 계좌 개설자)의 직책 조회
  const bankConsentResponse = responses.find(r => r.questionId === 'bankConsent');
  if (bankConsentResponse?.value && typeof bankConsentResponse.value === 'string') {
    const bankConsentName = toTitleCase(bankConsentResponse.value.trim());  // Title Case 적용
    const bankConsentTitle = getTitleForName(bankConsentName, responses);
    // 다양한 변수명 버전 지원
    result['BankConsent'] = bankConsentName;
    result['bankConsent'] = bankConsentName;
    result['BankConsent1'] = bankConsentName;
    result['bankConsent1'] = bankConsentName;
    result['BankConsentTitle'] = bankConsentTitle;
    result['bankConsentTitle'] = bankConsentTitle;
    result['BankConsent1Title'] = bankConsentTitle;
    result['bankConsent1Title'] = bankConsentTitle;
    console.log(`[transformSurveyToVariables] BankConsent: ${bankConsentName}, Title: ${bankConsentTitle}`);
  }

  // BankConsent2 (은행 권한 수여자)의 직책 조회
  const bankConsent2Response = responses.find(r => r.questionId === 'bankConsent2');
  if (bankConsent2Response?.value && typeof bankConsent2Response.value === 'string') {
    const bankConsent2Name = toTitleCase(bankConsent2Response.value.trim());  // Title Case 적용
    const bankConsent2Title = getTitleForName(bankConsent2Name, responses);
    // 다양한 변수명 버전 지원
    result['BankConsent2'] = bankConsent2Name;
    result['bankConsent2'] = bankConsent2Name;
    result['BankConsent2Title'] = bankConsent2Title;
    result['bankConsent2Title'] = bankConsent2Title;
    console.log(`[transformSurveyToVariables] BankConsent2: ${bankConsent2Name}, Title: ${bankConsent2Title}`);
  }

  // 10. Fallback 계산: Founder1Share가 없으면 자동 계산 시도
  if (!result['Founder1Share'] && result['Founder1Cash'] && result['FMV']) {
    console.log('[transformSurveyToVariables] Step 10: Fallback calculation for Founder1Share');
    const founder1CashNum = parseFloat((result['Founder1Cash'] || '0').replace(/[$,]/g, ''));
    const fmvNum = parseFloat((result['FMV'] || '0').replace(/[$,]/g, ''));

    console.log(`[transformSurveyToVariables] Fallback: Founder1Cash=${founder1CashNum}, FMV=${fmvNum}`);

    if (!isNaN(founder1CashNum) && !isNaN(fmvNum) && fmvNum !== 0) {
      const shareCount = founder1CashNum / fmvNum;
      result['Founder1Share'] = formatNumberWithComma(shareCount);
      console.log(`[transformSurveyToVariables] Fallback: Founder1Share = ${result['Founder1Share']}`);
    }
  }

  // 추가 Founder들에 대한 Share 계산 (Founder2Share, Founder3Share 등)
  for (let i = 2; i <= 9; i++) {
    const cashKey = `Founder${i}Cash`;
    const shareKey = `Founder${i}Share`;

    if (!result[shareKey] && result[cashKey] && result['FMV']) {
      const founderCashNum = parseFloat((result[cashKey] || '0').replace(/[$,]/g, ''));
      const fmvNum = parseFloat((result['FMV'] || '0').replace(/[$,]/g, ''));

      if (!isNaN(founderCashNum) && !isNaN(fmvNum) && fmvNum !== 0 && founderCashNum > 0) {
        const shareCount = founderCashNum / fmvNum;
        result[shareKey] = formatNumberWithComma(shareCount);
        console.log(`[transformSurveyToVariables] Fallback: ${shareKey} = ${result[shareKey]}`);
      }
    }
  }

  // 10b. cashSum과 shareSum 계산 (모든 Founder의 합계)
  let totalCash = 0;
  let totalShare = 0;

  for (let i = 1; i <= 9; i++) {
    const cashKey = `Founder${i}Cash`;
    const shareKey = `Founder${i}Share`;

    if (result[cashKey]) {
      const cashNum = parseFloat((result[cashKey] || '0').replace(/[$,]/g, ''));
      if (!isNaN(cashNum)) {
        totalCash += cashNum;
      }
    }

    if (result[shareKey]) {
      const shareNum = parseFloat((result[shareKey] || '0').replace(/,/g, ''));
      if (!isNaN(shareNum)) {
        totalShare += shareNum;
      }
    }
  }

  // cashSum: $1,000 형식
  result['cashSum'] = '$' + formatNumberWithComma(totalCash);
  result['CashSum'] = result['cashSum'];
  result['CASHSUM'] = result['cashSum'];

  // shareSum: 1,000 형식
  result['shareSum'] = formatNumberWithComma(totalShare);
  result['ShareSum'] = result['shareSum'];
  result['SHARESUM'] = result['shareSum'];

  console.log(`[transformSurveyToVariables] CashSum: ${result['cashSum']}, ShareSum: ${result['shareSum']}`);

  // 10c. Option Pool 주식 수 계산
  // 공식: x = p × (S + x) → x = pS / (1 - p)
  // p = optionPool% / 100, S = totalShare (founder 전체 주식 수)
  const optionPoolResponse = responses.find(r => r.questionId === 'optionPool');
  if (optionPoolResponse?.value && totalShare > 0) {
    const optionPoolPercent = typeof optionPoolResponse.value === 'string'
      ? parseFloat(optionPoolResponse.value)
      : 0;

    if (optionPoolPercent > 0 && optionPoolPercent < 100) {
      const p = optionPoolPercent / 100;
      const optionPoolShares = Math.round((p * totalShare) / (1 - p));

      result['optionPoolShares'] = formatNumberWithComma(optionPoolShares);
      result['OptionPoolShares'] = result['optionPoolShares'];
      result['optionPoolSharesRaw'] = optionPoolShares.toString();
      result['OptionPoolSharesRaw'] = result['optionPoolSharesRaw'];

      // 총 발행 주식 수 (founder shares + option pool)
      const totalIssuedShares = totalShare + optionPoolShares;
      result['totalIssuedShares'] = formatNumberWithComma(totalIssuedShares);
      result['TotalIssuedShares'] = result['totalIssuedShares'];

      console.log(`[transformSurveyToVariables] OptionPool: ${optionPoolPercent}%, OptionPoolShares: ${optionPoolShares}, TotalIssued: ${totalIssuedShares}`);
    }
  }

  // 10d. founders 배열에 share 필드 추가 (docxtemplater 루프용)
  const foundersArray = (result as Record<string, unknown>)['founders'] as Array<Record<string, unknown>> | undefined;
  if (foundersArray && result['FMV']) {
    const fmvNum = parseFloat((result['FMV'] || '0').replace(/[$,]/g, ''));
    if (fmvNum > 0) {
      foundersArray.forEach((founder, idx) => {
        const cashVal = founder['cash'];
        if (cashVal) {
          const cashNum = parseFloat(String(cashVal).replace(/[$,]/g, ''));
          if (!isNaN(cashNum) && cashNum > 0) {
            const shareCount = Math.floor(cashNum / fmvNum);
            founder['share'] = formatNumberWithComma(shareCount);
            console.log(`[transformSurveyToVariables] Added share to founders[${idx}]: ${founder['share']}`);
          } else {
            founder['share'] = '0';
          }
        } else {
          founder['share'] = '0';
        }
      });
    }
  }

  console.log('[transformSurveyToVariables] Final result (selected vars):', {
    Founder1Cash: result['Founder1Cash'],
    Founder1Share: result['Founder1Share'],
    FMV: result['FMV'],
    cashSum: result['cashSum'],
    shareSum: result['shareSum'],
  });

  // 11. Designator 변수 처리
  const designatorResponse = responses.find(r => r.questionId === 'designator');
  const designatorCustomResponse = responses.find(r => r.questionId === 'designatorCustom');

  let designatorValue = '';
  if (designatorResponse?.value && typeof designatorResponse.value === 'string') {
    if (designatorResponse.value === 'custom' && designatorCustomResponse?.value) {
      // 직접 입력인 경우
      designatorValue = typeof designatorCustomResponse.value === 'string'
        ? designatorCustomResponse.value.trim()
        : '';
    } else {
      designatorValue = designatorResponse.value;
    }
  }

  if (designatorValue) {
    // Designator는 Capitalize 처리
    const capitalizedDesignator = capitalize(designatorValue);
    result['designator'] = capitalizedDesignator;
    result['Designator'] = capitalizedDesignator;
    result['DESIGNATOR'] = capitalizedDesignator;
    console.log(`[transformSurveyToVariables] Designator: ${capitalizedDesignator}`);
  }

  // 12. StockOption 조건부 변수 처리
  const stockOptionResponse = responses.find(r =>
    r.questionId === 'stockOption' || r.questionId === 'StockOption'
  );
  if (stockOptionResponse?.value) {
    const stockOptionValue = typeof stockOptionResponse.value === 'string'
      ? stockOptionResponse.value.toLowerCase()
      : '';
    // "yes", "true", "1" 등을 true로 처리
    const hasStockOption = ['yes', 'true', '1', 'y'].includes(stockOptionValue);
    result['hasStockOption'] = hasStockOption ? 'true' : '';
    result['HasStockOption'] = result['hasStockOption'];
    result['stockOption'] = stockOptionValue;
    result['StockOption'] = stockOptionValue;
    console.log(`[transformSurveyToVariables] StockOption: ${stockOptionValue}, hasStockOption: ${hasStockOption}`);
  }

  // 13. 계산된 변수 추가 (hasIndividualFounder, hasCorporationFounder 등)
  const computedVars = computeVariablesFromResponses(responses);
  for (const [key, value] of Object.entries(computedVars)) {
    if (result[key] === undefined) {
      result[key] = String(value);
    }
  }

  // 14. 대소문자 구분 없는 변수 처리 - 모든 변수에 대해 다양한 케이스 버전 생성
  const caseInsensitiveResult = createCaseVariations(result);

  return caseInsensitiveResult;
}

/**
 * 모든 변수에 대해 대소문자 변형 버전 생성
 * - 원본 유지
 * - 소문자 버전 (companyname)
 * - 대문자 버전 (COMPANYNAME)
 * - camelCase에서 첫글자 대/소문자 버전
 */
function createCaseVariations(variables: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(variables)) {
    // 문자열이 아닌 값은 그대로 유지 (배열 등)
    if (typeof value !== 'string') {
      (result as Record<string, unknown>)[key] = value;
      continue;
    }

    const strValue = value;

    // 원본 유지
    result[key] = strValue;

    // 소문자 버전
    const lowerKey = key.toLowerCase();
    if (!result[lowerKey]) {
      result[lowerKey] = strValue;
    }

    // 대문자 버전
    const upperKey = key.toUpperCase();
    if (!result[upperKey]) {
      result[upperKey] = strValue;
    }

    // 첫글자 대문자 버전 (companyName -> CompanyName)
    const capitalizedKey = key.charAt(0).toUpperCase() + key.slice(1);
    if (!result[capitalizedKey]) {
      result[capitalizedKey] = strValue;
    }

    // 첫글자 소문자 버전 (CompanyName -> companyName)
    const uncapitalizedKey = key.charAt(0).toLowerCase() + key.slice(1);
    if (!result[uncapitalizedKey]) {
      result[uncapitalizedKey] = strValue;
    }
  }

  return result;
}

// ============================================
// 변수 유효성 검사
// ============================================

export interface ValidationResult {
  isValid: boolean;
  missingVariables: string[];
  emptyRequired: string[];
}

/**
 * 필수 변수가 모두 채워졌는지 검사
 */
export function validateVariables(
  variables: Record<string, string>,
  mappings: VariableMapping[]
): ValidationResult {
  const missingVariables: string[] = [];
  const emptyRequired: string[] = [];

  for (const mapping of mappings) {
    const value = variables[mapping.variableName];

    if (value === undefined) {
      missingVariables.push(mapping.variableName);
    } else if (mapping.required && !value.trim()) {
      emptyRequired.push(mapping.variableName);
    }
  }

  return {
    isValid: missingVariables.length === 0 && emptyRequired.length === 0,
    missingVariables,
    emptyRequired,
  };
}

// ============================================
// 템플릿 선택 로직
// ============================================

// 계산된 변수로 사용 가능한 변수 목록 (UI에서 선택 시 사용)
export const COMPUTED_VARIABLES = [
  { id: 'directorsCount', label: 'Directors Count (이사 수)', group: 'directors' },
  { id: 'foundersCount', label: 'Founders Count (주주 수)', group: 'founders' },
  { id: 'hasMultipleDirectors', label: 'Has Multiple Directors (이사 2명 이상)', group: 'directors' },
  { id: 'hasSingleDirectors', label: 'Has Single Director (이사 1명)', group: 'directors' },
  { id: 'hasMultipleFounders', label: 'Has Multiple Founders (주주 2명 이상)', group: 'founders' },
  { id: 'hasSingleFounders', label: 'Has Single Founder (주주 1명)', group: 'founders' },
  { id: 'hasIndividualFounder', label: 'Has Individual Founder (개인 주주 1명 이상)', group: 'founders' },
  { id: 'hasCorporationFounder', label: 'Has Corporation Founder (법인 주주 1명 이상)', group: 'founders' },
  { id: 'individualFoundersCount', label: 'Individual Founders Count (개인 주주 수)', group: 'founders' },
  { id: 'corporationFoundersCount', label: 'Corporation Founders Count (법인 주주 수)', group: 'founders' },
];

/**
 * 설문 응답에서 계산된 변수 추출
 * @param responses - 설문 답변 배열
 * @returns 계산된 변수 객체 (directorsCount, foundersCount 등)
 */
export function computeVariablesFromResponses(
  responses: SurveyResponse[]
): Record<string, string | number> {
  const computed: Record<string, string | number> = {};

  // 반복 그룹 데이터 처리 (directors, founders 등)
  for (const response of responses) {
    const value = response.value;

    // 배열이면서 객체 배열인 경우 (반복 그룹)
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
      const groupItems = value as Array<Record<string, string>>;
      const baseName = response.questionId;

      // 그룹 개수
      computed[`${baseName}Count`] = groupItems.length;

      // 조건부 플래그
      const capitalizedName = baseName.charAt(0).toUpperCase() + baseName.slice(1);
      computed[`hasMultiple${capitalizedName}`] = groupItems.length >= 2 ? 'true' : '';
      computed[`hasSingle${capitalizedName}`] = groupItems.length === 1 ? 'true' : '';

      // founders 전용: Individual/Corporation 구분
      if (baseName === 'founders') {
        const individualFounders = groupItems.filter(item => item['type']?.toLowerCase() !== 'corporation');
        const corporationFounders = groupItems.filter(item => item['type']?.toLowerCase() === 'corporation');

        computed['individualFoundersCount'] = individualFounders.length;
        computed['corporationFoundersCount'] = corporationFounders.length;
        computed['hasIndividualFounder'] = individualFounders.length >= 1 ? 'true' : '';
        computed['hasCorporationFounder'] = corporationFounders.length >= 1 ? 'true' : '';
      }
    }
  }

  return computed;
}

/**
 * 단일 조건 평가
 * @param condition - 평가할 조건
 * @param responses - 설문 답변 배열
 * @param computedVariables - 계산된 변수 (directorsCount, foundersCount 등)
 * @returns 조건 충족 여부
 */
export function evaluateCondition(
  condition: RuleCondition,
  responses: SurveyResponse[],
  computedVariables?: Record<string, string | number>
): boolean {
  let actualValue: string | string[] | Array<Record<string, string>> | number | undefined;

  // 계산된 변수인 경우 (directorsCount, foundersCount 등)
  if (condition.sourceType === 'computed' && computedVariables) {
    actualValue = computedVariables[condition.questionId];
  } else {
    // 일반 설문 질문인 경우
    const response = responses.find(r => r.questionId === condition.questionId);
    actualValue = response?.value;
  }

  // 답변이 없는 경우
  if (actualValue === undefined || actualValue === null) {
    // != 연산자는 값이 없어도 true
    if (condition.operator === '!=') return true;
    return false;
  }

  // 배열 값을 문자열로 변환
  const valueStr = Array.isArray(actualValue) ? actualValue.join(',') : String(actualValue);

  // 비교할 값 결정: 다른 질문 참조 또는 직접 입력값
  let conditionValue: string;
  if (condition.valueType === 'question' && condition.valueQuestionId) {
    // 다른 질문의 답변과 비교
    const refResponse = responses.find(r => r.questionId === condition.valueQuestionId);
    const refValue = refResponse?.value;
    if (refValue === undefined || refValue === null) {
      // 참조 질문에 답변이 없으면 비교 불가
      return condition.operator === '!=';
    }
    conditionValue = Array.isArray(refValue) ? refValue.join(',') : String(refValue);
  } else {
    // 직접 입력값과 비교
    conditionValue = condition.value;
  }

  switch (condition.operator) {
    case '==':
      // 숫자 비교 시도 (양쪽이 숫자인 경우)
      const numValue = parseFloat(valueStr);
      const numCondition = parseFloat(conditionValue);
      if (!isNaN(numValue) && !isNaN(numCondition)) {
        return numValue === numCondition;
      }
      return valueStr.toLowerCase() === conditionValue.toLowerCase();

    case '!=':
      // 숫자 비교 시도
      const numValue2 = parseFloat(valueStr);
      const numCondition2 = parseFloat(conditionValue);
      if (!isNaN(numValue2) && !isNaN(numCondition2)) {
        return numValue2 !== numCondition2;
      }
      return valueStr.toLowerCase() !== conditionValue.toLowerCase();

    case 'contains':
      return valueStr.toLowerCase().includes(conditionValue.toLowerCase());

    case 'not_contains':
      return !valueStr.toLowerCase().includes(conditionValue.toLowerCase());

    case 'in':
      // conditionValue가 콤마로 구분된 값 목록인 경우
      const allowedValues = conditionValue.split(',').map(v => v.trim().toLowerCase());
      return allowedValues.includes(valueStr.toLowerCase());

    case '>':
      const numVal1 = parseFloat(valueStr);
      const numCond1 = parseFloat(conditionValue);
      return !isNaN(numVal1) && !isNaN(numCond1) && numVal1 > numCond1;

    case '>=':
      const numVal2 = parseFloat(valueStr);
      const numCond2 = parseFloat(conditionValue);
      return !isNaN(numVal2) && !isNaN(numCond2) && numVal2 >= numCond2;

    case '<':
      const numVal3 = parseFloat(valueStr);
      const numCond3 = parseFloat(conditionValue);
      return !isNaN(numVal3) && !isNaN(numCond3) && numVal3 < numCond3;

    case '<=':
      const numVal4 = parseFloat(valueStr);
      const numCond4 = parseFloat(conditionValue);
      return !isNaN(numVal4) && !isNaN(numCond4) && numVal4 <= numCond4;

    default:
      return false;
  }
}

/**
 * 템플릿의 규칙들을 평가하고 점수 반환
 * @param template - 평가할 템플릿
 * @param responses - 설문 답변 배열
 * @param computedVariables - 계산된 변수 (directorsCount, foundersCount 등)
 * @returns 평가 결과 (0.0 ~ 1.0 점수 포함)
 */
export function evaluateRules(
  template: Template,
  responses: SurveyResponse[],
  computedVariables?: Record<string, string | number>
): RuleEvaluationResult {
  const rules = template.rules || [];

  // 규칙이 없는 경우
  if (rules.length === 0) {
    return {
      templateId: template.id,
      score: 0,
      matchedRules: 0,
      totalRules: 0,
      isAlwaysInclude: false,
      isManualOnly: false,
    };
  }

  // "항상 사용" 규칙 확인
  const alwaysIncludeRule = rules.find(r => r.isAlwaysInclude);
  if (alwaysIncludeRule) {
    return {
      templateId: template.id,
      score: 1.0,
      matchedRules: rules.length,
      totalRules: rules.length,
      isAlwaysInclude: true,
      isManualOnly: false,
    };
  }

  // "수동 선택만" 규칙 확인
  const manualOnlyRule = rules.find(r => r.isManualOnly);
  if (manualOnlyRule) {
    return {
      templateId: template.id,
      score: 0,
      matchedRules: 0,
      totalRules: rules.length,
      isAlwaysInclude: false,
      isManualOnly: true,
    };
  }

  // 일반 규칙 평가 - AND 또는 OR 논리 연산자 지원
  let matchedRules = 0;
  let highestPriorityMatch = false;

  // 우선순위 정렬 (낮은 숫자 = 높은 우선순위)
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

  for (const rule of sortedRules) {
    // 규칙에 조건이 없으면 건너뛰기
    if (!rule.conditions || rule.conditions.length === 0) continue;

    // 논리 연산자에 따라 조건 평가
    let conditionsMet: boolean;
    if (rule.logicalOperator === 'OR') {
      // OR: 하나라도 충족되면 true
      conditionsMet = rule.conditions.some(condition =>
        evaluateCondition(condition, responses, computedVariables)
      );
    } else {
      // AND (기본값): 모든 조건이 충족되어야 true
      conditionsMet = rule.conditions.every(condition =>
        evaluateCondition(condition, responses, computedVariables)
      );
    }

    if (conditionsMet) {
      matchedRules++;
      // 첫 번째 매칭 규칙이 가장 높은 우선순위
      if (!highestPriorityMatch) {
        highestPriorityMatch = true;
      }
    }
  }

  // 조건이 있는 규칙만 카운트
  const rulesWithConditions = rules.filter(r => r.conditions && r.conditions.length > 0);
  const totalRules = rulesWithConditions.length;

  // 점수 계산: 매칭된 규칙 비율
  const score = totalRules > 0 ? matchedRules / totalRules : 0;

  return {
    templateId: template.id,
    score,
    matchedRules,
    totalRules,
    isAlwaysInclude: false,
    isManualOnly: false,
  };
}

/**
 * 설문 답변을 기반으로 필요한 템플릿 자동 선택
 *
 * @param responses - 설문 답변 배열
 * @param templates - 전체 템플릿 배열
 * @param computedVariables - 계산된 변수 (directorsCount, foundersCount 등)
 * @returns 분류된 템플릿 목록 (required, suggested, optional)
 *
 * 분류 기준:
 * - required: 규칙 100% 충족 (score === 1.0) 또는 "항상 사용" 설정
 * - suggested: 규칙 50% 이상 충족 (score > 0.5)
 * - optional: 그 외 (수동 선택용 포함)
 */
export function selectTemplates(
  responses: SurveyResponse[],
  templates: Template[],
  computedVariables?: Record<string, string | number>
): TemplateSelection {
  const required: Template[] = [];
  const suggested: Template[] = [];
  const optional: Template[] = [];

  // 활성화된 템플릿만 처리
  const activeTemplates = templates.filter(t => t.isActive);

  for (const template of activeTemplates) {
    const evaluation = evaluateRules(template, responses, computedVariables);

    // 항상 사용 → required
    if (evaluation.isAlwaysInclude) {
      required.push(template);
      continue;
    }

    // 수동 선택만 → optional
    if (evaluation.isManualOnly) {
      optional.push(template);
      continue;
    }

    // 규칙이 없는 템플릿 → optional
    if (evaluation.totalRules === 0) {
      optional.push(template);
      continue;
    }

    // 점수 기반 분류
    if (evaluation.score >= 1.0) {
      required.push(template);
    } else if (evaluation.score > 0.5) {
      suggested.push(template);
    } else {
      optional.push(template);
    }
  }

  // 각 카테고리 내에서 이름순 정렬
  const sortByName = (a: Template, b: Template) =>
    (a.displayName || a.name).localeCompare(b.displayName || b.name);

  return {
    required: required.sort(sortByName),
    suggested: suggested.sort(sortByName),
    optional: optional.sort(sortByName),
  };
}

/**
 * 특정 템플릿의 규칙 충족 상세 정보 반환
 * (디버깅 및 UI 표시용)
 */
export function getTemplateEvaluationDetails(
  template: Template,
  responses: SurveyResponse[],
  computedVariables?: Record<string, string | number>
): {
  evaluation: RuleEvaluationResult;
  conditionDetails: Array<{
    ruleIndex: number;
    condition: RuleCondition;
    isMet: boolean;
    actualValue: string | undefined;
  }>;
} {
  const evaluation = evaluateRules(template, responses, computedVariables);
  const conditionDetails: Array<{
    ruleIndex: number;
    condition: RuleCondition;
    isMet: boolean;
    actualValue: string | undefined;
  }> = [];

  const rules = template.rules || [];
  rules.forEach((rule, ruleIndex) => {
    if (!rule.conditions) return;

    rule.conditions.forEach(condition => {
      let actualValue: string | string[] | Array<Record<string, string>> | number | undefined;

      // 계산된 변수인 경우
      if (condition.sourceType === 'computed' && computedVariables) {
        actualValue = computedVariables[condition.questionId];
      } else {
        const response = responses.find(r => r.questionId === condition.questionId);
        actualValue = response?.value;
      }

      const isMet = evaluateCondition(condition, responses, computedVariables);

      conditionDetails.push({
        ruleIndex,
        condition,
        isMet,
        actualValue: Array.isArray(actualValue) ? actualValue.join(',') : String(actualValue ?? ''),
      });
    });
  });

  return { evaluation, conditionDetails };
}

// ============================================
// 변수 미리보기 생성
// ============================================

/**
 * 변수 치환 결과 미리보기 텍스트 생성
 */
export function generatePreviewText(
  templateText: string,
  variables: Record<string, string>
): string {
  let result = templateText;

  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{${key}\\}`, 'g');
    result = result.replace(regex, value || `[${key}]`);
  }

  return result;
}

// ============================================
// 내보내기
// ============================================

export default {
  // 메인 함수
  transformSurveyToVariables,
  validateVariables,
  generatePreviewText,

  // 수식 평가
  evaluateFormula,

  // 템플릿 선택
  selectTemplates,
  evaluateCondition,
  evaluateRules,
  getTemplateEvaluationDetails,
  computeVariablesFromResponses,
  COMPUTED_VARIABLES,

  // 날짜 유틸리티
  formatDate,
  getCurrentDate,
  getCurrentTime,

  // 숫자 유틸리티 (영문)
  numberToEnglish,
  numberToEnglishCurrency,
  numberToOrdinal,
  formatNumberWithComma,

  // 숫자 유틸리티 (한글)
  numberToKorean,
  numberToKoreanCurrency,

  // 문자열 유틸리티
  formatPhone,
  transformText,

  // 리스트 포맷팅
  formatListAnd,
  formatListOr,
  formatListComma,
  formatListNewline,
  generateArrayHelperVariables,

  // 문서번호
  generateDocumentNumber,

  // 직책 조회
  getRolesForName,
  formatRolesAsTitle,
  getTitleForName,
};
