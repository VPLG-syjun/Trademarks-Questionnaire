import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import PizZip from 'pizzip';

const TEMPLATES_KEY = 'templates';
const TEMPLATE_VARIABLES_KEY = 'template_variables';
const TEMPLATE_FILES_KEY = 'template_files';

// 반복 그룹 이름들 (자동 생성 변수 패턴 인식용)
const REPEATABLE_GROUPS = ['directors', 'founders'];
const REPEATABLE_GROUP_FIELDS = ['name', 'address', 'email', 'type', 'ceoName', 'cash', 'share'];

// 반복문 내부에서만 사용되는 필드명 (루프 컨텍스트 변수)
// 주의: ceoName은 독립 변수로도 사용되므로 여기서 제외
const LOOP_CONTEXT_FIELDS = [
  // 반복 그룹 필드 (루프 안에서만 의미 있는 것들)
  'name', 'address', 'email', 'type', 'cash', 'share', 'ceoName',
  // founders 전용 boolean 필드 (조건부 서명란 등에 사용)
  'isCorporation', 'isIndividual',
  // docxtemplater 루프 헬퍼
  'index', 'isFirst', 'isLast',
];

// 이름 기반 자동 생성 변수 (설문 데이터에서 자동 추출)
// 참고: 모든 설문 응답은 questionId와 동일한 변수명으로 자동 생성됨
const NAME_BASED_AUTO_VARIABLES = [
  // 회사 기본 정보 (설문 응답)
  'companyName', 'CompanyName', 'COMPANYNAME',
  'companyName1', 'CompanyName1', 'COMPANYNAME1',
  'companyName2', 'CompanyName2', 'COMPANYNAME2',
  'companyName3', 'CompanyName3', 'COMPANYNAME3',
  'info', 'Info',
  'designator', 'Designator', 'DESIGNATOR',

  // 회사 주소 변수
  'companyAddress', 'CompanyAddress', 'COMPANYADDRESS',
  'usAddress', 'USAddress', 'USADDRESS',
  'krAddress', 'KRAddress', 'KRADDRESS',
  'hasUSAddress',

  // 날짜 관련 자동 생성 변수
  'currentDate', 'CurrentDate', 'CURRENTDATE',
  'currentDateShort', 'CurrentDateShort',
  'currentDateISO', 'CurrentDateISO',
  'currentDateKR', 'CurrentDateKR',
  'currentTime', 'CurrentTime',
  'currentYear', 'CurrentYear', 'CURRENTYEAR',
  'documentNumber', 'DocumentNumber',
  'COIDate', 'COIDateShort', 'COIDateISO', 'COIDateKR',
  'SIGNDate', 'signDate', 'SignDate', 'SIGNDateShort', 'SIGNDateISO', 'SIGNDateKR',
  'SIGNYear', 'signYear', 'SIGNYEAR',
  // Cashin 및 SHSIGNDate (cashin 월의 마지막 영업일)
  'cashin', 'Cashin', 'cashinShort', 'cashinISO',
  'SHSIGNDate', 'SHSIGNDateShort', 'SHSIGNDateISO',

  // Officer 이름 변수 (설문 응답에서 자동 생성)
  'ceoName', 'CeoName', 'CEOName', 'CEONAME',
  'cfoName', 'CfoName', 'CFOName', 'CFONAME',
  'csName', 'CsName', 'CSName', 'CSNAME',
  'chairmanName', 'ChairmanName', 'CHAIRMANNAME',

  // BankConsent 직책 변수
  'BankConsentTitle', 'bankConsentTitle',
  'BankConsent1Title', 'bankConsent1Title',
  'BankConsent2Title', 'bankConsent2Title',
  'BankConsent', 'bankConsent',
  'BankConsent1', 'bankConsent1',
  'BankConsent2', 'bankConsent2',

  // 인원별 반복 생성 변수 (repeatForPersons 템플릿에서 사용)
  'PersonName', 'personName',
  'PersonAddress', 'personAddress',
  'PersonEmail', 'personEmail',
  'PersonRoles', 'personRoles',
  'PersonCash', 'personCash',
  'PersonShare', 'personShare',  // PersonCash / FMV 자동 계산
  'PersonCeoName', 'personCeoName', 'PersonCEOName',  // 법인 Founder의 CEO 이름

  // 기존 호환성 변수 (인원별 생성 시 자동 매핑)
  'FounderName', 'founderName',
  'FounderAddress', 'founderAddress',
  'FounderEmail', 'founderEmail',
  'FounderCash', 'founderCash',
  'FounderShare', 'founderShare',  // Founder용 PersonShare
  'FounderCeoName', 'founderCeoName', 'FounderCEOName',  // 법인 Founder CEO 이름

  // Individual/Corporation Founder 전용 변수
  'individualFounderName', 'IndividualFounderName',
  'individualFounderAddress', 'IndividualFounderAddress',
  'individualFounderEmail', 'IndividualFounderEmail',
  'individualFounderCash', 'IndividualFounderCash',
  'corporationFounderName', 'CorporationFounderName',
  'corporationFounderCeoName', 'CorporationFounderCeoName',
  'corporationFounderAddress', 'CorporationFounderAddress',
  'corporationFounderEmail', 'CorporationFounderEmail',
  'corporationFounderCash', 'CorporationFounderCash',
  'DirectorName', 'directorName',
  'DirectorAddress', 'directorAddress',
  'DirectorEmail', 'directorEmail',

  // 반복 그룹 배열 변수 (docxtemplater 루프용)
  'founders', 'Founders', 'FOUNDERS',
  'founder', 'Founder', 'FOUNDER',  // 단수형
  'directors', 'Directors', 'DIRECTORS',
  'director', 'Director', 'DIRECTOR',  // 단수형

  // 주식 관련 자동 생성 변수
  'authorizedShares', 'AuthorizedShares',
  'authorizedSharesRaw', 'AuthorizedSharesRaw',
  'authorizedSharesEnglish', 'AuthorizedSharesEnglish',
  'parValue', 'ParValue',
  'parValueDollar', 'ParValueDollar',
  'PV', 'pv',
  'fairMarketValue', 'FairMarketValue',
  'fairMarketValueDollar', 'FairMarketValueDollar',
  'FMV', 'fmv',

  // Stock Ledger 합계 변수
  'cashSum', 'CashSum', 'CASHSUM',  // 모든 Founder Cash 합계 ($1,000 형식)
  'shareSum', 'ShareSum', 'SHARESUM',  // 모든 Founder Share 합계 (1,000 형식)

  // 조건부 변수 (yes/no 질문에서 자동 생성)
  'hasStockOption', 'HasStockOption',  // stockOption == "yes"인 경우 true
  'stockOption', 'StockOption',
  'optionPool', 'OptionPool',  // Option Pool 비율 (%)
  'optionPoolShares', 'OptionPoolShares',  // Option Pool 주식 수
  'optionPoolSharesRaw', 'OptionPoolSharesRaw',  // Option Pool 주식 수 (원본)
  'totalIssuedShares', 'TotalIssuedShares',  // 총 발행 주식 수 (founder + option pool)
];

