# gen-react

GPU 서버에서 **GenMentor 백엔드(FastAPI)**와 **프론트(Streamlit)**를 Docker Compose로 구동하고, 프론트는 호스트(로컬) 가상환경에서 빠르게 개발할 수 있도록 정리한 운영 매뉴얼입니다. 모델은 `edumcp`에서 내려받아 둔 Qwen2.5-7B-Instruct 캐시를 공유 마운트해 재사용합니다.

---

## 1. 사전 준비물
- NVIDIA 드라이버 (CUDA 11.8 런타임 호환)
- Docker & docker-compose
- NVIDIA Container Toolkit (nvidia-docker2)
- GPU 인식 확인
  ```bash
  docker run --rm --gpus all nvidia/cuda:11.8.0-base nvidia-smi
  ```

---

## 2. 서버 경로
- 소스 코드 루트: `/raid/data/shared/gen-mentor/`
- 공유 모델 캐시(백엔드 컨테이너 마운트): `/raid/data/shared/models/gpt-oss-120b/`

---

## 3. Docker Compose 워크플로

### 3.1 초기 빌드
```bash
cd /raid/data/shared/gen-mentor
docker-compose build
```

### 3.2 실행/중지
```bash
cd /raid/data/shared/gen-mentor

# 실행 (백그라운드)
docker-compose up -d

# 중지
docker-compose down
```

### 3.3 서비스 포트 (메인 브랜치)
- 백엔드(FastAPI): `http://SERVER_IP:5000`
- 프론트(Streamlit): `http://SERVER_IP:8501`
- 프론트 환경 변수 예시: `BACKEND_ENDPOINT=http://genmentor_backend_main:5000/`

---

## 4. 컨테이너 이름·포트 정책
동시에 여러 인스턴스를 띄울 때 충돌을 막기 위해 컨테이너 이름과 호스트 포트를 브랜치/사용자별로 구분합니다. 동시에 사용하지 않는다면 메인 설정만으로도 충분합니다.

| 구분 | backend container_name | backend ports | frontend container_name | frontend ports |
|------|------------------------|---------------|-------------------------|----------------|
| main | `genmentor_backend_main` | `["5000:5000"]` | `genmentor_frontend_main` | `["8501:8501"]` |
| 현우·호준 | `genmentor_backend_hyunwoo_hojun` | `["5101:5000"]` | `genmentor_frontend_hyunwoo_hojun` | `["8601:8501"]` |
| 성관·웅빈 | `genmentor_backend_seonggwan_woongbin` | `["5102:5000"]` | `genmentor_frontend_seonggwan_woongbin` | `["8602:8501"]` |
| 재현 | `genmentor_backend_jaehyun` | `["5103:5000"]` | `genmentor_frontend_jaehyun` | `["8603:8501"]` |

> `docker-compose.yml`의 `services.<service>.container_name`과 `ports` 항목을 위 표에 맞춰 수정하세요.

### 4.1 compose 편집 예시
```yaml
services:
  backend:
    container_name: genmentor_backend_hyunwoo_hojun
    ports:
      - "5101:5000"
    environment:
      - BACKEND_ENDPOINT=http://genmentor_backend_hyunwoo_hojun:5000/
    # ... 나머지 설정 유지

  frontend:
    container_name: genmentor_frontend_hyunwoo_hojun
    ports:
      - "8601:8501"
    environment:
      - BACKEND_ENDPOINT=http://genmentor_backend_hyunwoo_hojun:5000/
    # ... 나머지 설정 유지
```

---

## 5. 프론트 로컬 개발 플로우
배포용 Compose 환경은 유지하면서, 프론트 수정/디버깅은 호스트에서 바로 실행하면 반영이 빠릅니다.

```bash
cd /raid/data/shared/gen-mentor/frontend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 팀별/브랜치별 포트 분리 (예: 8601, 8602, 8603)
python3 -m streamlit run main.py \
  --server.port 8601 \
  --server.address 0.0.0.0

python3 -m streamlit run main.py \
  --server.port 8602 \
  --server.address 0.0.0.0

python3 -m streamlit run main.py \
  --server.port 8603 \
  --server.address 0.0.0.0
```

