/**
 * document-generator.ts 테스트
 * 실행: npx ts-node lib/document-generator.test.ts
 */

import {
  numberToKorean,
  numberToKoreanCurrency,
  numberToEnglish,
  numberToEnglishCurrency,
  formatNumberWithComma,
  formatDate,
  formatPhone,
  transformText,
  generateDocumentNumber,
  transformSurveyToVariables,
  validateVariables,
  evaluateCondition,
  evaluateRules,
  selectTemplates,
  SurveyResponse,
  VariableMapping,
  RuleCondition,
  SelectionRule,
  Template,
} from './document-generator.js';

// ============================================
// 테스트 유틸리티
// ============================================

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (error) {
    console.log(`❌ ${name}`);
    console.error(`   Error: ${error}`);
  }
}

function assertEqual(actual: unknown, expected: unknown) {
  if (actual !== expected) {
    throw new Error(`Expected "${expected}" but got "${actual}"`);
  }
}

// ============================================
// 숫자 → 한글 변환 테스트
// ============================================

console.log('\n📝 숫자 → 한글 변환 테스트');
console.log('─'.repeat(40));

test('numberToKorean: 0', () => {
  assertEqual(numberToKorean(0), '영');
});

test('numberToKorean: 1', () => {
  assertEqual(numberToKorean(1), '일');
});

test('numberToKorean: 10', () => {
  assertEqual(numberToKorean(10), '십');
});

test('numberToKorean: 100', () => {
  assertEqual(numberToKorean(100), '백');
});

test('numberToKorean: 1000', () => {
  assertEqual(numberToKorean(1000), '천');
});

test('numberToKorean: 10000', () => {
  assertEqual(numberToKorean(10000), '만');
});

test('numberToKorean: 10000000 (천만)', () => {
  assertEqual(numberToKorean(10000000), '천만');
});

test('numberToKorean: 100000000 (억)', () => {
  assertEqual(numberToKorean(100000000), '억');
});

test('numberToKorean: 12345', () => {
  assertEqual(numberToKorean(12345), '만이천삼백사십오');
});

test('numberToKorean: 10000000 → 천만원', () => {
  assertEqual(numberToKoreanCurrency(10000000), '천만원');
});

test('formatNumberWithComma: 10000000', () => {
  assertEqual(formatNumberWithComma(10000000), '10,000,000');
});

// ============================================
// 숫자 → 영어 변환 테스트
// ============================================

console.log('\n📝 숫자 → 영어 변환 테스트');
console.log('─'.repeat(40));

test('numberToEnglish: 0', () => {
  assertEqual(numberToEnglish(0), 'Zero');
});

test('numberToEnglish: 1', () => {
  assertEqual(numberToEnglish(1), 'One');
});

test('numberToEnglish: 15', () => {
  assertEqual(numberToEnglish(15), 'Fifteen');
});

test('numberToEnglish: 100', () => {
  assertEqual(numberToEnglish(100), 'One Hundred');
});

test('numberToEnglish: 1000', () => {
  assertEqual(numberToEnglish(1000), 'One Thousand');
});

test('numberToEnglish: 1000000', () => {
  assertEqual(numberToEnglish(1000000), 'One Million');
});

test('numberToEnglish: 12345', () => {
  assertEqual(numberToEnglish(12345), 'Twelve Thousand Three Hundred Forty Five');
});

test('numberToEnglishCurrency: 1000000', () => {
  assertEqual(numberToEnglishCurrency(1000000), 'One Million Dollars');
});

test('numberToEnglishCurrency: 1', () => {
  assertEqual(numberToEnglishCurrency(1), 'One Dollar');
});

// ============================================
// 날짜 변환 테스트
// ============================================

console.log('\n📅 날짜 변환 테스트');
console.log('─'.repeat(40));

const testDate = new Date('2026-01-31');

test('formatDate: YYYY-MM-DD', () => {
  assertEqual(formatDate(testDate, 'YYYY-MM-DD'), '2026-01-31');
});

test('formatDate: YYYY년 MM월 DD일', () => {
  assertEqual(formatDate(testDate, 'YYYY년 MM월 DD일'), '2026년 01월 31일');
});

test('formatDate: MM/DD/YYYY', () => {
  assertEqual(formatDate(testDate, 'MM/DD/YYYY'), '01/31/2026');
});

