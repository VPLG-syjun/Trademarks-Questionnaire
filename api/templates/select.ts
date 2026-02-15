import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from 'redis';
import {
  selectTemplates,
  evaluateRules,
  computeVariablesFromResponses,
  SurveyResponse,
  Template,
  SelectionRule,
  RuleCondition,
} from '../../lib/document-generator.js';

const SURVEYS_KEY = 'surveys';
const TEMPLATES_KEY = 'templates';
const TEMPLATE_RULES_KEY = 'template_rules';

async function getRedisClient() {
  const client = createClient({ url: process.env.REDIS_URL });
  await client.connect();
  return client;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let client;
  try {
    client = await getRedisClient();

    const { surveyId, answers } = req.body;

    let responses: SurveyResponse[] = [];

    // surveyId가 제공된 경우 설문 데이터 조회
    if (surveyId) {
      const surveyData = await client.hGet(SURVEYS_KEY, surveyId);
      if (!surveyData) {
        return res.status(404).json({ error: 'Survey not found' });
      }

      const survey = JSON.parse(surveyData);
      responses = survey.answers || [];

      // 고객 정보도 응답에 추가
      if (survey.customerInfo) {
        if (survey.customerInfo.name) {
          responses.push({ questionId: '__customerName', value: survey.customerInfo.name });
        }
        if (survey.customerInfo.email) {
          responses.push({ questionId: '__customerEmail', value: survey.customerInfo.email });
        }
        if (survey.customerInfo.company) {
          responses.push({ questionId: '__customerCompany', value: survey.customerInfo.company });
        }
      }
    }
    // answers 객체가 직접 제공된 경우 (legacy 지원)
    else if (answers && typeof answers === 'object') {
      responses = Object.entries(answers).map(([questionId, value]) => ({
        questionId,
        value: value as string | string[],
      }));
    } else {
      return res.status(400).json({ error: 'surveyId or answers is required' });
    }

    // 모든 활성화된 템플릿 조회
    const allTemplatesData = await client.hGetAll(TEMPLATES_KEY);
    const templatesRaw = Object.values(allTemplatesData)
      .map((t) => JSON.parse(t as string))
      .filter((t) => t.isActive);

    // 모든 규칙 조회
    const allRulesData = await client.hGetAll(TEMPLATE_RULES_KEY);
    const allRules = Object.values(allRulesData).map((r) => JSON.parse(r as string));

    // 템플릿에 규칙 매핑
    const templates: Template[] = templatesRaw.map((t) => {
      const templateRules = allRules.filter((r) => r.templateId === t.id);

      // 규칙을 SelectionRule 형식으로 변환
      const rules: SelectionRule[] = templateRules.map((r) => {
        // 새 형식 규칙 (conditions 배열)
        if (r.conditions && Array.isArray(r.conditions)) {
          return {
            id: r.id,
            conditions: r.conditions as RuleCondition[],
            logicalOperator: r.logicalOperator || 'AND',
            priority: r.priority || 1,
            isAlwaysInclude: r.isAlwaysInclude || false,
            isManualOnly: r.isManualOnly || false,
          };
        }

        // 레거시 형식 규칙 (단일 조건)
        const conditions: RuleCondition[] = [];
        if (r.ruleType === 'always') {
          return {
            id: r.id,
            conditions: [],
            logicalOperator: 'AND',
            priority: r.priority || 1,
            isAlwaysInclude: true,
            isManualOnly: false,
          };
        }

        if (r.questionId && r.conditionOperator && r.conditionValue !== null) {
          conditions.push({
            questionId: r.questionId,
            operator: r.conditionOperator,
            value: r.conditionValue,
          });
        }

        return {
          id: r.id,
          conditions,
          logicalOperator: 'AND',
          priority: r.priority || 100,
          isAlwaysInclude: false,
          isManualOnly: false,
        };
      });

      return {
        id: t.id,
        name: t.name,
        displayName: t.displayName || t.name,
        category: t.category || 'Other',
        rules,
        isActive: t.isActive,
        repeatForPersons: t.repeatForPersons || false,  // 인원별 반복 생성 설정
        personTypeFilter: t.personTypeFilter || 'all',  // 인원 필터 (individual_founder, corporation_founder 등)
      };
    });

    // 계산된 변수 생성 (directorsCount, foundersCount 등)
    const computedVariables = computeVariablesFromResponses(responses);

    // 템플릿 선택 로직 실행
    const selection = selectTemplates(responses, templates, computedVariables);

    // 디버깅을 위한 규칙 평가 결과 (개발 중에만 사용)
    const debugEvaluations = templates.map((t) => {
      const evaluation = evaluateRules(t, responses, computedVariables);
      return {
        templateId: t.id,
        templateName: t.displayName || t.name,
        rules: t.rules?.map((r) => ({
          id: r.id,
          conditions: r.conditions,
          isAlwaysInclude: r.isAlwaysInclude,
          isManualOnly: r.isManualOnly,
        })),
        evaluation,
      };
    });

    return res.status(200).json({
      required: selection.required,
      suggested: selection.suggested,
      optional: selection.optional,
      debug: {
        surveyResponses: responses.map((r) => ({
          questionId: r.questionId,
          value: r.value,
        })),
        computedVariables,  // 디버깅용으로 계산된 변수도 포함
        templateEvaluations: debugEvaluations,
      },
      stats: {
        totalTemplates: templates.length,
        required: selection.required.length,
        suggested: selection.suggested.length,
        optional: selection.optional.length,
      },
    });
  } catch (error) {
    console.error('Template Selection API Error:', error);
    return res.status(500).json({ error: 'Server error occurred' });
  } finally {
    if (client) await client.disconnect();
  }
}
