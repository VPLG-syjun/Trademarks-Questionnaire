import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { questionSections } from '../data/questions';

interface Template {
  id: string;
  name: string;
  displayName: string;
  category: string;
  filename: string;
  uploadedAt: string;
  isActive: boolean;
}

interface VariableMapping {
  id?: string;
  variableName: string;
  questionId: string;
  dataType: string;
  transformRule: string;
  required: boolean;
  formula?: string;  // 계산된 값일 때 사용할 수식
}

interface RuleCondition {
  questionId: string;
  operator: string;
  value: string;
  valueType?: 'literal' | 'question';  // 'literal' = 직접 입력, 'question' = 다른 질문 참조
  valueQuestionId?: string;            // valueType이 'question'일 때 참조할 질문 ID
  sourceType?: 'question' | 'computed';  // 'question' = 설문 질문, 'computed' = 계산된 변수
}

interface SelectionRule {
  id?: string;
  conditions: RuleCondition[];
  logicalOperator?: 'AND' | 'OR';      // 조건 간 논리 연산자 (기본값: AND)
  priority: number;
  isAlwaysInclude: boolean;
  isManualOnly: boolean;
}

const CATEGORIES = ['투자', '법인설립', '근로계약', '기타'];

const OPERATORS = [
  { value: '==', label: '같음 (==)' },
  { value: '!=', label: '다름 (!=)' },
  { value: 'contains', label: '포함함' },
  { value: 'not_contains', label: '포함하지 않음' },
  { value: 'in', label: '다음 중 하나 (in)' },
  { value: '>', label: '크다 (>)' },
  { value: '>=', label: '크거나 같다 (>=)' },
  { value: '<', label: '작다 (<)' },
  { value: '<=', label: '작거나 같다 (<=)' },
];

// 계산된 변수 목록 (선택 규칙 조건으로 사용 가능)
const COMPUTED_VARIABLES = [
  { id: 'directorsCount', label: 'Directors Count (이사 수)', type: 'number' },
  { id: 'foundersCount', label: 'Founders Count (주주 수)', type: 'number' },
  { id: 'hasMultipleDirectors', label: 'Has Multiple Directors (이사 2명 이상)', type: 'boolean' },
  { id: 'hasSingleDirectors', label: 'Has Single Director (이사 1명)', type: 'boolean' },
  { id: 'hasMultipleFounders', label: 'Has Multiple Founders (주주 2명 이상)', type: 'boolean' },
  { id: 'hasSingleFounders', label: 'Has Single Founder (주주 1명)', type: 'boolean' },
  { id: 'hasIndividualFounder', label: 'Has Individual Founder (개인 주주 1명 이상)', type: 'boolean' },
  { id: 'hasCorporationFounder', label: 'Has Corporation Founder (법인 주주 1명 이상)', type: 'boolean' },
  { id: 'individualFoundersCount', label: 'Individual Founders Count (개인 주주 수)', type: 'number' },
  { id: 'corporationFoundersCount', label: 'Corporation Founders Count (법인 주주 수)', type: 'number' },
];

const DATA_TYPES = [
  { value: 'text', label: '텍스트' },
  { value: 'date', label: '날짜' },
  { value: 'number', label: '숫자' },
  { value: 'currency', label: '금액' },
  { value: 'email', label: '이메일' },
  { value: 'phone', label: '전화번호' },
];