test('formatDate: MMMM D, YYYY', () => {
  assertEqual(formatDate(testDate, 'MMMM D, YYYY'), 'January 31, 2026');
});

test('formatDate: from string', () => {
  assertEqual(formatDate('2026-01-31', 'YYYY-MM-DD'), '2026-01-31');
});

// ============================================
// 전화번호 변환 테스트
// ============================================

console.log('\n📞 전화번호 변환 테스트');
console.log('─'.repeat(40));

test('formatPhone: 01012345678 (dashed)', () => {
  assertEqual(formatPhone('01012345678', 'dashed'), '010-1234-5678');
});

test('formatPhone: 0212345678 (dashed)', () => {
  assertEqual(formatPhone('0212345678', 'dashed'), '02-1234-5678');
});

test('formatPhone: 01012345678 (dotted)', () => {
  assertEqual(formatPhone('01012345678', 'dotted'), '010.1234.5678');
});

test('formatPhone: 01012345678 (none)', () => {
  assertEqual(formatPhone('01012345678', 'none'), '01012345678');
});

// ============================================
// 텍스트 변환 테스트
// ============================================

console.log('\n📝 텍스트 변환 테스트');
console.log('─'.repeat(40));

test('transformText: uppercase', () => {
  assertEqual(transformText('hello world', 'uppercase'), 'HELLO WORLD');
});

test('transformText: lowercase', () => {
  assertEqual(transformText('HELLO WORLD', 'lowercase'), 'hello world');
});

test('transformText: capitalize', () => {
  assertEqual(transformText('hello world', 'capitalize'), 'Hello world');
});

test('transformText: title', () => {
  assertEqual(transformText('hello world', 'title'), 'Hello World');
});

// ============================================
// 문서번호 생성 테스트
// ============================================

console.log('\n🔢 문서번호 생성 테스트');
console.log('─'.repeat(40));

test('generateDocumentNumber: 형식 확인', () => {
  const docNum = generateDocumentNumber('DOC');
  const pattern = /^DOC-\d{8}-[A-Z0-9]{6}$/;
  if (!pattern.test(docNum)) {
    throw new Error(`Invalid format: ${docNum}`);
  }
});

test('generateDocumentNumber: 날짜 없이', () => {
  const docNum = generateDocumentNumber('INV', false);
  const pattern = /^INV-[A-Z0-9]{6}$/;
  if (!pattern.test(docNum)) {
    throw new Error(`Invalid format: ${docNum}`);
  }
});

// ============================================
// 메인 변환 함수 테스트
// ============================================

console.log('\n🔄 메인 변환 함수 테스트');
console.log('─'.repeat(40));

test('transformSurveyToVariables: 기본 동작', () => {
  const responses: SurveyResponse[] = [
    { questionId: 'companyName1', value: 'Test Corp' },
    { questionId: 'email', value: 'TEST@EXAMPLE.COM' },
    { questionId: 'founder1Cash', value: '1000000' },
    { questionId: 'state', value: 'delaware' },
  ];

  const mappings: VariableMapping[] = [
    { variableName: 'companyName', questionId: 'companyName1', dataType: 'text', transformRule: 'none', required: true },
    { variableName: 'email', questionId: 'email', dataType: 'email', transformRule: 'none', required: true },
    { variableName: 'capital', questionId: 'founder1Cash', dataType: 'currency', transformRule: 'number_english', required: true },
    { variableName: 'capitalFormatted', questionId: 'founder1Cash', dataType: 'currency', transformRule: 'comma_dollar', required: true },
    { variableName: 'state', questionId: 'state', dataType: 'text', transformRule: 'uppercase', required: true },
  ];

  const result = transformSurveyToVariables(responses, mappings);

  assertEqual(result['companyName'], 'Test Corp');
  assertEqual(result['email'], 'test@example.com');
  assertEqual(result['capital'], 'One Million Dollars');
  assertEqual(result['capitalFormatted'], '$1,000,000');
  assertEqual(result['state'], 'DELAWARE');

  // 자동 생성 변수 확인 (영문)
  if (!result['currentDate']) throw new Error('currentDate missing');
  if (!result['documentNumber']) throw new Error('documentNumber missing');
});

test('transformSurveyToVariables: 날짜 변환', () => {
  const responses: SurveyResponse[] = [
    { questionId: 'foundingDate', value: '2026-03-15' },
  ];

  const mappings: VariableMapping[] = [
    { variableName: 'foundingDate', questionId: 'foundingDate', dataType: 'date', transformRule: 'YYYY년 MM월 DD일', required: true },
  ];

  const result = transformSurveyToVariables(responses, mappings);
  assertEqual(result['foundingDate'], '2026년 03월 15일');
});