// 대소문자 무시를 위한 소문자 목록
const NAME_BASED_AUTO_VARIABLES_LOWER = NAME_BASED_AUTO_VARIABLES.map(v => v.toLowerCase());
const LOOP_CONTEXT_FIELDS_LOWER = LOOP_CONTEXT_FIELDS.map(v => v.toLowerCase());

/**
 * 반복 그룹에서 자동 생성되는 변수인지 확인 (대소문자 무시)
 */
function isAutoGeneratedVariable(varName: string): boolean {
  const varNameLower = varName.toLowerCase();

  // 0. 이름 기반 자동 생성 변수 (대소문자 무시)
  if (NAME_BASED_AUTO_VARIABLES_LOWER.includes(varNameLower)) return true;

  // 1. 루프 컨텍스트 필드 (대소문자 무시)
  if (LOOP_CONTEXT_FIELDS_LOWER.includes(varNameLower)) return true;

  for (const group of REPEATABLE_GROUPS) {
    const singular = group.slice(0, -1); // directors -> director
    const capitalized = group.charAt(0).toUpperCase() + group.slice(1); // Directors

    // {group}Count - directorsCount, foundersCount (대소문자 무시)
    if (varNameLower === `${group}count`) return true;

    // hasMultiple{Group}, hasSingle{Group} (대소문자 무시)
    if (varNameLower === `hasmultiple${group}` || varNameLower === `hassingle${group}`) return true;

    // {group}{Field}Formatted, {group}{Field}List, {group}{Field}OrList (대소문자 무시)
    for (const field of REPEATABLE_GROUP_FIELDS) {
      if (varNameLower === `${group}${field}formatted` ||
          varNameLower === `${group}${field}list` ||
          varNameLower === `${group}${field}orlist`) return true;
    }

    // {singular}{N}{Field} - director1Name, founder2Email, founder1Share (N은 1-9)
    const individualPattern = new RegExp(`^${singular}[1-9](name|address|email|type|ceoname|cash|share)$`, 'i');
    if (individualPattern.test(varName)) return true;

    // {group}{N}{Field} - directors1Name, founders2Cash, founders1Share (새 형식, N은 1-9)
    const groupIndexPattern = new RegExp(`^${group}[1-9](name|address|email|type|ceoname|cash|share)$`, 'i');
    if (groupIndexPattern.test(varName)) return true;
  }

  return false;
}

