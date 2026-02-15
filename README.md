# Trademarks Questionnaire

상표 등록 설문 수집 및 문서 자동 생성 웹 애플리케이션

## 프로젝트 구조

```
├── client/          # React 프론트엔드 (Vite)
├── server/          # Express 백엔드
├── api/             # Vercel Serverless Functions
├── lib/             # 공유 라이브러리
└── questions_template.csv  # 설문 질문 템플릿
```

## 설치 및 실행

```bash
# 모든 의존성 설치
npm run install:all

# 개발 서버 실행
npm run dev
```

## 환경 변수

```env
REDIS_URL=           # Redis 연결 URL
RESEND_API_KEY=      # Resend 이메일 API 키
ADMIN_PASSWORD=      # 관리자 로그인 비밀번호
```
