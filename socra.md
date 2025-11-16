# Socratic Assessment – 설계/흐름/파일 개요

본 문서는 프로젝트 내 “Socratic Assessment” 기능의 관련 파일, 동작 흐름, API 계약, 확장 포인트를 정리합니다.

## 핵심 개념
- 목적: 사용자의 학습 세션 주제를 기반으로 소크라틱 방식의 문답을 진행하여 이해도를 점검하고 피드백을 제공.
- 진입점: 학습 문서 화면 사이드바의 “Socratic Assessment” 탭, 그리고 퀴즈 카드의 “Socratic Coach” 패널.
- 상태관리: 페이지 로컬 상태(`assessmentState`, `quizState`)와 앱 전역 상태 저장소(`frontend-web/static/js/state.js`)를 조합하여 메시지/진행도/완료 여부 유지.

## 관련 파일(Frontend)
- `frontend-web/static/js/pages/knowledge-document.js`
  - 사이드바 탭 렌더링: `_renderSidebar()` → `_renderAssessmentTab()`
  - 초기 부트스트랩: `_ensureAssessmentBootstrap()` – 학습 경로 첫 세션을 선택해 자동 시작 시도
  - 토픽 선택/시작: `_selectAssessmentTopic(topic)` – 첫 질문을 받기 위해 API 호출
  - 사용자 응답: `_sendAssessmentMessage()` – 최근 10개 메시지를 묶어 API 호출, 진행도/오답 수 집계
  - 퀴즈 코치: `_activateCoach()` → `_startCoachSession()` / `_sendCoachMessage()` – 각 퀴즈 문항별 소크라틱 대화
  - 응답 정규화: `_normalizeTutorResponse()` – `{ response: string }` 등 다양한 형태를 문자열로 통일
  - 진행 판단: 최대 문항 수(`MAX_ASSESSMENT_QUESTIONS = 3`)와 키워드 휴리스틱으로 오답/완료 여부 추정
- `frontend-web/static/js/api.js`
  - `API.assessWithSocraticTutor(learningTopic, messages, modelProvider, modelName)`
  - 백엔드 `POST /assess-with-socratic-tutor` 호출 래퍼
- (보조) `frontend-web/static/js/components/SocraticTutor.js`
  - 별도 “Socratic Tutor” UI 컴포넌트. 본 평가 탭과 동일한 백엔드 API를 사용해 대화형 코칭 제공 가능
- (진입/라우팅) `frontend-web/index.html`, `frontend-web/static/js/main.js`
  - 학습 문서 화면(`resume-learning` 라우트)에서 사이드바 탭으로 Assessment 노출

## 관련 파일(Backend)
- `backend/main.py`
  - 엔드포인트: `@app.post("/assess-with-socratic-tutor")`
    - 요청 파싱/로깅 → `assess_with_socratic_tutor(...)` 호출 → `{"response": <string>}` 반환
- `backend/api_schemas.py`
  - `class SocraticTutorRequest(BaseRequest)`
    - 필드: `learning_topic: str`, `messages: str`
    - 상속 필드: `model_provider: str = "shared"`, `model_name: str = "qwen-instruct"`, `method_name: str = "genmentor"`
- `backend/modules/ai_chatbot_tutor/agents/ai_chatbot_tutor.py`
  - `assess_with_socratic_tutor(learning_topic, messages)`
    - 공유 LLM 래퍼 생성(`create_shared_llm_wrapper`), `SocraticTutorAgent`로 수행
  - `class SocraticTutorAgent(BaseAgent)`
    - 시스템/태스크 프롬프트: `socratic_tutor_system_prompt`, `socratic_tutor_task_prompt`
    - `assess(payload)`: 대화 이력을 `_stringify_history`로 `"role: content"` 라인들로 변환하여 모델 호출
- `backend/modules/ai_chatbot_tutor/prompts/ai_chatbot_tutor.py`
  - `socratic_tutor_system_prompt`/`socratic_tutor_task_prompt` 정의 위치

## 동작 방식(엔드투엔드)
1. 사용자 진입
   - 학습 문서 화면(`resume-learning`) 사이드바에서 “Socratic Assessment” 탭을 선택.
   - 초기에는 `_ensureAssessmentBootstrap()`이 학습 경로의 첫 토픽을 자동 선택 시도.
2. 첫 질문 요청
   - `_selectAssessmentTopic(topic)`가 `API.assessWithSocraticTutor(topic, [])` 호출 → 백엔드에서 첫 질문 생성
   - 응답은 문자열 또는 `{ response: string }` 형태. 화면에 첫 메시지로 노출, `questionCount = 1`로 시작
3. 사용자 응답 루프
   - `_sendAssessmentMessage()`가 이전 메시지 + 사용자 입력을 합쳐 최근 10개만 전송
   - 백엔드 응답을 표현하고, 문장 내 물음표 여부와 칭찬/완료 키워드로 진행도/완료를 추정
   - 오답/불확실 키워드(예: “not sure”, “모르겠…”) 감지 시 `incorrectCount` 증가, 경고 배너 노출
4. 완료/요약
   - `questionCount >= MAX_ASSESSMENT_QUESTIONS` 또는 완료 키워드 매칭 시 완료 처리 및 요약 카드 표시
5. 퀴즈 연동 코칭(Socratic Coach)
   - 사용자가 퀴즈에 답하면 `_activateCoach()`가 문항 맥락으로 인트로 프롬프트 생성
   - `_startCoachSession()`/`_sendCoachMessage()`가 동일 API를 사용해 문항별 소크라틱 코칭 대화를 이어감

