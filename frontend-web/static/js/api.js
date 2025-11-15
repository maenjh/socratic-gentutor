// API endpoints
const DEFAULT_BASE_URL = window.__GENMENTOR_CONFIG__?.backendBaseUrl ?? 'http://127.0.0.1:5003/';

const shouldLogApi = () => {
    if (typeof window === 'undefined') return false;
    if (window.__GM_API_DEBUG__ === false) return false;
    const stored = window.localStorage?.getItem?.('gm.api.debug');
    if (stored !== null) return stored !== 'false';
    return true;
};

const logApi = (...args) => {
    if (!shouldLogApi()) return;
    console.info('[GM API]', ...args);
};

const summarizeBodyForLog = (body, isFormData = false) => {
    if (!body) return undefined;
    if (isFormData) return '[form-data]';
    if (typeof body === 'string') {
        return body.length > 400 ? `${body.slice(0, 400)}…` : body;
    }
    try {
        const json = JSON.stringify(body);
        return json.length > 400 ? `${json.slice(0, 400)}…` : json;
    } catch (error) {
        return '[unserializable body]';
    }
};

const withNormalizedUrl = (endpoint = '') => {
    const trimmedBase = DEFAULT_BASE_URL.replace(/\/+$/, '');
    const trimmedEndpoint = String(endpoint ?? '').replace(/^\/+/, '');
    return `${trimmedBase}/${trimmedEndpoint}`;
};

export class API {
    static async get(endpoint) {
        const url = withNormalizedUrl(endpoint);
        logApi('GET →', url);
        try {
            const response = await fetch(url);
            logApi('GET ←', url, response.status);
            if (!response.ok) throw new Error('Network response was not ok');
            return await response.json();
        } catch (error) {
            logApi('GET ✖', url, error?.message ?? error);
            console.error('API Get Error:', error);
            throw error;
        }
    }

