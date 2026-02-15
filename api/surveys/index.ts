import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import { Resend } from 'resend';
import { sendSurveyNotification } from '../utils/email.js';

async function getRedisClient() {
  const client = createClient({ url: process.env.REDIS_URL });
  await client.connect();
  return client;
}

async function disconnectSafely(client: any) {
  if (client && client.isOpen) {
    try {
      await client.quit();
    } catch (e) {
      console.error('Redis quit error:', e);
    }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let client;
  try {
    client = await getRedisClient();

    if (req.method === 'POST') {
      const { action, id, customerInfo, answers, totalPrice, completedSectionIndex, email } = req.body;

      // 이메일 테스트 (Redis 연결 불필요)
      if (action === 'testEmail') {
        await disconnectSafely(client);

        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) {
          return res.status(500).json({
            success: false,
            error: 'RESEND_API_KEY is not configured',
          });
        }

        try {
          const resend = new Resend(apiKey);
          const { data, error } = await resend.emails.send({
            from: 'FirstRegister <onboarding@resend.dev>',
            to: 'syjun@ventureplg.com',
            subject: '[테스트] FirstRegister 이메일 발송 테스트',
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #1a1a1a; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">
                  이메일 발송 테스트
                </h2>

                <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                  <tr>
                    <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; width: 120px;">상태</td>
                    <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
                      <span style="display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 14px; background-color: #d1fae5; color: #065f46;">
                        정상 작동
                      </span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280;">발송 시간</td>
                    <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1a1a1a;">${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</td>
                  </tr>
                </table>

                <div style="margin-top: 24px; padding: 16px; background-color: #f3f4f6; border-radius: 8px; text-align: center;">
                  <p style="margin: 0 0 12px 0; color: #4b5563; font-size: 14px;">이 메일이 도착했다면 이메일 설정이 정상입니다.</p>
                  <a href="https://trademarks-questionnaire.vercel.app/admin/login" style="display: inline-block; padding: 12px 28px; background-color: #3b82f6; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 15px;">관리자 대시보드 열기</a>
                  <p style="margin: 16px 0 0 0; color: #6b7280; font-size: 12px;">또는 링크 복사: <a href="https://trademarks-questionnaire.vercel.app/admin/login" style="color: #3b82f6;">https://trademarks-questionnaire.vercel.app/admin/login</a></p>
                </div>

                <p style="margin-top: 24px; color: #9ca3af; font-size: 12px;">
                  이 메일은 FirstRegister 시스템에서 자동으로 발송되었습니다.
                </p>
              </div>
            `,
          });

          if (error) {
            return res.status(400).json({ success: false, error });
          }

          return res.status(200).json({
            success: true,
            message: '테스트 이메일이 발송되었습니다.',
            data,
          });
        } catch (err: any) {
          return res.status(500).json({
            success: false,
            error: err.message || String(err),
          });
        }
      }

      // 자동 저장
      if (action === 'autosave') {
        console.log('[AutoSave] Request:', { id, email: customerInfo?.email, completedSectionIndex });

        if (id) {
          const existingSurveyStr = await client.hGet('surveys', id);
          if (existingSurveyStr) {
            const existingSurvey = JSON.parse(existingSurveyStr);
            if (existingSurvey.status !== 'in_progress') {
              await disconnectSafely(client);
              return res.status(400).json({ error: '이미 제출된 설문은 수정할 수 없습니다.', id: existingSurvey.id });
            }
            const updatedSurvey = { ...existingSurvey, customerInfo, answers, totalPrice, completedSectionIndex, updatedAt: new Date().toISOString() };
            await client.hSet('surveys', id, JSON.stringify(updatedSurvey));
            await disconnectSafely(client);
            return res.status(200).json({ id, message: '설문이 자동 저장되었습니다.', isNew: false });
          }
        }

        const newId = id || uuidv4();
        const survey = { id: newId, customerInfo, answers, totalPrice, status: 'in_progress', completedSectionIndex, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        await client.hSet('surveys', newId, JSON.stringify(survey));

        // 새 설문 생성 시 이메일 알림 발송 (await로 완료 대기)
        await sendSurveyNotification({
          id: newId,
          email: customerInfo?.email || '',
          name: customerInfo?.name,
          company: customerInfo?.company,
          status: 'in_progress',
          completedSectionIndex,
          totalPrice,
        }).catch(err => console.error('[Email] Background send failed:', err));

        await disconnectSafely(client);
        return res.status(201).json({ id: newId, message: '설문이 자동 저장되었습니다.', isNew: true });
      }

      // 이메일로 작성중인 설문 찾기
      if (action === 'findByEmail') {
        if (!email) {
          await disconnectSafely(client);
          return res.status(400).json({ error: '이메일이 필요합니다.' });
        }
        const allSurveys = await client.hGetAll('surveys');
        const surveys = Object.values(allSurveys).map((s) => JSON.parse(s as string));
        const inProgressSurvey = surveys
          .filter((s: any) => s.status === 'in_progress' && s.customerInfo?.email?.toLowerCase() === email.toLowerCase())
          .sort((a: any, b: any) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())[0];

        await disconnectSafely(client);
        return res.status(200).json({ found: !!inProgressSurvey, survey: inProgressSurvey || null });
      }

      // 기본: 설문 생성/제출
      const existingId = req.body.id;
      if (existingId) {
        const existingSurveyStr = await client.hGet('surveys', existingId);
        if (existingSurveyStr) {
          const existingSurvey = JSON.parse(existingSurveyStr);
          if (existingSurvey.status === 'in_progress') {
            const updatedSurvey = { ...existingSurvey, customerInfo, answers, totalPrice, status: 'pending', completedSectionIndex: undefined, updatedAt: new Date().toISOString() };
            await client.hSet('surveys', existingId, JSON.stringify(updatedSurvey));

            // 설문 제출 시 이메일 알림 발송 (await로 완료 대기)
            await sendSurveyNotification({
              id: existingId,
              email: customerInfo?.email || existingSurvey.customerInfo?.email || '',
              name: customerInfo?.name || existingSurvey.customerInfo?.name,
              company: customerInfo?.company || existingSurvey.customerInfo?.company,
              status: 'pending',
              totalPrice,
            }).catch(err => console.error('[Email] Background send failed:', err));

            await disconnectSafely(client);
            return res.status(200).json({ id: existingId, message: '설문이 성공적으로 제출되었습니다.' });
          }
        }
      }

      const newId = uuidv4();
      const survey = { id: newId, customerInfo, answers, totalPrice, status: 'pending', createdAt: new Date().toISOString() };
      await client.hSet('surveys', newId, JSON.stringify(survey));

      // 새 설문 제출 시 이메일 알림 발송 (await로 완료 대기)
      await sendSurveyNotification({
        id: newId,
        email: customerInfo?.email || '',
        name: customerInfo?.name,
        company: customerInfo?.company,
        status: 'pending',
        totalPrice,
      }).catch(err => console.error('[Email] Background send failed:', err));

      await disconnectSafely(client);
      return res.status(201).json({ id: newId, message: '설문이 성공적으로 제출되었습니다.' });
    }

    if (req.method === 'GET') {
      const { status } = req.query;
      const allSurveys = await client.hGetAll('surveys');
      let surveys = Object.values(allSurveys).map((s) => JSON.parse(s as string));

      if (status && status !== 'all') {
        surveys = surveys.filter((s: any) => s.status === status);
      }

      surveys.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      await disconnectSafely(client);
      return res.status(200).json(surveys);
    }

    await disconnectSafely(client);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error('API Error:', error);
    await disconnectSafely(client);
    return res.status(500).json({ error: '서버 오류가 발생했습니다.', details: error?.message || String(error) });
  }
}
