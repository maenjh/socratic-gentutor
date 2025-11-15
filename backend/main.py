import ast
import json
import time
import logging
import uvicorn
import hydra
from omegaconf import DictConfig, OmegaConf
from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI, HTTPException, File, UploadFile, Form, Request
from base.llm_factory import LLMFactory
from base.searcher_factory import SearchRunner
from base.search_rag import SearchRagManager
from utils.preprocess import extract_text_from_pdf
from fastapi.responses import JSONResponse
from modules.skill_gap_identification import *
from modules.adaptive_learner_modeling import *
from modules.personalized_resource_delivery import *
from modules.ai_chatbot_tutor import chat_with_tutor_with_llm, assess_with_socratic_tutor, assess_with_socratic_tutor
from api_schemas import *
from config import load_config

def parse_string_to_object(value):
    """Parse string to Python object, trying JSON first, then ast.literal_eval"""
    if not isinstance(value, str) or not value.strip():
        return value
    try:
        return json.loads(value)
    except (json.JSONDecodeError, ValueError):
        try:
            return ast.literal_eval(value)
        except (ValueError, SyntaxError):
            return value

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger("genreact.backend")

app_config = load_config(config_name="main")
search_rag_manager = SearchRagManager.from_config(app_config)

app = FastAPI()

@app.middleware("http")
async def log_requests(request: Request, call_next):
    logger.info(
        "HTTP %s %s from %s",
        request.method,
        request.url.path,
        request.client.host if request.client else "unknown",
    )
    try:
        response = await call_next(request)
    except Exception as exc:
        logger.exception("Unhandled exception while processing %s %s", request.method, request.url.path)
        raise
    logger.info("Response %s %s -> %s", request.method, request.url.path, response.status_code)
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_origin_regex=None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_llm(model_provider: str | None = None, model_name: str | None = None, **kwargs):
    model_provider = model_provider or "shared"
    model_name = model_name or "qwen-instruct"
    use_shared = kwargs.pop("use_shared_llm", model_provider in {"shared", "gpt-oss", "chatbot"})
    return LLMFactory.create(
        model=model_name,
        model_provider=model_provider,
        use_shared_llm=use_shared,
        **kwargs
    )

UPLOAD_LOCATION = "./uploads/cv/"

@app.get("/list-llm-models")
async def list_llm_models():
    try:
        return {"models": [
            {
                "model_name": app_config.llm.model_name, 
                "model_provider": app_config.llm.provider
            }
        ]}
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})

@app.post("/chat-with-tutor")
async def chat_with_autor(request: ChatWithAutorRequest):
    llm = get_llm(request.model_provider, request.model_name)
    learner_profile = request.learner_profile
    try:
        if isinstance(request.messages, str) and request.messages.strip().startswith("["):
            converted_messages = ast.literal_eval(request.messages)
        else:
            return JSONResponse(status_code=400, content={"detail": "messages must be a JSON array string"})
        response = chat_with_tutor_with_llm(
            llm,
            converted_messages,
            learner_profile,
            search_rag_manager=search_rag_manager,
            use_search=True,
        )
        return {"response": response}
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})

@app.post("/refine-learning-goal")
async def refine_learning_goal(request: LearningGoalRefinementRequest):
    llm = get_llm(request.model_provider, request.model_name)
    try:
        refined_learning_goal = refine_learning_goal_with_llm(llm, request.learning_goal, request.learner_information)
        return refined_learning_goal
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})

