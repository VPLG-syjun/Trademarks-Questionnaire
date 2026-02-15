import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { questionSections, BASE_PRICE } from '../data/questions';
import { Question, SurveyAnswer, RepeatableGroupItem, RepeatableField, Survey } from '../types/survey';
import { createSurvey, autoSaveSurvey, findSurveyByEmail } from '../services/api';

// localStorage 키
const SURVEY_ID_KEY = 'surveyFormId';

// 이름-주소-이메일-SSN 매핑 정보 타입
interface PersonInfo {
  name: string;
  address?: string;
  email?: string;
  ssn?: string;
}

export default function SurveyForm() {
  const navigate = useNavigate();
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | string[] | RepeatableGroupItem[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPriceExpanded, setIsPriceExpanded] = useState(false);

  // Refs for closure-safe access (항상 최신 값 유지)
  const surveyIdRef = useRef<string | null>(null);
  const answersRef = useRef<Record<string, string | string[] | RepeatableGroupItem[]>>({});
  const currentSectionIndexRef = useRef(0);
  const isAutoSavingRef = useRef(false);
  const saveQueueRef = useRef<Array<{ sectionIndex: number; answers: Record<string, string | string[] | RepeatableGroupItem[]> }>>([]);

  // state가 변경될 때마다 ref 동기화
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    currentSectionIndexRef.current = currentSectionIndex;
  }, [currentSectionIndex]);

  // 기존 설문 복원 팝업 관련 상태
  const [showResumeModal, setShowResumeModal] = useState(false);
  const [existingSurvey, setExistingSurvey] = useState<Survey | null>(null);
  const [isCheckingEmail, setIsCheckingEmail] = useState(false);

  // 이용약관 팝업 상태
  const [showTermsModal, setShowTermsModal] = useState(false);

  // 모든 입력된 이름-주소-이메일 매핑을 수집하는 함수
  // currentAnswers 인수를 받아서 현재 상태를 기반으로 수집
  // 대소문자 무시하여 이름 매칭 (키는 소문자로 저장)
  const collectPersonInfoMap = useCallback((currentAnswers?: Record<string, string | string[] | RepeatableGroupItem[]>): Map<string, PersonInfo> => {
    const answersToUse = currentAnswers || answers;
    const personMap = new Map<string, PersonInfo>();

    // 이사 정보 수집 (directors 반복 그룹)
    const directors = answersToUse['directors'] as RepeatableGroupItem[] || [];
    directors.forEach(director => {
      const name = director.name?.trim();
      if (name) {
        const key = name.toLowerCase();  // 대소문자 무시
        const existing = personMap.get(key);
        personMap.set(key, {
          name: existing?.name || name,  // 원본 이름 유지
          address: existing?.address || director.address?.trim() || undefined,
          email: existing?.email || director.email?.trim() || undefined,
          ssn: existing?.ssn || director.ssn?.trim() || undefined,
        });
      }
    });

    // 임원 정보 수집 (CEO, CFO, CS)
    const officers = [
      { nameKey: 'ceoName', addressKey: 'ceoAddress', emailKey: 'ceoEmail', ssnKey: 'ceoSsn' },
      { nameKey: 'cfoName', addressKey: 'cfoAddress', emailKey: 'cfoEmail', ssnKey: 'cfoSsn' },
      { nameKey: 'csName', addressKey: 'csAddress', emailKey: 'csEmail', ssnKey: 'csSsn' },
    ];

    officers.forEach(({ nameKey, addressKey, emailKey, ssnKey }) => {
      const name = (answersToUse[nameKey] as string)?.trim();
      if (name) {
        const key = name.toLowerCase();  // 대소문자 무시
        const existing = personMap.get(key);
        personMap.set(key, {
          name: existing?.name || name,  // 원본 이름 유지
          address: existing?.address || (answersToUse[addressKey] as string)?.trim() || undefined,
          email: existing?.email || (answersToUse[emailKey] as string)?.trim() || undefined,
          ssn: existing?.ssn || (answersToUse[ssnKey] as string)?.trim() || undefined,
        });
      }
    });

    // 창업자/주주 정보 수집 (founders 반복 그룹)
    const founders = answersToUse['founders'] as RepeatableGroupItem[] || [];
    founders.forEach(founder => {
      const name = founder.name?.trim();
      if (name) {
        const key = name.toLowerCase();  // 대소문자 무시
        const existing = personMap.get(key);
        personMap.set(key, {
          name: existing?.name || name,  // 원본 이름 유지
          address: existing?.address || founder.address?.trim() || undefined,
          email: existing?.email || founder.email?.trim() || undefined,
          ssn: existing?.ssn || founder.ssn?.trim() || undefined,
        });
      }
    });

    return personMap;
  }, [answers]);

  // 가격 계산 함수
  const calculateTotalPrice = useCallback((currentAnswers: Record<string, string | string[] | RepeatableGroupItem[]>) => {
    let totalPrice = BASE_PRICE;
    questionSections.forEach(section => {
      section.questions.forEach(question => {
        const answer = currentAnswers[question.id];
        if (!answer) return;

        if (question.type === 'repeatable_group' && question.pricePerItem) {
          const items = answer as RepeatableGroupItem[];
          const additionalItems = Math.max(0, items.length - 1);
          totalPrice += additionalItems * question.pricePerItem;
          return;
        }

        if (question.priceEffect?.type === 'perAnswer' && question.priceEffect.values) {
          totalPrice += question.priceEffect.values[answer as string] || 0;
        }
      });
    });
    return totalPrice;
  }, []);

  // 실제 저장 수행 함수
  const doSave = useCallback(async (completedSectionIndex: number, currentAnswers: Record<string, string | string[] | RepeatableGroupItem[]>) => {
    const email = currentAnswers.email as string;
    if (!email) return null;

    const surveyAnswers: SurveyAnswer[] = Object.entries(currentAnswers).map(([questionId, value]) => ({
      questionId,
      value,
    }));

    const totalPrice = calculateTotalPrice(currentAnswers);

    // surveyIdRef.current를 사용하여 항상 최신 ID 사용
    const currentSurveyId = surveyIdRef.current;

    console.log('[AutoSave] Saving section:', completedSectionIndex, 'Email:', email, 'SurveyId:', currentSurveyId);

    const result = await autoSaveSurvey({
      id: currentSurveyId || undefined,
      customerInfo: {
        name: currentAnswers.name as string || '',
        email: email,
        phone: currentAnswers.phone as string,
        company: currentAnswers.companyName1 as string,
      },
      answers: surveyAnswers,
      totalPrice,
      completedSectionIndex,
    });

    console.log('[AutoSave] Success:', result, 'Answers count:', surveyAnswers.length);

    return result;
  }, [calculateTotalPrice]);

  // 큐 처리 함수
  const processQueue = useCallback(async () => {
    if (isAutoSavingRef.current) return;
    if (saveQueueRef.current.length === 0) return;

    isAutoSavingRef.current = true;

    try {
      // 큐에서 가장 최신 항목만 처리 (가장 높은 섹션 인덱스)
      const latestItem = saveQueueRef.current.reduce((latest, current) =>
        current.sectionIndex > latest.sectionIndex ? current : latest
      );
      saveQueueRef.current = []; // 큐 비우기

      const result = await doSave(latestItem.sectionIndex, latestItem.answers);

      if (result?.id && result.id !== surveyIdRef.current) {
        surveyIdRef.current = result.id;
        localStorage.setItem(SURVEY_ID_KEY, result.id);
      }
    } catch (error) {
      console.error('[AutoSave] Error:', error);
    } finally {
      isAutoSavingRef.current = false;
      // 큐에 새 항목이 있으면 다시 처리
      if (saveQueueRef.current.length > 0) {
        processQueue();
      }
    }
  }, [doSave]);

  // 자동 저장 함수 (큐에 추가)
  const performAutoSave = useCallback((completedSectionIndex: number, currentAnswers: Record<string, string | string[] | RepeatableGroupItem[]>) => {
    const email = currentAnswers.email as string;
    if (!email) return;

    // 큐에 추가
    saveQueueRef.current.push({ sectionIndex: completedSectionIndex, answers: { ...currentAnswers } });

    // 큐 처리 시작
    processQueue();
  }, [processQueue]);

  // 페이지 이탈 시 자동 저장 (이메일이 있으면 항상 저장 시도)
  useEffect(() => {
    const handleBeforeUnload = () => {
      // refs를 사용하여 항상 최신 값 사용 (클로저 문제 방지)
      const currentSurveyId = surveyIdRef.current;
      const currentAnswers = answersRef.current;
      const sectionIndex = currentSectionIndexRef.current;

      // 이메일이 있으면 저장 (신규 또는 기존 설문)
      if (currentAnswers.email) {
        const surveyAnswers = Object.entries(currentAnswers).map(([questionId, value]) => ({
          questionId,
          value,
        }));

        let totalPrice = BASE_PRICE;
        questionSections.forEach(section => {
          section.questions.forEach(question => {
            const answer = currentAnswers[question.id];
            if (!answer) return;
            if (question.type === 'repeatable_group' && question.pricePerItem) {
              const items = answer as RepeatableGroupItem[];
              totalPrice += Math.max(0, items.length - 1) * question.pricePerItem;
              return;
            }
            if (question.priceEffect?.type === 'perAnswer' && question.priceEffect.values) {
              totalPrice += question.priceEffect.values[answer as string] || 0;
            }
          });
        });

        // 현재 섹션까지 완료된 것으로 저장 (이어서 작성 시 다음 섹션부터 시작)
        // sectionIndex가 0보다 크면 현재 작업 중인 섹션의 이전까지 완료
        const completedIndex = sectionIndex > 0 ? sectionIndex - 1 : 0;

        const data = JSON.stringify({
          action: 'autosave',
          id: currentSurveyId,
          customerInfo: {
            name: currentAnswers.name as string || '',
            email: currentAnswers.email as string,
            phone: currentAnswers.phone as string,
            company: currentAnswers.companyName1 as string,
          },
          answers: surveyAnswers,
          totalPrice,
          completedSectionIndex: completedIndex,
        });

        console.log('[BeforeUnload] Saving:', currentSurveyId ? 'update' : 'new', 'completedIndex:', completedIndex, 'answers:', surveyAnswers.length);
        navigator.sendBeacon('/api/surveys', new Blob([data], { type: 'application/json' }));
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []); // 빈 의존성 배열 - refs를 사용하므로 재등록 불필요

  const currentSection = questionSections[currentSectionIndex];
  const totalSections = questionSections.length;
  const progress = ((currentSectionIndex + 1) / totalSections) * 100;

  // Check if a question should be visible based on conditional rules
  const isQuestionVisible = (question: Question): boolean => {
    if (!question.conditionalOn) return true;
    const { questionId, values, minGroupCount, requiresIndividualFounder } = question.conditionalOn;
    const answer = answers[questionId];

    // Individual founder가 1명 이상 필요한 조건 체크
    if (requiresIndividualFounder) {
      const founders = answers['founders'] as RepeatableGroupItem[] || [];
      const hasIndividual = founders.some(f => f.type !== 'corporation');
      if (!hasIndividual) return false;
    }

    // 반복 그룹의 최소 항목 수 조건 체크
    if (minGroupCount !== undefined) {
      const groupItems = answer as RepeatableGroupItem[] || [];
      if (groupItems.length < minGroupCount) return false;
      // minGroupCount만 있고 values가 없으면 개수 조건만 통과하면 표시
      if (!values) return true;
    }

    // 값 기반 조건 체크
    if (values) {
      if (!answer) return false;
      return values.includes(answer as string);
    }

    return true;
  };

  // 동적 드롭다운 옵션 생성 (이사, 창업자(개인), 임원 목록)
  const getDynamicOptions = (question: Question): { value: string; label: string }[] => {
    if (!question.dynamicOptionsSource) return [];

    if (question.dynamicOptionsSource === 'directors_founders_officers') {
      const options: { value: string; label: string }[] = [];
      const addedNames = new Set<string>();

      // 이사 목록
      const directors = answers['directors'] as RepeatableGroupItem[] || [];
      directors.forEach(d => {
        const name = d.name?.trim();
        if (name && !addedNames.has(name.toLowerCase())) {
          addedNames.add(name.toLowerCase());
          options.push({ value: name, label: `${name} (이사)` });
        }
      });

      // 창업자 목록 (개인만, 법인 제외)
      const founders = answers['founders'] as RepeatableGroupItem[] || [];
      founders.forEach(f => {
        if (f.type !== 'corporation') {
          const name = f.name?.trim();
          if (name && !addedNames.has(name.toLowerCase())) {
            addedNames.add(name.toLowerCase());
            options.push({ value: name, label: `${name} (주주)` });
          }
        }
      });

      // 임원 목록 (CEO, CFO, CS)
      const officerFields = [
        { id: 'ceoName', label: '임원 - CEO' },
        { id: 'cfoName', label: '임원 - CFO' },
        { id: 'csName', label: '임원 - Corporate Secretary' },
      ];
      officerFields.forEach(officer => {
        const name = (answers[officer.id] as string)?.trim();
        if (name && !addedNames.has(name.toLowerCase())) {
          addedNames.add(name.toLowerCase());
          options.push({ value: name, label: `${name} (${officer.label})` });
        }
      });

      return options;
    }

    return [];
  };

  // Get visible questions for current section
  const visibleQuestions = useMemo(() => {
    return currentSection.questions.filter(isQuestionVisible);
  }, [currentSection, answers]);

  // Calculate total price
  const priceBreakdown = useMemo(() => {
    const breakdown: { label: string; amount: number }[] = [];
    let additionalTotal = 0;

    questionSections.forEach(section => {
      section.questions.forEach(question => {
        const answer = answers[question.id];
        if (!answer) return;

        // 반복 그룹의 pricePerItem 처리
        if (question.type === 'repeatable_group' && question.pricePerItem) {
          const items = answer as RepeatableGroupItem[];
          const additionalItems = Math.max(0, items.length - 1); // 첫 번째 항목 이후
          const price = additionalItems * question.pricePerItem;
          if (price > 0) {
            breakdown.push({
              label: `추가 ${question.itemLabel || '항목'} (${additionalItems}명)`,
              amount: price,
            });
            additionalTotal += price;
          }
          return;
        }

        // 기존 priceEffect 처리
        if (!question.priceEffect) return;

        let price = 0;
        if (question.priceEffect.type === 'perAnswer' && question.priceEffect.values) {
          price = question.priceEffect.values[answer as string] || 0;
        }

        if (price > 0) {
          breakdown.push({
            label: question.text.length > 20 ? question.text.substring(0, 20) + '...' : question.text,
            amount: price,
          });
          additionalTotal += price;
        }
      });
    });

    return { breakdown, additionalTotal, total: BASE_PRICE + additionalTotal };
  }, [answers]);

  const handleAnswer = (questionId: string, value: string | string[] | RepeatableGroupItem[]) => {
    // 임원 이름 필드와 해당하는 주소/이메일/SSN 필드 매핑
    const officerFieldMapping: Record<string, { addressKey: string; emailKey: string; ssnKey: string }> = {
      ceoName: { addressKey: 'ceoAddress', emailKey: 'ceoEmail', ssnKey: 'ceoSsn' },
      cfoName: { addressKey: 'cfoAddress', emailKey: 'cfoEmail', ssnKey: 'cfoSsn' },
      csName: { addressKey: 'csAddress', emailKey: 'csEmail', ssnKey: 'csSsn' },
    };

    setAnswers(prev => {
      const newAnswers = { ...prev, [questionId]: value };

      // 임원 이름 필드가 변경된 경우 자동 완성 로직 실행
      if (officerFieldMapping[questionId] && typeof value === 'string' && value.trim()) {
        const personMap = collectPersonInfoMap(prev);
        const matchedPerson = personMap.get(value.trim().toLowerCase());  // 대소문자 무시
        const { addressKey, emailKey, ssnKey } = officerFieldMapping[questionId];

        if (matchedPerson) {
          // 현재 주소가 비어있고 매칭된 사람에게 주소가 있으면 자동 채움
          if (!(prev[addressKey] as string)?.trim() && matchedPerson.address) {
            newAnswers[addressKey] = matchedPerson.address;
          }
          // 현재 이메일이 비어있고 매칭된 사람에게 이메일이 있으면 자동 채움
          if (!(prev[emailKey] as string)?.trim() && matchedPerson.email) {
            newAnswers[emailKey] = matchedPerson.email;
          }
          // 현재 SSN이 비어있고 매칭된 사람에게 SSN이 있으면 자동 채움
          if (!(prev[ssnKey] as string)?.trim() && matchedPerson.ssn) {
            newAnswers[ssnKey] = matchedPerson.ssn;
          }
        }
      }

      return newAnswers;
    });

    setErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[questionId];
      return newErrors;
    });
  };

  // 반복 그룹: 항목 추가
  const handleAddGroupItem = (questionId: string, fields: RepeatableField[]) => {
    const currentItems = (answers[questionId] as RepeatableGroupItem[]) || [];
    const newItem: RepeatableGroupItem = {};
    fields.forEach(field => {
      newItem[field.id] = '';
    });
    handleAnswer(questionId, [...currentItems, newItem]);
  };

  // 반복 그룹: 항목 삭제
  const handleRemoveGroupItem = (questionId: string, index: number) => {
    const currentItems = (answers[questionId] as RepeatableGroupItem[]) || [];
    const newItems = currentItems.filter((_, i) => i !== index);
    handleAnswer(questionId, newItems);
  };

  // 반복 그룹: 필드 값 변경 (이름 입력 시 주소/이메일/SSN 자동 완성)
  const handleGroupFieldChange = (questionId: string, itemIndex: number, fieldId: string, value: string) => {
    const currentItems = (answers[questionId] as RepeatableGroupItem[]) || [];
    const newItems = [...currentItems];
    newItems[itemIndex] = { ...newItems[itemIndex], [fieldId]: value };

    // name 필드가 변경된 경우 자동 완성 로직 실행
    if (fieldId === 'name' && value.trim()) {
      const personMap = collectPersonInfoMap();
      const matchedPerson = personMap.get(value.trim().toLowerCase());  // 대소문자 무시

      if (matchedPerson) {
        // 현재 주소가 비어있고 매칭된 사람에게 주소가 있으면 자동 채움
        if (!newItems[itemIndex].address?.trim() && matchedPerson.address) {
          newItems[itemIndex].address = matchedPerson.address;
        }
        // 현재 이메일이 비어있고 매칭된 사람에게 이메일이 있으면 자동 채움
        if (!newItems[itemIndex].email?.trim() && matchedPerson.email) {
          newItems[itemIndex].email = matchedPerson.email;
        }
        // 현재 SSN이 비어있고 매칭된 사람에게 SSN이 있으면 자동 채움
        if (!newItems[itemIndex].ssn?.trim() && matchedPerson.ssn) {
          newItems[itemIndex].ssn = matchedPerson.ssn;
        }
      }
    }

    handleAnswer(questionId, newItems);
  };

  // 반복 그룹 초기화 (첫 항목 생성)
  const initializeGroupIfNeeded = (question: Question) => {
    if (question.type === 'repeatable_group' && !answers[question.id]) {
      const fields = question.groupFields || [];
      const initialItem: RepeatableGroupItem = {};
      fields.forEach(field => {
        initialItem[field.id] = '';
      });
      setAnswers(prev => ({ ...prev, [question.id]: [initialItem] }));
    }
  };

  const validateSection = (): boolean => {
    const newErrors: Record<string, string> = {};

    visibleQuestions.forEach(question => {
      const answer = answers[question.id];

      // 반복 그룹 검증
      if (question.type === 'repeatable_group') {
        const items = answer as RepeatableGroupItem[] || [];
        const minItems = question.minItems || 1;

        if (question.required && items.length < minItems) {
          newErrors[question.id] = `최소 ${minItems}개 이상의 ${question.itemLabel || '항목'}이 필요합니다.`;
          return;
        }

        // 각 항목의 필수 필드 검증
        let hasFieldError = false;
        items.forEach((item, index) => {
          question.groupFields?.forEach(field => {
            // 조건부 필드 체크 - 조건이 충족되지 않으면 검증 스킵
            if (field.conditionalOn) {
              const { fieldId, values } = field.conditionalOn;
              const dependentValue = item[fieldId];
              if (!dependentValue || !values.includes(dependentValue)) {
                return; // 조건 미충족 시 검증 스킵
              }
            }

            if (field.required && !item[field.id]?.trim()) {
              newErrors[`${question.id}_${index}_${field.id}`] = '필수 항목입니다.';
              hasFieldError = true;
            }
            // 이메일 형식 검증
            if (field.type === 'email' && item[field.id]) {
              const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
              if (!emailPattern.test(item[field.id])) {
                newErrors[`${question.id}_${index}_${field.id}`] = '올바른 이메일 형식을 입력해주세요.';
                hasFieldError = true;
              }
            }
          });
        });

        if (hasFieldError) {
          newErrors[question.id] = '모든 필수 항목을 입력해주세요.';
        }
        return;
      }

      if (question.required) {
        if (!answer || (Array.isArray(answer) && answer.length === 0)) {
          newErrors[question.id] = '필수 항목입니다.';
          return;
        }
      }

      // 이메일 형식 검증
      if (question.type === 'email' && answer) {
        const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        if (!emailPattern.test(answer as string)) {
          newErrors[question.id] = '올바른 이메일 형식을 입력해주세요.';
        }
      }

      // validation 패턴 검증
      if (question.validation?.pattern && answer) {
        const pattern = new RegExp(question.validation.pattern);
        if (!pattern.test(answer as string)) {
          newErrors[question.id] = '올바른 형식을 입력해주세요.';
        }
      }
    });

    // 기본 정보 섹션에서 추가 검증
    if (currentSection.id === 'basic') {
      // terms가 Accept가 아니면 다음으로 넘어갈 수 없음
      if (answers.agreeTerms && answers.agreeTerms !== '1') {
        newErrors['agreeTerms'] = '서비스 이용에 동의해야 진행할 수 있습니다.';
      }

      // proceedWithCorp가 yes가 아니면 다음으로 넘어갈 수 없음
      if (answers.agreeTerms === '1' && answers.proceedWithCorp && answers.proceedWithCorp !== 'yes') {
        newErrors['proceedWithCorp'] = '계속 진행하시려면 "예"를 선택해주세요.';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // 기존 설문 복원 확인 및 다음 섹션으로 이동
  const proceedToNextSection = () => {
    // 섹션 완료 시 자동 저장
    performAutoSave(currentSectionIndex, answers);

    if (currentSectionIndex < totalSections - 1) {
      setCurrentSectionIndex(prev => prev + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // 기존 설문 불러오기
  const handleResumeSurvey = () => {
    if (!existingSurvey) return;

    // 기존 설문 답변을 현재 상태로 복원
    const restoredAnswers: Record<string, string | string[] | RepeatableGroupItem[]> = {};
    existingSurvey.answers.forEach((answer: SurveyAnswer) => {
      restoredAnswers[answer.questionId] = answer.value;
    });

    console.log('[Resume] Restoring answers:', Object.keys(restoredAnswers).length, 'items');
    console.log('[Resume] Answer keys:', Object.keys(restoredAnswers));

    // state와 ref 모두 업데이트
    setAnswers(restoredAnswers);
    answersRef.current = restoredAnswers;  // ref도 즉시 업데이트
    surveyIdRef.current = existingSurvey.id;
    localStorage.setItem(SURVEY_ID_KEY, existingSurvey.id);

    // 다음 섹션으로 이동 (완료된 섹션 + 1)
    const nextSection = (existingSurvey.completedSectionIndex || 0) + 1;
    setCurrentSectionIndex(Math.min(nextSection, totalSections - 1));
    currentSectionIndexRef.current = Math.min(nextSection, totalSections - 1);  // ref도 즉시 업데이트

    setShowResumeModal(false);
    setExistingSurvey(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 새로 작성하기 (기존 설문 무시)
  const handleStartFresh = () => {
    // 기존 surveyId 초기화 (새로운 설문 생성)
    surveyIdRef.current = null;
    localStorage.removeItem(SURVEY_ID_KEY);

    // 현재 입력한 기본 정보는 유지 (answers는 건드리지 않음)
    setShowResumeModal(false);
    setExistingSurvey(null);
    proceedToNextSection();
  };

  const handleNext = async () => {
    if (!validateSection()) return;

    // 기본 정보 섹션에서 다음 버튼 클릭 시 기존 설문 확인
    // surveyId가 있어도 확인 (이전 세션에서 localStorage에 저장된 경우)
    if (currentSectionIndex === 0) {
      const email = answers.email as string;
      if (email) {
        setIsCheckingEmail(true);
        try {
          const result = await findSurveyByEmail(email);
          if (result.found && result.survey) {
            // 현재 surveyId와 같은 설문이면 바로 진행 (이미 같은 설문 진행 중)
            const currentSurveyId = surveyIdRef.current;
            if (currentSurveyId && result.survey.id === currentSurveyId) {
              setIsCheckingEmail(false);
              proceedToNextSection();
              return;
            }
            // 기존 설문 발견 - 팝업 표시
            setExistingSurvey(result.survey);
            setShowResumeModal(true);
            setIsCheckingEmail(false);
            return;
          }
        } catch (error) {
          console.error('Error checking existing survey:', error);
          // 오류 시 그냥 진행
        }
        setIsCheckingEmail(false);
      }
    }

    proceedToNextSection();
  };

  const handlePrev = () => {
    if (currentSectionIndex > 0) {
      setCurrentSectionIndex(prev => prev - 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleSubmit = async () => {
    if (!validateSection()) return;

    setIsSubmitting(true);

    try {
      // 답변 복사본 생성 (원본 수정 방지)
      const processedAnswers = { ...answers };

      // designator 처리: "custom" 선택 시 직접 입력 값 사용
      if (processedAnswers.designator === 'custom' && processedAnswers.designatorCustom) {
        processedAnswers.designator = processedAnswers.designatorCustom;
        delete processedAnswers.designatorCustom; // 불필요한 필드 제거
      }

      const surveyAnswers: SurveyAnswer[] = Object.entries(processedAnswers).map(([questionId, value]) => ({
        questionId,
        value,
      }));

      await createSurvey({
        id: surveyIdRef.current || undefined,  // 기존 작성중 설문 ID 포함
        customerInfo: {
          name: answers.name as string,
          email: answers.email as string,
          phone: answers.phone as string,
          company: answers.companyName1 as string,
        },
        answers: surveyAnswers,
        totalPrice: priceBreakdown.total,
      });

      // 제출 완료 후 localStorage 정리
      localStorage.removeItem(SURVEY_ID_KEY);

      navigate('/success');
    } catch (error) {
      console.error('Submit error:', error);
      alert('제출 중 오류가 발생했습니다. 다시 시도해주세요.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderQuestion = (question: Question) => {
    // 반복 그룹 초기화
    if (question.type === 'repeatable_group') {
      initializeGroupIfNeeded(question);
    }

    const value = answers[question.id] || '';
    const error = errors[question.id];
    const hasPriceEffect = question.priceEffect && question.priceEffect.values;

    return (
      <div key={question.id} className={`question fade-in ${error ? 'has-error' : ''}`}>
        <label className="question-label">
          <span>{question.text}</span>
          {question.required && <span className="required">*</span>}
          {hasPriceEffect && <span className="question-price-tag">가격 영향</span>}
        </label>

        {question.description && (
          <p className="question-description">
            {question.description.includes('{{TERMS_LINK}}') ? (
              <>
                {question.description.split('{{TERMS_LINK}}')[0]}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setShowTermsModal(true);
                  }}
                  style={{ color: 'var(--color-primary)', textDecoration: 'underline', cursor: 'pointer' }}
                >
                  이용약관 및 개인정보 처리방침
                </a>
                {question.description.split('{{TERMS_LINK}}')[1]}
              </>
            ) : (
              question.description
            )}
          </p>
        )}

        {renderInput(question, value, error)}

        {error && <p style={{ color: 'var(--color-error)', fontSize: '0.85rem', marginTop: '8px' }}>{error}</p>}
      </div>
    );
  };

  const renderInput = (question: Question, value: string | string[] | RepeatableGroupItem[], _error?: string) => {
    switch (question.type) {
      case 'text':
      case 'email':
      case 'tel':
      case 'number':
      case 'date':
        return (
          <input
            type={question.type}
            value={value as string}
            onChange={e => handleAnswer(question.id, e.target.value)}
            placeholder={question.placeholder}
          />
        );

      case 'dropdown': {
        // 동적 옵션이 있으면 사용, 없으면 정적 옵션 사용
        const dynamicOpts = getDynamicOptions(question);
        const options = dynamicOpts.length > 0 ? dynamicOpts : question.options || [];
        return (
          <select
            value={value as string}
            onChange={e => handleAnswer(question.id, e.target.value)}
          >
            <option value="">선택해주세요</option>
            {options.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
                {'price' in option && option.price ? ` (+$${option.price.toLocaleString()})` : ''}
              </option>
            ))}
          </select>
        );
      }

      case 'yesno':
        return (
          <div className="yesno-group">
            <button
              type="button"
              className={`yesno-btn ${value === 'yes' ? 'selected yes' : ''}`}
              onClick={() => handleAnswer(question.id, 'yes')}
            >
              예
            </button>
            <button
              type="button"
              className={`yesno-btn ${value === 'no' ? 'selected no' : ''}`}
              onClick={() => handleAnswer(question.id, 'no')}
            >
              아니오
            </button>
          </div>
        );

      case 'radio':
        return (
          <div className="option-group">
            {question.options?.map(option => (
              <label
                key={option.value}
                className={`option-item ${value === option.value ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name={question.id}
                  value={option.value}
                  checked={value === option.value}
                  onChange={e => handleAnswer(question.id, e.target.value)}
                />
                <span className="option-label">{option.label}</span>
                {option.price !== undefined && option.price > 0 && (
                  <span className="option-price">+${option.price.toLocaleString()}</span>
                )}
              </label>
            ))}
          </div>
        );

      case 'checkbox':
        const selectedValues = (value as string[]) || [];
        return (
          <div className="option-group">
            {question.options?.map(option => (
              <label
                key={option.value}
                className={`option-item ${selectedValues.includes(option.value) ? 'selected' : ''}`}
              >
                <input
                  type="checkbox"
                  value={option.value}
                  checked={selectedValues.includes(option.value)}
                  onChange={e => {
                    const newValues = e.target.checked
                      ? [...selectedValues, option.value]
                      : selectedValues.filter(v => v !== option.value);
                    handleAnswer(question.id, newValues);
                  }}
                />
                <span className="option-label">{option.label}</span>
                {option.price !== undefined && option.price > 0 && (
                  <span className="option-price">+${option.price.toLocaleString()}</span>
                )}
              </label>
            ))}
          </div>
        );

      case 'repeatable_group':
        const groupItems = (value as unknown as RepeatableGroupItem[]) || [];
        const fields = question.groupFields || [];
        const maxItems = question.maxItems || 10;
        const minItems = question.minItems || 1;
        const itemLabel = question.itemLabel || '항목';

        return (
          <div className="repeatable-group">
            {groupItems.map((item, itemIndex) => (
              <div key={itemIndex} className="repeatable-group-item">
                <div className="repeatable-group-header">
                  <span className="repeatable-group-title">
                    {itemLabel} {itemIndex + 1}
                  </span>
                  {groupItems.length > minItems && (
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => handleRemoveGroupItem(question.id, itemIndex)}
                    >
                      삭제
                    </button>
                  )}
                </div>
                <div className="repeatable-group-fields">
                  {fields.map(field => {
                    // 그룹 내 조건부 필드 체크
                    if (field.conditionalOn) {
                      const { fieldId, values } = field.conditionalOn;
                      const dependentValue = item[fieldId];
                      if (!dependentValue || !values.includes(dependentValue)) {
                        return null;
                      }
                    }

                    const fieldError = errors[`${question.id}_${itemIndex}_${field.id}`];
                    return (
                      <div key={field.id} className={`repeatable-field ${fieldError ? 'has-error' : ''}`}>
                        <label className="repeatable-field-label">
                          {field.label}
                          {field.required && <span className="required">*</span>}
                        </label>
                        {field.type === 'dropdown' ? (
                          <select
                            value={item[field.id] || ''}
                            onChange={e => handleGroupFieldChange(question.id, itemIndex, field.id, e.target.value)}
                          >
                            <option value="">선택해주세요</option>
                            {field.options?.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={field.type}
                            value={item[field.id] || ''}
                            onChange={e => handleGroupFieldChange(question.id, itemIndex, field.id, e.target.value)}
                            placeholder={field.placeholder}
                          />
                        )}
                        {fieldError && (
                          <p className="field-error">{fieldError}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {groupItems.length < maxItems && (
              <button
                type="button"
                className="btn btn-outline btn-add-item"
                onClick={() => handleAddGroupItem(question.id, fields)}
              >
                + {question.addButtonText || `${itemLabel} 추가`}
              </button>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  const formatPrice = (amount: number) => {
    return '$' + amount.toLocaleString();
  };

  return (
    <div className="survey-layout">
      <div className="survey-main">
        <div className="card">
          {/* Progress */}
          <div className="progress-container">
            <div className="progress-header">
              <span className="progress-title">설문 진행률</span>
              <span className="progress-text">{currentSectionIndex + 1} / {totalSections}</span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>

          {/* Section Header */}
          <div className="section-header">
            <h2 className="section-title">{currentSection.title}</h2>
            {currentSection.description && (
              <p className="section-description">{currentSection.description}</p>
            )}
          </div>

          {/* Questions */}
          <div className="questions">
            {visibleQuestions.map(renderQuestion)}
          </div>

          {/* Navigation */}
          <div className="nav-buttons">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handlePrev}
              disabled={currentSectionIndex === 0}
            >
              이전
            </button>

            {currentSectionIndex < totalSections - 1 ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleNext}
                disabled={isCheckingEmail}
              >
                {isCheckingEmail ? '확인 중...' : '다음'}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-success btn-lg"
                onClick={handleSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? '제출 중...' : '설문 제출하기'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Price Sidebar */}
      <aside className="price-sidebar">
        <div className={`price-card ${isPriceExpanded ? 'expanded' : ''}`}>
          {/* 데스크탑용 (항상 표시) */}
          <p className="price-card-title">예상 서비스 비용</p>
          <p className="price-total">
            <span className="currency">$</span>
            {priceBreakdown.total.toLocaleString()}
          </p>

          {/* 모바일용 접힌 헤더 */}
          <div
            className="price-card-collapsed"
            onClick={() => setIsPriceExpanded(!isPriceExpanded)}
          >
            <div>
              <span className="price-label">예상 비용</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className="price-amount">${priceBreakdown.total.toLocaleString()}</span>
              <span className="expand-icon">{isPriceExpanded ? '▼' : '▲'}</span>
            </div>
          </div>

          {/* 모바일 확장 콘텐츠 */}
          <div className="price-card-expanded">
            <div className="price-breakdown">
              <div className="price-item base">
                <span className="price-item-label">기본 서비스</span>
                <span className="price-item-value">{formatPrice(BASE_PRICE)}</span>
              </div>

              {priceBreakdown.breakdown.map((item, index) => (
                <div key={index} className="price-item">
                  <span className="price-item-label">{item.label}</span>
                  <span className="price-item-value">+{formatPrice(item.amount)}</span>
                </div>
              ))}

              {priceBreakdown.breakdown.length === 0 && (
                <p style={{ opacity: 0.6, fontSize: '0.8rem', textAlign: 'center', padding: '8px 0' }}>
                  추가 옵션을 선택하면<br />여기에 표시됩니다
                </p>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* 기존 설문 복원 팝업 */}
      {showResumeModal && existingSurvey && (
        <div className="modal-overlay">
          <div className="modal-content resume-modal">
            <h3>기존 작성 내역 발견</h3>
            <p>
              이전에 작성하던 질문지가 있습니다.<br />
              이어서 작성하시겠습니까?
            </p>
            <div className="resume-info">
              <div className="resume-info-row">
                <span className="resume-info-label">이메일</span>
                <span className="resume-info-value">{existingSurvey.customerInfo?.email}</span>
              </div>
              <div className="resume-info-row">
                <span className="resume-info-label">진행 상태</span>
                <span className="resume-info-value">
                  {getSectionNameForModal(existingSurvey.completedSectionIndex || 0)}까지 완료
                </span>
              </div>
              <div className="resume-info-row">
                <span className="resume-info-label">마지막 저장</span>
                <span className="resume-info-value">
                  {new Date(existingSurvey.updatedAt || existingSurvey.createdAt).toLocaleDateString('ko-KR', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            </div>
            <div className="modal-buttons">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleStartFresh}
              >
                새로 작성
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleResumeSurvey}
              >
                이어서 작성
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 이용약관 및 개인정보 처리방침 팝업 */}
      {showTermsModal && (
        <div className="modal-overlay" onClick={() => setShowTermsModal(false)}>
          <div className="modal-content terms-modal" onClick={(e) => e.stopPropagation()}>
            <div className="terms-modal-header">
              <h3>이용약관 및 개인정보 처리방침</h3>
              <button
                type="button"
                className="terms-modal-close"
                onClick={() => setShowTermsModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="terms-modal-body">
              <h4>1. 개인정보의 수집 및 이용 (Privacy Notice)</h4>
              <p>
                본 서비스는 효율적인 법인 설립 지원을 위해 귀하의 이메일 및 답변 정보를 수집합니다.
                수집된 정보는 서비스 제공, 상담, 비용 청구 및 Formation Pro, LLC와 Venture Pacific Law Group, PC의
                새로운 서비스 안내, 법률 업데이트 등 마케팅 목적으로 활용됩니다.
              </p>
              <p><strong>보유 기간:</strong> 서비스 목적 달성 시 또는 관련 법령에 따른 보존 기간까지.</p>

              <h4>2. 이용자 권리 (User Rights)</h4>
              <p>
                귀하는 언제든지 자신의 개인정보에 대한 열람, 수정, 삭제 및 마케팅 수신 거부를 요청할 권리가 있습니다.
              </p>
              <p>
                <strong>California residents (CCPA/CPRA):</strong> 귀하는 개인정보의 수집 및 공유를 제한할 권리가 있습니다.
              </p>
              <p>
                <strong>한국 거주자 (PIPA):</strong> 귀하는 개인정보 처리에 대한 동의를 거부할 수 있으나, 서비스 이용이 제한될 수 있습니다.
              </p>

              <h4>3. 법적 고지 (Legal Disclaimer)</h4>
              <p>
                본 웹사이트에서 제공되는 모든 정보는 일반적인 정보 제공을 목적으로 하며, 특정 사안에 대한 법률적 조언(Legal Advice)을 대체할 수 없습니다.
                이용자와 본 사이트 운영자 간에는 변호사-의뢰인 관계가 성립되지 않습니다.
                개별적인 법률 문제는 반드시 자격을 갖춘 변호사와 상담하시기 바랍니다.
              </p>

              <h4>4. 저작권 (Copyright)</h4>
              <p>
                본 서비스 내 모든 콘텐츠는 저작권법의 보호를 받습니다.
                권한 없는 복제, 배포 및 상업적 목적의 무단 연결은 엄격히 금지됩니다.
              </p>

              <h4>5. 연락처 및 철회</h4>
              <p>
                본 정책이나 마케팅 수신 철회에 관한 문의는 귀하의 담당자 또는 공식 이메일 주소로 연락해 주시기 바랍니다.
              </p>
            </div>
            <div className="modal-buttons">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowTermsModal(false)}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  // 섹션 이름 반환 함수 (모달용)
  function getSectionNameForModal(index: number) {
    const sectionNames = ['기본 정보', '회사 정보', '주소 정보', '이사회 정보', '임원 정보', '주주 정보', '금융 서비스', '추가 서비스', '최종 확인'];
    return sectionNames[index] || `섹션 ${index + 1}`;
  }
}
