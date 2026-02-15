import { useState, useEffect } from 'react';
import {
  TemplateSelection,
  Template,
  selectTemplates,
  generateDocuments,
  getDocumentDownloadURL,
  getManualVariables,
  fetchSurvey,
  DocumentResult,
  ManualVariable,
} from '../services/api';
import { Survey } from '../types/survey';
import TemplatePreviewModal from './TemplatePreviewModal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  surveyId: string;
  onComplete: () => void;
}

type ModalStep = 'selection' | 'manualInput' | 'generating' | 'complete' | 'error';

export default function DocumentGenerationModal({ isOpen, onClose, surveyId, onComplete }: Props) {
  const [step, setStep] = useState<ModalStep>('selection');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Template selection state
  const [templateSelection, setTemplateSelection] = useState<TemplateSelection | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Manual variables state
  const [manualVariables, setManualVariables] = useState<ManualVariable[]>([]);
  const [manualValues, setManualValues] = useState<Record<string, string>>({});
  const [loadingManualVars, setLoadingManualVars] = useState(false);

  // Survey data for admin values
  const [survey, setSurvey] = useState<Survey | null>(null);

  // Generation progress
  const [generatingTemplates, setGeneratingTemplates] = useState<string[]>([]);
  const [completedTemplates, setCompletedTemplates] = useState<string[]>([]);
  const [currentTemplate, setCurrentTemplate] = useState<string>('');

  // Results
  const [results, setResults] = useState<DocumentResult[]>([]);
  const [downloadUrl, setDownloadUrl] = useState('');
  const [zipFilename, setZipFilename] = useState('');

  // Preview state
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // 인원별 반복 생성 선택 상태: 템플릿ID → 선택된 인원 인덱스 배열 (0-based)
  const [repeatForSelections, setRepeatForSelections] = useState<Record<string, number[]>>({});

  // Load templates when modal opens
  useEffect(() => {
    if (isOpen && surveyId) {
      loadTemplates();
    }
  }, [isOpen, surveyId]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStep('selection');
      setError('');
      setTemplateSelection(null);
      setSelectedIds(new Set());
      setManualVariables([]);
      setManualValues({});
      setGeneratingTemplates([]);
      setCompletedTemplates([]);
      setCurrentTemplate('');
      setResults([]);
      setDownloadUrl('');
      setZipFilename('');
      setPreviewTemplate(null);
      setShowPreview(false);
      setRepeatForSelections({});
    }
  }, [isOpen]);

  const loadTemplates = async () => {
    setLoading(true);
    setError('');

    try {
      // Load survey data for admin values
      const surveyData = await fetchSurvey(surveyId);
      setSurvey(surveyData);

      const selection = await selectTemplates(surveyId);
      setTemplateSelection(selection);

      // Auto-select required templates
      const requiredIds = new Set(selection.required.map(t => t.id));
      // Also pre-select suggested templates
      selection.suggested.forEach(t => requiredIds.add(t.id));
      setSelectedIds(requiredIds);

      // repeatForPersons가 설정된 템플릿에 대해 기본 인원 선택 초기화
      const allTemplates = [...selection.required, ...selection.suggested, ...selection.optional];
      const initialRepeatSelections: Record<string, number[]> = {};
      const persons = extractAllPersonsFromSurvey(surveyData);

      allTemplates.forEach(template => {
        if (template.repeatForPersons) {
          // personTypeFilter에 따라 필터링된 인원만 기본 선택
          const personTypeFilter = template.personTypeFilter;
          const filteredIndices: number[] = [];

          persons.forEach((person, idx) => {
            const isFounder = person.roles.includes('Founder');
            const isCorporation = person.type === 'corporation';

            // 필터 조건에 맞는 인원만 선택
            if (personTypeFilter === 'individual' && isCorporation) return;
            if (personTypeFilter === 'individual_founder' && (!isFounder || isCorporation)) return;
            if ((personTypeFilter === 'corporation' || personTypeFilter === 'corporation_founder') && !isCorporation) return;

            filteredIndices.push(idx);
          });

          initialRepeatSelections[template.id] = filteredIndices;
        }
      });

      setRepeatForSelections(initialRepeatSelections);
    } catch (err) {
      setError(err instanceof Error ? err.message : '템플릿을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 설문에서 등장한 모든 인원과 직책 추출
  interface PersonWithRoles {
    name: string;
    roles: string[];
    address?: string;
    email?: string;
    cash?: string;  // 창업자인 경우 출자금
    type?: 'individual' | 'corporation';  // Founder의 경우 개인/법인 구분
  }

  const extractAllPersonsFromSurvey = (surveyData: Survey): PersonWithRoles[] => {
    const personMap = new Map<string, PersonWithRoles>();

    const getAnswer = (questionId: string): string | undefined => {
      const answer = surveyData.answers?.find(a => a.questionId === questionId);
      return answer?.value as string | undefined;
    };

    // 1. Directors (이사)
    const directorsAnswer = surveyData.answers?.find(a => a.questionId === 'directors');
    if (directorsAnswer && Array.isArray(directorsAnswer.value)) {
      for (const director of directorsAnswer.value as Array<{ name: string; address?: string; email?: string }>) {
        const name = director.name?.trim();
        if (!name) continue;

        if (personMap.has(name)) {
          personMap.get(name)!.roles.push('Director');
          if (!personMap.get(name)!.address && director.address) personMap.get(name)!.address = director.address;
          if (!personMap.get(name)!.email && director.email) personMap.get(name)!.email = director.email;
        } else {
          personMap.set(name, {
            name,
            roles: ['Director'],
            address: director.address,
            email: director.email,
          });
        }
      }
    }

    // 2. Founders (창업자/주주)
    const foundersAnswer = surveyData.answers?.find(a => a.questionId === 'founders');
    if (foundersAnswer && Array.isArray(foundersAnswer.value)) {
      for (const founder of foundersAnswer.value as Array<{ name: string; address?: string; email?: string; cash?: string; type?: string }>) {
        const name = founder.name?.trim();
        if (!name) continue;

        const founderType = (founder.type?.toLowerCase() === 'corporation' ? 'corporation' : 'individual') as 'individual' | 'corporation';

        if (personMap.has(name)) {
          personMap.get(name)!.roles.push('Founder');
          if (!personMap.get(name)!.address && founder.address) personMap.get(name)!.address = founder.address;
          if (!personMap.get(name)!.email && founder.email) personMap.get(name)!.email = founder.email;
          if (founder.cash) personMap.get(name)!.cash = founder.cash;
          // 법인 타입인 경우에만 type 설정 (개인은 기본값)
          if (founderType === 'corporation') {
            personMap.get(name)!.type = 'corporation';
          }
        } else {
          personMap.set(name, {
            name,
            roles: ['Founder'],
            address: founder.address,
            email: founder.email,
            cash: founder.cash,
            type: founderType,
          });
        }
      }
    }

    // 3. CEO
    const ceoName = getAnswer('ceoName')?.trim();
    if (ceoName) {
      if (personMap.has(ceoName)) {
        personMap.get(ceoName)!.roles.push('CEO');
        if (!personMap.get(ceoName)!.address) personMap.get(ceoName)!.address = getAnswer('ceoAddress');
        if (!personMap.get(ceoName)!.email) personMap.get(ceoName)!.email = getAnswer('ceoEmail');
      } else {
        personMap.set(ceoName, {
          name: ceoName,
          roles: ['CEO'],
          address: getAnswer('ceoAddress'),
          email: getAnswer('ceoEmail'),
        });
      }
    }

    // 4. CFO
    const cfoName = getAnswer('cfoName')?.trim();
    if (cfoName) {
      if (personMap.has(cfoName)) {
        personMap.get(cfoName)!.roles.push('CFO');
        if (!personMap.get(cfoName)!.address) personMap.get(cfoName)!.address = getAnswer('cfoAddress');
        if (!personMap.get(cfoName)!.email) personMap.get(cfoName)!.email = getAnswer('cfoEmail');
      } else {
        personMap.set(cfoName, {
          name: cfoName,
          roles: ['CFO'],
          address: getAnswer('cfoAddress'),
          email: getAnswer('cfoEmail'),
        });
      }
    }

    // 5. Corporate Secretary
    const csName = getAnswer('csName')?.trim();
    if (csName) {
      if (personMap.has(csName)) {
        personMap.get(csName)!.roles.push('Corporate Secretary');
        if (!personMap.get(csName)!.address) personMap.get(csName)!.address = getAnswer('csAddress');
        if (!personMap.get(csName)!.email) personMap.get(csName)!.email = getAnswer('csEmail');
      } else {
        personMap.set(csName, {
          name: csName,
          roles: ['Corporate Secretary'],
          address: getAnswer('csAddress'),
          email: getAnswer('csEmail'),
        });
      }
    }

    // 6. Chairman (의장)
    const chairmanName = getAnswer('chairmanName')?.trim();
    if (chairmanName) {
      if (personMap.has(chairmanName)) {
        personMap.get(chairmanName)!.roles.push('Chairman');
      } else {
        personMap.set(chairmanName, {
          name: chairmanName,
          roles: ['Chairman'],
        });
      }
    }

    return Array.from(personMap.values());
  };

  // 인원 목록 (survey가 로드되면 계산)
  const allPersons = survey ? extractAllPersonsFromSurvey(survey) : [];

  // 인원 선택 토글
  const handleTogglePersonSelection = (templateId: string, personIndex: number) => {
    setRepeatForSelections(prev => {
      const current = prev[templateId] || [];
      if (current.includes(personIndex)) {
        return { ...prev, [templateId]: current.filter(i => i !== personIndex) };
      } else {
        return { ...prev, [templateId]: [...current, personIndex].sort((a, b) => a - b) };
      }
    });
  };

  // 전체 인원 선택/해제
  const handleSelectAllPersons = (templateId: string, selectAll: boolean) => {
    if (!survey) return;
    if (selectAll) {
      setRepeatForSelections(prev => ({
        ...prev,
        [templateId]: allPersons.map((_, idx) => idx),
      }));
    } else {
      setRepeatForSelections(prev => ({
        ...prev,
        [templateId]: [],
      }));
    }
  };

  const handleToggleTemplate = (templateId: string, isRequired: boolean) => {
    if (isRequired) return; // Required templates cannot be deselected

    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(templateId)) {
        newSet.delete(templateId);
      } else {
        newSet.add(templateId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (!templateSelection) return;

    const allIds = new Set([
      ...templateSelection.required.map(t => t.id),
      ...templateSelection.suggested.map(t => t.id),
      ...templateSelection.optional.map(t => t.id),
    ]);
    setSelectedIds(allIds);
  };

  const handleDeselectAll = () => {
    if (!templateSelection) return;

    // Keep only required templates selected
    const requiredIds = new Set(templateSelection.required.map(t => t.id));
    setSelectedIds(requiredIds);
  };

  const handleManualValueChange = (variableName: string, value: string) => {
    setManualValues(prev => ({
      ...prev,
      [variableName]: value,
    }));
  };

  const handlePreview = (template: Template, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPreviewTemplate(template);
    setShowPreview(true);
  };

  // Proceed to check for manual variables
  const handleProceedToManualInput = async () => {
    if (selectedIds.size === 0) {
      setError('최소 하나의 템플릿을 선택해주세요.');
      return;
    }

    setLoadingManualVars(true);
    setError('');

    try {
      const templateIds = Array.from(selectedIds);
      const response = await getManualVariables(templateIds);

      // Admin value mapping - map questionId to actual survey values
      const adminValueMap: Record<string, string | undefined> = {
        '__authorizedShares': survey?.adminValues?.authorizedShares,
        '__parValue': survey?.adminValues?.parValue,
        '__fairMarketValue': survey?.adminValues?.fairMarketValue,
        '__COIDate': survey?.adminDates?.COIDate,
        '__SIGNDate': survey?.adminDates?.SIGNDate,
      };

      // Filter out admin variables that already have values set
      // These don't need manual input since they're already configured
      const filteredVariables = response.variables.filter(v => {
        // If it's an admin-type variable and already has a value, skip it
        if (v.sourceType === 'admin' && v.questionId && adminValueMap[v.questionId]) {
          return false;
        }
        return true;
      });

      if (filteredVariables.length > 0) {
        setManualVariables(filteredVariables);
        // Initialize values with defaults
        const initialValues: Record<string, string> = {};

        filteredVariables.forEach(v => {
          // Check if this variable is mapped to an admin value (shouldn't happen after filtering, but just in case)
          if (v.questionId && adminValueMap[v.questionId]) {
            initialValues[v.variableName] = adminValueMap[v.questionId]!;
          } else if (v.defaultValue) {
            initialValues[v.variableName] = v.defaultValue;
          }
        });
        setManualValues(initialValues);
        setStep('manualInput');
      } else {
        // No manual variables needed, proceed directly to generation
        performGeneration();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '변수 정보를 불러오는데 실패했습니다.');
    } finally {
      setLoadingManualVars(false);
    }
  };

  // Validate manual inputs
  const validateManualInputs = (): boolean => {
    const requiredVars = manualVariables.filter(v => v.required);
    for (const v of requiredVars) {
      if (!manualValues[v.variableName]?.trim()) {
        setError(`필수 항목을 입력해주세요: ${v.variableName}`);
        return false;
      }
    }
    return true;
  };

  // Perform actual document generation
  const performGeneration = async () => {
    setStep('generating');
    setError('');

    const templateIds = Array.from(selectedIds);
    setGeneratingTemplates(templateIds);
    setCompletedTemplates([]);

    // Filter out empty manual values
    const overrides: Record<string, string> = {};
    Object.entries(manualValues).forEach(([key, value]) => {
      if (value && value.trim()) {
        overrides[key] = value.trim();
      }
    });

    // Simulate progress updates (actual generation happens server-side)
    let currentIndex = 0;
    const progressInterval = setInterval(() => {
      if (currentIndex < templateIds.length) {
        setCurrentTemplate(templateIds[currentIndex]);
        if (currentIndex > 0) {
          setCompletedTemplates(prev => [...prev, templateIds[currentIndex - 1]]);
        }
        currentIndex++;
      }
    }, 500);

    try {
      // repeatFor 선택이 있는 템플릿만 필터링해서 전달
      const filteredRepeatSelections: Record<string, number[]> = {};
      Object.entries(repeatForSelections).forEach(([templateId, indices]) => {
        if (selectedIds.has(templateId) && indices.length > 0) {
          filteredRepeatSelections[templateId] = indices;
        }
      });

      const response = await generateDocuments(
        surveyId,
        templateIds,
        overrides,
        Object.keys(filteredRepeatSelections).length > 0 ? filteredRepeatSelections : undefined
      );

      clearInterval(progressInterval);
      setCompletedTemplates(templateIds);
      setCurrentTemplate('');

      setResults(response.documents);
      setDownloadUrl(response.downloadUrl);
      setZipFilename(response.zipFile);
      setStep('complete');
      onComplete();
    } catch (err) {
      clearInterval(progressInterval);
      setError(err instanceof Error ? err.message : '문서 생성에 실패했습니다.');
      setStep('error');
    }
  };

  // Handle generation from manual input step
  const handleGenerateFromManualInput = () => {
    if (!validateManualInputs()) return;
    performGeneration();
  };

  const handleDownloadZip = () => {
    if (downloadUrl) {
      window.open(getDocumentDownloadURL(downloadUrl.split('/').pop() || ''), '_blank');
    }
  };

  const getTemplateName = (templateId: string): string => {
    if (!templateSelection) return templateId;

    const allTemplates = [
      ...templateSelection.required,
      ...templateSelection.suggested,
      ...templateSelection.optional,
    ];
    const template = allTemplates.find(t => t.id === templateId);
    return template?.displayName || template?.name || templateId;
  };

  const getProgressPercentage = (): number => {
    if (generatingTemplates.length === 0) return 0;
    return Math.round((completedTemplates.length / generatingTemplates.length) * 100);
  };

  const getInputType = (dataType: string): string => {
    switch (dataType) {
      case 'number':
      case 'currency':
        return 'number';
      case 'date':
        return 'date';
      case 'email':
        return 'email';
      default:
        return 'text';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-large" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <h2>
            {step === 'selection' && 'Generate Documents'}
            {step === 'manualInput' && 'Enter Required Information'}
            {step === 'generating' && 'Generating Documents...'}
            {step === 'complete' && 'Documents Generated!'}
            {step === 'error' && 'Generation Failed'}
          </h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        {/* Body */}
        <div className="modal-body">
          {(loading || loadingManualVars) && (
            <div className="loading-container">
              <div className="spinner"></div>
              <p>{loading ? 'Loading templates...' : 'Loading required fields...'}</p>
            </div>
          )}

          {error && step !== 'error' && (
            <div className="message message-error">{error}</div>
          )}

          {/* Selection Step */}
          {step === 'selection' && !loading && templateSelection && (
            <>
              {/* Required Templates */}
              {templateSelection.required.length > 0 && (
                <div className="template-section">
                  <h3 className="template-section-title">
                    <span className="badge badge-required">Required</span>
                    Required Templates (Auto-selected)
                  </h3>
                  <div className="template-list">
                    {templateSelection.required.map(template => (
                      <div key={template.id} className="template-item template-item-required">
                        <input
                          type="checkbox"
                          checked={true}
                          disabled
                        />
                        <span className="template-name">{template.displayName || template.name}</span>
                        <span className="template-category">{template.category}</span>
                        <button
                          className="btn-preview"
                          onClick={(e) => handlePreview(template, e)}
                          title="Preview with survey data"
                        >
                          👁
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggested Templates */}
              {templateSelection.suggested.length > 0 && (
                <div className="template-section">
                  <h3 className="template-section-title">
                    <span className="badge badge-suggested">Suggested</span>
                    Suggested Templates
                  </h3>
                  <div className="template-list">
                    {templateSelection.suggested.map(template => (
                      <div key={template.id} className="template-item">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(template.id)}
                          onChange={() => handleToggleTemplate(template.id, false)}
                        />
                        <span className="template-name">{template.displayName || template.name}</span>
                        <span className="template-category">{template.category}</span>
                        <button
                          className="btn-preview"
                          onClick={(e) => handlePreview(template, e)}
                          title="Preview with survey data"
                        >
                          👁
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Optional Templates */}
              {templateSelection.optional.length > 0 && (
                <div className="template-section">
                  <h3 className="template-section-title">
                    <span className="badge badge-optional">Optional</span>
                    Other Templates
                  </h3>
                  <div className="template-list">
                    {templateSelection.optional.map(template => (
                      <div key={template.id} className="template-item">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(template.id)}
                          onChange={() => handleToggleTemplate(template.id, false)}
                        />
                        <span className="template-name">{template.displayName || template.name}</span>
                        <span className="template-category">{template.category}</span>
                        <button
                          className="btn-preview"
                          onClick={(e) => handlePreview(template, e)}
                          title="Preview with survey data"
                        >
                          👁
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 인원별 반복 생성 선택 섹션 */}
              {(() => {
                const allTemplates = [
                  ...templateSelection.required,
                  ...templateSelection.suggested,
                  ...templateSelection.optional,
                ];
                const repeatTemplates = allTemplates.filter(
                  t => t.repeatForPersons && selectedIds.has(t.id)
                );

                if (repeatTemplates.length === 0 || !survey || allPersons.length === 0) return null;

                return (
                  <div className="template-section" style={{ marginTop: '20px' }}>
                    <h3 className="template-section-title">
                      <span className="badge" style={{ background: '#9333ea', color: 'white' }}>인원 선택</span>
                      인원별 문서 생성
                    </h3>
                    <p style={{ fontSize: '0.9rem', color: 'var(--color-gray-600)', marginBottom: '16px' }}>
                      아래 템플릿은 선택한 인원별로 개별 문서가 생성됩니다.
                    </p>

                    {repeatTemplates.map(template => {
                      const selectedPersonIndices = repeatForSelections[template.id] || [];
                      const personTypeFilter = template.personTypeFilter;

                      // personTypeFilter에 따라 인원 필터링
                      const filteredPersonsWithIndex = allPersons
                        .map((person, idx) => ({ person, idx }))
                        .filter(({ person }) => {
                          const isFounder = person.roles.includes('Founder');
                          const isCorporation = person.type === 'corporation';

                          if (personTypeFilter === 'individual' && isCorporation) return false;
                          if (personTypeFilter === 'individual_founder' && (!isFounder || isCorporation)) return false;
                          if ((personTypeFilter === 'corporation' || personTypeFilter === 'corporation_founder') && !isCorporation) return false;
                          return true;
                        });

                      const filterDescriptions: Record<string, string> = {
                        'all': '',
                        'individual': '(개인 주주 + 이사 + 임원)',
                        'individual_founder': '(개인 주주만)',
                        'corporation_founder': '(법인 주주만)',
                        'corporation': '(법인만)',
                      };
                      const filterDescription = filterDescriptions[personTypeFilter || 'all'] || '';

                      return (
                        <div key={template.id} style={{
                          background: 'var(--color-gray-50)',
                          border: '1px solid var(--color-gray-200)',
                          borderRadius: '8px',
                          padding: '16px',
                          marginBottom: '12px',
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <div>
                              <strong>{template.displayName || template.name}</strong>
                              {filterDescription && (
                                <span style={{ marginLeft: '8px', fontSize: '0.8rem', color: 'var(--color-gray-500)' }}>
                                  {filterDescription}
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline"
                                onClick={() => {
                                  const indices = filteredPersonsWithIndex.map(p => p.idx);
                                  setRepeatForSelections(prev => ({ ...prev, [template.id]: indices }));
                                }}
                              >
                                전체 선택
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline"
                                onClick={() => handleSelectAllPersons(template.id, false)}
                              >
                                전체 해제
                              </button>
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {filteredPersonsWithIndex.map(({ person, idx }) => (
                              <label
                                key={idx}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '10px',
                                  padding: '8px 12px',
                                  background: selectedPersonIndices.includes(idx) ? 'var(--color-primary-light)' : 'white',
                                  border: `1px solid ${selectedPersonIndices.includes(idx) ? 'var(--color-primary)' : 'var(--color-gray-300)'}`,
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedPersonIndices.includes(idx)}
                                  onChange={() => handleTogglePersonSelection(template.id, idx)}
                                  style={{ width: '16px', height: '16px' }}
                                />
                                <span style={{ fontWeight: 500 }}>{person.name}</span>
                                <span style={{ color: 'var(--color-gray-500)', fontSize: '0.85rem' }}>
                                  {person.roles.join(' / ')}
                                </span>
                                {person.cash && (
                                  <span style={{ color: 'var(--color-gray-500)', fontSize: '0.85rem' }}>
                                    (${Number(person.cash).toLocaleString()})
                                  </span>
                                )}
                              </label>
                            ))}
                          </div>

                          <div style={{ marginTop: '8px', fontSize: '0.85rem', color: 'var(--color-gray-500)' }}>
                            {selectedPersonIndices.length}명 선택됨 → {selectedPersonIndices.length}개 문서 생성 예정
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Bulk Actions */}
              <div className="bulk-actions">
                <button type="button" className="btn btn-sm btn-outline" onClick={handleSelectAll}>
                  Select All
                </button>
                <button type="button" className="btn btn-sm btn-outline" onClick={handleDeselectAll}>
                  Deselect All
                </button>
                <span className="selection-count">
                  {selectedIds.size} template(s) selected
                </span>
              </div>
            </>
          )}

          {/* Manual Input Step */}
          {step === 'manualInput' && !loadingManualVars && (
            <div className="manual-input-container">
              <p className="manual-input-description">
                The following information is required to generate your documents.
                Fields marked with <span className="required-mark">*</span> are required.
              </p>

              <div className="manual-input-fields">
                {manualVariables.map(variable => (
                  <div key={variable.variableName} className="form-group">
                    <label>
                      {variable.variableName}
                      {variable.required && <span className="required-mark">*</span>}
                      {variable.usedInTemplates.length > 0 && (
                        <span className="variable-templates" title={variable.usedInTemplates.join(', ')}>
                          (Used in {variable.usedInTemplates.length} template{variable.usedInTemplates.length > 1 ? 's' : ''})
                        </span>
                      )}
                    </label>
                    <input
                      type={getInputType(variable.dataType)}
                      value={manualValues[variable.variableName] || ''}
                      onChange={e => handleManualValueChange(variable.variableName, e.target.value)}
                      placeholder={variable.defaultValue || `Enter ${variable.variableName}`}
                      required={variable.required}
                      className={variable.required && !manualValues[variable.variableName]?.trim() ? 'input-required' : ''}
                    />
                    {variable.dataType !== 'text' && (
                      <span className="input-hint">Type: {variable.dataType}</span>
                    )}
                  </div>
                ))}
              </div>

              <div className="manual-input-summary">
                <span className="summary-total">{manualVariables.length} field(s) total</span>
                <span className="summary-required">
                  {manualVariables.filter(v => v.required).length} required
                </span>
              </div>
            </div>
          )}

          {/* Generating Step */}
          {step === 'generating' && (
            <div className="generating-container">
              <div className="generation-list">
                {generatingTemplates.map(templateId => {
                  const isCompleted = completedTemplates.includes(templateId);
                  const isCurrent = currentTemplate === templateId;
                  const isPending = !isCompleted && !isCurrent;

                  return (
                    <div key={templateId} className={`generation-item ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''}`}>
                      <span className="generation-icon">
                        {isCompleted && '✓'}
                        {isCurrent && <span className="spinner-small"></span>}
                        {isPending && '○'}
                      </span>
                      <span className="generation-name">{getTemplateName(templateId)}</span>
                      <span className="generation-status">
                        {isCompleted && 'Complete'}
                        {isCurrent && 'Generating...'}
                        {isPending && 'Pending'}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="progress-container">
                <div className="progress-bar">
                  <div
                    className="progress-fill"
                    style={{ width: `${getProgressPercentage()}%` }}
                  ></div>
                </div>
                <span className="progress-text">{getProgressPercentage()}%</span>
              </div>
            </div>
          )}

          {/* Complete Step */}
          {step === 'complete' && (
            <div className="complete-container">
              <div className="complete-icon">🎉</div>
              <p className="complete-summary">
                {results.filter(r => r.status === 'success').length} document(s) generated successfully
              </p>

              <div className="document-list">
                {results.map(doc => (
                  <div key={doc.templateId} className={`document-item ${doc.status}`}>
                    <span className="document-icon">
                      {doc.status === 'success' ? '📄' : '❌'}
                    </span>
                    <span className="document-filename">
                      {doc.filename || doc.templateName}
                    </span>
                    {doc.status === 'error' && (
                      <span className="document-error">{doc.error}</span>
                    )}
                    {doc.missingVariables && doc.missingVariables.length > 0 && (
                      <span className="document-warning" title={doc.missingVariables.join(', ')}>
                        ⚠️ {doc.missingVariables.length} missing variable(s)
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <div className="download-actions">
                <button className="btn btn-primary btn-lg" onClick={handleDownloadZip}>
                  📦 Download ZIP ({zipFilename})
                </button>
              </div>
            </div>
          )}

          {/* Error Step */}
          {step === 'error' && (
            <div className="error-container">
              <div className="error-icon">❌</div>
              <p className="error-message">{error}</p>
              <button className="btn btn-primary" onClick={() => setStep('selection')}>
                Try Again
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          {step === 'selection' && (
            <>
              <button className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleProceedToManualInput}
                disabled={selectedIds.size === 0 || loading || loadingManualVars}
              >
                {loadingManualVars ? 'Loading...' : 'Next'}
              </button>
            </>
          )}

          {step === 'manualInput' && (
            <>
              <button className="btn btn-secondary" onClick={() => setStep('selection')}>
                Back
              </button>
              <button
                className="btn btn-primary"
                onClick={handleGenerateFromManualInput}
                disabled={loadingManualVars}
              >
                Generate Documents
              </button>
            </>
          )}

          {step === 'complete' && (
            <button className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          )}

          {step === 'error' && (
            <button className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>

      {/* Template Preview Modal */}
      {previewTemplate && (
        <TemplatePreviewModal
          isOpen={showPreview}
          onClose={() => {
            setShowPreview(false);
            setPreviewTemplate(null);
          }}
          templateId={previewTemplate.id}
          templateName={previewTemplate.displayName || previewTemplate.name}
          surveyId={surveyId}
          useSampleData={false}
        />
      )}
    </div>
  );
}