@app.post("/identify-skill-gap-with-info")
async def identify_skill_gap_with_info(request: SkillGapIdentificationRequest):
    logger.info(
        "[SkillGapWithInfo] Incoming payload: learning_goal=%s, learner_information=%s, skill_requirements=%s, model_provider=%s, model_name=%s",
        request.learning_goal,
        request.learner_information if len(str(request.learner_information)) < 400 else str(request.learner_information)[:400] + "...",
        request.skill_requirements,
        request.model_provider,
        request.model_name,
    )
    llm = get_llm(request.model_provider, request.model_name)
    learning_goal = request.learning_goal

    if not isinstance(learning_goal, str) or len(learning_goal.strip()) < 5:
        message = "Learning goal is too short or unspecified. Please provide a specific objective (≥5 characters)."
        logger.warning("[SkillGapWithInfo] %s", message)
        return JSONResponse(status_code=400, content={"detail": message})
    
    # learner_information이 문자열이 아닌 경우 문자열로 변환
    if not isinstance(request.learner_information, str):
        learner_information = json.dumps(request.learner_information)
    else:
        learner_information = request.learner_information
        
    skill_requirements = request.skill_requirements
    try:
        if isinstance(skill_requirements, str) and skill_requirements.strip():
            skill_requirements = ast.literal_eval(skill_requirements)
        if not isinstance(skill_requirements, dict):
            skill_requirements = None
        logger.info(
            "[SkillGapWithInfo] Normalized skill_requirements=%s",
            skill_requirements,
        )
        start_time = time.time()
        skill_gaps, skill_requirements = identify_skill_gap_with_llm(
            llm, learning_goal, learner_information, skill_requirements
        )
        elapsed = time.time() - start_time
        if not skill_requirements or not skill_requirements.get("skill_requirements"):
            message = "Unable to derive relevant skills from the provided goal. Please refine the goal with more detail."
            logger.warning("[SkillGapWithInfo] %s", message)
            return JSONResponse(status_code=422, content={"detail": message})
        logger.info(
            "[SkillGapWithInfo] Completed in %.2fs. skill_gaps keys=%s, skill_requirements keys=%s",
            elapsed,
            list(skill_gaps.keys()) if isinstance(skill_gaps, dict) else type(skill_gaps),
            list(skill_requirements.keys()) if isinstance(skill_requirements, dict) else type(skill_requirements),
        )
        results = {**skill_gaps, **skill_requirements}
        return results
    except Exception as e:
        logger.exception("[SkillGapWithInfo] Error: %s", e)
        return JSONResponse(status_code=500, content={"detail": str(e)})


@app.post("/identify-skill-gap")
async def identify_skill_gap(goal: str = Form(...), cv: UploadFile = File(...), model_provider: str = Form("deepseek"), model_name: str = Form("deepseek-chat")):
    llm = get_llm(model_provider, model_name)
    mapper = SkillRequirementMapper(llm)
    skill_gap_identifier = SkillGapIdentifier(llm)
    try:
        file_location = f"{UPLOAD_LOCATION}{cv.filename}"
#         with open(file_location, "wb") as file_object:
#             file_object.write(await cv.read())
        with open(file_location, "wb") as file_object:
            file_object.write(await cv.read())
        # print(file_location)
        cv_text = extract_text_from_pdf(file_location)  
        skill_requirements = mapper.map_goal_to_skill({
            "learning_goal": goal
        })
        skill_gaps = skill_gap_identifier.identify_skill_gap({
            "learning_goal": goal,
            "skill_requirements": skill_requirements,
            "learner_information": cv_text
        })
        results = {**skill_gaps, **skill_requirements}
        return results
    except Exception as e:
        return JSONResponse(status_code=500, content={"detail": str(e)})

@app.post("/create-learner-profile-with-info")
async def create_learner_profile_with_info(request: LearnerProfileInitializationWithInfoRequest):
    llm = get_llm(request.model_provider, request.model_name)
    learner_information = request.learner_information
    learning_goal = request.learning_goal
    skill_gaps = request.skill_gaps
    try:
        if isinstance(learner_information, str):
            try:
                learner_information = ast.literal_eval(learner_information)
            except Exception:
                learner_information = {"raw": learner_information}
        if isinstance(skill_gaps, str):
            try:
                skill_gaps = ast.literal_eval(skill_gaps)
            except Exception:
                skill_gaps = {"raw": skill_gaps}
        learner_profile = initialize_learner_profile_with_llm(
            llm, learning_goal, learner_information, skill_gaps
        )
        return {"learner_profile": learner_profile}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/create-learner-profile")
