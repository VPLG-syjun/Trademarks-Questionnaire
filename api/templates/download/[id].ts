import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from 'redis';

const TEMPLATES_KEY = 'templates';
const TEMPLATE_FILES_KEY = 'template_files';

async function getRedisClient() {
  const client = createClient({ url: process.env.REDIS_URL });
  await client.connect();
  return client;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'ID가 필요합니다.' });
  }

  let client;
  try {
    client = await getRedisClient();

    // 템플릿 메타데이터 조회
    const templateData = await client.hGet(TEMPLATES_KEY, id);
    if (!templateData) {
      return res.status(404).json({ error: '템플릿을 찾을 수 없습니다.' });
    }

    const template = JSON.parse(templateData);

    // 파일 데이터 조회
    const fileData = await client.hGet(TEMPLATE_FILES_KEY, id);
    if (!fileData) {
      return res.status(404).json({ error: '템플릿 파일을 찾을 수 없습니다.' });
    }

    // base64를 Buffer로 변환
    const fileBuffer = Buffer.from(fileData, 'base64');

    // 파일명 설정 (원본 파일명 또는 템플릿 이름 사용)
    const filename = template.filename || `${template.name}.docx`;
    const encodedFilename = encodeURIComponent(filename);

    // 응답 헤더 설정
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
    res.setHeader('Content-Length', fileBuffer.length);

    return res.send(fileBuffer);
  } catch (error) {
    console.error('Template Download Error:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  } finally {
    if (client) await client.disconnect();
  }
}