/**
 * DOCX 템플릿에서 {변수명} 형식의 변수를 추출 (대소문자 중복 제거)
 */
function extractVariablesFromDocx(buffer: Buffer): string[] {
  try {
    const zip = new PizZip(buffer);
    // 대소문자 무시하여 중복 제거 (소문자 → 원본 매핑)
    const variablesMap = new Map<string, string>();

    const xmlFiles = [
      'word/document.xml',
      'word/header1.xml',
      'word/header2.xml',
      'word/header3.xml',
      'word/footer1.xml',
      'word/footer2.xml',
      'word/footer3.xml',
    ];

    for (const xmlFile of xmlFiles) {
      try {
        const file = zip.file(xmlFile);
        if (file) {
          const content = file.asText();
          const textContent = content.replace(/<[^>]+>/g, '');
          const matches = textContent.match(/\{([^}]+)\}/g);
          if (matches) {
            for (const match of matches) {
              const varName = match.slice(1, -1).trim();
              if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
                const lowerName = varName.toLowerCase();
                // 첫 번째 발견된 케이스 유지 (대소문자 중복 방지)
                if (!variablesMap.has(lowerName)) {
                  variablesMap.set(lowerName, varName);
                }
              }
            }
          }
        }
      } catch {
        // 파일이 없거나 읽기 실패 시 무시
      }
    }

    return Array.from(variablesMap.values()).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
  } catch (error) {
    console.error('Error extracting variables:', error);
    return [];
  }
}

