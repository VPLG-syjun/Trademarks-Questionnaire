import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from 'redis';

const TEMPLATES_KEY = 'templates';
const TEMPLATE_VARIABLES_KEY = 'template_variables';
const TEMPLATE_RULES_KEY = 'template_rules';

async function getRedisClient() {
  const client = createClient({ url: process.env.REDIS_URL });
  await client.connect();
  return client;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'ID가 필요합니다.' });
  }

  let client;
  try {
    client = await getRedisClient();

    if (req.method === 'GET') {
      // 템플릿 상세 조회 (변수 및 규칙 포함)
      const templateData = await client.hGet(TEMPLATES_KEY, id);
      if (!templateData) {
        return res.status(404).json({ error: '템플릿을 찾을 수 없습니다.' });
      }

      const template = JSON.parse(templateData);

      // 변수 조회
      const allVariables = await client.hGetAll(TEMPLATE_VARIABLES_KEY);
      const variables = Object.values(allVariables)
        .map((v) => JSON.parse(v))
        .filter((v) => v.templateId === id);

      // 규칙 조회
      const allRules = await client.hGetAll(TEMPLATE_RULES_KEY);
      const rules = Object.values(allRules)
        .map((r) => JSON.parse(r))
        .filter((r) => r.templateId === id)
        .sort((a, b) => a.priority - b.priority);

      return res.status(200).json({
        ...template,
        variables,
        rules,
      });
    }

    if (req.method === 'PATCH') {
      // 템플릿 수정
      const templateData = await client.hGet(TEMPLATES_KEY, id);
      if (!templateData) {
        return res.status(404).json({ error: '템플릿을 찾을 수 없습니다.' });
      }

      const template = JSON.parse(templateData);
      const { name, displayName, category, filename, filePath, isActive, repeatForPersons, personTypeFilter } = req.body;

      if (name !== undefined) template.name = name;
      if (displayName !== undefined) template.displayName = displayName;
      if (category !== undefined) template.category = category;
      if (filename !== undefined) template.filename = filename;
      if (filePath !== undefined) template.filePath = filePath;
      if (isActive !== undefined) template.isActive = isActive;
      if (repeatForPersons !== undefined) template.repeatForPersons = repeatForPersons; // boolean
      if (personTypeFilter !== undefined) template.personTypeFilter = personTypeFilter; // 'all' | 'individual' | 'corporation'

      template.updatedAt = new Date().toISOString();

      await client.hSet(TEMPLATES_KEY, id, JSON.stringify(template));

      return res.status(200).json({ message: '템플릿이 수정되었습니다.', template });
    }

    if (req.method === 'DELETE') {
      // 템플릿 삭제 (관련 변수, 규칙도 삭제)
      const deleted = await client.hDel(TEMPLATES_KEY, id);
      if (!deleted) {
        return res.status(404).json({ error: '템플릿을 찾을 수 없습니다.' });
      }

      // 관련 변수 삭제
      const allVariables = await client.hGetAll(TEMPLATE_VARIABLES_KEY);
      for (const [varId, varData] of Object.entries(allVariables)) {
        const variable = JSON.parse(varData);
        if (variable.templateId === id) {
          await client.hDel(TEMPLATE_VARIABLES_KEY, varId);
        }
      }

      // 관련 규칙 삭제
      const allRules = await client.hGetAll(TEMPLATE_RULES_KEY);
      for (const [ruleId, ruleData] of Object.entries(allRules)) {
        const rule = JSON.parse(ruleData);
        if (rule.templateId === id) {
          await client.hDel(TEMPLATE_RULES_KEY, ruleId);
        }
      }

      return res.status(200).json({ message: '템플릿이 삭제되었습니다.' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Template API Error:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  } finally {
    if (client) await client.disconnect();
  }
}