test('transformSurveyToVariables: 기본값 처리', () => {
  const responses: SurveyResponse[] = [];

  const mappings: VariableMapping[] = [
    { variableName: 'country', questionId: 'countryQ', dataType: 'text', transformRule: 'none', required: false, defaultValue: 'United States' },
  ];

  const result = transformSurveyToVariables(responses, mappings);
  assertEqual(result['country'], 'United States');
});

// ============================================
// 유효성 검사 테스트
// ============================================

console.log('\n✅ 유효성 검사 테스트');
console.log('─'.repeat(40));

test('validateVariables: 유효한 경우', () => {
  const variables = { companyName: 'Test Corp', email: 'test@test.com' };
  const mappings: VariableMapping[] = [
    { variableName: 'companyName', questionId: 'q1', dataType: 'text', transformRule: 'none', required: true },
    { variableName: 'email', questionId: 'q2', dataType: 'email', transformRule: 'none', required: true },
  ];

  const result = validateVariables(variables, mappings);
  assertEqual(result.isValid, true);
  assertEqual(result.missingVariables.length, 0);
  assertEqual(result.emptyRequired.length, 0);
});

test('validateVariables: 필수값 누락', () => {
  const variables = { companyName: '', email: 'test@test.com' };
  const mappings: VariableMapping[] = [
    { variableName: 'companyName', questionId: 'q1', dataType: 'text', transformRule: 'none', required: true },
    { variableName: 'email', questionId: 'q2', dataType: 'email', transformRule: 'none', required: true },
  ];

  const result = validateVariables(variables, mappings);
  assertEqual(result.isValid, false);
  assertEqual(result.emptyRequired.length, 1);
});

// ============================================
// 템플릿 선택 로직 테스트
// ============================================

console.log('\n📋 템플릿 선택 로직 테스트');
console.log('─'.repeat(40));

// 테스트용 템플릿 생성
const createTestTemplate = (
  id: string,
  name: string,
  rules: SelectionRule[] = [],
  isActive = true
): Template => ({
  id,
  name,
  displayName: name,
  category: 'test',
  rules,
  isActive,
});

test('evaluateCondition: == 연산자', () => {
  const condition: RuleCondition = { questionId: 'state', operator: '==', value: 'delaware' };
  const responses: SurveyResponse[] = [{ questionId: 'state', value: 'delaware' }];
  assertEqual(evaluateCondition(condition, responses), true);
});

test('evaluateCondition: == 대소문자 무시', () => {
  const condition: RuleCondition = { questionId: 'state', operator: '==', value: 'Delaware' };
  const responses: SurveyResponse[] = [{ questionId: 'state', value: 'DELAWARE' }];
  assertEqual(evaluateCondition(condition, responses), true);
});

test('evaluateCondition: != 연산자', () => {
  const condition: RuleCondition = { questionId: 'state', operator: '!=', value: 'california' };
  const responses: SurveyResponse[] = [{ questionId: 'state', value: 'delaware' }];
  assertEqual(evaluateCondition(condition, responses), true);
});

test('evaluateCondition: contains 연산자', () => {
  const condition: RuleCondition = { questionId: 'name', operator: 'contains', value: 'Corp' };
  const responses: SurveyResponse[] = [{ questionId: 'name', value: 'Test Corporation Inc' }];
  assertEqual(evaluateCondition(condition, responses), true);
});

test('evaluateCondition: in 연산자', () => {
  const condition: RuleCondition = { questionId: 'state', operator: 'in', value: 'delaware,california,new york' };
  const responses: SurveyResponse[] = [{ questionId: 'state', value: 'california' }];
  assertEqual(evaluateCondition(condition, responses), true);
});

test('evaluateCondition: > 연산자', () => {
  const condition: RuleCondition = { questionId: 'capital', operator: '>', value: '1000000' };
  const responses: SurveyResponse[] = [{ questionId: 'capital', value: '5000000' }];
  assertEqual(evaluateCondition(condition, responses), true);
});

test('evaluateCondition: >= 연산자', () => {
  const condition: RuleCondition = { questionId: 'capital', operator: '>=', value: '1000000' };
  const responses: SurveyResponse[] = [{ questionId: 'capital', value: '1000000' }];
  assertEqual(evaluateCondition(condition, responses), true);
});