## API 계약
- 엔드포인트: `POST /assess-with-socratic-tutor`
- 요청(JSON)
  - `learning_topic: string` – 평가 주제(탭: 세션 제목, 코치: 문항/지시문 텍스트)
  - `messages: string` – JSON 배열 문자열. 예: `[{"role":"assistant","content":"..."},{"role":"user","content":"..."}]`
  - `model_provider?: string` – 프론트 기본 전달값은 `gpt-oss`
  - `model_name?: string` – 프론트 기본 전달값은 `gpt-oss-120b`
- 응답(JSON)
  - 일반적으로 `{ "response": "...모델 응답 문자열..." }`
  - 프론트는 `_normalizeTutorResponse()`로 문자열만 추출하여 사용

## 백엔드 처리 상세
- `backend/main.py` 내 핸들러는 `messages`가 문자열이고 `[`로 시작하면 `ast.literal_eval`로 배열로 파싱.
- `assess_with_socratic_tutor(...)`는 공유 LLM을 생성하고, `SocraticTutorAgent.assess` 호출.
- `SocraticTutorAgent.assess`는 시스템/태스크 프롬프트와 합쳐 모델을 호출하고 모델 원문 응답 문자열을 반환.
- 로깅: 요청/파싱/완료/에러 지점에서 풍부한 로그를 남겨 추적 가능.

## 프런트 상태 구조(요약)
- `assessmentState` (탭 전용)
  - `topic: string | null`
  - `messages: {role: 'user'|'assistant', content: string}[]`
  - `questionCount: number`, `incorrectCount: number`, `completed: boolean`, `isLoading: boolean`
- `quizState[questionId].coach` (문항별 코치)
  - `active: boolean`, `messages: [...], exchanges: number (<=3), completed: boolean`

## 테스트/확인 방법
- 백엔드 단독 호출(cURL)
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "learning_topic": "Intro to Scikit-Learn",
    "messages": "[]",
    "model_provider": "gpt-oss",
    "model_name": "gpt-oss-120b"
  }' \
  http://127.0.0.1:5003/assess-with-socratic-tutor
```
- 프런트에서 동작 확인
  1) 라우트 `resume-learning`으로 진입 → 사이드바 “Socratic Assessment” 선택
  2) 토픽 선택 시 첫 질문 생성, 입력창에 응답하며 진행
  3) 퀴즈 카드에서 정답/오답 후 “Socratic Coach” 패널로 대화 진행

## 주의/확장 포인트
- 휴리스틱: 진행도/오답/완료 판단은 키워드 매칭 기반이므로 프롬프트 변경 시 조정 필요(`_sendAssessmentMessage` 내부).
- 메시지 직렬화: 프런트는 `messages`를 항상 `JSON.stringify([...])`로 보냄. 백엔드는 문자열만 파싱 시도하므로, 배열 전달 시 문자열화 필수.
- 모델 구성: 에이전트는 `create_shared_llm_wrapper(temperature=0.7, max_tokens=1024)`를 사용. 필요 시 파라미터/모델 교체.
- 프롬프트 수정: `backend/modules/ai_chatbot_tutor/prompts/ai_chatbot_tutor.py`의 시스템/태스크 프롬프트로 톤/전략 제어.

---
본 문서는 `main` 브랜치(작성 시점) 기준 코드에서 추출한 내용을 요약했습니다.

## 시스템 프롬프트 원문(소크라테스 튜터)
- 정의 위치: `backend/modules/ai_chatbot_tutor/prompts/ai_chatbot_tutor.py`

### `socratic_tutor_system_prompt`

```
당신은 소크라테스식 AI 튜터입니다. 당신의 목표는 질문을 통해 학습자가 특정 주제를 스스로 탐구하도록 돕는 것입니다.
당신에게 학습 주제가 주어집니다. 다음 원칙을 따르세요:

대화를 시작할 때는 학습자의 현재 관점이나 해석을 자연스럽게 드러낼 수 있는 폭넓고 개방형 질문으로 시작합니다.

학습자의 응답에서 드러나는 개념, 논리, 가정 등을 바탕으로 더 깊은 사고를 이끌어낼 수 있는 후속 질문을 합니다.

오해나 논리적 간극을 직접 지적하지 않고, 이를 스스로 발견할 수 있도록 탐구적 질문을 활용합니다.

정답을 직접 제공하지 않습니다. 대신, 정의, 이유, 예시, 반례, 관계 등을 묻는 질문들로 학습자의 사고 과정을 확장합니다.

질문은 명확하고 간결하게 유지합니다.

어조는 차분하고 호기심을 자극하는 방식으로 유지합니다.

한국어로 질문하고 응답합니다. 사용자가 다른 언어를 명시적으로 요청하지 않는 한 한국어를 사용합니다.
```

### `socratic_tutor_task_prompt`

```
당신은 소크라테스식 AI 튜터입니다. 학습자는 다음 주제를 탐구하고자 합니다.

학습 주제:
{learning_topic}

대화 기록:
{messages}

위 대화 흐름을 이어서, 학습자가 자신의 생각을 더 깊이 탐구할 수 있도록 돕는 다음 탐구적 질문을 한 문장으로만 제시하세요.
대화가 처음이라면, 학습 주제에 대한 학습자의 관점이나 해석을 자연스럽게 이끌어낼 수 있는 폭넓은 개방형 질문으로 시작하세요.
정답이나 결론을 제시하지 말고 반드시 질문으로만 끝나는 한 문장을 출력하세요.
모든 출력은 한국어로 작성하세요.
```