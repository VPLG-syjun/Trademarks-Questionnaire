import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from 'redis';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import {
  transformSurveyToVariables,
  SurveyResponse,
  VariableMapping,
} from '../../lib/document-generator.js';

const SURVEYS_KEY = 'surveys';
const TEMPLATES_KEY = 'templates';
const TEMPLATE_FILES_KEY = 'template_files';
const TEMPLATE_VARIABLES_KEY = 'template_variables';

// 샘플 데이터 (템플릿 미리보기용)
const SAMPLE_DATA: Record<string, string> = {
  companyName: 'ABC Startup Inc.',
  companyName1: 'ABC Startup Inc.',
  founderName: 'John Smith',
  founderName1: 'John Smith',
  founderEmail: 'john@abcstartup.com',
  investorName: 'XYZ Ventures LLC',
  investmentAmount: '500000',
  state: 'Delaware',
  incorporationDate: '2026-01-15',
  totalShares: '10000000',
  parValue: '0.0001',
  address: '123 Main Street, Suite 100, San Francisco, CA 94102',
  phone: '415-555-1234',
  email: 'contact@abcstartup.com',
  __customerName: 'John Smith',
  __customerEmail: 'john@example.com',
  __customerCompany: 'ABC Startup Inc.',
};

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

    const { templateId, surveyId, useSampleData = false } = req.body;

    if (!templateId) {
      return res.status(400).json({ error: 'templateId is required' });
    }

    // 1. 템플릿 메타데이터 조회
    const templateData = await client.hGet(TEMPLATES_KEY, templateId);
    if (!templateData) {
      return res.status(404).json({ error: 'Template not found' });
    }
    const template = JSON.parse(templateData);

    // 2. 템플릿 파일 조회
    const fileData = await client.hGet(TEMPLATE_FILES_KEY, templateId);
    if (!fileData) {
      return res.status(404).json({ error: 'Template file not found' });
    }
    const templateBuffer = Buffer.from(fileData, 'base64');

    // 3. 변수 매핑 정보 조회
    const allVariables = await client.hGetAll(TEMPLATE_VARIABLES_KEY);
    const variableMappings: VariableMapping[] = Object.values(allVariables)
      .map(v => JSON.parse(v as string))
      .filter(v => v.templateId === templateId);

    // 4. 변수 데이터 준비
    let variables: Record<string, string>;

    if (useSampleData || !surveyId) {
      // 샘플 데이터 사용
      const sampleResponses: SurveyResponse[] = Object.entries(SAMPLE_DATA).map(
        ([questionId, value]) => ({ questionId, value })
      );
      variables = transformSurveyToVariables(sampleResponses, variableMappings);

      // 매핑되지 않은 변수도 샘플 데이터로 채우기
      Object.entries(SAMPLE_DATA).forEach(([key, value]) => {
        if (!variables[key]) {
          variables[key] = value;
        }
      });
    } else {
      // 실제 설문 데이터 사용
      const surveyData = await client.hGet(SURVEYS_KEY, surveyId);
      if (!surveyData) {
        return res.status(404).json({ error: 'Survey not found' });
      }

      const survey = JSON.parse(surveyData);
      const responses: SurveyResponse[] = survey.answers || [];

      // 고객 정보 추가
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

      variables = transformSurveyToVariables(responses, variableMappings);
    }

    // 5. 문서 생성
    const zip = new PizZip(templateBuffer);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '{', end: '}' },
    });

    doc.render(variables);

    const generatedBuffer = doc.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });

    // 6. Base64로 인코딩하여 반환
    const base64Doc = generatedBuffer.toString('base64');

    return res.status(200).json({
      success: true,
      templateName: template.displayName || template.name,
      documentBase64: base64Doc,
      variables: variables,
      usedSampleData: useSampleData || !surveyId,
    });

  } catch (error: any) {
    console.error('Preview Document API Error:', error);
    return res.status(500).json({
      error: 'Failed to generate preview',
      details: error.message,
    });
  } finally {
    if (client) await client.disconnect();
  }
}