- 로컬 프론트 → Docker 백엔드를 호출하려면 `BACKEND_ENDPOINT=http://SERVER_IP:5101/`처럼 호스트 포트를 지정합니다.
- 호스트 프론트와 Compose 프론트를 동시에 띄우지 않으면 포트 충돌은 발생하지 않습니다.

### 5.1 백엔드까지 로컬 실행 (선택)
```bash
cd /raid/data/shared/gen-mentor/backend
uvicorn main:app --host 0.0.0.0 --port 5101
```

---

## 6. 서비스 접속 방법
- 같은 네트워크: `http://SERVER_IP:<프론트포트>` (예: `http://61.39.248.33:8501`)
- SSH 포트 포워딩(권장)
  ```bash
  ssh -L 8501:localhost:8501 -L 5000:localhost:5000 a202321005@61.39.248.33
  # 브라우저에서 http://localhost:8501 접속
  ```

---

## 7. 로그 · 재시작 · 상태 확인
```bash
cd /raid/data/shared/gen-mentor

# 기본 컨테이너 이름 (필요 시 표에 맞춰 변경)
docker-compose logs -f --tail=200 genmentor_backend_main
docker-compose logs -f --tail=200 genmentor_frontend_main

docker-compose restart genmentor_backend_main
docker-compose restart genmentor_frontend_main
```

---

## 8. 모델 출력 디버깅 (JSON/Markdown)
프론트에 표시되는 JSON/Markdown이 깨질 때 백엔드 로그에서 원문 토큰 출력을 확인합니다.

```bash
cd /raid/data/shared/gen-mentor
docker-compose logs -f genmentor_backend_main | grep -A 20 "DEBUG RAW"
```

- `"DEBUG RAW"` 이후 20줄을 살펴보며 JSON 포맷, Markdown 백틱/괄호 누락 등을 확인하세요.
- 프롬프트나 후처리를 수정한 뒤 동일 명령으로 재확인합니다.
- pydantic 등의 스키마 검증을 활성화하면 비정상 JSON을 조기에 감지 가능합니다.

---

## 9. 빠른 API 점검
```bash
# 사용 가능한 LLM 목록
curl -s http://SERVER_IP:5000/list-llm-models | jq

# 샘플 POST 요청
curl -s -X POST http://SERVER_IP:5000/schedule-learning-path \
  -H 'Content-Type: application/json' \
  -d '{
    "learning_goal": "Learn Python basics",
    "learner_information": "Beginner, can dedicate 5h/week"
  }' | jq
```

---

## 10. 트러블슈팅 체크리스트
- 프론트 연결 오류: 두 컨테이너가 실행 중인지, `BACKEND_ENDPOINT`가 올바른지 확인 후 프론트를 재시작합니다.
- GPU 미인식: NVIDIA Container Toolkit 설정과 `nvidia-smi` 결과를 점검합니다.
- UI 꼬임/상태 초기화: `docker-compose restart genmentor_frontend_main genmentor_backend_main`
- 생성 형식 깨짐: 8번 `DEBUG RAW` 로그 확인 후 프롬프트/후처리 수정.

---

## 11. 설정 변경 위치
- Compose: `/raid/data/shared/gen-mentor/docker-compose.yml`
- 백엔드 Dockerfile: `/raid/data/shared/gen-mentor/backend/Dockerfile`
- 프론트 Dockerfile: `/raid/data/shared/gen-mentor/frontend/Dockerfile`

---

## 12. 레퍼런스

This is the official implementation of "*LLM-powered Multi-agent Framework for Goal-oriented Learning in Intelligent Tutoring System*" (WWW 2025, Industry Track Oral).

**Key Agent Modules**
- `Skill Gap Identifier`
- `Adaptive Learner Modeler`
- `Learning Path Scheduler`
- `Tailored Content Generator`
- `AI Chatbot Tutor`

Demo & Links  
- Website: https://www.tianfuwang.tech/gen-mentor  
- Paper: https://arxiv.org/pdf/2501.15749  
- Streamlit Demo: https://gen-mentor.streamlit.app/  
- Video: https://youtu.be/vTdtGZop-Zc