const TRANSFORM_RULES: Record<string, { value: string; label: string }[]> = {
  text: [
    { value: 'none', label: 'None' },
    { value: 'uppercase', label: 'UPPERCASE' },
    { value: 'lowercase', label: 'lowercase' },
    { value: 'capitalize', label: 'Capitalize (회사명)' },
    { value: 'title', label: 'Title Case (사람 이름)' },
  ],
  date: [
    { value: 'MMMM D, YYYY', label: 'January 1, 2026 (Recommended)' },
    { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
    { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (ISO)' },
    { value: 'MMM D, YYYY', label: 'Jan 1, 2026' },
    { value: 'none', label: 'None' },
  ],
  number: [
    { value: 'comma', label: 'Comma (1,000,000)' },
    { value: 'number_english', label: 'English (Two, Three)' },
    { value: 'ordinal_english', label: 'Ordinal (First, Second, Third)' },
    { value: 'none', label: 'None' },
  ],
  currency: [
    { value: 'comma_dollar', label: '$1,000,000 (Recommended)' },
    { value: 'comma_dollar_cents', label: '$1,000,000.00' },
    { value: 'number_english', label: 'One Million Dollars' },
    { value: 'number_korean', label: '일천만원 (Korean)' },
    { value: 'none', label: 'None' },
  ],
  email: [
    { value: 'none', label: 'None (lowercase)' },
  ],
  phone: [
    { value: 'dashed', label: 'Dashed (010-1234-5678)' },
    { value: 'dotted', label: 'Dotted (010.1234.5678)' },
    { value: 'none', label: 'None' },
  ],
};

export default function TemplateEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 기본 정보
  const [formData, setFormData] = useState({
    name: '',
    displayName: '',
    category: '법인설립',
    repeatForPersons: false,  // 인원별 반복 생성 여부
    personTypeFilter: 'all' as 'all' | 'individual' | 'corporation' | 'individual_founder' | 'corporation_founder',
  });

  // 변수 매핑
  const [variables, setVariables] = useState<VariableMapping[]>([]);
  const [scanning, setScanning] = useState(false);

  // 선택 규칙
  const [rules, setRules] = useState<SelectionRule[]>([]);

  // 새 변수 추가 모달
  const [showAddModal, setShowAddModal] = useState(false);
  const [newVariable, setNewVariable] = useState({
    variableName: '',
    questionId: '__manual__',
    dataType: 'text',
    transformRule: 'none',
    required: true,
    formula: '',
  });

  useEffect(() => {
    loadTemplate();
  }, [id]);

  const loadTemplate = async () => {
    if (!id) return;

    try {
      setLoading(true);

      // 템플릿 기본 정보 조회
      const templateRes = await fetch(`/api/templates/${id}`);
      if (!templateRes.ok) throw new Error('템플릿을 찾을 수 없습니다.');
      const templateData = await templateRes.json();
      setTemplate(templateData);
      setFormData({
        name: templateData.name,
        displayName: templateData.displayName,
        category: templateData.category,
        repeatForPersons: templateData.repeatForPersons || false,
        personTypeFilter: templateData.personTypeFilter || 'all',
      });

      // 변수 매핑 조회 (대소문자 중복 제거)
      const varsRes = await fetch(`/api/templates/variables?templateId=${id}`);
      if (varsRes.ok) {
        const varsData = await varsRes.json();
        // 대소문자 무시하여 중복 제거 (첫 번째 발견 유지)
        const seen = new Set<string>();
        const deduplicatedVars = varsData.filter((v: VariableMapping) => {
          const lowerName = v.variableName.toLowerCase();
          if (seen.has(lowerName)) return false;
          seen.add(lowerName);
          return true;
        });
        setVariables(deduplicatedVars);
      }

      // 선택 규칙 조회
      const rulesRes = await fetch(`/api/templates/rules?templateId=${id}`);
      if (rulesRes.ok) {
        const rulesData = await rulesRes.json();
        setRules(rulesData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleScanVariables = async () => {
    if (!id) return;

    setScanning(true);
    try {
      const response = await fetch('/api/templates/variables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: id, action: 'scan' }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || '변수 스캔에 실패했습니다.');
      }

      const data = await response.json();

      // 기존 변수 목록과 병합 (대소문자 무시하여 중복 제거)
      const existingNamesLower = new Set(variables.map(v => v.variableName.toLowerCase()));

      // 새 변수 생성 (자동 생성 변수와 일반 변수 모두 포함)
      const newVariables = data.variables
        .filter((v: { variableName: string }) => !existingNamesLower.has(v.variableName.toLowerCase()))
        .map((v: { variableName: string; isAutoGenerated: boolean }) => {
          const isAuto = v.isAutoGenerated;
          const name = v.variableName;

          // 자동 생성 변수: questionId를 __auto__로, 기본 타입/규칙 추론
          if (isAuto) {
            let dataType = 'text';
            let transformRule = 'none';
            const nameLower = name.toLowerCase();

            // 사람 이름 필드 → Title Case
            const personNamePatterns = ['ceoname', 'cfoname', 'csname', 'agentname', 'registeredagentname', 'incorporatorname', 'chairmanname'];
            const isFounderName = nameLower.includes('founder') && nameLower.includes('name');
            const isDirectorName = nameLower.includes('director') && nameLower.includes('name');

            if (personNamePatterns.some(p => nameLower.includes(p)) || isFounderName || isDirectorName) {
              dataType = 'text';
              transformRule = 'title';
            }
            // 회사/법인 이름 필드 → Capitalize
            else if (nameLower.includes('companyname') || nameLower.includes('corporationname') ||
                     nameLower.includes('businessname') || nameLower.includes('entityname')) {
              dataType = 'text';
              transformRule = 'capitalize';
            }
            // Designator → Capitalize
            else if (nameLower.includes('designator')) {
              dataType = 'text';
              transformRule = 'capitalize';
            }
            // Cash/FMV/금액 필드 → Currency $1,000
            else if (nameLower.includes('cash') || nameLower.includes('fmv') ||
                     nameLower.includes('fairmarketvalue') || nameLower.includes('price') ||
                     nameLower.includes('amount') || nameLower.includes('parvalue')) {
              dataType = 'currency';
              transformRule = 'comma_dollar';
            }
            // Share 필드 → Number 1,000
            else if (nameLower.includes('share') || nameLower.includes('authorized') ||
                     nameLower.includes('issued')) {
              dataType = 'number';
              transformRule = 'comma';
            }
            // 날짜 필드 → Date
            else if (nameLower.includes('date') || nameLower.includes('signdate')) {
              dataType = 'date';
              transformRule = 'MMMM D, YYYY';
            }

            return {
              variableName: name,
              questionId: '__auto__',
              dataType,
              transformRule,
              required: false,
            };
          }

          // 일반 변수
          return {
            variableName: name,
            questionId: '__manual__',
            dataType: 'text',
            transformRule: 'none',
            required: true,
          };
        });

      if (newVariables.length > 0) {
        setVariables([...variables, ...newVariables]);
        const autoCount = newVariables.filter((v: VariableMapping) => v.questionId === '__auto__').length;
        const manualCount = newVariables.length - autoCount;

        const messages: string[] = [];
        if (manualCount > 0) messages.push(`일반 변수 ${manualCount}개`);
        if (autoCount > 0) messages.push(`자동 생성 변수 ${autoCount}개`);

        alert(`${messages.join(', ')}가 추가되었습니다.`);
      } else {
        alert('추가할 새 변수가 없습니다.');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : '변수 스캔에 실패했습니다.');
    } finally {
      setScanning(false);
    }
  };

  const handleAddVariable = () => {
    if (!newVariable.variableName.trim()) {
      alert('변수명을 입력해주세요.');
      return;
    }

    // 중복 체크
    if (variables.some(v => v.variableName === newVariable.variableName)) {
      alert('이미 존재하는 변수입니다.');
      return;
    }

    // 계산된 값인 경우 수식 필수
    if (newVariable.questionId === '__calculated__' && !newVariable.formula?.trim()) {
      alert('계산된 값을 선택한 경우 수식을 입력해주세요.');
      return;
    }

    const variableToAdd = {
      ...newVariable,
      formula: newVariable.questionId === '__calculated__' ? newVariable.formula : undefined,
    };

    setVariables([...variables, variableToAdd]);
    setNewVariable({
      variableName: '',
      questionId: '__manual__',
      dataType: 'text',
      transformRule: 'none',
      required: true,
      formula: '',
    });
    setShowAddModal(false);
  };

  const handleDeleteVariable = (index: number) => {
    if (!confirm('이 변수를 삭제하시겠습니까?')) return;
    setVariables(variables.filter((_, i) => i !== index));
  };

  const updateVariable = (index: number, field: keyof VariableMapping, value: string | boolean) => {
    const updated = [...variables];
    updated[index] = { ...updated[index], [field]: value };

    // dataType 변경 시 transformRule 초기화
    if (field === 'dataType') {
      updated[index].transformRule = 'none';
    }

    // questionId가 __calculated__가 아닌 것으로 변경되면 formula 초기화
    if (field === 'questionId' && value !== '__calculated__') {
      updated[index].formula = undefined;
    }

    setVariables(updated);
  };

  // 규칙 관리 함수들
  const addRule = () => {
    const newRule: SelectionRule = {
      conditions: [{ questionId: '', operator: '==', value: '', valueType: 'literal', sourceType: 'question' }],
      logicalOperator: 'AND',
      priority: rules.length + 1,
      isAlwaysInclude: false,
      isManualOnly: false,
    };
    setRules([...rules, newRule]);
  };

  const deleteRule = (ruleIndex: number) => {
    if (!confirm('이 규칙을 삭제하시겠습니까?')) return;
    const updated = rules.filter((_, i) => i !== ruleIndex);
    // 우선순위 재정렬
    updated.forEach((rule, i) => {
      rule.priority = i + 1;
    });
    setRules(updated);
  };

  const updateRule = (ruleIndex: number, field: keyof SelectionRule, value: unknown) => {
    const updated = [...rules];
    updated[ruleIndex] = { ...updated[ruleIndex], [field]: value };
    setRules(updated);
  };

  const addCondition = (ruleIndex: number) => {
    const updated = [...rules];
    updated[ruleIndex].conditions.push({ questionId: '', operator: '==', value: '', valueType: 'literal', sourceType: 'question' });
    setRules(updated);
  };

  const deleteCondition = (ruleIndex: number, condIndex: number) => {
    const updated = [...rules];
    if (updated[ruleIndex].conditions.length > 1) {
      updated[ruleIndex].conditions = updated[ruleIndex].conditions.filter((_, i) => i !== condIndex);
      setRules(updated);
    }
  };

  const updateCondition = (ruleIndex: number, condIndex: number, field: keyof RuleCondition, value: string) => {
    const updated = [...rules];
    updated[ruleIndex].conditions[condIndex] = {
      ...updated[ruleIndex].conditions[condIndex],
      [field]: value,
    };
    setRules(updated);
  };

  const getQuestionText = (questionId: string) => {
    for (const section of questionSections) {
      const question = section.questions.find(q => q.id === questionId);
      if (question) {
        return question.text.length > 30 ? question.text.substring(0, 30) + '...' : question.text;
      }
    }
    return questionId;
  };

  const handleApplyToAllTemplates = async (variable: VariableMapping) => {
    if (!confirm(`"${variable.variableName}" 변수 설정을 모든 템플릿에 적용하시겠습니까?\n\n적용될 설정:\n- 설문 질문/수식: ${variable.questionId}\n- 데이터 타입: ${variable.dataType}\n- 변환 규칙: ${variable.transformRule}\n- 필수: ${variable.required ? '예' : '아니오'}`)) {
      return;
    }

    try {
      const res = await fetch('/api/templates/variables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'applyToAll',
          variableName: variable.variableName,
          settings: {
            questionId: variable.questionId,
            dataType: variable.dataType,
            transformRule: variable.transformRule,
            required: variable.required,
            formula: variable.formula,
          },
        }),
      });

      if (!res.ok) throw new Error('전체 적용에 실패했습니다.');

      const result = await res.json();
      let message = `${result.totalCount || result.updatedCount}개의 템플릿에 적용되었습니다.`;
      if (result.createdCount > 0) {
        message += `\n(업데이트: ${result.updatedCount}, 새로 생성: ${result.createdCount})`;
      }
      if (result.createdTemplates?.length > 0) {
        message += `\n\n새로 생성된 템플릿:\n${result.createdTemplates.join('\n')}`;
      }
      alert(message);
    } catch (err) {
      alert(err instanceof Error ? err.message : '전체 적용에 실패했습니다.');
    }
  };

  const handleSave = async () => {
    if (!id) return;

    setSaving(true);
    try {
      // 기본 정보 저장
      const templateRes = await fetch(`/api/templates/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!templateRes.ok) throw new Error('기본 정보 저장에 실패했습니다.');

      // 변수 매핑 저장
      const varsRes = await fetch('/api/templates/variables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: id,
          variables: variables,
        }),
      });

      if (!varsRes.ok) throw new Error('변수 매핑 저장에 실패했습니다.');

      // 선택 규칙 저장
      const rulesRes = await fetch('/api/templates/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: id,
          rules: rules,
        }),
      });

      if (!rulesRes.ok) throw new Error('선택 규칙 저장에 실패했습니다.');

      alert('저장되었습니다.');
      navigate('/admin/templates');
    } catch (err) {
      alert(err instanceof Error ? err.message : '저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="loading">로딩 중...</div>;
  }

  if (error) {
    return <div className="message message-error">{error}</div>;
  }

  if (!template) {
    return <div className="message message-error">템플릿을 찾을 수 없습니다.</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
        <h2 style={{ color: 'var(--color-primary)', fontWeight: 700 }}>
          템플릿 편집
        </h2>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn btn-secondary" onClick={() => navigate('/admin/templates')}>
            취소
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>

      {/* 섹션 1: 기본 정보 */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <h3 style={{ marginBottom: '20px', color: 'var(--color-gray-700)' }}>기본 정보</h3>

        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label>템플릿 이름</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label>화면 표시명</label>
            <input
              type="text"
              value={formData.displayName}
              onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
            />
          </div>
          <div className="form-group" style={{ flex: 0.5 }}>
            <label>카테고리</label>
            <select
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
            >
              {CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ flex: 0.7, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input
              type="checkbox"
              id="repeatForPersons"
              checked={formData.repeatForPersons}
              onChange={(e) => setFormData({ ...formData, repeatForPersons: e.target.checked })}
              style={{ width: '18px', height: '18px' }}
            />
            <label htmlFor="repeatForPersons" style={{ marginBottom: 0, cursor: 'pointer' }}>
              인원별 반복 생성
            </label>
          </div>
        </div>

        {formData.repeatForPersons && (
          <div style={{
            marginTop: '12px',
            padding: '12px',
            background: 'var(--color-info-light, #e7f3ff)',
            border: '1px solid var(--color-info, #0066cc)',
            borderRadius: '8px',
            fontSize: '0.85rem',
            color: 'var(--color-info-dark, #004499)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <strong>인원별 반복 생성 활성화됨</strong>
              <select
                value={formData.personTypeFilter}
                onChange={(e) => setFormData({ ...formData, personTypeFilter: e.target.value as 'all' | 'individual' | 'corporation' | 'individual_founder' | 'corporation_founder' })}
                style={{ padding: '4px 8px', fontSize: '0.85rem' }}
              >
                <option value="all">모든 인원</option>
                <option value="individual">개인 주주 + 이사 + 임원 (IA, IPAA용)</option>
                <option value="individual_founder">개인 주주만 (CSPA, RSPA용)</option>
                <option value="corporation_founder">법인 주주만 (CSPA Entity용)</option>
              </select>
            </div>
            {formData.personTypeFilter === 'all' && '모든 인원(주주, 이사, 임원) 중 선택한 인원에 대해 문서가 생성됩니다.'}
            {formData.personTypeFilter === 'individual' && '개인 주주 + 이사 + 임원 중 선택한 인원에 대해 문서가 생성됩니다. (법인 주주 제외)'}
            {formData.personTypeFilter === 'individual_founder' && '개인 주주만 선택 가능합니다. (이사, 임원, 법인 주주 제외)'}
            {formData.personTypeFilter === 'corporation_founder' && '법인 주주만 선택 가능합니다.'}
            <br />
            <span style={{ fontSize: '0.8rem', marginTop: '4px', display: 'block' }}>
              템플릿에서 사용할 변수: {'{PersonName}'}, {'{PersonAddress}'}, {'{PersonEmail}'}, {'{PersonRoles}'}
              {(formData.personTypeFilter === 'corporation' || formData.personTypeFilter === 'corporation_founder') && ', {PersonCeoName}'}
            </span>
          </div>
        )}

        <div style={{ marginTop: '12px', fontSize: '0.9rem', color: 'var(--color-gray-500)' }}>
          파일: {template.filename} | 업로드일: {new Date(template.uploadedAt).toLocaleDateString('ko-KR')}
        </div>
      </div>

      {/* 섹션 2: 변수 매핑 */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ color: 'var(--color-gray-700)' }}>변수 매핑</h3>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              className="btn btn-outline"
              onClick={handleScanVariables}
              disabled={scanning}
            >
              {scanning ? '스캔 중...' : '변수 자동 스캔'}
            </button>
            <button className="btn btn-secondary" onClick={() => setShowAddModal(true)}>
              + 변수 추가
            </button>
          </div>
        </div>

        {/* 자동 생성 변수 안내 */}
        <div style={{
          background: 'var(--color-primary-light)',
          border: '1px solid var(--color-primary)',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '20px',
          fontSize: '0.9rem',
        }}>
          <strong style={{ color: 'var(--color-primary-dark)' }}>반복 그룹 자동 생성 변수</strong>
          <p style={{ margin: '8px 0 0', color: 'var(--color-gray-700)' }}>
            <code>directors</code>, <code>founders</code> 등의 반복 그룹은 다음 변수가 자동 생성됩니다:
          </p>
          <ul style={{ margin: '8px 0 0', paddingLeft: '20px', color: 'var(--color-gray-600)' }}>
            <li><code>{'{#directors}...{/directors}'}</code> - 반복문 (Loop)</li>
            <li><code>{'{directorsCount}'}</code> - 개수</li>
            <li><code>{'{hasMultipleDirectors}'}</code> - 2명 이상 조건</li>
            <li><code>{'{hasSingleDirectors}'}</code> - 1명 조건</li>
            <li><code>{'{director1Name}'}</code>, <code>{'{director2Name}'}</code> ... - 개별 접근</li>
            <li><code>{'{directorsNameFormatted}'}</code> - "A, B, and C" 형식</li>
          </ul>
          <p style={{ margin: '8px 0 0', color: 'var(--color-gray-500)', fontSize: '0.85rem' }}>
            * 반복문 내부에서는 <code>{'{name}'}</code>, <code>{'{email}'}</code> 등 필드명으로 직접 접근
          </p>
        </div>

        {variables.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📝</div>
            <h3 style={{ marginBottom: '8px', color: 'var(--color-gray-700)' }}>변수가 없습니다</h3>
            <p>"변수 자동 스캔" 버튼을 클릭하여 템플릿에서 변수를 추출하거나,<br />"변수 추가" 버튼으로 수동 추가할 수 있습니다.</p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>변수명</th>
                  <th>설문 질문 / 수식</th>
                  <th>데이터 타입</th>
                  <th>변환 규칙</th>
                  <th style={{ width: '60px', textAlign: 'center' }}>필수</th>
                  <th style={{ width: '100px', textAlign: 'center' }}>전체 적용</th>
                  <th style={{ width: '80px' }}>액션</th>
                </tr>
              </thead>
              <tbody>
                {variables.map((variable, index) => (
                  <tr key={index}>
                    <td>
                      <code style={{
                        background: 'var(--color-gray-100)',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '0.85rem',
                      }}>
                        {`{${variable.variableName}}`}
                      </code>
                    </td>
                    <td>
                      {variable.questionId === '__auto__' ? (
                        <div style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '8px 12px',
                          background: 'var(--color-success-light, #d4edda)',
                          border: '1px solid var(--color-success, #28a745)',
                          borderRadius: '4px',
                          fontSize: '0.85rem',
                          color: 'var(--color-success-dark, #155724)',
                        }}>
                          <span style={{ fontSize: '1rem' }}>⚡</span>
                          <span>자동 생성</span>
                        </div>
                      ) : (
                      <select
                        value={variable.questionId}
                        onChange={(e) => updateVariable(index, 'questionId', e.target.value)}
                        style={{ width: '100%', minWidth: '200px' }}
                      >
                        <optgroup label="특수 옵션">
                          <option value="__manual__">직접 입력</option>
                          <option value="__calculated__">계산된 값</option>
                        </optgroup>
                        <optgroup label="관리자 설정 날짜">
                          <option value="__COIDate">COIDate (법인설립일)</option>
                          <option value="__SIGNDate">SIGNDate (서명일)</option>
                        </optgroup>
                        <optgroup label="관리자 설정 값">
                          <option value="__authorizedShares">Authorized Shares (수권주식수)</option>
                          <option value="__parValue">Par Value (액면가)</option>
                          <option value="__fairMarketValue">Fair Market Value (공정시장가치)</option>
                        </optgroup>
                        <optgroup label="Founders 목록 변수">
                          <option value="__founders.cash">Founders Cash (투자금 목록)</option>
                          <option value="__founders.name">Founders Name (이름 목록)</option>
                          <option value="__founders.email">Founders Email (이메일 목록)</option>
                          <option value="__founders.address">Founders Address (주소 목록)</option>
                          <option value="__founders.type">Founders Type (유형 목록)</option>
                          <option value="__foundersCount">Founders Count (주주 수)</option>
                        </optgroup>
                        <optgroup label="Founders 개별 항목 (1번째)">
                          <option value="__founder.1.cash">Founder1 Cash (1번째 투자금)</option>
                          <option value="__founder.1.name">Founder1 Name (1번째 이름)</option>
                          <option value="__founder.1.email">Founder1 Email (1번째 이메일)</option>
                          <option value="__founder.1.address">Founder1 Address (1번째 주소)</option>
                          <option value="__founder.1.type">Founder1 Type (1번째 유형)</option>
                        </optgroup>
                        <optgroup label="Founders 개별 항목 (2번째)">
                          <option value="__founder.2.cash">Founder2 Cash (2번째 투자금)</option>
                          <option value="__founder.2.name">Founder2 Name (2번째 이름)</option>
                          <option value="__founder.2.email">Founder2 Email (2번째 이메일)</option>
                          <option value="__founder.2.address">Founder2 Address (2번째 주소)</option>
                          <option value="__founder.2.type">Founder2 Type (2번째 유형)</option>
                        </optgroup>
                        <optgroup label="Founders 개별 항목 (3-4번째)">
                          <option value="__founder.3.cash">Founder3 Cash (3번째 투자금)</option>
                          <option value="__founder.3.name">Founder3 Name (3번째 이름)</option>
                          <option value="__founder.4.cash">Founder4 Cash (4번째 투자금)</option>
                          <option value="__founder.4.name">Founder4 Name (4번째 이름)</option>
                        </optgroup>
                        <optgroup label="Directors 목록 변수">
                          <option value="__directors.name">Directors Name (이름 목록)</option>
                          <option value="__directors.email">Directors Email (이메일 목록)</option>
                          <option value="__directors.address">Directors Address (주소 목록)</option>
                          <option value="__directorsCount">Directors Count (이사 수)</option>
                        </optgroup>
                        <optgroup label="Directors 개별 항목">
                          <option value="__director.1.name">Director1 Name (1번째 이름)</option>
                          <option value="__director.1.email">Director1 Email (1번째 이메일)</option>
                          <option value="__director.1.address">Director1 Address (1번째 주소)</option>
                          <option value="__director.2.name">Director2 Name (2번째 이름)</option>
                          <option value="__director.2.email">Director2 Email (2번째 이메일)</option>
                          <option value="__director.2.address">Director2 Address (2번째 주소)</option>
                        </optgroup>
                        {questionSections.map(section => {
                          // repeatable_group 제외
                          const filteredQuestions = section.questions.filter(q => q.type !== 'repeatable_group');
                          if (filteredQuestions.length === 0) return null;
                          return (
                            <optgroup key={section.id} label={section.title}>
                              {filteredQuestions.map(q => (
                                <option key={q.id} value={q.id}>
                                  {q.text.length > 40 ? q.text.substring(0, 40) + '...' : q.text}
                                </option>
                              ))}
                            </optgroup>
                          );
                        })}
                      </select>
                      )}
                      {variable.questionId === '__calculated__' && (
                        <input
                          type="text"
                          value={variable.formula || ''}
                          onChange={(e) => updateVariable(index, 'formula', e.target.value)}
                          placeholder="예: {authorizedShares} * {parValue}"
                          style={{
                            width: '100%',
                            marginTop: '8px',
                            padding: '8px',
                            fontSize: '0.85rem',
                            fontFamily: 'monospace',
                            border: '1px solid var(--color-gray-300)',
                            borderRadius: '4px',
                          }}
                        />
                      )}
                    </td>
                    <td>
                      <select
                        value={variable.dataType}
                        onChange={(e) => updateVariable(index, 'dataType', e.target.value)}
                        style={{ width: '100%' }}
                      >
                        {DATA_TYPES.map(type => (
                          <option key={type.value} value={type.value}>{type.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={variable.transformRule}
                        onChange={(e) => updateVariable(index, 'transformRule', e.target.value)}
                        style={{ width: '100%' }}
                      >
                        {(TRANSFORM_RULES[variable.dataType] || TRANSFORM_RULES.text).map(rule => (
                          <option key={rule.value} value={rule.value}>{rule.label}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={variable.required}
                        onChange={(e) => updateVariable(index, 'required', e.target.checked)}
                        style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                      />
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        className="btn btn-outline"
                        style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                        onClick={() => handleApplyToAllTemplates(variable)}
                        title="이 변수 설정을 모든 템플릿에 적용"
                      >
                        전체 적용
                      </button>
                    </td>
                    <td>
                      <button
                        className="btn btn-danger"
                        style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                        onClick={() => handleDeleteVariable(index)}
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: '16px', fontSize: '0.85rem', color: 'var(--color-gray-500)' }}>
          총 {variables.length}개의 변수
        </div>
      </div>

      {/* 섹션 3: 선택 규칙 */}
      <div className="card" style={{ marginTop: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <h3 style={{ color: 'var(--color-gray-700)', marginBottom: '4px' }}>선택 규칙</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--color-gray-500)', margin: 0 }}>
              이 템플릿이 언제 사용되어야 하나요?
            </p>
          </div>
          <button className="btn btn-secondary" onClick={addRule}>
            + 규칙 추가
          </button>
        </div>

        {rules.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📋</div>
            <h3 style={{ marginBottom: '8px', color: 'var(--color-gray-700)' }}>규칙이 없습니다</h3>
            <p>"규칙 추가" 버튼을 클릭하여 템플릿 선택 조건을 설정하세요.</p>
          </div>
        ) : (
          <div className="rules-container">
            {rules.map((rule, ruleIndex) => (
              <div key={ruleIndex} className="rule-card">
                <div className="rule-header">
                  <span className="rule-title">규칙 {ruleIndex + 1}</span>
                  <button
                    className="btn btn-danger"
                    style={{ padding: '4px 12px', fontSize: '0.8rem' }}
                    onClick={() => deleteRule(ruleIndex)}
                  >
                    삭제
                  </button>
                </div>

                <div className="rule-body">
                  {/* 특수 옵션 */}
                  <div className="rule-special-options">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={rule.isAlwaysInclude}
                        onChange={(e) => updateRule(ruleIndex, 'isAlwaysInclude', e.target.checked)}
                      />
                      <span>항상 사용</span>
                      <small>(모든 경우에 이 템플릿 포함)</small>
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={rule.isManualOnly}
                        onChange={(e) => updateRule(ruleIndex, 'isManualOnly', e.target.checked)}
                      />
                      <span>수동 선택만</span>
                      <small>(자동 추천 안 함)</small>
                    </label>
                  </div>

                  {/* 조건들 - 항상 사용이 아닐 때만 표시 */}
                  {!rule.isAlwaysInclude && (
                    <div className="rule-conditions">
                      <div className="conditions-header">
                        <span className="conditions-label">조건:</span>
                        {rule.conditions.length > 1 && (
                          <div className="logical-operator-selector">
                            <label>
                              <input
                                type="radio"
                                name={`logical-op-${ruleIndex}`}
                                value="AND"
                                checked={rule.logicalOperator !== 'OR'}
                                onChange={() => updateRule(ruleIndex, 'logicalOperator', 'AND')}
                              />
                              <span>AND (모두 충족)</span>
                            </label>
                            <label>
                              <input
                                type="radio"
                                name={`logical-op-${ruleIndex}`}
                                value="OR"
                                checked={rule.logicalOperator === 'OR'}
                                onChange={() => updateRule(ruleIndex, 'logicalOperator', 'OR')}
                              />
                              <span>OR (하나라도 충족)</span>
                            </label>
                          </div>
                        )}
                      </div>
                      {rule.conditions.map((condition, condIndex) => (
                        <div key={condIndex} className="condition-row">
                          {condIndex > 0 && (
                            <span className="condition-connector">{rule.logicalOperator || 'AND'}</span>
                          )}
                          <div className="condition-fields">
                            {/* 소스 타입 선택: 설문 질문 vs 계산된 변수 */}
                            <select
                              value={condition.sourceType || 'question'}
                              onChange={(e) => {
                                const updated = [...rules];
                                updated[ruleIndex].conditions[condIndex] = {
                                  ...condition,
                                  sourceType: e.target.value as 'question' | 'computed',
                                  questionId: '',  // 소스 변경 시 선택 초기화
                                };
                                setRules(updated);
                              }}
                              className="condition-source-type"
                              style={{ minWidth: '110px' }}
                            >
                              <option value="question">설문 질문</option>
                              <option value="computed">계산된 변수</option>
                            </select>
                            {/* 질문 또는 계산된 변수 선택 */}
                            {(condition.sourceType || 'question') === 'question' ? (
                              <select
                                value={condition.questionId}
                                onChange={(e) => updateCondition(ruleIndex, condIndex, 'questionId', e.target.value)}
                                className="condition-select"
                              >
                                <option value="">질문 선택...</option>
                                {questionSections.map(section => (
                                  <optgroup key={section.id} label={section.title}>
                                    {section.questions.map(q => (
                                      <option key={q.id} value={q.id}>
                                        {q.text.length > 35 ? q.text.substring(0, 35) + '...' : q.text}
                                      </option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                            ) : (
                              <select
                                value={condition.questionId}
                                onChange={(e) => updateCondition(ruleIndex, condIndex, 'questionId', e.target.value)}
                                className="condition-select"
                              >
                                <option value="">계산된 변수 선택...</option>
                                <optgroup label="Directors (이사)">
                                  {COMPUTED_VARIABLES.filter(v => v.id.toLowerCase().includes('director')).map(v => (
                                    <option key={v.id} value={v.id}>{v.label}</option>
                                  ))}
                                </optgroup>
                                <optgroup label="Founders (주주)">
                                  {COMPUTED_VARIABLES.filter(v => v.id.toLowerCase().includes('founder')).map(v => (
                                    <option key={v.id} value={v.id}>{v.label}</option>
                                  ))}
                                </optgroup>
                              </select>
                            )}
                            <select
                              value={condition.operator}
                              onChange={(e) => updateCondition(ruleIndex, condIndex, 'operator', e.target.value)}
                              className="condition-operator"
                            >
                              {OPERATORS.map(op => (
                                <option key={op.value} value={op.value}>{op.label}</option>
                              ))}
                            </select>
                            {/* 값 타입 선택 */}
                            <select
                              value={condition.valueType || 'literal'}
                              onChange={(e) => {
                                const updated = [...rules];
                                updated[ruleIndex].conditions[condIndex] = {
                                  ...condition,
                                  valueType: e.target.value as 'literal' | 'question',
                                  value: e.target.value === 'question' ? '' : condition.value,
                                  valueQuestionId: e.target.value === 'question' ? condition.valueQuestionId : undefined,
                                };
                                setRules(updated);
                              }}
                              className="condition-value-type"
                              style={{ minWidth: '100px' }}
                            >
                              <option value="literal">직접 입력</option>
                              <option value="question">다른 질문</option>
                            </select>
                            {/* 직접 입력 또는 질문 선택 */}
                            {(condition.valueType || 'literal') === 'literal' ? (
                              <input
                                type="text"
                                value={condition.value}
                                onChange={(e) => updateCondition(ruleIndex, condIndex, 'value', e.target.value)}
                                placeholder={condition.operator === 'in' ? '값1,값2,값3' : '값 입력'}
                                className="condition-value"
                              />
                            ) : (
                              <select
                                value={condition.valueQuestionId || ''}
                                onChange={(e) => {
                                  const updated = [...rules];
                                  updated[ruleIndex].conditions[condIndex] = {
                                    ...condition,
                                    valueQuestionId: e.target.value,
                                  };
                                  setRules(updated);
                                }}
                                className="condition-value-question"
                                style={{ minWidth: '180px' }}
                              >
                                <option value="">비교할 질문 선택...</option>
                                {questionSections.map(section => (
                                  <optgroup key={section.id} label={section.title}>
                                    {section.questions
                                      .filter(q => q.id !== condition.questionId)
                                      .map(q => (
                                        <option key={q.id} value={q.id}>
                                          {q.text.length > 30 ? q.text.substring(0, 30) + '...' : q.text}
                                        </option>
                                      ))}
                                  </optgroup>
                                ))}
                              </select>
                            )}
                            {rule.conditions.length > 1 && (
                              <button
                                className="condition-delete"
                                onClick={() => deleteCondition(ruleIndex, condIndex)}
                                title="조건 삭제"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                      <button
                        className="btn btn-outline"
                        style={{ marginTop: '8px', padding: '6px 12px', fontSize: '0.85rem' }}
                        onClick={() => addCondition(ruleIndex)}
                      >
                        + 조건 추가
                      </button>
                    </div>
                  )}

                  {/* 우선순위 */}
                  <div className="rule-priority">
                    <label>우선순위:</label>
                    <select
                      value={rule.priority}
                      onChange={(e) => updateRule(ruleIndex, 'priority', parseInt(e.target.value))}
                    >
                      {Array.from({ length: 10 }, (_, i) => i + 1).map(num => (
                        <option key={num} value={num}>{num}</option>
                      ))}
                    </select>
                    <small>(낮을수록 먼저 평가)</small>
                  </div>

                  {/* 규칙 미리보기 */}
                  {!rule.isAlwaysInclude && rule.conditions.some(c => c.questionId && c.value) && (
                    <div className="rule-preview">
                      <strong>규칙 요약:</strong>
                      <code>
                        {rule.conditions
                          .filter(c => c.questionId && c.value)
                          .map((c, i) => {
                            const questionText = getQuestionText(c.questionId);
                            const opLabel = OPERATORS.find(o => o.value === c.operator)?.label || c.operator;
                            return `${i > 0 ? ' AND ' : ''}${questionText} ${opLabel} "${c.value}"`;
                          })
                          .join('')}
                      </code>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: '16px', fontSize: '0.85rem', color: 'var(--color-gray-500)' }}>
          총 {rules.length}개의 규칙
        </div>
      </div>

      {/* 변수 추가 모달 */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h3>변수 추가</h3>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>×</button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label>변수명 *</label>
                <input
                  type="text"
                  placeholder="예: companyName"
                  value={newVariable.variableName}
                  onChange={(e) => setNewVariable({ ...newVariable, variableName: e.target.value })}
                />
                <small style={{ color: 'var(--color-gray-500)' }}>
                  템플릿에서 {'{'}변수명{'}'} 형식으로 사용됩니다.
                </small>
              </div>

              <div className="form-group">
                <label>설문 질문</label>
                <select
                  value={newVariable.questionId}
                  onChange={(e) => setNewVariable({ ...newVariable, questionId: e.target.value, formula: '' })}
                >
                  <optgroup label="특수 옵션">
                    <option value="__manual__">직접 입력</option>
                    <option value="__calculated__">계산된 값</option>
                  </optgroup>
                  <optgroup label="관리자 설정 날짜">
                    <option value="__COIDate">COIDate (법인설립일)</option>
                    <option value="__SIGNDate">SIGNDate (서명일)</option>
                  </optgroup>
                  <optgroup label="관리자 설정 값">
                    <option value="__authorizedShares">Authorized Shares (수권주식수)</option>
                    <option value="__parValue">Par Value (액면가)</option>
                    <option value="__fairMarketValue">Fair Market Value (공정시장가치)</option>
                  </optgroup>
                  <optgroup label="Founders 목록 변수">
                    <option value="__founders.cash">Founders Cash (투자금 목록)</option>
                    <option value="__founders.name">Founders Name (이름 목록)</option>
                    <option value="__founders.email">Founders Email (이메일 목록)</option>
                    <option value="__founders.address">Founders Address (주소 목록)</option>
                    <option value="__founders.type">Founders Type (유형 목록)</option>
                    <option value="__foundersCount">Founders Count (주주 수)</option>
                  </optgroup>
                  <optgroup label="Founders 개별 항목 (1번째)">
                    <option value="__founder.1.cash">Founder1 Cash (1번째 투자금)</option>
                    <option value="__founder.1.name">Founder1 Name (1번째 이름)</option>
                    <option value="__founder.1.email">Founder1 Email (1번째 이메일)</option>
                    <option value="__founder.1.address">Founder1 Address (1번째 주소)</option>
                    <option value="__founder.1.type">Founder1 Type (1번째 유형)</option>
                  </optgroup>
                  <optgroup label="Founders 개별 항목 (2번째)">
                    <option value="__founder.2.cash">Founder2 Cash (2번째 투자금)</option>
                    <option value="__founder.2.name">Founder2 Name (2번째 이름)</option>
                    <option value="__founder.2.email">Founder2 Email (2번째 이메일)</option>
                    <option value="__founder.2.address">Founder2 Address (2번째 주소)</option>
                    <option value="__founder.2.type">Founder2 Type (2번째 유형)</option>
                  </optgroup>
                  <optgroup label="Founders 개별 항목 (3-4번째)">
                    <option value="__founder.3.cash">Founder3 Cash (3번째 투자금)</option>
                    <option value="__founder.3.name">Founder3 Name (3번째 이름)</option>
                    <option value="__founder.4.cash">Founder4 Cash (4번째 투자금)</option>
                    <option value="__founder.4.name">Founder4 Name (4번째 이름)</option>
                  </optgroup>
                  <optgroup label="Directors 목록 변수">
                    <option value="__directors.name">Directors Name (이름 목록)</option>
                    <option value="__directors.email">Directors Email (이메일 목록)</option>
                    <option value="__directors.address">Directors Address (주소 목록)</option>
                    <option value="__directorsCount">Directors Count (이사 수)</option>
                  </optgroup>
                  <optgroup label="Directors 개별 항목">
                    <option value="__director.1.name">Director1 Name (1번째 이름)</option>
                    <option value="__director.1.email">Director1 Email (1번째 이메일)</option>
                    <option value="__director.1.address">Director1 Address (1번째 주소)</option>
                    <option value="__director.2.name">Director2 Name (2번째 이름)</option>
                    <option value="__director.2.email">Director2 Email (2번째 이메일)</option>
                    <option value="__director.2.address">Director2 Address (2번째 주소)</option>
                  </optgroup>
                  {questionSections.map(section => {
                    // repeatable_group 제외
                    const filteredQuestions = section.questions.filter(q => q.type !== 'repeatable_group');
                    if (filteredQuestions.length === 0) return null;
                    return (
                      <optgroup key={section.id} label={section.title}>
                        {filteredQuestions.map(q => (
                          <option key={q.id} value={q.id}>
                            {q.text.length > 40 ? q.text.substring(0, 40) + '...' : q.text}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              </div>

              {newVariable.questionId === '__calculated__' && (
                <div className="form-group">
                  <label>수식 *</label>
                  <input
                    type="text"
                    placeholder="예: {authorizedShares} * {parValue}"
                    value={newVariable.formula}
                    onChange={(e) => setNewVariable({ ...newVariable, formula: e.target.value })}
                    style={{ fontFamily: 'monospace' }}
                  />
                  <small style={{ color: 'var(--color-gray-500)', display: 'block', marginTop: '4px' }}>
                    변수는 {'{'}변수명{'}'} 형식으로 입력합니다. 사용 가능한 연산자: +, -, *, /, (, )
                  </small>
                </div>
              )}

              <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                  <label>데이터 타입</label>
                  <select
                    value={newVariable.dataType}
                    onChange={(e) => setNewVariable({
                      ...newVariable,
                      dataType: e.target.value,
                      transformRule: 'none',
                    })}
                  >
                    {DATA_TYPES.map(type => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>변환 규칙</label>
                  <select
                    value={newVariable.transformRule}
                    onChange={(e) => setNewVariable({ ...newVariable, transformRule: e.target.value })}
                  >
                    {(TRANSFORM_RULES[newVariable.dataType] || TRANSFORM_RULES.text).map(rule => (
                      <option key={rule.value} value={rule.value}>{rule.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={newVariable.required}
                    onChange={(e) => setNewVariable({ ...newVariable, required: e.target.checked })}
                    style={{ width: '18px', height: '18px' }}
                  />
                  필수 변수
                </label>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowAddModal(false)}>
                취소
              </button>
              <button className="btn btn-primary" onClick={handleAddVariable}>
                추가
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
