# GenMentor with SharedLLM - Docker Setup Guide

GenMentor를 SharedLLM (Qwen2.5-7B-Instruct)과 함께 Docker로 실행하는 가이드입니다.

## 🎯 주요 변경사항

- ✅ **SharedLLM 통합**: OpenAI/DeepSeek API 대신 로컬 Qwen2.5-7B-Instruct 사용
- ✅ **GPU 공유**: edumcp와 같은 GPU (1번) 사용
- ✅ **모델 캐시 공유**: edumcp의 Hugging Face 모델 캐시 재사용
- ✅ **CUDA 베이스 이미지**: `nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04` 사용

---

## 🚀 실행 방법

### 1. Docker Compose로 빌드 & 실행

```bash
cd /raid/data/shared/gen-mentor

# 빌드 (첫 실행 시)
docker-compose build

# 실행
docker-compose up -d

# 로그 확인
docker-compose logs -f

# Backend 로그만 보기
docker-compose logs -f genmentor_backend

# Frontend 로그만 보기
docker-compose logs -f genmentor_frontend
```

### 2. 서비스 접속

- **Backend API**: http://localhost:5000
- **Frontend UI**: http://localhost:8501

### 3. 중지 & 재시작

```bash
# 중지
docker-compose stop

# 재시작
docker-compose start

# 완전히 삭제
docker-compose down
```

---

## 📂 구조

```
gen-mentor/
├── backend/
│   ├── Dockerfile              # CUDA 베이스 이미지
│   ├── requirements.txt        # Langchain 버전 수정됨
│   ├── base/
│   │   ├── shared_llm.py       # SharedLLM 싱글톤 (NEW)
│   │   ├── shared_llm_wrapper.py  # Langchain 래퍼 (NEW)
│   │   └── llm_factory.py      # SharedLLM 사용하도록 수정됨
│   └── ...
├── frontend/
│   ├── Dockerfile
│   └── ...
└── docker-compose.yml          # GPU 1번, 모델 볼륨 마운트
```

---

## 🔧 환경 변수

Backend 컨테이너에서 자동으로 설정됨:

```yaml
CUDA_VISIBLE_DEVICES=1                              # GPU 1번 사용
SHARED_MODEL_PATH=/root/.cache/huggingface         # 모델 경로
HF_HOME=/root/.cache/huggingface                   # Hugging Face 캐시
```

---

## 🎮 GPU 메모리 확인

```bash
# Backend 컨테이너 내부에서
docker-compose exec genmentor_backend nvidia-smi

# 또는 호스트에서
watch -n 1 nvidia-smi
```

---

## 🐛 트러블슈팅

### 1. 빌드 실패 시

```bash
# 캐시 없이 재빌드
docker-compose build --no-cache

# 특정 서비스만 재빌드
docker-compose build --no-cache genmentor_backend
```

### 2. GPU 인식 안 될 때

```bash
# nvidia-docker2 설치 확인
docker run --rm --gpus all nvidia/cuda:11.8.0-base-ubuntu22.04 nvidia-smi

# docker-compose.yml에서 runtime: nvidia 확인
```

### 3. 모델 로딩 실패 시

```bash
# 모델 캐시 경로 확인
ls -la /raid/data/shared/models/gpt-oss-120b/

# Backend 로그 확인
docker-compose logs genmentor_backend | grep -i "error\|fail"
```

### 4. 포트 충돌 시

```bash
# 5000번 포트 사용 중인 프로세스 확인
lsof -i :5000

# 8501번 포트 사용 중인 프로세스 확인
lsof -i :8501

# docker-compose.yml에서 포트 변경 가능
```

---

## 📊 성능 모니터링

```bash
# 컨테이너 리소스 사용량
docker stats genmentor_backend genmentor_frontend

# GPU 메모리 사용량 (실시간)
watch -n 1 "docker-compose exec genmentor_backend nvidia-smi"
```

---

## 🔄 개발 모드

코드 수정이 실시간으로 반영됩니다 (볼륨 마운트):

```yaml
volumes:
  - ./backend:/app     # Backend 코드 실시간 반영
  - ./frontend:/app    # Frontend 코드 실시간 반영
```

변경사항 적용:
```bash
# Backend 재시작 (코드 변경 시)
docker-compose restart genmentor_backend

# Frontend 재시작 (코드 변경 시)
docker-compose restart genmentor_frontend
```

---

## 🌐 외부 접속 (SSH 포트 포워딩)

다른 컴퓨터에서 접속하려면:

```bash
# 로컬 컴퓨터에서
ssh -L 5000:localhost:5000 -L 8501:localhost:8501 user@server-ip

# 브라우저에서
# - Backend: http://localhost:5000
# - Frontend: http://localhost:8501
```

---

## ✅ 체크리스트

- [ ] edumcp의 SharedLLM이 실행 중인가?
- [ ] GPU 1번이 사용 가능한가? (`nvidia-smi`)
- [ ] gpt-oss-120b 모델이 캐시에 있는가? (`/raid/data/shared/models/gpt-oss-120b/`)
- [ ] Docker Compose 빌드 성공?
- [ ] Backend 컨테이너 실행 중? (`docker-compose ps`)
- [ ] Frontend 컨테이너 실행 중?
- [ ] http://localhost:8501 접속 가능?

---

## 🎓 GenMentor 기능

GenMentor는 5개의 AI 에이전트로 구성됩니다:

1. 🧭 **Skill Gap Identifier**: 학습 목표와 현재 지식 간의 격차 분석
2. 👤 **Adaptive Learner Modeler**: 학습자 프로필 생성 및 업데이트
3. 🗓️ **Learning Path Scheduler**: 맞춤형 학습 경로 및 일정 생성
4. 📝 **Tailored Content Generator**: 개인화된 학습 자료 및 평가 생성
5. 🧑‍🏫 **AI Chatbot Tutor**: 대화형 튜터링 및 질문 응답

이제 이 모든 기능이 **로컬 SharedLLM**으로 작동합니다! 🚀

---

## 📚 참고

- 원본 프로젝트: https://github.com/GeminiLight/gen-mentor
- 논문: WWW 2025 (Industry Track) - "LLM-powered Multi-agent Framework for Goal-oriented Learning"
- edumcp 프로젝트: `/raid/data/shared/edumcp`

