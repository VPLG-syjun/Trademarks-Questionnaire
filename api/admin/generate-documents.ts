import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import * as Archiver from 'archiver';
import { PassThrough } from 'stream';
import {
  transformSurveyToVariables,
  validateVariables,
  SurveyResponse,
  VariableMapping,
  formatNumberWithComma,
  toTitleCase,
  capitalize,
} from '../../lib/document-generator.js';

// Redis Keys
const SURVEYS_KEY = 'surveys';
const TEMPLATES_KEY = 'templates';
const TEMPLATE_FILES_KEY = 'template_files';
const TEMPLATE_VARIABLES_KEY = 'template_variables';
const GENERATED_DOCS_KEY = 'generated_documents';
const TEMP_FILES_KEY = 'temp_files';

// 24시간 TTL for temporary files
const TEMP_FILE_TTL = 60 * 60 * 24;

interface GenerateRequest {
  surveyId: string;
  selectedTemplates: string[];
  overrideVariables?: Record<string, string>;
  repeatForSelections?: Record<string, number[]>;  // 템플릿ID별 선택된 인원 인덱스 (0-based)
}

interface DocumentResult {
  templateId: string;
  templateName: string;
  filename: string;
  status: 'success' | 'error';
  error?: string;
  missingVariables?: string[];
}

interface GenerationRecord {
  id: string;
  surveyId: string;
  templates: DocumentResult[];
  zipFilename: string;
  downloadId: string;
  generatedAt: string;
  generatedBy?: string;
}

async function getRedisClient() {
  const client = createClient({ url: process.env.REDIS_URL });
  await client.connect();
  return client;
}

/**
 * 문서 파일명 생성
 */