test('evaluateCondition: 답변 없음 시 false', () => {
  const condition: RuleCondition = { questionId: 'state', operator: '==', value: 'delaware' };
  const responses: SurveyResponse[] = [];
  assertEqual(evaluateCondition(condition, responses), false);
});

test('evaluateCondition: 답변 없음 + != 시 true', () => {
  const condition: RuleCondition = { questionId: 'state', operator: '!=', value: 'delaware' };
  const responses: SurveyResponse[] = [];
  assertEqual(evaluateCondition(condition, responses), true);
});

console.log('\n📋 규칙 평가 테스트');
console.log('─'.repeat(40));

test('evaluateRules: 항상 사용 템플릿', () => {
  const template = createTestTemplate('t1', 'Always Template', [
    { conditions: [], priority: 1, isAlwaysInclude: true, isManualOnly: false },
  ]);
  const result = evaluateRules(template, []);
  assertEqual(result.isAlwaysInclude, true);
  assertEqual(result.score, 1.0);
});

test('evaluateRules: 수동 선택만 템플릿', () => {
  const template = createTestTemplate('t2', 'Manual Only Template', [
    { conditions: [], priority: 1, isAlwaysInclude: false, isManualOnly: true },
  ]);
  const result = evaluateRules(template, []);
  assertEqual(result.isManualOnly, true);
  assertEqual(result.score, 0);
});

test('evaluateRules: 규칙 100% 충족', () => {
  const template = createTestTemplate('t3', 'Full Match Template', [
    {
      conditions: [{ questionId: 'state', operator: '==', value: 'delaware' }],
      priority: 1,
      isAlwaysInclude: false,
      isManualOnly: false,
    },
  ]);
  const responses: SurveyResponse[] = [{ questionId: 'state', value: 'delaware' }];
  const result = evaluateRules(template, responses);
  assertEqual(result.score, 1.0);
  assertEqual(result.matchedRules, 1);
});

test('evaluateRules: 규칙 50% 충족 (2개 중 1개)', () => {
  const template = createTestTemplate('t4', 'Partial Match Template', [
    {
      conditions: [{ questionId: 'state', operator: '==', value: 'delaware' }],
      priority: 1,
      isAlwaysInclude: false,
      isManualOnly: false,
    },
    {
      conditions: [{ questionId: 'type', operator: '==', value: 'llc' }],
      priority: 2,
      isAlwaysInclude: false,
      isManualOnly: false,
    },
  ]);
  const responses: SurveyResponse[] = [{ questionId: 'state', value: 'delaware' }];
  const result = evaluateRules(template, responses);
  assertEqual(result.score, 0.5);
  assertEqual(result.matchedRules, 1);
  assertEqual(result.totalRules, 2);
});

test('evaluateRules: AND 조건 - 모두 충족', () => {
  const template = createTestTemplate('t5', 'AND Conditions Template', [
    {
      conditions: [
        { questionId: 'state', operator: '==', value: 'delaware' },
        { questionId: 'type', operator: '==', value: 'corp' },
      ],
      priority: 1,
      isAlwaysInclude: false,
      isManualOnly: false,
    },
  ]);
  const responses: SurveyResponse[] = [
    { questionId: 'state', value: 'delaware' },
    { questionId: 'type', value: 'corp' },
  ];
  const result = evaluateRules(template, responses);
  assertEqual(result.score, 1.0);
});

test('evaluateRules: AND 조건 - 일부만 충족', () => {
  const template = createTestTemplate('t6', 'AND Partial Template', [
    {
      conditions: [
        { questionId: 'state', operator: '==', value: 'delaware' },
        { questionId: 'type', operator: '==', value: 'corp' },
      ],
      priority: 1,
      isAlwaysInclude: false,
      isManualOnly: false,
    },
  ]);
  const responses: SurveyResponse[] = [{ questionId: 'state', value: 'delaware' }];
  const result = evaluateRules(template, responses);
  assertEqual(result.score, 0); // AND이므로 부분 충족은 0
});

console.log('\n📋 selectTemplates 테스트');
console.log('─'.repeat(40));

