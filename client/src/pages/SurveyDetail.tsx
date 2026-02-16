import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Survey, SurveyAnswer } from '../types/survey';
import { fetchSurvey, updateSurvey } from '../services/api';
import { questionSections } from '../data/questions';

export default function SurveyDetail() {
  const { id } = useParams<{ id: string }>();

  const [survey, setSurvey] = useState<Survey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    loadSurvey();
  }, [id]);

  const loadSurvey = async () => {
    if (!id) return;

    try {
      setLoading(true);
      const data = await fetchSurvey(id);
      setSurvey(data);
      setAdminNotes(data.adminNotes || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : '설문을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusUpdate = async (status: 'approved' | 'rejected') => {
    if (!id) return;

    setIsUpdating(true);
    setMessage({ type: '', text: '' });

    try {
      await updateSurvey(id, { status, adminNotes });
      setMessage({ type: 'success', text: `설문이 ${status === 'approved' ? '승인' : '반려'}되었습니다.` });
      loadSurvey();
    } catch (err) {
      setMessage({ type: 'error', text: '상태 업데이트에 실패했습니다.' });
    } finally {
      setIsUpdating(false);
    }
  };

  // 질문 ID로 질문 텍스트 찾기
  const getQuestionText = (questionId: string): string => {
    for (const section of questionSections) {
      const question = section.questions.find(q => q.id === questionId);
      if (question) {
        return question.text;
      }
    }
    return questionId;
  };

  // 중복 제거된 응답 목록 반환
  const getUniqueAnswers = (answers: SurveyAnswer[]): SurveyAnswer[] => {
    const answersMap = new Map<string, SurveyAnswer>();
    for (const answer of answers) {
      answersMap.set(answer.questionId, answer);
    }
    return Array.from(answersMap.values());
  };

  // 응답 값 포맷팅
  const formatAnswerValue = (value: string | string[] | unknown): string => {
    if (Array.isArray(value)) {
      if (value.length > 0 && typeof value[0] === 'object') {
        // 반복 그룹 데이터
        return value.map((item, idx) => {
          if (typeof item === 'object' && item !== null) {
            const entries = Object.entries(item as Record<string, string>)
              .filter(([_, v]) => v)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ');
            return `[${idx + 1}] ${entries}`;
          }
          return String(item);
        }).join('\n');
      }
      return value.join(', ');
    }
    if (value === 'yes') return '예';
    if (value === 'no') return '아니오';
    if (value === '1') return 'Accept';
    if (value === '2') return 'Deny';
    return String(value || '-');
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { class: string; text: string }> = {
      in_progress: { class: 'status-in-progress', text: '작성중' },
      pending: { class: 'status-pending', text: '검토 대기' },
      approved: { class: 'status-approved', text: '승인됨' },
      rejected: { class: 'status-rejected', text: '반려됨' },
    };
    const { class: className, text } = statusMap[status] || statusMap.pending;
    return <span className={`status-badge ${className}`}>{text}</span>;
  };

  // PDF 출력 (브라우저 인쇄)
  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return <div className="loading">로딩 중...</div>;
  }

  if (error || !survey) {
    return (
      <div className="card">
        <div className="message message-error">{error || '설문을 찾을 수 없습니다.'}</div>
        <Link to="/admin" className="btn btn-secondary">목록으로</Link>
      </div>
    );
  }

  const uniqueAnswers = getUniqueAnswers(survey.answers || []);

  return (
    <div>
      <div className="no-print" style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
        <Link to="/admin" className="btn btn-outline">
          &larr; 목록으로
        </Link>
        <button className="btn btn-secondary" onClick={handlePrint}>
          🖨️ PDF 출력
        </button>
      </div>

      {message.text && (
        <div className={`message message-${message.type} no-print`}>{message.text}</div>
      )}

      <div className="card print-area">
        <h2 style={{ marginBottom: '20px', borderBottom: '2px solid var(--color-primary)', paddingBottom: '10px' }}>
          상표 등록 설문 응답
        </h2>

        {/* 기본 정보 */}
        <div className="detail-section">
          <h3>제출 정보</h3>
          <div className="detail-row">
            <span className="detail-label">상태</span>
            <span className="detail-value">{getStatusBadge(survey.status)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">제출일</span>
            <span className="detail-value">{formatDate(survey.createdAt)}</span>
          </div>
          {survey.customerInfo?.email && (
            <div className="detail-row">
              <span className="detail-label">이메일</span>
              <span className="detail-value">{survey.customerInfo.email}</span>
            </div>
          )}
        </div>

        {/* 질문-답 목록 */}
        <div className="detail-section">
          <h3>설문 응답</h3>
          {uniqueAnswers.map((answer, index) => (
            <div key={index} className="qa-item" style={{
              marginBottom: '16px',
              padding: '12px',
              backgroundColor: 'var(--color-gray-50)',
              borderRadius: '8px',
              pageBreakInside: 'avoid'
            }}>
              <div style={{ fontWeight: 600, color: 'var(--color-gray-700)', marginBottom: '8px' }}>
                Q. {getQuestionText(answer.questionId)}
              </div>
              <div style={{
                color: 'var(--color-gray-900)',
                whiteSpace: 'pre-wrap',
                paddingLeft: '12px',
                borderLeft: '3px solid var(--color-primary)'
              }}>
                A. {formatAnswerValue(answer.value)}
              </div>
            </div>
          ))}
        </div>

        {/* 관리자 메모 */}
        {survey.adminNotes && (
          <div className="detail-section">
            <h3>관리자 메모</h3>
            <p style={{ whiteSpace: 'pre-wrap' }}>{survey.adminNotes}</p>
          </div>
        )}
      </div>

      {/* 관리자 액션 (인쇄 시 숨김) */}
      <div className="card no-print" style={{ marginTop: '20px' }}>
        <h3>관리자 액션</h3>

        <div className="form-group">
          <label>관리자 메모</label>
          <textarea
            value={adminNotes}
            onChange={e => setAdminNotes(e.target.value)}
            placeholder="메모를 입력하세요..."
            rows={3}
          />
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            className="btn btn-success"
            onClick={() => handleStatusUpdate('approved')}
            disabled={isUpdating || survey.status === 'approved'}
          >
            {isUpdating ? '처리 중...' : '승인하기'}
          </button>

          <button
            className="btn btn-danger"
            onClick={() => handleStatusUpdate('rejected')}
            disabled={isUpdating || survey.status === 'rejected'}
          >
            {isUpdating ? '처리 중...' : '반려하기'}
          </button>
        </div>
      </div>

      {/* 인쇄용 스타일 */}
      <style>{`
        @media print {
          .no-print {
            display: none !important;
          }
          .print-area {
            box-shadow: none !important;
            border: none !important;
          }
          .header, nav {
            display: none !important;
          }
          body {
            padding: 20px;
          }
          .qa-item {
            break-inside: avoid;
          }
        }
      `}</style>
    </div>
  );
}
