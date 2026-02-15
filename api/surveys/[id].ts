import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from 'redis';

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
      const data = await client.hGet('surveys', id);
      if (!data) {
        return res.status(404).json({ error: '설문을 찾을 수 없습니다.' });
      }
      return res.status(200).json(JSON.parse(data));
    }

    if (req.method === 'PATCH') {
      const data = await client.hGet('surveys', id);
      if (!data) {
        return res.status(404).json({ error: '설문을 찾을 수 없습니다.' });
      }

      const survey = JSON.parse(data);
      const { status, adminNotes, answers, adminDates, adminValues } = req.body;

      if (status) {
        survey.status = status;
        survey.reviewedAt = new Date().toISOString();
      }
      if (adminNotes !== undefined) {
        survey.adminNotes = adminNotes;
      }
      // 설문 응답 업데이트 (동일한 questionId가 있으면 마지막 값만 유지)
      if (answers !== undefined) {
        // questionId를 키로 사용하여 중복 제거 (마지막 값 유지)
        const answersMap = new Map();
        for (const answer of answers) {
          answersMap.set(answer.questionId, answer);
        }
        survey.answers = Array.from(answersMap.values());
      }
      // 관리자 날짜 설정 업데이트
      if (adminDates !== undefined) {
        survey.adminDates = { ...survey.adminDates, ...adminDates };
      }
      // 관리자 값 설정 업데이트
      if (adminValues !== undefined) {
        survey.adminValues = { ...survey.adminValues, ...adminValues };
      }

      await client.hSet('surveys', id, JSON.stringify(survey));
      return res.status(200).json({ message: '설문이 업데이트되었습니다.', survey });
    }

    if (req.method === 'DELETE') {
      const deleted = await client.hDel('surveys', id);
      if (!deleted) {
        return res.status(404).json({ error: '설문을 찾을 수 없습니다.' });
      }
      return res.status(200).json({ message: '설문이 삭제되었습니다.' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  } finally {
    if (client) await client.disconnect();
  }
}
