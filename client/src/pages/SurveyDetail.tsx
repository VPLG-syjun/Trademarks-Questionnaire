import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Survey, SurveyAnswer, RepeatableGroupItem } from '../types/survey';
import { fetchSurvey, updateSurvey } from '../services/api';
import DocumentGenerationModal from '../components/DocumentGenerationModal';

// Directors/Founders 필드 정의
const DIRECTOR_FIELDS = ['name', 'address', 'email'];
const FOUNDER_FIELDS = ['name', 'type', 'address', 'email', 'cash'];

interface RepeatableGroupState {
  [groupId: string]: RepeatableGroupItem[];
}

export default function SurveyDetail() {
  const { id } = useParams<{ id: string }>();

  const [survey, setSurvey] = useState<Survey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adminNotes, setAdminNotes] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [showDocumentModal, setShowDocumentModal] = useState(false);

  // 편집 모드 상태
  const [editingAnswers, setEditingAnswers] = useState(false);
  const [editedAnswers, setEditedAnswers] = useState<SurveyAnswer[]>([]);

  // 관리자 날짜 상태
  const [coiDate, setCoiDate] = useState('');
  const [signDate, setSignDate] = useState('');

  // 관리자 값 상태
  const [authorizedShares, setAuthorizedShares] = useState('');
  const [parValue, setParValue] = useState('');
  const [fairMarketValue, setFairMarketValue] = useState('');

  // 반복 그룹 편집 상태
  const [editingRepeatableGroups, setEditingRepeatableGroups] = useState(false);
  const [repeatableGroups, setRepeatableGroups] = useState<RepeatableGroupState>({
    directors: [],
    founders: [],
  });

  useEffect(() => {
    loadSurvey();
  }, [id]);

  // survey가 로드되면 날짜/값 상태 초기화
  useEffect(() => {
    if (survey) {
      setCoiDate(survey.adminDates?.COIDate || '');
      setSignDate(survey.adminDates?.SIGNDate || '');
      setAuthorizedShares(survey.adminValues?.authorizedShares || '');
      setParValue(survey.adminValues?.parValue || '');
      setFairMarketValue(survey.adminValues?.fairMarketValue || '');

      // 반복 그룹 데이터 초기화
      const directorsAnswer = survey.answers?.find(a => a.questionId === 'directors');
      const foundersAnswer = survey.answers?.find(a => a.questionId === 'founders');

      const newGroups: RepeatableGroupState = {
        directors: [],
        founders: [],
      };

      // Directors 데이터 처리
      if (directorsAnswer && Array.isArray(directorsAnswer.value) && directorsAnswer.value.length > 0) {
        if (typeof directorsAnswer.value[0] === 'object' && directorsAnswer.value[0] !== null) {
          newGroups.directors = directorsAnswer.value as RepeatableGroupItem[];
        }
      }
      // 데이터가 없거나 손상된 경우 빈 항목 1개 추가
      if (newGroups.directors.length === 0) {
        const emptyDirector: RepeatableGroupItem = {};
        DIRECTOR_FIELDS.forEach(f => emptyDirector[f] = '');
        newGroups.directors = [emptyDirector];
      }

      // Founders 데이터 처리
      if (foundersAnswer && Array.isArray(foundersAnswer.value) && foundersAnswer.value.length > 0) {
        if (typeof foundersAnswer.value[0] === 'object' && foundersAnswer.value[0] !== null) {
          newGroups.founders = foundersAnswer.value as RepeatableGroupItem[];
        }
      }
      // 데이터가 없거나 손상된 경우 빈 항목 1개 추가
      if (newGroups.founders.length === 0) {
        const emptyFounder: RepeatableGroupItem = {};
        FOUNDER_FIELDS.forEach(f => emptyFounder[f] = '');
        newGroups.founders = [emptyFounder];
      }

      setRepeatableGroups(newGroups);
    }
  }, [survey]);

  const loadSurvey = async (showLoading = true) => {
    if (!id) return;

    try {
      if (showLoading && !survey) {
        setLoading(true);
      }
      const data = await fetchSurvey(id);
      setSurvey(data);
      setAdminNotes(data.adminNotes || '');
      // 중복 제거된 응답으로 설정
      setEditedAnswers(getUniqueAnswers(data.answers || []));
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

  const handleDocumentGenerated = () => {
    loadSurvey(false);
    setMessage({ type: 'success', text: '문서가 성공적으로 생성되었습니다.' });
  };

  // 응답 편집 시작
  const handleStartEditAnswers = () => {
    if (survey) {
      setEditedAnswers(getUniqueAnswers(survey.answers || []));
      setEditingAnswers(true);
    }
  };

  // 응답 편집 취소
  const handleCancelEditAnswers = () => {
    if (survey) {
      setEditedAnswers(getUniqueAnswers(survey.answers || []));
    }
    setEditingAnswers(false);
  };

  // 개별 응답 수정
  const handleAnswerChange = (index: number, newValue: string | string[]) => {
    const updated = [...editedAnswers];
    updated[index] = { ...updated[index], value: newValue };
    setEditedAnswers(updated);
  };

  // 응답 저장
  const handleSaveAnswers = async () => {
    if (!id) return;

    setIsUpdating(true);
    setMessage({ type: '', text: '' });

    try {
      await updateSurvey(id, { answers: editedAnswers });
      setMessage({ type: 'success', text: '설문 응답이 저장되었습니다.' });
      setEditingAnswers(false);
      loadSurvey(false);
    } catch (err) {
      setMessage({ type: 'error', text: '응답 저장에 실패했습니다.' });
    } finally {
      setIsUpdating(false);
    }
  };

  // 관리자 날짜 저장
  const handleSaveDates = async () => {
    if (!id) return;

    setIsUpdating(true);
    setMessage({ type: '', text: '' });

    try {
      const result = await updateSurvey(id, {
        adminDates: {
          COIDate: coiDate || undefined,
          SIGNDate: signDate || undefined,
        },
      });

      // API에서 반환된 survey로 직접 업데이트
      if (result.survey) {
        setSurvey(result.survey);
        // 로컬 상태도 명시적으로 업데이트
        setCoiDate(result.survey.adminDates?.COIDate || '');
        setSignDate(result.survey.adminDates?.SIGNDate || '');
      }

      setMessage({ type: 'success', text: '날짜가 저장되었습니다.' });
    } catch (err) {
      setMessage({ type: 'error', text: '날짜 저장에 실패했습니다.' });
    } finally {
      setIsUpdating(false);
    }
  };

  // 관리자 값 저장
  const handleSaveValues = async () => {
    if (!id) return;

    setIsUpdating(true);
    setMessage({ type: '', text: '' });

    try {
      const result = await updateSurvey(id, {
        adminValues: {
          authorizedShares: authorizedShares || undefined,
          parValue: parValue || undefined,
          fairMarketValue: fairMarketValue || undefined,
        },
      });

      // API에서 반환된 survey로 직접 업데이트
      if (result.survey) {
        setSurvey(result.survey);
        // 로컬 상태도 명시적으로 업데이트
        setAuthorizedShares(result.survey.adminValues?.authorizedShares || '');
        setParValue(result.survey.adminValues?.parValue || '');
        setFairMarketValue(result.survey.adminValues?.fairMarketValue || '');
      }

      setMessage({ type: 'success', text: '값이 저장되었습니다.' });
    } catch (err) {
      setMessage({ type: 'error', text: '값 저장에 실패했습니다.' });
    } finally {
      setIsUpdating(false);
    }
  };

  // 반복 그룹 필드 변경
  const handleRepeatableFieldChange = (groupId: string, itemIndex: number, fieldId: string, value: string) => {
    setRepeatableGroups(prev => {
      const newGroups = { ...prev };
      const items = [...(newGroups[groupId] || [])];
      items[itemIndex] = { ...items[itemIndex], [fieldId]: value };
      newGroups[groupId] = items;
      return newGroups;
    });
  };

  // 반복 그룹 항목 추가
  const handleAddRepeatableItem = (groupId: string) => {
    const fields = groupId === 'directors' ? DIRECTOR_FIELDS : FOUNDER_FIELDS;
    const newItem: RepeatableGroupItem = {};
    fields.forEach(f => newItem[f] = '');

    setRepeatableGroups(prev => ({
      ...prev,
      [groupId]: [...(prev[groupId] || []), newItem],
    }));
  };

  // 반복 그룹 항목 삭제
  const handleRemoveRepeatableItem = (groupId: string, itemIndex: number) => {
    setRepeatableGroups(prev => ({
      ...prev,
      [groupId]: (prev[groupId] || []).filter((_, i) => i !== itemIndex),
    }));
  };

  // 반복 그룹 데이터 저장
  const handleSaveRepeatableGroups = async () => {
    if (!id || !survey) return;

    setIsUpdating(true);
    setMessage({ type: '', text: '' });

    try {
      // 기존 answers에서 directors, founders 제거 후 새 데이터 추가
      const otherAnswers = (survey.answers || []).filter(
        a => a.questionId !== 'directors' && a.questionId !== 'founders'
      );

      const newAnswers: SurveyAnswer[] = [
        ...otherAnswers,
        { questionId: 'directors', value: repeatableGroups.directors },
        { questionId: 'founders', value: repeatableGroups.founders },
      ];

      const result = await updateSurvey(id, { answers: newAnswers });

      if (result.survey) {
        setSurvey(result.survey);
      }

      setEditingRepeatableGroups(false);
      setMessage({ type: 'success', text: 'Directors/Founders 데이터가 저장되었습니다.' });
    } catch (err) {
      setMessage({ type: 'error', text: '데이터 저장에 실패했습니다.' });
    } finally {
      setIsUpdating(false);
    }
  };

  // 중복 제거된 응답 목록 반환 (동일 questionId는 마지막 값만 유지)
  const getUniqueAnswers = (answers: SurveyAnswer[]): SurveyAnswer[] => {
    const answersMap = new Map<string, SurveyAnswer>();
    for (const answer of answers) {
      answersMap.set(answer.questionId, answer);
    }
    return Array.from(answersMap.values());
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

  const formatPrice = (amount: number) => {
    return '$' + amount.toLocaleString();
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

  // 섹션 이름 가져오기
  const getSectionName = (index: number) => {
    const sectionNames = ['기본 정보', '회사 정보', '주소 정보', '이사회 정보', '임원 정보', '주주 정보', '금융 서비스', '추가 서비스', '최종 확인'];
    return sectionNames[index] || `섹션 ${index + 1}`;
  };

  // 반복 그룹 데이터인지 확인 (객체 배열)
  const isRepeatableGroupData = (value: unknown): value is Array<Record<string, string>> => {
    return Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null;
  };

  // 손상된 반복 그룹 데이터인지 확인 ("[object Object]" 문자열)
  const isCorruptedRepeatableData = (questionId: string, value: unknown): boolean => {
    const repeatableGroups = ['directors', 'founders'];
    if (!repeatableGroups.includes(questionId)) return false;
    if (typeof value === 'string' && value.includes('[object Object]')) return true;
    if (Array.isArray(value) && value.some(v => typeof v === 'string' && v.includes('[object Object]'))) return true;
    return false;
  };

  // 응답 값을 렌더링하는 함수
  const renderAnswerValue = (questionId: string, value: string | string[] | Array<Record<string, string>>) => {
    // 손상된 데이터 체크
    if (isCorruptedRepeatableData(questionId, value)) {
      return (
        <div className="corrupted-data-warning">
          <div className="warning-icon">⚠️</div>
          <div className="warning-content">
            <strong>데이터 손상됨</strong>
            <p>이 데이터는 이전 버전에서 잘못 저장되어 복구할 수 없습니다.</p>
            <p>고객에게 설문을 다시 작성하도록 요청하거나, 아래 편집 기능으로 직접 입력해주세요.</p>
            <p className="raw-value">원본 값: {String(value)}</p>
          </div>
        </div>
      );
    }

    // 반복 그룹 데이터 (directors, founders 등)
    if (isRepeatableGroupData(value)) {
      const groupName = questionId.charAt(0).toUpperCase() + questionId.slice(1);
      const singularName = groupName.endsWith('s') ? groupName.slice(0, -1) : groupName;

      return (
        <div className="repeatable-group-display">
          {value.map((item, index) => (
            <div key={index} className="repeatable-group-item">
              <div className="repeatable-group-header">
                <strong>{singularName} {index + 1}</strong>
              </div>
              <div className="repeatable-group-fields">
                {Object.entries(item).map(([fieldKey, fieldValue]) => (
                  <div key={fieldKey} className="repeatable-group-field">
                    <span className="field-label">
                      {singularName}{index + 1}{fieldKey.charAt(0).toUpperCase() + fieldKey.slice(1)}:
                    </span>
                    <span className="field-value">{fieldValue || '-'}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }

    // 일반 배열 (다중 선택 등)
    if (Array.isArray(value)) {
      return value.join(', ');
    }

    // 단일 값
    return value;
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

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <Link to="/admin" className="btn btn-outline">
          &larr; 목록으로
        </Link>
      </div>

      {message.text && (
        <div className={`message message-${message.type}`}>{message.text}</div>
      )}

      <div className="card">
        <h2>설문 상세 정보</h2>

        {/* Customer Info */}
        <div className="detail-section">
          <h3>고객 정보</h3>
          <div className="detail-row">
            <span className="detail-label">이름</span>
            <span className="detail-value">{survey.customerInfo?.name || '-'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">이메일</span>
            <span className="detail-value">{survey.customerInfo?.email || '-'}</span>
          </div>
          {survey.customerInfo?.phone && (
            <div className="detail-row">
              <span className="detail-label">연락처</span>
              <span className="detail-value">{survey.customerInfo.phone}</span>
            </div>
          )}
          {survey.customerInfo?.company && (
            <div className="detail-row">
              <span className="detail-label">회사명</span>
              <span className="detail-value">{survey.customerInfo.company}</span>
            </div>
          )}
        </div>

        {/* Status Info */}
        <div className="detail-section">
          <h3>상태 정보</h3>
          <div className="detail-row">
            <span className="detail-label">상태</span>
            <span className="detail-value">{getStatusBadge(survey.status)}</span>
          </div>
          {survey.status === 'in_progress' && survey.completedSectionIndex !== undefined && (
            <div className="detail-row">
              <span className="detail-label">완료된 섹션</span>
              <span className="detail-value" style={{ color: 'var(--color-warning)' }}>
                {getSectionName(survey.completedSectionIndex)}까지 ({survey.completedSectionIndex + 1}/9)
              </span>
            </div>
          )}
          {survey.status === 'in_progress' && (
            <div className="detail-row">
              <span className="detail-label"></span>
              <span className="detail-value" style={{ fontSize: '0.85rem', color: 'var(--color-gray-500)' }}>
                작성자가 설문을 완료하지 않고 페이지를 이탈했습니다.
              </span>
            </div>
          )}
          <div className="detail-row">
            <span className="detail-label">예상 금액</span>
            <span className="detail-value" style={{ fontWeight: 600, color: 'var(--color-primary)' }}>
              {formatPrice(survey.totalPrice || 0)}
            </span>
          </div>
          <div className="detail-row">
            <span className="detail-label">{survey.status === 'in_progress' ? '생성일' : '제출일'}</span>
            <span className="detail-value">{formatDate(survey.createdAt)}</span>
          </div>
          {survey.updatedAt && survey.status === 'in_progress' && (
            <div className="detail-row">
              <span className="detail-label">마지막 업데이트</span>
              <span className="detail-value">{formatDate(survey.updatedAt)}</span>
            </div>
          )}
          <div className="detail-row">
            <span className="detail-label">검토일</span>
            <span className="detail-value">{formatDate(survey.reviewedAt)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">문서 생성일</span>
            <span className="detail-value">{formatDate(survey.documentGeneratedAt)}</span>
          </div>
        </div>

        {/* Survey Answers */}
        <div className="detail-section">
          <div className="section-header">
            <h3>설문 응답</h3>
            {!editingAnswers ? (
              <button
                className="btn btn-sm btn-outline"
                onClick={handleStartEditAnswers}
              >
                편집
              </button>
            ) : (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={handleCancelEditAnswers}
                  disabled={isUpdating}
                >
                  취소
                </button>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={handleSaveAnswers}
                  disabled={isUpdating}
                >
                  {isUpdating ? '저장 중...' : '저장'}
                </button>
              </div>
            )}
          </div>

          {editingAnswers ? (
            // 편집 모드
            <div className="answers-edit-list">
              {editedAnswers.map((answer, index) => (
                <div key={index} className="answer-edit-item">
                  <label className="answer-edit-label">{answer.questionId}</label>
                  {isRepeatableGroupData(answer.value) ? (
                    // 반복 그룹 편집 (읽기 전용으로 표시 - 설문에서만 수정 가능)
                    <div className="repeatable-group-edit-notice">
                      <div style={{ color: 'var(--color-gray-500)', fontSize: '0.9rem', marginBottom: '8px' }}>
                        ※ 반복 그룹 데이터는 설문에서 직접 수정해주세요.
                      </div>
                      {renderAnswerValue(answer.questionId, answer.value)}
                    </div>
                  ) : Array.isArray(answer.value) ? (
                    <textarea
                      className="answer-edit-input"
                      value={answer.value.join('\n')}
                      onChange={(e) =>
                        handleAnswerChange(
                          index,
                          e.target.value.split('\n').filter((v) => v.trim())
                        )
                      }
                      rows={3}
                      placeholder="각 줄에 하나씩 입력"
                    />
                  ) : (
                    <input
                      type="text"
                      className="answer-edit-input"
                      value={answer.value as string}
                      onChange={(e) => handleAnswerChange(index, e.target.value)}
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            // 보기 모드 (중복 제거된 응답만 표시)
            getUniqueAnswers(survey.answers || []).map((answer, index) => (
              <div key={index} className="question-card">
                <h4>{answer.questionId}</h4>
                <div style={{ marginTop: '10px', color: '#374151' }}>
                  {renderAnswerValue(answer.questionId, answer.value)}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Directors & Founders 편집 섹션 */}
        <div className="detail-section">
          <div className="section-header">
            <h3>Directors & Founders 데이터</h3>
            {!editingRepeatableGroups ? (
              <button
                className="btn btn-sm btn-outline"
                onClick={() => setEditingRepeatableGroups(true)}
              >
                편집
              </button>
            ) : (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => setEditingRepeatableGroups(false)}
                  disabled={isUpdating}
                >
                  취소
                </button>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={handleSaveRepeatableGroups}
                  disabled={isUpdating}
                >
                  {isUpdating ? '저장 중...' : '저장'}
                </button>
              </div>
            )}
          </div>

          {editingRepeatableGroups ? (
            <div className="repeatable-groups-edit">
              {/* Directors 편집 */}
              <div className="repeatable-group-edit-section">
                <h4>Directors (이사)</h4>
                {repeatableGroups.directors.map((item, itemIndex) => (
                  <div key={itemIndex} className="repeatable-group-item">
                    <div className="repeatable-group-header">
                      <strong>Director {itemIndex + 1}</strong>
                      {repeatableGroups.directors.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => handleRemoveRepeatableItem('directors', itemIndex)}
                        >
                          삭제
                        </button>
                      )}
                    </div>
                    <div className="repeatable-edit-fields">
                      {DIRECTOR_FIELDS.map(field => (
                        <div key={field} className="repeatable-edit-field">
                          <label>Director{itemIndex + 1}{field.charAt(0).toUpperCase() + field.slice(1)}</label>
                          <input
                            type={field === 'email' ? 'email' : 'text'}
                            value={item[field] || ''}
                            onChange={(e) => handleRepeatableFieldChange('directors', itemIndex, field, e.target.value)}
                            placeholder={field}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn btn-outline btn-add-item"
                  onClick={() => handleAddRepeatableItem('directors')}
                >
                  + Director 추가
                </button>
              </div>

              {/* Founders 편집 */}
              <div className="repeatable-group-edit-section">
                <h4>Founders (주주)</h4>
                {repeatableGroups.founders.map((item, itemIndex) => (
                  <div key={itemIndex} className="repeatable-group-item">
                    <div className="repeatable-group-header">
                      <strong>Founder {itemIndex + 1}</strong>
                      {repeatableGroups.founders.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => handleRemoveRepeatableItem('founders', itemIndex)}
                        >
                          삭제
                        </button>
                      )}
                    </div>
                    <div className="repeatable-edit-fields">
                      {FOUNDER_FIELDS.map(field => (
                        <div key={field} className="repeatable-edit-field">
                          <label>Founder{itemIndex + 1}{field.charAt(0).toUpperCase() + field.slice(1)}</label>
                          <input
                            type={field === 'email' ? 'email' : field === 'cash' ? 'number' : 'text'}
                            value={item[field] || ''}
                            onChange={(e) => handleRepeatableFieldChange('founders', itemIndex, field, e.target.value)}
                            placeholder={field}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn btn-outline btn-add-item"
                  onClick={() => handleAddRepeatableItem('founders')}
                >
                  + Founder 추가
                </button>
              </div>
            </div>
          ) : (
            <p className="section-description">
              손상된 데이터나 누락된 Directors/Founders 정보를 직접 입력하려면 "편집" 버튼을 클릭하세요.
            </p>
          )}
        </div>

        {/* Admin Values - Shares & Values */}
        <div className="detail-section">
          <h3>주식 및 가치 설정</h3>
          <p className="section-description">
            문서 생성 시 사용될 주식 관련 값을 설정합니다.
          </p>

          <div className="admin-values-grid">
            <div className="admin-value-field">
              <label>Authorized Shares (수권주식수)</label>
              <input
                type="text"
                value={authorizedShares}
                onChange={(e) => setAuthorizedShares(e.target.value)}
                placeholder="예: 10,000,000"
                className="value-input"
              />
              {authorizedShares && (
                <span className="value-preview">
                  {parseInt(authorizedShares.replace(/,/g, '')).toLocaleString()} shares
                </span>
              )}
            </div>

            <div className="admin-value-field">
              <label>Par Value (액면가)</label>
              <input
                type="text"
                value={parValue}
                onChange={(e) => setParValue(e.target.value)}
                placeholder="예: 0.0001"
                className="value-input"
              />
              {parValue && (
                <span className="value-preview">
                  ${parValue} per share
                </span>
              )}
            </div>

            <div className="admin-value-field">
              <label>Fair Market Value (공정시장가치)</label>
              <input
                type="text"
                value={fairMarketValue}
                onChange={(e) => setFairMarketValue(e.target.value)}
                placeholder="예: 0.10"
                className="value-input"
              />
              {fairMarketValue && (
                <span className="value-preview">
                  ${fairMarketValue} per share
                </span>
              )}
            </div>
          </div>

          <div style={{ marginTop: '16px' }}>
            <button
              className="btn btn-primary"
              onClick={handleSaveValues}
              disabled={isUpdating}
            >
              {isUpdating ? '저장 중...' : '값 저장'}
            </button>
            {(survey.adminValues?.authorizedShares || survey.adminValues?.parValue || survey.adminValues?.fairMarketValue) && (
              <span className="saved-indicator" style={{ marginLeft: '12px' }}>
                ✓ 저장됨
              </span>
            )}
          </div>
        </div>

        {/* Admin Dates - COIDate & SIGNDate */}
        <div className="detail-section">
          <h3>문서 생성 날짜 설정</h3>
          <p className="section-description">
            문서 생성 시 사용될 날짜를 설정합니다. 설정하지 않으면 문서 생성 시점의 날짜가 사용됩니다.
          </p>

          <div className="admin-dates-grid">
            <div className="admin-date-field">
              <label>COIDate (Certificate of Incorporation)</label>
              <input
                type="date"
                value={coiDate}
                onChange={(e) => setCoiDate(e.target.value)}
                className="date-input"
              />
              {coiDate && (
                <span className="date-preview">
                  {new Date(coiDate).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
              )}
            </div>

            <div className="admin-date-field">
              <label>SIGNDate (서명 날짜)</label>
              <input
                type="date"
                value={signDate}
                onChange={(e) => setSignDate(e.target.value)}
                className="date-input"
              />
              {signDate && (
                <span className="date-preview">
                  {new Date(signDate).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </span>
              )}
            </div>

          </div>

          <div style={{ marginTop: '16px' }}>
            <button
              className="btn btn-primary"
              onClick={handleSaveDates}
              disabled={isUpdating}
            >
              {isUpdating ? '저장 중...' : '날짜 저장'}
            </button>
            {(survey.adminDates?.COIDate || survey.adminDates?.SIGNDate) && (
              <span className="saved-indicator" style={{ marginLeft: '12px' }}>
                ✓ 저장됨
              </span>
            )}
          </div>
        </div>

        {/* Admin Actions */}
        <div className="detail-section">
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

            <button
              className="btn btn-primary"
              onClick={() => setShowDocumentModal(true)}
              disabled={survey.status !== 'approved'}
              title={survey.status !== 'approved' ? '승인된 설문만 문서 생성이 가능합니다' : ''}
            >
              📄 문서 생성
            </button>

            {survey.documentGeneratedAt && (
              <span className="doc-generated-badge">
                ✅ 문서 생성됨 ({formatDate(survey.documentGeneratedAt)})
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Document Generation Modal */}
      <DocumentGenerationModal
        isOpen={showDocumentModal}
        onClose={() => setShowDocumentModal(false)}
        surveyId={survey.id}
        onComplete={handleDocumentGenerated}
      />
    </div>
  );
}