test('selectTemplates: 분류 테스트', () => {
  const templates: Template[] = [
    // 항상 사용 → required
    createTestTemplate('always', 'Always Include', [
      { conditions: [], priority: 1, isAlwaysInclude: true, isManualOnly: false },
    ]),
    // 100% 충족 → required
    createTestTemplate('full-match', 'Full Match', [
      {
        conditions: [{ questionId: 'state', operator: '==', value: 'delaware' }],
        priority: 1,
        isAlwaysInclude: false,
        isManualOnly: false,
      },
    ]),
    // 50% 초과 충족 → suggested (2개 중 2개 매칭이 아닌 경우)
    createTestTemplate('partial-match', 'Partial Match', [
      {
        conditions: [{ questionId: 'state', operator: '==', value: 'delaware' }],
        priority: 1,
        isAlwaysInclude: false,
        isManualOnly: false,
      },
      {
        conditions: [{ questionId: 'capital', operator: '>', value: '10000000' }],
        priority: 2,
        isAlwaysInclude: false,
        isManualOnly: false,
      },
    ]),
    // 수동 선택만 → optional
    createTestTemplate('manual-only', 'Manual Only', [
      { conditions: [], priority: 1, isAlwaysInclude: false, isManualOnly: true },
    ]),
    // 규칙 없음 → optional
    createTestTemplate('no-rules', 'No Rules', []),
    // 비활성화 → 제외
    createTestTemplate('inactive', 'Inactive', [], false),
  ];

  const responses: SurveyResponse[] = [
    { questionId: 'state', value: 'delaware' },
    { questionId: 'capital', value: '5000000' }, // 10,000,000 미만
  ];

  const result = selectTemplates(responses, templates);

  // required: always + full-match
  assertEqual(result.required.length, 2);
  if (!result.required.find(t => t.id === 'always')) throw new Error('always not in required');
  if (!result.required.find(t => t.id === 'full-match')) throw new Error('full-match not in required');

  // suggested: partial-match (1/2 = 0.5, 50% 초과 아님)
  // 실제로 0.5는 > 0.5가 아니므로 optional로 감
  assertEqual(result.suggested.length, 0);

  // optional: partial-match + manual-only + no-rules
  assertEqual(result.optional.length, 3);
  if (!result.optional.find(t => t.id === 'partial-match')) throw new Error('partial-match not in optional');
  if (!result.optional.find(t => t.id === 'manual-only')) throw new Error('manual-only not in optional');
  if (!result.optional.find(t => t.id === 'no-rules')) throw new Error('no-rules not in optional');

  // inactive는 제외
  const allIds = [...result.required, ...result.suggested, ...result.optional].map(t => t.id);
  if (allIds.includes('inactive')) throw new Error('inactive should be excluded');
});

test('selectTemplates: 60% 충족 → suggested', () => {
  const templates: Template[] = [
    createTestTemplate('sixty-percent', 'Sixty Percent', [
      {
        conditions: [{ questionId: 'q1', operator: '==', value: 'yes' }],
        priority: 1,
        isAlwaysInclude: false,
        isManualOnly: false,
      },
      {
        conditions: [{ questionId: 'q2', operator: '==', value: 'yes' }],
        priority: 2,
        isAlwaysInclude: false,
        isManualOnly: false,
      },
      {
        conditions: [{ questionId: 'q3', operator: '==', value: 'yes' }],
        priority: 3,
        isAlwaysInclude: false,
        isManualOnly: false,
      },
      {
        conditions: [{ questionId: 'q4', operator: '==', value: 'yes' }],
        priority: 4,
        isAlwaysInclude: false,
        isManualOnly: false,
      },
      {
        conditions: [{ questionId: 'q5', operator: '==', value: 'yes' }],
        priority: 5,
        isAlwaysInclude: false,
        isManualOnly: false,
      },
    ]),
  ];

  // 5개 중 3개 충족 = 60%
  const responses: SurveyResponse[] = [
    { questionId: 'q1', value: 'yes' },
    { questionId: 'q2', value: 'yes' },
    { questionId: 'q3', value: 'yes' },
    { questionId: 'q4', value: 'no' },
    { questionId: 'q5', value: 'no' },
  ];

  const result = selectTemplates(responses, templates);

  assertEqual(result.suggested.length, 1);
  assertEqual(result.suggested[0].id, 'sixty-percent');
});

// ============================================
// 결과 요약
// ============================================

console.log('\n' + '═'.repeat(40));
console.log('테스트 완료!');
console.log('═'.repeat(40) + '\n');