async function getRedisClient() {
  const client = createClient({ url: process.env.REDIS_URL });
  await client.connect();
  return client;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let client;
  try {
    client = await getRedisClient();

    if (req.method === 'POST') {
      const { templateId, variables, action } = req.body;

      // 변수 스캔 모드
      if (action === 'scan' && templateId) {
        const fileData = await client.hGet(TEMPLATE_FILES_KEY, templateId);
        if (!fileData) {
          return res.status(404).json({ error: 'Template file not found' });
        }

        const templateBuffer = Buffer.from(fileData, 'base64');
        const allScannedVariables = extractVariablesFromDocx(templateBuffer);

        // 모든 변수를 객체 형태로 반환 (isAutoGenerated 플래그 포함)
        const variablesWithInfo = allScannedVariables.map(v => ({
          variableName: v,
          isAutoGenerated: isAutoGeneratedVariable(v),
        }));

        // 자동 생성 변수 개수
        const autoGeneratedCount = variablesWithInfo.filter(v => v.isAutoGenerated).length;

        return res.status(200).json({
          templateId,
          variables: variablesWithInfo,
          count: variablesWithInfo.length,
          autoGeneratedCount,
        });
      }

      // 직접 입력 변수 조회 모드
      if (action === 'getManual') {
        const { templateIds } = req.body;

        if (!templateIds || !Array.isArray(templateIds) || templateIds.length === 0) {
          return res.status(400).json({ error: 'templateIds array is required' });
        }

        // 템플릿 정보 조회
        const templatesMap: Record<string, string> = {};
        for (const tid of templateIds) {
          const templateData = await client.hGet(TEMPLATES_KEY, tid);
          if (templateData) {
            const template = JSON.parse(templateData);
            templatesMap[tid] = template.displayName || template.name;
          }
        }

        // 모든 변수 조회
        const allVariables = await client.hGetAll(TEMPLATE_VARIABLES_KEY);
        const varsList = Object.values(allVariables).map(v => JSON.parse(v as string));

        // 관리자 설정 값 questionIds
        const ADMIN_VALUE_QUESTION_IDS = [
          '__authorizedShares',
          '__parValue',
          '__fairMarketValue',
          '__COIDate',
          '__SIGNDate',
        ];

        // 선택된 템플릿의 직접 입력 변수 및 관리자 설정 변수 필터링
        // - 계산 변수(__calculated__)는 자동 계산되므로 제외
        // - 자동 생성 변수(directorsCount 등)도 제외
        const manualVariables = varsList
          .filter(v =>
            templateIds.includes(v.templateId) &&
            (v.questionId === '__manual__' || ADMIN_VALUE_QUESTION_IDS.includes(v.questionId)) &&
            !isAutoGeneratedVariable(v.variableName)  // 자동 생성 변수 제외
          )
          .map(v => ({
            id: v.id,
            templateId: v.templateId,
            templateName: templatesMap[v.templateId] || v.templateId,
            variableName: v.variableName,
            dataType: v.dataType || 'text',
            transformRule: v.transformRule || 'none',
            required: v.required || false,
            defaultValue: v.defaultValue || '',
            sourceType: v.questionId === '__manual__' ? 'manual' : 'admin',  // 소스 타입 추가
            questionId: v.questionId,  // questionId도 반환
          }));

        // 변수명으로 그룹화
        const groupedVariables: Record<string, typeof manualVariables> = {};
        manualVariables.forEach(v => {
          if (!groupedVariables[v.variableName]) {
            groupedVariables[v.variableName] = [];
          }
          groupedVariables[v.variableName].push(v);
        });

        // 중복 제거된 고유 변수 목록
        const uniqueVariables = Object.entries(groupedVariables).map(([variableName, vars]) => {
          const isRequired = vars.some(v => v.required);
          const firstVar = vars[0];
          return {
            variableName,
            dataType: firstVar.dataType,
            transformRule: firstVar.transformRule,
            required: isRequired,
            defaultValue: firstVar.defaultValue,
            usedInTemplates: vars.map(v => v.templateName),
            sourceType: firstVar.sourceType || 'manual',  // 'manual' or 'admin'
            questionId: firstVar.questionId,
          };
        });

        return res.status(200).json({
          variables: uniqueVariables,
          totalCount: uniqueVariables.length,
          requiredCount: uniqueVariables.filter(v => v.required).length,
        });
      }

      // 전체 템플릿에 변수 설정 적용 모드
      if (action === 'applyToAll') {
        const { variableName, settings } = req.body as {
          variableName: string;
          settings: {
            questionId: string;
            dataType: string;
            transformRule: string;
            required: boolean;
            formula?: string;
          };
        };

        if (!variableName || !settings) {
          return res.status(400).json({ error: '변수명과 설정이 필요합니다.' });
        }

        console.log(`[applyToAll] Applying settings for variable: "${variableName}"`);

        // 1. 모든 템플릿 조회
        const allTemplates = await client.hGetAll(TEMPLATES_KEY);
        const allTemplateFiles = await client.hGetAll(TEMPLATE_FILES_KEY);
        const allVariables = await client.hGetAll(TEMPLATE_VARIABLES_KEY);

        // 기존 변수 매핑을 templateId별로 정리
        const existingMappings: Record<string, { varId: string; variable: Record<string, unknown> }> = {};
        for (const [varId, varData] of Object.entries(allVariables)) {
          const variable = JSON.parse(varData);
          if (variable.variableName === variableName) {
            existingMappings[variable.templateId] = { varId, variable };
          }
        }

        let updatedCount = 0;
        let createdCount = 0;
        const updatedTemplates: string[] = [];
        const createdTemplates: string[] = [];

        // 2. 각 템플릿의 DOCX 파일을 스캔하여 변수 확인
        for (const [templateId, templateData] of Object.entries(allTemplates)) {
          const template = JSON.parse(templateData);
          if (!template.isActive) continue; // 비활성 템플릿 스킵

          const fileData = allTemplateFiles[templateId];
          if (!fileData) continue; // 파일 없는 템플릿 스킵

          try {
            const templateBuffer = Buffer.from(fileData, 'base64');
            const scannedVariables = extractVariablesFromDocx(templateBuffer);

            // 해당 변수가 템플릿에 존재하는지 확인
            if (!scannedVariables.includes(variableName)) {
              continue; // 변수가 없으면 스킵
            }

            // 3. 기존 매핑이 있으면 업데이트, 없으면 생성
            const formula = (settings as { formula?: string }).formula;

            if (existingMappings[templateId]) {
              // 업데이트
              const { varId, variable } = existingMappings[templateId];
              const updatedVariable: Record<string, unknown> = {
                ...variable,
                questionId: settings.questionId,
                dataType: settings.dataType,
                transformRule: settings.transformRule,
                required: settings.required,
              };

              if (settings.questionId === '__calculated__' && formula) {
                updatedVariable.formula = formula;
              } else {
                delete updatedVariable.formula;
              }

              await client.hSet(TEMPLATE_VARIABLES_KEY, varId, JSON.stringify(updatedVariable));
              updatedCount++;
              updatedTemplates.push(template.displayName || template.name);
              console.log(`[applyToAll] Updated in template: ${template.displayName || template.name}`);
            } else {
              // 새로 생성
              const newVarId = uuidv4();
              const newVariable: Record<string, unknown> = {
                id: newVarId,
                templateId,
                variableName,
                questionId: settings.questionId,
                dataType: settings.dataType || 'text',
                transformRule: settings.transformRule || 'none',
                required: settings.required || false,
              };

              if (settings.questionId === '__calculated__' && formula) {
                newVariable.formula = formula;
              }

              await client.hSet(TEMPLATE_VARIABLES_KEY, newVarId, JSON.stringify(newVariable));
              createdCount++;
              createdTemplates.push(template.displayName || template.name);
              console.log(`[applyToAll] Created in template: ${template.displayName || template.name}`);
            }
          } catch (err) {
            console.error(`[applyToAll] Error processing template ${templateId}:`, err);
          }
        }

        const totalCount = updatedCount + createdCount;
        console.log(`[applyToAll] Total: ${totalCount} (updated: ${updatedCount}, created: ${createdCount})`);

        return res.status(200).json({
          message: `${totalCount}개의 템플릿에 적용되었습니다. (업데이트: ${updatedCount}, 새로 생성: ${createdCount})`,
          updatedCount,
          createdCount,
          totalCount,
          updatedTemplates,
          createdTemplates,
        });
      }

      // 일괄 저장 모드 (variables 배열이 있는 경우)
      if (templateId && Array.isArray(variables)) {
        // 템플릿 존재 확인
        const templateExists = await client.hExists(TEMPLATES_KEY, templateId);
        if (!templateExists) {
          return res.status(404).json({ error: '템플릿을 찾을 수 없습니다.' });
        }

        // 기존 변수 삭제
        const allVariables = await client.hGetAll(TEMPLATE_VARIABLES_KEY);
        for (const [varId, varData] of Object.entries(allVariables)) {
          const variable = JSON.parse(varData);
          if (variable.templateId === templateId) {
            await client.hDel(TEMPLATE_VARIABLES_KEY, varId);
          }
        }

        // 새 변수 저장
        // 자동 생성 변수도 명시적으로 설정된 경우 저장 허용
        // (dataType/transformRule을 지정하면 포맷팅 적용 가능)
        const savedVariables = [];
        for (const v of variables) {
          const id = v.id || uuidv4();

          // 자동 생성 변수인 경우 questionId를 __auto__로 강제 설정
          const isAuto = isAutoGeneratedVariable(v.variableName);
          const questionId = isAuto ? '__auto__' : (v.questionId || '__manual__');

          const variable: Record<string, unknown> = {
            id,
            templateId,
            variableName: v.variableName,
            questionId,
            dataType: v.dataType || 'text',
            transformRule: v.transformRule || 'none',
            required: v.required !== undefined ? v.required : true,
          };

          // 계산 변수인 경우 formula 저장 (자동 생성 변수가 아닌 경우만)
          if (!isAuto && v.questionId === '__calculated__' && v.formula) {
            variable.formula = v.formula;
          }

          await client.hSet(TEMPLATE_VARIABLES_KEY, id, JSON.stringify(variable));
          savedVariables.push(variable);
        }

        return res.status(200).json({
          message: `${savedVariables.length}개의 변수가 저장되었습니다.`,
          variables: savedVariables,
        });
      }

      // 단일 변수 생성 모드 (기존 방식)
      const {
        variableName,
        variableKey,
        questionIds,
        dataType,
        isRequired,
        defaultValue,
        transformationRule,
      } = req.body;

      if (!templateId || !variableName || !variableKey) {
        return res.status(400).json({ error: '필수 필드가 누락되었습니다.' });
      }

      // 템플릿 존재 확인
      const templateExists = await client.hExists(TEMPLATES_KEY, templateId);
      if (!templateExists) {
        return res.status(404).json({ error: '템플릿을 찾을 수 없습니다.' });
      }

      const id = uuidv4();
      const variable = {
        id,
        templateId,
        variableName,
        variableKey,
        questionIds: questionIds || [],
        dataType: dataType || 'text',
        isRequired: isRequired || false,
        defaultValue: defaultValue || null,
        transformationRule: transformationRule || null,
      };

      await client.hSet(TEMPLATE_VARIABLES_KEY, id, JSON.stringify(variable));

      return res.status(201).json({ id, message: '변수가 생성되었습니다.', variable });
    }

    if (req.method === 'GET') {
      // 템플릿 변수 목록 조회
      const { templateId, includeAutoGenerated } = req.query;
      const allVariables = await client.hGetAll(TEMPLATE_VARIABLES_KEY);

      let variables = Object.values(allVariables).map((v) => JSON.parse(v));

      if (templateId) {
        variables = variables.filter((v) => v.templateId === templateId);
      }

      // 자동 생성 변수인 경우 questionId를 __auto__로 자동 수정
      variables = variables.map((v) => {
        if (isAutoGeneratedVariable(v.variableName) && v.questionId !== '__auto__') {
          return { ...v, questionId: '__auto__' };
        }
        return v;
      });

      // 자동 생성 변수 필터링 (기본적으로 제외, includeAutoGenerated=true면 포함)
      if (includeAutoGenerated !== 'true') {
        variables = variables.filter((v) => !isAutoGeneratedVariable(v.variableName));
      }

      return res.status(200).json(variables);
    }

    if (req.method === 'PATCH') {
      // 변수 수정
      const { id } = req.query;
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'ID가 필요합니다.' });
      }

      const varData = await client.hGet(TEMPLATE_VARIABLES_KEY, id);
      if (!varData) {
        return res.status(404).json({ error: '변수를 찾을 수 없습니다.' });
      }

      const variable = JSON.parse(varData);
      const updates = req.body;

      Object.keys(updates).forEach((key) => {
        if (key !== 'id' && key !== 'templateId') {
          variable[key] = updates[key];
        }
      });

      await client.hSet(TEMPLATE_VARIABLES_KEY, id, JSON.stringify(variable));

      return res.status(200).json({ message: '변수가 수정되었습니다.', variable });
    }

    if (req.method === 'DELETE') {
      // 변수 삭제
      const { id } = req.query;
      if (!id || typeof id !== 'string') {
        return res.status(400).json({ error: 'ID가 필요합니다.' });
      }

      const deleted = await client.hDel(TEMPLATE_VARIABLES_KEY, id);
      if (!deleted) {
        return res.status(404).json({ error: '변수를 찾을 수 없습니다.' });
      }

      return res.status(200).json({ message: '변수가 삭제되었습니다.' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Template Variables API Error:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  } finally {
    if (client) await client.disconnect();
  }
}
