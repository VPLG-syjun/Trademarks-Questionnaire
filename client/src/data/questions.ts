import { QuestionSection } from '../types/survey';

export const BASE_PRICE = 0; // 기본 서비스 금액 (USD)

export const questionSections: QuestionSection[] = [
  {
    id: 'basic',
    title: '기본 정보',
    description: '',
    questions: [
      {
        id: 'agreeTerms',
        type: 'dropdown',
        text: 'By clicking, I further agree to the site\'s Terms of Use.',
        description: '본 서비스를 이용함으로써, 귀하는 본 서비스의 {{TERMS_LINK}}에 동의하고, 위 두 법인으로부터 광고성 정보를 수신하는 것에 동의하게 됩니다. 본 웹사이트의 정보는 법률적 조언이 아니며 변호사-의뢰인 관계를 형성하지 않습니다. 본 웹사이트에 게재된 모든 자료들은 저작권법상 보호를 받는 대상이며, 권한 없는 복제나 상업적 서비스로의 어떠한 연결도 금지됩니다.',
        required: true,
        options: [
          { value: '1', label: 'Accept' },
          { value: '2', label: 'Deny' },
        ],
        documentField: 'agreeTerms',
      },
      {
        id: 'email',
        type: 'email',
        text: '이메일 주소 수집',
        description: 'FirstRegister는 입력하신 이메일 주소를 통해 질문지 내용을 확인하고, Invoice를 발행하며, Formation Pro, LLC 및 Venture Pacific Law Group, PC의 서비스 안내 및 마케팅 정보를 전달합니다. 반드시 정확한 주 이메일 주소를 기입해 주시기 바랍니다.',
        placeholder: 'example@email.com',
        required: true,
        conditionalOn: {
          questionId: 'agreeTerms',
          values: ['1'],
        },
        validation: {
          pattern: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
        },
        documentField: 'customerEmail',
      },
    ],
  },
  // TODO: 추가 섹션 정의
];

export default questionSections;