    static async post(endpoint, data) {
        const url = withNormalizedUrl(endpoint);
        const body = JSON.stringify(data);
        logApi('POST →', url, summarizeBodyForLog(body));
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body,
            });
            logApi('POST ←', url, response.status);
            if (!response.ok) throw new Error('Network response was not ok');
            return await response.json();
        } catch (error) {
            logApi('POST ✖', url, error?.message ?? error);
            console.error('API Post Error:', error);
            throw error;
        }
    }

    static async postFormData(endpoint, formData) {
        const url = withNormalizedUrl(endpoint);
        logApi('POST (form) →', url, summarizeBodyForLog(null, true));
        try {
            const response = await fetch(url, {
                method: 'POST',
                body: formData,
            });
            logApi('POST (form) ←', url, response.status);
            if (!response.ok) throw new Error('Network response was not ok');
            return await response.json();
        } catch (error) {
            logApi('POST (form) ✖', url, error?.message ?? error);
            console.error('API Post FormData Error:', error);
            throw error;
        }
    }

    // LLM Models
    static async listLLMModels() {
        return await this.get('/list-llm-models');
    }

    // Chat with Tutor
    static async chatWithTutor(messages, learnerProfile, modelProvider = 'gpt-oss', modelName = 'gpt-oss-120b') {
        return await this.post('/chat-with-tutor', {
            messages: JSON.stringify(messages),
            learner_profile: learnerProfile,
            model_provider: modelProvider,
            model_name: modelName
        });
    }

    // Learning Goal Refinement
    static async refineLearningGoal(learningGoal, learnerInformation, modelProvider = 'shared', modelName = 'qwen-instruct') {
        return await this.post('/refine-learning-goal', {
            learning_goal: learningGoal,
            learner_information: learnerInformation,
            model_provider: modelProvider,
            model_name: modelName
        });
    }

    // Skill Gap Identification
    static async identifySkillGapWithInfo(learningGoal, learnerInformation, skillRequirements = null, modelProvider = 'shared', modelName = 'qwen-instruct') {
        return await this.post('/identify-skill-gap-with-info', {
            learning_goal: learningGoal,
            learner_information: JSON.stringify(learnerInformation ?? {}),
            skill_requirements: skillRequirements,
            model_provider: modelProvider,
            model_name: modelName
        });
    }

    static async identifySkillGap(goal, cvFile, modelProvider = 'shared', modelName = 'qwen-instruct') {
        const formData = new FormData();
        formData.append('goal', goal);
        formData.append('cv', cvFile);
        formData.append('model_provider', modelProvider);
        formData.append('model_name', modelName);
        return await this.postFormData('/identify-skill-gap', formData);
    }

    // Learner Profile Management
    static async createLearnerProfileWithInfo(learnerInformation, learningGoal, skillGaps, modelProvider = 'shared', modelName = 'qwen-instruct') {
        return await this.post('/create-learner-profile-with-info', {
            learner_information: JSON.stringify(learnerInformation ?? {}),
            learning_goal: learningGoal,
            skill_gaps: JSON.stringify(skillGaps ?? []),
            model_provider: modelProvider,
            model_name: modelName
        });
    }

    static async createLearnerProfile(cvPath, learningGoal, skillGaps, modelProvider = 'shared', modelName = 'qwen-instruct') {
        return await this.post('/create-learner-profile', {
            cv_path: cvPath,
            learning_goal: learningGoal,
            skill_gaps: JSON.stringify(skillGaps ?? []),
            model_provider: modelProvider,
            model_name: modelName
        });
    }

    static async updateLearnerProfile(learnerProfile, learnerInteractions, learnerInformation, sessionInformation, modelProvider = 'shared', modelName = 'qwen-instruct') {
        return await this.post('/update-learner-profile', {
            learner_profile: learnerProfile,
            learner_interactions: learnerInteractions,
            learner_information: learnerInformation,
            session_information: sessionInformation,
            model_provider: modelProvider,
            model_name: modelName
        });
    }

    // Learning Path Management
    static async scheduleLearningPath(learnerProfile, sessionCount, modelProvider = 'shared', modelName = 'qwen-instruct') {
        return await this.post('/schedule-learning-path', {
            learner_profile: learnerProfile,
            session_count: sessionCount,
            model_provider: modelProvider,
            model_name: modelName
        });
    }

    static async rescheduleLearningPath(learnerProfile, learningPath, sessionCount, otherFeedback = null, modelProvider = 'shared', modelName = 'qwen-instruct') {
        return await this.post('/reschedule-learning-path', {
            learner_profile: learnerProfile,
            learning_path: learningPath,
            session_count: sessionCount,
            other_feedback: otherFeedback,
            model_provider: modelProvider,
            model_name: modelName
        });
    }

    // Knowledge Points Management
    static async exploreKnowledgePoints(learnerProfile, learningPath, learningSession) {
        return await this.post('/explore-knowledge-points', {
            learner_profile: learnerProfile,
            learning_path: learningPath,
            learning_session: learningSession
        });
    }

    static async draftKnowledgePoint(learnerProfile, learningPath, learningSession, knowledgePoints, knowledgePoint, useSearch = true) {
        return await this.post('/draft-knowledge-point', {
            learner_profile: learnerProfile,
            learning_path: learningPath,
            learning_session: learningSession,
            knowledge_points: knowledgePoints,
            knowledge_point: knowledgePoint,
            use_search: useSearch
        });
    }

    static async draftKnowledgePoints(learnerProfile, learningPath, learningSession, knowledgePoints, useSearch = true, allowParallel = true) {
        return await this.post('/draft-knowledge-points', {
            learner_profile: learnerProfile,
            learning_path: learningPath,
            learning_session: learningSession,
            knowledge_points: knowledgePoints,
            use_search: useSearch,
            allow_parallel: allowParallel
        });
    }

    // Learning Document Management
    static async integrateLearningDocument(learnerProfile, learningPath, learningSession, knowledgePoints, knowledgeDrafts, outputMarkdown = true) {
        return await this.post('/integrate-learning-document', {
            learner_profile: learnerProfile,
            learning_path: learningPath,
            learning_session: learningSession,
            knowledge_points: knowledgePoints,
            knowledge_drafts: knowledgeDrafts,
            output_markdown: outputMarkdown
        });
    }

    static async generateDocumentQuizzes(learnerProfile, learningDocument, singleChoiceCount = 2, multipleChoiceCount = 2, trueFalseCount = 2, shortAnswerCount = 2) {
        return await this.post('/generate-document-quizzes', {
            learner_profile: learnerProfile,
            learning_document: learningDocument,
            single_choice_count: singleChoiceCount,
            multiple_choice_count: multipleChoiceCount,
            true_false_count: trueFalseCount,
            short_answer_count: shortAnswerCount
        });
    }

    // Content Generation
    static async tailorKnowledgeContent(learningPath, learnerProfile, learningSession, useSearch = true, allowParallel = true, withQuiz = true, modelProvider = 'shared', modelName = 'qwen-instruct') {
        return await this.post('/tailor-knowledge-content', {
            learning_path: learningPath,
            learner_profile: learnerProfile,
            learning_session: learningSession,
            use_search: useSearch,
            allow_parallel: allowParallel,
            with_quiz: withQuiz,
            model_provider: modelProvider,
            model_name: modelName
        });
    }

    // Socratic Tutor
    static async assessWithSocraticTutor(learningTopic, messages, modelProvider = 'gpt-oss', modelName = 'gpt-oss-120b') {
        return await this.post('/assess-with-socratic-tutor', {
            learning_topic: learningTopic,
            messages: JSON.stringify(messages),
            model_provider: modelProvider,
            model_name: modelName
        });
    }
}

// Provide a simpler `api` object with convenient methods for the frontend code
export const api = {
    get: API.get.bind(API),
    post: API.post.bind(API),
    postFormData: API.postFormData.bind(API),
    chatWithTutor: API.chatWithTutor.bind(API),
    getLearningPath: () => API.get('/learning-path'),
    getSkillGaps: () => API.get('/skill-gaps'),
    getKnowledgeDocuments: () => API.get('/knowledge-documents'),
    getAgentStatus: () => API.get('/agent-status'),
    getAnalytics: () => API.get('/analytics'),
    getGoals: () => API.get('/goals'),
    getLearnerProfile: () => API.get('/learner-profile'),
    updateLearnerProfile: (data) => API.post('/learner-profile', data)
};

// Backwards-compat: some legacy page scripts expect a global `API` object
window.API = {
    get: api.get,
    post: api.post,
    postFormData: api.postFormData,
    getProfile: api.getLearnerProfile,
    updateProfile: api.updateLearnerProfile
};