async def create_learner_profile(request: LearnerProfileInitializationRequest):
    llm = get_llm(request.model_provider, request.model_name)
    file_location = f"{UPLOAD_LOCATION}{request.cv_path}"
    learner_information = extract_text_from_pdf(file_location)
    learning_goal = request.learning_goal
    skill_gaps = request.skill_gaps
    try:
        if isinstance(skill_gaps, str):
            try:
                skill_gaps = ast.literal_eval(skill_gaps)
            except Exception:
                skill_gaps = {"raw": skill_gaps}
        learner_profile = initialize_learner_profile_with_llm(
            llm, learning_goal, {"raw": learner_information}, skill_gaps
        )
        return {"learner_profile": learner_profile}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/update-learner-profile")
async def update_learner_profile(request: LearnerProfileUpdateRequest):
    llm = get_llm(request.model_provider, request.model_name)
    learner_profile = request.learner_profile
    learner_interactions = request.learner_interactions
    learner_information = request.learner_information
    session_information = request.session_information
    try:
        for name in ("learner_profile", "learner_interactions", "learner_information", "session_information"):
            val = locals()[name]
            if isinstance(val, str) and val.strip():
                try:
                    locals()[name] = ast.literal_eval(val)
                except Exception:
                    if name != "session_information":
                        locals()[name] = {"raw": val}
        learner_profile = update_learner_profile_with_llm(
            llm,
            locals()["learner_profile"],
            locals()["learner_interactions"],
            locals()["learner_information"],
            locals()["session_information"],
        )
        return {"learner_profile": learner_profile}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/schedule-learning-path")
async def schedule_learning_path(request: LearningPathSchedulingRequest):
    llm = get_llm(request.model_provider, request.model_name)
    learner_profile = request.learner_profile
    session_count = request.session_count
    try:
        if isinstance(learner_profile, str) and learner_profile.strip():
            learner_profile = ast.literal_eval(learner_profile)
        if not isinstance(learner_profile, dict):
            learner_profile = {}
        learning_path = schedule_learning_path_with_llm(llm, learner_profile, session_count)
        return learning_path
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/reschedule-learning-path")
async def reschedule_learning_path(request: LearningPathReschedulingRequest):
    llm = get_llm(request.model_provider, request.model_name)
    learner_profile = request.learner_profile
    learning_path = request.learning_path
    session_count = request.session_count
    other_feedback = request.other_feedback
    try:
        if isinstance(learner_profile, str) and learner_profile.strip():
            learner_profile = ast.literal_eval(learner_profile)
        if not isinstance(learner_profile, dict):
            learner_profile = {}
        if isinstance(learning_path, str) and learning_path.strip():
            learning_path = ast.literal_eval(learning_path)
        if isinstance(other_feedback, str) and other_feedback.strip():
            try:
                other_feedback = ast.literal_eval(other_feedback)
            except Exception:
                pass
        learning_path = reschedule_learning_path_with_llm(
            llm, learning_path, learner_profile, session_count, other_feedback
        )
        return learning_path
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/explore-knowledge-points")
async def explore_knowledge_points(request: KnowledgePointExplorationRequest):
    llm = get_llm()
    learner_profile = parse_string_to_object(request.learner_profile)
    learning_path = parse_string_to_object(request.learning_path)
    learning_session = parse_string_to_object(request.learning_session)
    try:
        knowledge_points = explore_knowledge_points_with_llm(llm, learner_profile, learning_path, learning_session)
        return knowledge_points
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/draft-knowledge-point")
async def draft_knowledge_point(request: KnowledgePointDraftingRequest):
    llm = get_llm()
    learner_profile = parse_string_to_object(request.learner_profile)
    learning_path = parse_string_to_object(request.learning_path)
    learning_session = parse_string_to_object(request.learning_session)
    knowledge_points = parse_string_to_object(request.knowledge_points)
    knowledge_point = parse_string_to_object(request.knowledge_point)
    use_search = request.use_search
    try:
        knowledge_draft = draft_knowledge_point_with_llm(llm, learner_profile, learning_path, learning_session, knowledge_points, knowledge_point, use_search)
        return {"knowledge_draft": knowledge_draft}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/draft-knowledge-points")