function generateFilename(templateName: string, companyName: string, personName?: string): string {
  const date = new Date();
  const dateStr = `${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}`;

  // 파일명에 사용할 수 없는 문자 제거
  const safeName = (companyName || 'Document').replace(/[<>:"/\\|?*]/g, '_').trim();
  const safeTemplateName = templateName.replace(/[<>:"/\\|?*]/g, '_').trim();

  // 인원별 문서인 경우 이름 추가
  if (personName) {
    const safePersonName = personName.replace(/[<>:"/\\|?*]/g, '_').trim();
    return `${safeTemplateName}_${safePersonName}_${dateStr}.docx`;
  }

  return `${safeTemplateName}_${safeName}_${dateStr}.docx`;
}

/**
 * ZIP 파일명 생성
 */
function generateZipFilename(companyName: string): string {
  const date = new Date();
  const dateStr = `${date.getFullYear()}${(date.getMonth() + 1).toString().padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}`;

  const safeName = (companyName || 'Documents').replace(/[<>:"/\\|?*]/g, '_').trim();

  return `${safeName}_Legal_Documents_${dateStr}.zip`;
}

/**
 * 설문에서 모든 인원과 직책 추출
 */
interface PersonWithRoles {
  name: string;
  roles: string[];
  address?: string;
  email?: string;
  cash?: string;
  type?: 'individual' | 'corporation';  // Founder의 경우 개인/법인 구분
  ceoName?: string;  // 법인인 경우 해당 법인의 CEO 이름
}

function extractAllPersons(responses: SurveyResponse[]): PersonWithRoles[] {
  const personMap = new Map<string, PersonWithRoles>();

  const getAnswer = (questionId: string): string | undefined => {
    const answer = responses.find(r => r.questionId === questionId);
    return typeof answer?.value === 'string' ? answer.value : undefined;
  };

  // 1. Directors (이사)
  const directorsResponse = responses.find(r => r.questionId === 'directors');
  if (directorsResponse && Array.isArray(directorsResponse.value)) {
    for (const director of directorsResponse.value as Array<{ name?: string; address?: string; email?: string }>) {
      const name = director.name?.trim();
      if (!name) continue;

      if (personMap.has(name)) {
        personMap.get(name)!.roles.push('Director');
        if (!personMap.get(name)!.address && director.address) personMap.get(name)!.address = director.address;
        if (!personMap.get(name)!.email && director.email) personMap.get(name)!.email = director.email;
      } else {
        personMap.set(name, {
          name,
          roles: ['Director'],
          address: director.address,
          email: director.email,
        });
      }
    }
  }

  // 2. Founders (창업자/주주)
  const foundersResponse = responses.find(r => r.questionId === 'founders');
  if (foundersResponse && Array.isArray(foundersResponse.value)) {
    for (const founder of foundersResponse.value as Array<{ name?: string; address?: string; email?: string; cash?: string; type?: string; ceoName?: string; ceoname?: string }>) {
      const name = founder.name?.trim();
      if (!name) continue;

      const founderType = (founder.type?.toLowerCase() === 'corporation' ? 'corporation' : 'individual') as 'individual' | 'corporation';
      // 법인인 경우 ceoName 추출 (대소문자 모두 지원)
      const founderCeoName = founder.ceoName || founder.ceoname || '';

      if (personMap.has(name)) {
        personMap.get(name)!.roles.push('Founder');
        if (!personMap.get(name)!.address && founder.address) personMap.get(name)!.address = founder.address;
        if (!personMap.get(name)!.email && founder.email) personMap.get(name)!.email = founder.email;
        if (founder.cash) personMap.get(name)!.cash = founder.cash;
        // 법인 타입인 경우에만 type 설정 (개인은 기본값)
        if (founderType === 'corporation') {
          personMap.get(name)!.type = 'corporation';
          if (founderCeoName) personMap.get(name)!.ceoName = founderCeoName;
        }
      } else {
        personMap.set(name, {
          name,
          roles: ['Founder'],
          address: founder.address,
          email: founder.email,
          cash: founder.cash,
          type: founderType,
          ceoName: founderType === 'corporation' ? founderCeoName : undefined,
        });
      }
    }
  }

  // 3. CEO
  const ceoName = getAnswer('ceoName')?.trim();
  if (ceoName) {
    if (personMap.has(ceoName)) {
      personMap.get(ceoName)!.roles.push('CEO');
      if (!personMap.get(ceoName)!.address) personMap.get(ceoName)!.address = getAnswer('ceoAddress');
      if (!personMap.get(ceoName)!.email) personMap.get(ceoName)!.email = getAnswer('ceoEmail');
    } else {
      personMap.set(ceoName, {
        name: ceoName,
        roles: ['CEO'],
        address: getAnswer('ceoAddress'),
        email: getAnswer('ceoEmail'),
      });
    }
  }

  // 4. CFO
  const cfoName = getAnswer('cfoName')?.trim();
  if (cfoName) {
    if (personMap.has(cfoName)) {
      personMap.get(cfoName)!.roles.push('CFO');
      if (!personMap.get(cfoName)!.address) personMap.get(cfoName)!.address = getAnswer('cfoAddress');
      if (!personMap.get(cfoName)!.email) personMap.get(cfoName)!.email = getAnswer('cfoEmail');
    } else {
      personMap.set(cfoName, {
        name: cfoName,
        roles: ['CFO'],
        address: getAnswer('cfoAddress'),
        email: getAnswer('cfoEmail'),
      });
    }
  }

  // 5. Corporate Secretary
  const csName = getAnswer('csName')?.trim();
  if (csName) {
    if (personMap.has(csName)) {
      personMap.get(csName)!.roles.push('Corporate Secretary');
      if (!personMap.get(csName)!.address) personMap.get(csName)!.address = getAnswer('csAddress');
      if (!personMap.get(csName)!.email) personMap.get(csName)!.email = getAnswer('csEmail');
    } else {
      personMap.set(csName, {
        name: csName,
        roles: ['Corporate Secretary'],
        address: getAnswer('csAddress'),
        email: getAnswer('csEmail'),
      });
    }
  }

  // 6. Chairman (의장)
  const chairmanName = getAnswer('chairmanName')?.trim();
  if (chairmanName) {
    if (personMap.has(chairmanName)) {
      personMap.get(chairmanName)!.roles.push('Chairman');
    } else {
      personMap.set(chairmanName, {
        name: chairmanName,
        roles: ['Chairman'],
      });
    }
  }

  return Array.from(personMap.values());
}

/**
 * 인원별 변수 생성 (개인 정보로 전역 변수 덮어쓰기)
 */
function createPersonVariables(
  baseVariables: Record<string, string>,
  person: PersonWithRoles
): Record<string, string> {
  const personVars: Record<string, string> = { ...baseVariables };

  // 디버깅: 인원 정보 로깅
  console.log(`[DEBUG] createPersonVariables for: ${person.name}`, {
    roles: person.roles,
    type: person.type || 'individual',
    address: person.address || '(none)',
    email: person.email || '(none)',
    cash: person.cash || '(none)',
    ceoName: person.ceoName || '(none)',
  });

  // 이름에 Title Case 적용 (법인은 Capitalize)
  const isCorporation = person.type === 'corporation';
  const formattedName = isCorporation
    ? capitalize(person.name || '')  // 법인명은 Capitalize
    : toTitleCase(person.name || '');  // 개인명은 Title Case

  // 공통 인원 변수 (항상 설정, 빈 문자열 포함)
  personVars['PersonName'] = formattedName;
  personVars['personName'] = formattedName;
  personVars['PersonAddress'] = person.address || '';
  personVars['personAddress'] = person.address || '';
  personVars['PersonEmail'] = person.email || '';
  personVars['personEmail'] = person.email || '';
  personVars['PersonRoles'] = person.roles.join(' / ');
  personVars['personRoles'] = person.roles.join(' / ');

  // 법인인 경우 CEO 이름 설정 (Title Case 적용)
  if (isCorporation && person.ceoName) {
    const formattedCeoName = toTitleCase(person.ceoName);
    personVars['PersonCeoName'] = formattedCeoName;
    personVars['personCeoName'] = formattedCeoName;
    personVars['PersonCEOName'] = formattedCeoName;
  } else {
    personVars['PersonCeoName'] = '';
    personVars['personCeoName'] = '';
    personVars['PersonCEOName'] = '';
  }

  // 출자금 (항상 설정 - 빈 문자열 허용)
  // $ + comma 형식 적용 (예: $10,000)
  const rawCash = person.cash || '';
  const cashNum = parseFloat(rawCash.replace(/[$,]/g, '') || '0');
  if (cashNum > 0) {
    const formattedCash = '$' + formatNumberWithComma(cashNum);
    personVars['PersonCash'] = formattedCash;
    personVars['personCash'] = formattedCash;
  } else {
    personVars['PersonCash'] = '';
    personVars['personCash'] = '';
  }

  // PersonShare 계산: PersonCash / FMV
  // FMV는 baseVariables에서 가져옴 (fairMarketValue 또는 FMV - $ 제거 필요)
  const fmvStr = baseVariables['fairMarketValue'] || baseVariables['FMV'] || '0';
  const fmv = parseFloat(fmvStr.replace(/[$,]/g, ''));
  if (fmv > 0 && cashNum > 0) {
    const share = Math.floor(cashNum / fmv);  // 정수 주식 수
    const formattedShare = formatNumberWithComma(share);  // comma 형식 적용
    personVars['PersonShare'] = formattedShare;
    personVars['personShare'] = formattedShare;
    console.log(`[DEBUG] PersonShare calculated: ${cashNum} / ${fmv} = ${share} -> ${formattedShare}`);
  } else {
    personVars['PersonShare'] = '';
    personVars['personShare'] = '';
    console.log(`[DEBUG] PersonShare not calculable: cash=${cashNum}, fmv=${fmv}`);
  }

  // 기존 호환성을 위한 Founder/Director 변수도 설정
  if (person.roles.includes('Founder')) {
    personVars['FounderName'] = formattedName;  // Title Case 적용된 이름 사용
    personVars['founderName'] = formattedName;
    personVars['FounderAddress'] = person.address || '';
    personVars['founderAddress'] = person.address || '';
    personVars['FounderEmail'] = person.email || '';
    personVars['founderEmail'] = person.email || '';
    // FounderCash도 PersonCash와 동일하게 $ + comma 형식
    personVars['FounderCash'] = personVars['PersonCash'];
    personVars['founderCash'] = personVars['personCash'];
    // FounderShare도 동일하게 설정
    personVars['FounderShare'] = personVars['PersonShare'];
    personVars['founderShare'] = personVars['personShare'];
  }

  if (person.roles.includes('Director')) {
    personVars['DirectorName'] = formattedName;  // Title Case 적용된 이름 사용
    personVars['directorName'] = formattedName;
    personVars['DirectorAddress'] = person.address || '';
    personVars['directorAddress'] = person.address || '';
    personVars['DirectorEmail'] = person.email || '';
    personVars['directorEmail'] = person.email || '';
  }

  // 디버깅: 최종 Person 변수 로깅
  console.log(`[DEBUG] Final Person variables:`, {
    PersonName: personVars['PersonName'],
    PersonAddress: personVars['PersonAddress'],
    PersonCash: personVars['PersonCash'],
    PersonShare: personVars['PersonShare'],
    PersonCeoName: personVars['PersonCeoName'],
  });

  return personVars;
}

/**
 * docxtemplater로 문서 생성
 */
function generateDocument(
  templateBuffer: Buffer,
  variables: Record<string, string>
): Buffer {
  const zip = new PizZip(templateBuffer);

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{', end: '}' },
    // 누락된 변수 처리: undefined 대신 빈 문자열 반환 + 로깅
    nullGetter: (part: { module?: string; value?: string }) => {
      // 루프/조건 태그가 아닌 일반 변수만 로깅
      if (!part.module) {
        console.warn(`[WARN] Missing variable: ${part.value}`);
      }
      return '';
    },
  });

  doc.render(variables);

  return doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });
}

/**
 * 버퍼들을 ZIP으로 압축
 */
async function createZipBuffer(
  files: Array<{ filename: string; buffer: Buffer }>
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    const passThrough = new PassThrough();

    passThrough.on('data', (chunk: Buffer) => chunks.push(new Uint8Array(chunk)));
    passThrough.on('end', () => resolve(Buffer.concat(chunks)));
    passThrough.on('error', reject);

    const archive = Archiver.default('zip', { zlib: { level: 9 } });
    archive.on('error', reject);
    archive.pipe(passThrough);

    for (const file of files) {
      archive.append(file.buffer, { name: file.filename });
    }

    archive.finalize();
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
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

    const { surveyId, selectedTemplates, overrideVariables = {}, repeatForSelections = {} } = req.body as GenerateRequest;

    // 1. 입력 검증
    if (!surveyId) {
      return res.status(400).json({ error: 'surveyId is required' });
    }

    if (!selectedTemplates || !Array.isArray(selectedTemplates) || selectedTemplates.length === 0) {
      return res.status(400).json({ error: 'selectedTemplates must be a non-empty array' });
    }

    // 2. 설문 데이터 조회
    const surveyData = await client.hGet(SURVEYS_KEY, surveyId);
    if (!surveyData) {
      return res.status(404).json({ error: 'Survey not found' });
    }

    const survey = JSON.parse(surveyData);

    // 디버깅: survey 구조 확인
    console.log('[DEBUG] Survey keys:', Object.keys(survey));
    console.log('[DEBUG] Survey has answers:', !!survey.answers, 'count:', survey.answers?.length || 0);
    console.log('[DEBUG] Survey has founders direct:', !!survey.founders);

    // 설문 답변을 Map으로 관리 (동일 questionId는 마지막 값으로 덮어씀)
    const responsesMap = new Map<string, SurveyResponse>();

    // 1. 기존 설문 답변 추가
    const surveyAnswers: SurveyResponse[] = survey.answers || [];
    for (const answer of surveyAnswers) {
      responsesMap.set(answer.questionId, answer);
    }

    // 1b. founders/directors가 별도 필드로 있는 경우 추가
    if (survey.founders && Array.isArray(survey.founders) && survey.founders.length > 0) {
      console.log('[DEBUG] Adding founders from survey.founders:', survey.founders.length, 'items');
      responsesMap.set('founders', { questionId: 'founders', value: survey.founders });
    }
    if (survey.directors && Array.isArray(survey.directors) && survey.directors.length > 0) {
      console.log('[DEBUG] Adding directors from survey.directors:', survey.directors.length, 'items');
      responsesMap.set('directors', { questionId: 'directors', value: survey.directors });
    }

    // 2. 고객 정보 추가 (덮어씀)
    if (survey.customerInfo) {
      if (survey.customerInfo.name) {
        responsesMap.set('__customerName', { questionId: '__customerName', value: survey.customerInfo.name });
      }
      if (survey.customerInfo.email) {
        responsesMap.set('__customerEmail', { questionId: '__customerEmail', value: survey.customerInfo.email });
      }
      if (survey.customerInfo.phone) {
        responsesMap.set('__customerPhone', { questionId: '__customerPhone', value: survey.customerInfo.phone });
      }
      if (survey.customerInfo.company) {
        responsesMap.set('__customerCompany', { questionId: '__customerCompany', value: survey.customerInfo.company });
      }
    }

    // 3. 관리자가 설정한 날짜 추가 (덮어씀)
    if (survey.adminDates) {
      if (survey.adminDates.COIDate) {
        responsesMap.set('__COIDate', { questionId: '__COIDate', value: survey.adminDates.COIDate });
      }
      if (survey.adminDates.SIGNDate) {
        responsesMap.set('__SIGNDate', { questionId: '__SIGNDate', value: survey.adminDates.SIGNDate });
      }
    }

    // 4. 관리자가 설정한 값 추가 (덮어씀)
    if (survey.adminValues) {
      if (survey.adminValues.authorizedShares) {
        responsesMap.set('__authorizedShares', { questionId: '__authorizedShares', value: survey.adminValues.authorizedShares });
      }
      if (survey.adminValues.parValue) {
        responsesMap.set('__parValue', { questionId: '__parValue', value: survey.adminValues.parValue });
      }
      if (survey.adminValues.fairMarketValue) {
        responsesMap.set('__fairMarketValue', { questionId: '__fairMarketValue', value: survey.adminValues.fairMarketValue });
      }
    }

    // Map을 배열로 변환
    const responses: SurveyResponse[] = Array.from(responsesMap.values());

    // 회사명 추출 (ZIP 파일명용)
    const companyNameResponse = responses.find(r => r.questionId === 'companyName' || r.questionId === 'companyName1');
    const companyNameValue = companyNameResponse?.value;
    const companyName: string = survey.customerInfo?.company ||
                        (Array.isArray(companyNameValue) ? companyNameValue[0] : companyNameValue) ||
                        'Company';

    // 3. 각 템플릿 처리
    const documentResults: DocumentResult[] = [];
    const generatedFiles: Array<{ filename: string; buffer: Buffer }> = [];
    const templateDebugInfo: Record<string, unknown> = {};

    for (const templateId of selectedTemplates) {
      try {
        // 3a. 템플릿 메타데이터 조회
        const templateData = await client.hGet(TEMPLATES_KEY, templateId);
        if (!templateData) {
          documentResults.push({
            templateId,
            templateName: 'Unknown',
            filename: '',
            status: 'error',
            error: 'Template not found',
          });
          continue;
        }

        const template = JSON.parse(templateData);

        // 3b. 템플릿 파일 조회
        const fileData = await client.hGet(TEMPLATE_FILES_KEY, templateId);
        if (!fileData) {
          documentResults.push({
            templateId,
            templateName: template.displayName || template.name,
            filename: '',
            status: 'error',
            error: 'Template file not found',
          });
          continue;
        }

        const templateBuffer = Buffer.from(fileData, 'base64');

        // 3c. 변수 매핑 정보 조회
        const allVariables = await client.hGetAll(TEMPLATE_VARIABLES_KEY);
        const variableMappings: VariableMapping[] = Object.values(allVariables)
          .map(v => JSON.parse(v as string))
          .filter(v => v.templateId === templateId);

        // 디버깅: 변수 매핑 로깅
        const calculatedMappings = variableMappings.filter(m => m.questionId === '__calculated__');
        console.log(`[DEBUG] Template ${templateId} - Total mappings: ${variableMappings.length}, Calculated: ${calculatedMappings.length}`);
        if (calculatedMappings.length > 0) {
          console.log('[DEBUG] Calculated mappings:', JSON.stringify(calculatedMappings, null, 2));
        }

        // 3d. 설문 답변 → 변수 변환
        console.log('[DEBUG] Responses before transform:', JSON.stringify(responses.map(r => ({
          questionId: r.questionId,
          valueType: typeof r.value,
          isArray: Array.isArray(r.value),
          value: Array.isArray(r.value) && r.value.length > 0 && typeof r.value[0] === 'object'
            ? `[${r.value.length} objects]`
            : r.value
        })), null, 2));
        let variables = transformSurveyToVariables(responses, variableMappings);

        // 디버깅: Founder 관련 변수 로깅
        const founderVars = Object.entries(variables)
          .filter(([k]) => k.toLowerCase().includes('founder') || k.toLowerCase().includes('fmv') || k.toLowerCase().includes('share'))
          .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});
        console.log(`[DEBUG] Template ${templateId} (${template.displayName || template.name}) - Founder vars:`, JSON.stringify(founderVars, null, 2));

        // 디버그 정보 저장
        templateDebugInfo[templateId] = {
          templateName: template.displayName || template.name,
          mappingsCount: variableMappings.length,
          calculatedMappings: calculatedMappings.map(m => ({ name: m.variableName, formula: m.formula })),
          founderVars,
        };

        // 3e. overrideVariables 적용 (우선순위 높음)
        variables = { ...variables, ...overrideVariables };

        // 3f. repeatForPersons 확인 (검증 전에 필요)
        const repeatForPersons = template.repeatForPersons as boolean | undefined;

        // 3g. 필수 변수 검증
        // repeatForPersons 템플릿의 경우 Person* 변수는 나중에 생성되므로 검증에서 제외
        // 루프 컨텍스트 변수 (name, cash, share 등)도 제외 (루프 내부에서만 유효)
        const PERSON_AUTO_VARIABLES = [
          'PersonName', 'personName', 'PersonAddress', 'personAddress',
          'PersonEmail', 'personEmail', 'PersonRoles', 'personRoles',
          'PersonCash', 'personCash', 'PersonShare', 'personShare',
          'PersonCeoName', 'personCeoName', 'PersonCEOName',
          'FounderName', 'founderName', 'FounderAddress', 'founderAddress',
          'FounderEmail', 'founderEmail', 'FounderCash', 'founderCash',
          'FounderShare', 'founderShare', 'DirectorName', 'directorName',
          'DirectorAddress', 'directorAddress', 'DirectorEmail', 'directorEmail',
        ];

        // 루프 컨텍스트 필드 (docxtemplater 루프 내부에서만 사용)
        const LOOP_CONTEXT_FIELDS = [
          'name', 'Name', 'NAME',
          'address', 'Address', 'ADDRESS',
          'email', 'Email', 'EMAIL',
          'type', 'Type', 'TYPE',
          'cash', 'Cash', 'CASH',
          'share', 'Share', 'SHARE',
          'ceoName', 'CeoName', 'ceoname',
          'isCorporation', 'isIndividual',  // founders 전용 boolean 필드
          'index', 'isFirst', 'isLast',
        ];

        const mappingsToValidate = repeatForPersons
          ? variableMappings.filter(m => !PERSON_AUTO_VARIABLES.includes(m.variableName))
          : variableMappings.filter(m => !LOOP_CONTEXT_FIELDS.includes(m.variableName));

        const validation = validateVariables(variables, mappingsToValidate);

        if (!validation.isValid) {
          // 경고하지만 계속 진행 (빈 값으로 처리됨)
          console.warn(`Template ${templateId} has missing/empty variables:`, {
            missing: validation.missingVariables,
            emptyRequired: validation.emptyRequired,
          });
        }

        // 3h. repeatForPersons 처리 - 인원별 문서 생성
        const selectedPersonIndices = repeatForSelections[templateId];
        const personTypeFilter = template.personTypeFilter as 'all' | 'individual' | 'corporation' | 'individual_founder' | 'corporation_founder' | undefined;

        if (repeatForPersons && selectedPersonIndices && selectedPersonIndices.length > 0) {
          // 모든 인원 추출
          const allPersons = extractAllPersons(responses);
          console.log(`[DEBUG] Template ${templateId} - repeatForPersons: true, personTypeFilter: ${personTypeFilter || 'all'}, selected: ${selectedPersonIndices.join(',')}, allPersons: ${allPersons.length}`);

          for (const personIndex of selectedPersonIndices) {
            const person = allPersons[personIndex];
            if (!person) {
              console.warn(`[WARN] Person at index ${personIndex} not found for template ${templateId}`);
              continue;
            }

            // personTypeFilter에 따라 해당 인원을 건너뛰기
            const isFounder = person.roles.includes('Founder');
            const isCorporation = person.type === 'corporation';

            // 'individual': 법인 주주 제외 (IA, IPAA용 - 개인주주 + 이사 + 임원)
            if (personTypeFilter === 'individual' && isCorporation) {
              console.log(`[DEBUG] Skipping corporation ${person.name} for individual template ${templateId}`);
              continue;
            }
            // 'individual_founder': 개인 주주만 (CSPA, RSPA용 - 이사/임원 제외)
            if (personTypeFilter === 'individual_founder' && (!isFounder || isCorporation)) {
              console.log(`[DEBUG] Skipping ${person.name} (founder:${isFounder}, corp:${isCorporation}) for individual_founder template ${templateId}`);
              continue;
            }
            // 'corporation' 또는 'corporation_founder': 법인 주주만 (CSPA Entity용)
            if ((personTypeFilter === 'corporation' || personTypeFilter === 'corporation_founder') && !isCorporation) {
              console.log(`[DEBUG] Skipping non-corporation ${person.name} for corporation template ${templateId}`);
              continue;
            }

            // 개인별 변수 생성
            const personVariables = createPersonVariables(variables, person);

            try {
              // docxtemplater로 문서 생성
              const generatedBuffer = generateDocument(templateBuffer, personVariables);

              // 파일명 생성 (인원 이름 포함)
              const filename = generateFilename(
                template.displayName || template.name,
                companyName,
                person.name
              );

              generatedFiles.push({ filename, buffer: generatedBuffer });

              documentResults.push({
                templateId: `${templateId}_${personIndex}`,
                templateName: `${template.displayName || template.name} - ${person.name}`,
                filename,
                status: 'success',
                missingVariables: validation.isValid ? undefined : [...validation.missingVariables, ...validation.emptyRequired],
              });
            } catch (personDocError: any) {
              console.error(`Error generating document for ${person.name}:`, personDocError);
              documentResults.push({
                templateId: `${templateId}_${personIndex}`,
                templateName: `${template.displayName || template.name} - ${person.name}`,
                filename: '',
                status: 'error',
                error: personDocError.message || 'Document generation failed',
              });
            }
          }
        } else {
          // 일반 문서 생성 (기존 로직)
          const generatedBuffer = generateDocument(templateBuffer, variables);

          // 파일명 생성 및 저장
          const filename = generateFilename(
            template.displayName || template.name,
            companyName
          );

          generatedFiles.push({ filename, buffer: generatedBuffer });

          documentResults.push({
            templateId,
            templateName: template.displayName || template.name,
            filename,
            status: 'success',
            missingVariables: validation.isValid ? undefined : [...validation.missingVariables, ...validation.emptyRequired],
          });
        }

      } catch (docError: any) {
        console.error(`Error generating document for template ${templateId}:`, docError);

        // 템플릿 정보 재조회 시도
        let templateName = 'Unknown';
        try {
          const td = await client.hGet(TEMPLATES_KEY, templateId);
          if (td) {
            const t = JSON.parse(td);
            templateName = t.displayName || t.name;
          }
        } catch {}

        documentResults.push({
          templateId,
          templateName,
          filename: '',
          status: 'error',
          error: docError.message || 'Document generation failed',
        });
      }
    }

    // 4. 성공한 문서가 없으면 에러
    const successfulDocs = documentResults.filter(d => d.status === 'success');
    if (successfulDocs.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No documents were generated successfully',
        documents: documentResults,
      });
    }

    // 5. ZIP 파일 생성
    const zipFilename = generateZipFilename(companyName);
    const zipBuffer = await createZipBuffer(generatedFiles);
    const zipBase64 = zipBuffer.toString('base64');

    // 6. 임시 파일로 저장 (TTL 24시간)
    const downloadId = uuidv4();
    await client.hSet(TEMP_FILES_KEY, downloadId, JSON.stringify({
      filename: zipFilename,
      data: zipBase64,
      mimeType: 'application/zip',
      createdAt: new Date().toISOString(),
    }));
    await client.expire(TEMP_FILES_KEY, TEMP_FILE_TTL);

    // 7. 생성 기록 저장
    const recordId = uuidv4();
    const generationRecord: GenerationRecord = {
      id: recordId,
      surveyId,
      templates: documentResults,
      zipFilename,
      downloadId,
      generatedAt: new Date().toISOString(),
    };

    await client.hSet(GENERATED_DOCS_KEY, recordId, JSON.stringify(generationRecord));

    // 8. 설문 상태 업데이트
    survey.documentGeneratedAt = new Date().toISOString();
    survey.lastGenerationId = recordId;
    await client.hSet(SURVEYS_KEY, surveyId, JSON.stringify(survey));

    // 9. 응답 반환 (디버그 정보 포함)
    return res.status(200).json({
      success: true,
      documents: documentResults,
      zipFile: zipFilename,
      downloadUrl: `/api/admin/download/${downloadId}`,
      generationId: recordId,
      stats: {
        total: selectedTemplates.length,
        successful: successfulDocs.length,
        failed: documentResults.filter(d => d.status === 'error').length,
      },
      // 디버그 정보 (문제 해결 후 제거 예정)
      _debug: {
        surveyKeys: Object.keys(survey),
        hasAnswers: !!survey.answers,
        answersCount: survey.answers?.length || 0,
        hasFoundersDirect: !!survey.founders,
        foundersInAnswers: survey.answers?.find((a: SurveyResponse) => a.questionId === 'founders') ? true : false,
        foundersData: survey.answers?.find((a: SurveyResponse) => a.questionId === 'founders')?.value,
        adminValues: survey.adminValues,
        responsesQuestionIds: responses.map(r => r.questionId),
        templateDebugInfo,
      },
    });

  } catch (error: any) {
    console.error('Generate Documents API Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error occurred',
      details: error.message,
    });
  } finally {
    if (client) await client.disconnect();
  }
}
