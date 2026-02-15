import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from 'redis';

const TEMP_FILES_KEY = 'temp_files';

async function getRedisClient() {
  const client = createClient({ url: process.env.REDIS_URL });
  await client.connect();
  return client;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let client;
  try {
    const { id } = req.query;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Download ID is required' });
    }

    client = await getRedisClient();

    // 임시 파일 조회
    const fileData = await client.hGet(TEMP_FILES_KEY, id);

    if (!fileData) {
      return res.status(404).json({
        error: 'File not found or expired',
        message: 'The download link may have expired. Please generate the documents again.',
      });
    }

    const file = JSON.parse(fileData);

    // Base64 디코딩
    const buffer = Buffer.from(file.data, 'base64');

    // 파일명 인코딩 (한글 지원)
    const encodedFilename = encodeURIComponent(file.filename);

    // 응답 헤더 설정
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
    res.setHeader('Content-Length', buffer.length);

    // 파일 전송
    return res.send(buffer);

  } catch (error: any) {
    console.error('Download API Error:', error);
    return res.status(500).json({
      error: 'Server error occurred',
      details: error.message,
    });
  } finally {
    if (client) await client.disconnect();
  }
}