async def draft_knowledge_points(request: KnowledgePointsDraftingRequest):
    llm = get_llm()
    learner_profile = parse_string_to_object(request.learner_profile)
    learning_path = parse_string_to_object(request.learning_path)
    learning_session = parse_string_to_object(request.learning_session)
    knowledge_points = parse_string_to_object(request.knowledge_points)
    use_search = request.use_search
    allow_parallel = request.allow_parallel
    try:
        knowledge_drafts = draft_knowledge_points_with_llm(llm, learner_profile, learning_path, learning_session, knowledge_points, allow_parallel, use_search)
        print(f"[DEBUG] draft_knowledge_points produced {len(knowledge_drafts) if isinstance(knowledge_drafts, list) else 'non-list'} items")
        return {"knowledge_drafts": knowledge_drafts}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/integrate-learning-document")
async def integrate_learning_document(request: LearningDocumentIntegrationRequest):
    llm = get_llm()
    learner_profile = parse_string_to_object(request.learner_profile)
    learning_path = parse_string_to_object(request.learning_path)
    learning_session = parse_string_to_object(request.learning_session)
    knowledge_points = parse_string_to_object(request.knowledge_points)
    knowledge_drafts = parse_string_to_object(request.knowledge_drafts)
    output_markdown = request.output_markdown
    try:
        learning_document = integrate_learning_document_with_llm(llm, learner_profile, learning_path, learning_session, knowledge_points, knowledge_drafts, output_markdown)
        return {"learning_document": learning_document}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/generate-document-quizzes")
async def generate_document_quizzes(request: KnowledgeQuizGenerationRequest):
    llm = get_llm()
    learner_profile = parse_string_to_object(request.learner_profile)
    learning_document = parse_string_to_object(request.learning_document)
    single_choice_count = request.single_choice_count
    multiple_choice_count = request.multiple_choice_count
    true_false_count = request.true_false_count
    short_answer_count = request.short_answer_count
    try:
        document_quiz = generate_document_quizzes_with_llm(llm, learner_profile, learning_document, single_choice_count, multiple_choice_count, true_false_count, short_answer_count)
        return {"document_quiz": document_quiz}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/tailor-knowledge-content")
async def tailor_knowledge_content(request: TailoredContentGenerationRequest):
    llm = get_llm()
    learning_path = request.learning_path
    learner_profile = request.learner_profile
    learning_session = request.learning_session
    use_search = request.use_search
    allow_parallel = request.allow_parallel
    with_quiz = request.with_quiz
    try:
        tailored_content = create_learning_content_with_llm(
            llm, learner_profile, learning_path, learning_session, allow_parallel=allow_parallel, with_quiz=with_quiz, use_search=use_search
        )
        return {"tailored_content": tailored_content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
@app.post("/assess-with-socratic-tutor")
async def assess_with_socratic_tutor_endpoint(request: SocraticTutorRequest):
    try:
        raw_messages = request.messages
        logger.info(
            "[API] /assess-with-socratic-tutor called | topic=%s | provider=%s | model=%s | raw_type=%s",
            request.learning_topic,
            request.model_provider,
            request.model_name,
            type(raw_messages).__name__,
        )
        if isinstance(request.messages, str) and request.messages.strip().startswith("["):
            converted_messages = ast.literal_eval(request.messages)
        else:
            converted_messages = []

        logger.info(
            "[API] Parsed Socratic messages | topic=%s | parsed_len=%s",
            request.learning_topic,
            len(converted_messages),
        )

        response = assess_with_socratic_tutor(
            learning_topic=request.learning_topic,
            messages=converted_messages,
        )
        logger.info("[API] Socratic tutor response ready | topic=%s", request.learning_topic)
        return {"response": response}
    except Exception as e:
        logger.exception("[API] Socratic tutor failure | topic=%s", request.learning_topic)
        return JSONResponse(status_code=500, content={"detail": str(e)})

if __name__ == "__main__":
    server_cfg = app_config.get("server", {})
    host = app_config.get("server", {}).get("host", "127.0.0.1")
    port = int(app_config.get("server", {}).get("port", 5000))
    log_level = str(app_config.get("log_level", "debug")).lower()
    uvicorn.run(app, host=host, port=port, log_level=log_level)
