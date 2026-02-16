import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

const NOTIFICATION_EMAIL = 'syjun@ventureplg.com';
const FROM_EMAIL = 'FirstRegister <onboarding@resend.dev>';

interface SurveyNotificationData {
  id: string;
  email: string;
  name?: string;
  company?: string;
  status: 'in_progress' | 'pending';
  completedSectionIndex?: number;
  totalPrice?: number;
}

const getSectionName = (index: number): string => {
  const sectionNames = ['기본 정보', '상표권 소유 정보', '상표 정보', '등록 현황', '상표 사용 현황', '최종 확인'];
  return sectionNames[index] || `섹션 ${index + 1}`;
};

export async function sendSurveyNotification(data: SurveyNotificationData): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    console.log('[Email] RESEND_API_KEY not configured, skipping email notification');
    return false;
  }

  try {
    const isSubmitted = data.status === 'pending';
    const subject = isSubmitted
      ? `[FirstRegister] 새 설문이 제출되었습니다 - ${data.company || data.name || data.email}`
      : `[FirstRegister] 설문 작성 중 - ${data.company || data.name || data.email}`;

    const statusText = isSubmitted
      ? '제출 완료 (검토 대기)'
      : `작성 중 (${getSectionName(data.completedSectionIndex || 0)}까지 완료)`;

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1a1a1a; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">
          ${isSubmitted ? '새 설문이 제출되었습니다' : '설문이 수집되었습니다 (작성 중)'}
        </h2>

        <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
          <tr>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280; width: 120px;">설문 ID</td>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1a1a1a;">${data.id}</td>
          </tr>
          <tr>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280;">이메일</td>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1a1a1a;">${data.email}</td>
          </tr>
          ${data.name ? `
          <tr>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280;">이름</td>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1a1a1a;">${data.name}</td>
          </tr>
          ` : ''}
          ${data.company ? `
          <tr>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280;">회사명</td>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1a1a1a;">${data.company}</td>
          </tr>
          ` : ''}
          <tr>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280;">상태</td>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
              <span style="display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 14px; ${isSubmitted ? 'background-color: #fef3c7; color: #92400e;' : 'background-color: #dbeafe; color: #1e40af;'}">
                ${statusText}
              </span>
            </td>
          </tr>
          ${data.totalPrice ? `
          <tr>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #6b7280;">예상 금액</td>
            <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #1a1a1a; font-weight: 600;">$${data.totalPrice.toLocaleString()}</td>
          </tr>
          ` : ''}
        </table>

        <div style="margin-top: 24px; padding: 16px; background-color: #f3f4f6; border-radius: 8px; text-align: center;">
          <a href="https://trademarks-questionnaire.vercel.app/admin/login" style="display: inline-block; padding: 12px 28px; background-color: #3b82f6; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 15px;">관리자 대시보드 열기</a>
          <p style="margin: 16px 0 0 0; color: #6b7280; font-size: 12px;">
            또는 링크 복사: <a href="https://trademarks-questionnaire.vercel.app/admin/login" style="color: #3b82f6;">https://trademarks-questionnaire.vercel.app/admin/login</a>
          </p>
        </div>

        <p style="margin-top: 24px; color: #9ca3af; font-size: 12px;">
          이 메일은 FirstRegister 시스템에서 자동으로 발송되었습니다.
        </p>
      </div>
    `;

    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: NOTIFICATION_EMAIL,
      subject,
      html,
    });

    if (error) {
      console.error('[Email] Failed to send notification:', error);
      return false;
    }

    console.log('[Email] Notification sent successfully to', NOTIFICATION_EMAIL);
    return true;
  } catch (error) {
    console.error('[Email] Error sending notification:', error);
    return false;
  }
}
