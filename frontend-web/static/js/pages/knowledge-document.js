import { API } from '../api.js';
import { state as appState } from '../state.js';
import { router } from '../router.js';

const MODEL_PROVIDER = 'shared';
const MODEL_NAME = 'qwen-instruct';
const CHAT_MODEL_PROVIDER = 'gpt-oss';
const CHAT_MODEL_NAME = 'gpt-oss-120b';
const MOTIVATION_INTERVAL_MS = 180000; // 3 minutes
const MAX_ASSESSMENT_QUESTIONS = 3;
const PREPARATION_STAGES = [
    {
        id: 1,
        icon: '🔍',
        title: 'Stage 1/4',
        description: 'Exploring knowledge points...',
        agent: 'Knowledge Explorer Agent',
        summary: 'Scanning the knowledge base for the most relevant concepts.'
    },
    {
        id: 2,
        icon: '📝',
        title: 'Stage 2/4',
        description: 'Drafting knowledge points...',
        agent: 'Knowledge Drafter Agent',
        summary: 'Structuring detailed explanations tailored to your goal.'
    },
    {
        id: 3,
        icon: '📚',
        title: 'Stage 3/4',
        description: 'Integrating knowledge document...',
        agent: 'Learning Document Integrator Agent',
        summary: 'Weaving drafts into a cohesive, story-driven learning guide.'
    },
    {
        id: 4,
        icon: '🎯',
        title: 'Stage 4/4',
        description: 'Generating document quizzes...',
        agent: 'Quiz Architect Agent',
        summary: 'Designing mastery checks that reinforce each concept.'
    }
];

class KnowledgeDocumentPage {
    constructor() {
        this.container = null;

        this.goal = null;
        this.session = null;
        this.sessionIndex = 0;
        this.sessionUid = null;

        this.learningContent = null;
        this.learningDocument = '';
        this.knowledgePoints = [];
        this.knowledgeDrafts = [];
        this.quizzesRaw = {};

        this.sectionList = [];
        this.currentSectionIndex = 0;
        this.showQuizzes = false;

        this.quizItems = [];
        this.quizState = {};

        this.loadingStage = null;
        this.isGenerating = false;
        this.error = null;

        this.sidebarTab = 'tutor';
        this.tutorMessages = [];
        this.assessmentState = this._getEmptyAssessmentState();

        this.feedbackDraft = {
            clarity: '',
            relevance: '',
            depth: '',
            engagement: '',
            comments: '',
        };

        this.motivationTimer = null;
        this.sessionLearningMeta = null;
        this.toastMessages = [];
        this.loadingProgress = {
            current: 0,
            completed: new Set(),
        };

        this.assessmentBootstrapped = false;
    }

    async initialize() {
        this._hydrateState();
        await this._ensureAssessmentBootstrap();
        if (this.learningContent) {
            this._prepareDocumentArtifacts();
            this._ensureSessionLearningMeta();
        }
    }

    render(container) {
        if (!container) return;
        this.container = container;

        if (this.error) {
            container.innerHTML = this._renderErrorState();
            this._bindErrorActions();
            return;
        }

        if (!this.goal) {
            container.innerHTML = this._renderMissingGoal();
            this._bindMissingGoalActions();
            return;
        }

        if (!this.session) {
            container.innerHTML = this._renderMissingSession();
            this._bindMissingSessionActions();
            return;
        }

        if (!this.learningContent) {
            if (!this.isGenerating) {
                this._prepareLearningContent();
            }
            container.innerHTML = this._renderPreparation();
            return;
        }

        this._ensureSessionLearningMeta();
        this._setupMotivationTimer();

        container.innerHTML = this._renderExperience();
        this._bindExperienceEvents();
    }

    /* ------------------------------------------------------------------ */
    /* State Hydration / Persistence                                       */
    /* ------------------------------------------------------------------ */

    _hydrateState() {
        const snapshot = appState.getState();
        const goals = Array.isArray(snapshot.goals) ? snapshot.goals : [];
        let selectedGoalId = snapshot.selectedGoalId;

        if (!selectedGoalId && goals.length) {
            selectedGoalId = goals[0].id;
            appState.setState({ selectedGoalId });
        }

        this.goal = goals.find((goal) => goal.id === selectedGoalId) || null;

        const totalSessions = Array.isArray(this.goal?.learningPath) ? this.goal.learningPath.length : 0;
        let sessionIndex = typeof snapshot.selectedSessionIndex === 'number' ? snapshot.selectedSessionIndex : 0;
        if (sessionIndex < 0) sessionIndex = 0;
        if (sessionIndex >= totalSessions) sessionIndex = Math.max(totalSessions - 1, 0);

        this.sessionIndex = sessionIndex;
        this.session = this.goal?.learningPath?.[sessionIndex] || null;

        this.sessionUid = this.goal && this.session
            ? `${this.goal.id}::${this.session.id || sessionIndex}`
            : null;

        const documentCaches = snapshot.documentCaches || {};
        this.learningContent = this.sessionUid ? documentCaches[this.sessionUid] || null : null;

        const knowledgeState = snapshot.knowledgeSessionState || {};
        const sessionState = this.sessionUid ? { ...(knowledgeState[this.sessionUid] || {}) } : {};

        this.currentSectionIndex = typeof sessionState.currentSectionIndex === 'number'
            ? sessionState.currentSectionIndex
            : 0;
        this.showQuizzes = Boolean(sessionState.showQuizzes);
        this.sidebarTab = sessionState.sidebarTab || 'tutor';

        this.quizState = sessionState.quizState || {};
        this.tutorMessages = Array.isArray(sessionState.tutorMessages) ? sessionState.tutorMessages : [];
        this.assessmentState = this._getEmptyAssessmentState(sessionState.assessmentState);

        this.feedbackDraft = sessionState.feedbackDraft || { ...this.feedbackDraft };
        this.toastMessages = Array.isArray(sessionState.toastMessages) ? sessionState.toastMessages : [];

        const sessionLearningTimes = snapshot.sessionLearningTimes || {};
        this.sessionLearningMeta = this.sessionUid ? sessionLearningTimes[this.sessionUid] || null : null;
    }

    async _ensureAssessmentBootstrap() {
        if (this.assessmentBootstrapped) return;
        const hasMessages = Array.isArray(this.assessmentState?.messages) && this.assessmentState.messages.length > 0;
        if (this.assessmentState?.topic || hasMessages) {
            this.assessmentBootstrapped = true;
            return;
        }

        const topics = this._getAssessmentSessions();
        if (!Array.isArray(topics) || topics.length === 0) {
            this.assessmentBootstrapped = true;
            return;
        }

        this.assessmentBootstrapped = true;
        try {
            await this._selectAssessmentTopic(topics[0].value);
        } catch (error) {
            console.warn('[KnowledgeDocument] Failed to auto-start Socratic assessment', error);
            this.assessmentBootstrapped = false;
        }
    }

    _persistKnowledgeState(updates = {}) {
        if (!this.sessionUid) return;
        const snapshot = appState.getState();
        const knowledgeState = snapshot.knowledgeSessionState || {};
        const sessionState = { ...(knowledgeState[this.sessionUid] || {}) };

        const merged = { ...sessionState, ...updates };

        appState.setState({
            knowledgeSessionState: {
                ...knowledgeState,
                [this.sessionUid]: merged,
            },
        });
    }

    _persistDocumentCache(content) {
        if (!this.sessionUid) return;
        const snapshot = appState.getState();
        const caches = snapshot.documentCaches || {};

        appState.setState({
            documentCaches: {
                ...caches,
                [this.sessionUid]: content,
            },
        });
    }

    _persistSessionLearningMeta(meta) {
        if (!this.sessionUid) return;
        const snapshot = appState.getState();
        const metaMap = snapshot.sessionLearningTimes || {};

        appState.setState({
            sessionLearningTimes: {
                ...metaMap,
                [this.sessionUid]: meta,
            },
        });
    }

    /* ------------------------------------------------------------------ */
    /* Content Preparation                                                 */
    /* ------------------------------------------------------------------ */

    async _prepareLearningContent() {
        if (!this.goal || !this.session || this.isGenerating) return;

        this.isGenerating = true;
        this.error = null;
        this.loadingStage = { step: 1, total: PREPARATION_STAGES.length, label: PREPARATION_STAGES[0].description, log: [] };
        this.loadingProgress = {
            current: 1,
            completed: new Set(),
        };
        this.render(this.container);

        const learnerProfile = this.goal.learnerProfile || {};
        const learningPath = this._getLearningPathPayload();
        const learningSession = this._getLearningSessionPayload();

        try {
            this._updateStage(1, 'Stage 1/4 - Exploring knowledge points...');
            const explore = await API.exploreKnowledgePoints(
                this._ensureJsonString(learnerProfile),
                this._ensureJsonString(learningPath),
                this._ensureJsonString(learningSession)
            );
            this.knowledgePoints = this._normalizeKnowledgePoints(explore);
            if (!Array.isArray(this.knowledgePoints) || !this.knowledgePoints.length) {
                throw new Error('Failed to explore knowledge points.');
            }

            this._updateStage(2, 'Stage 2/4 - Drafting knowledge points...');
            const drafts = await API.draftKnowledgePoints(
                this._ensureJsonString(learnerProfile),
                this._ensureJsonString(learningPath),
                this._ensureJsonString(learningSession),
                this._ensureJsonString(this.knowledgePoints),
                true,
                true
            );
            this.knowledgeDrafts = this._normalizeKnowledgeDrafts(drafts);
            if (!Array.isArray(this.knowledgeDrafts) || !this.knowledgeDrafts.length) {
                throw new Error('Failed to draft knowledge points.');
            }

            this._updateStage(3, 'Stage 3/4 - Integrating knowledge document...');
            const integrated = await API.integrateLearningDocument(
                this._ensureJsonString(learnerProfile),
                this._ensureJsonString(learningPath),
                this._ensureJsonString(learningSession),
                this._ensureJsonString(this.knowledgePoints),
                this._ensureJsonString(this.knowledgeDrafts),
                true
            );
            this.learningDocument = this._normalizeLearningDocument(integrated);
            if (!this.learningDocument) {
                throw new Error('Learning document integration returned empty content.');
            }

            this._updateStage(4, 'Stage 4/4 - Generating document quizzes...');
            const quizzes = await API.generateDocumentQuizzes(
                this._ensureJsonString(learnerProfile),
                this.learningDocument,
                3,
                1,
                1,
                1
            );
            this.quizzesRaw = this._normalizeQuizPayload(quizzes);

            this.learningContent = {
                document: this.learningDocument,
                knowledgePoints: this.knowledgePoints,
                knowledgeDrafts: this.knowledgeDrafts,
                quizzes: this.quizzesRaw,
                generatedAt: new Date().toISOString(),
            };

            this._persistDocumentCache(this.learningContent);
            this._prepareDocumentArtifacts();
            this.showQuizzes = this.sectionList.length <= 1;
            this._persistKnowledgeState({
                currentSectionIndex: this.currentSectionIndex,
                showQuizzes: this.showQuizzes,
                quizState: this.quizState,
            });
        } catch (error) {
            console.error('[KnowledgeDocument] Failed to prepare learning content', error);
            this.error = error;
        } finally {
            this.isGenerating = false;
            this.loadingStage = null;
            this.render(this.container);
        }
    }

    _updateStage(step, label) {
        const total = PREPARATION_STAGES.length;
        const completed = new Set(this.loadingProgress?.completed || []);
        if (step > 1) {
            completed.add(step - 1);
        }
        this.loadingProgress = {
            current: step,
            completed,
        };
        this.loadingStage = {
            step,
            total,
            label,
            log: [...(this.loadingStage?.log || []), label],
        };
        if (this.container) {
            this.container.innerHTML = this._renderPreparation();
        }
    }

    _prepareDocumentArtifacts() {
        this.learningDocument = this._extractDocumentString(this.learningContent?.document);
        this.knowledgePoints = Array.isArray(this.learningContent?.knowledgePoints)
            ? this.learningContent.knowledgePoints
            : [];
        this.knowledgeDrafts = Array.isArray(this.learningContent?.knowledgeDrafts)
            ? this.learningContent.knowledgeDrafts
            : [];
        this.quizzesRaw = this.learningContent?.quizzes || {};

        this.sectionList = this._sliceDocumentSections(this.learningDocument);
        if (!this.sectionList.length) {
            this.sectionList = [{
                title: this.session?.title || 'Session Document',
                content: this.learningDocument,
                anchor: 'session-document',
            }];
        }

        if (this.currentSectionIndex >= this.sectionList.length) {
            this.currentSectionIndex = this.sectionList.length - 1;
        }
        if (this.currentSectionIndex < 0) {
            this.currentSectionIndex = 0;
        }

        this.quizItems = this._normalizeQuizItems(this.quizzesRaw);

        // Initialize quiz state defaults
        const restoredQuizState = {};
        this.quizItems.forEach((item) => {
            const stored = this.quizState[item.id] || {};
            restoredQuizState[item.id] = {
                type: item.type,
                status: stored.status || 'unanswered',
                selected: stored.selected != null
                    ? stored.selected
                    : (item.type === 'multiple_choice' ? [] : null),
                coach: {
                    messages: stored.coach?.messages || [],
                    active: Boolean(stored.coach?.active),
                    exchanges: stored.coach?.exchanges || 0,
                    incorrectCount: stored.coach?.incorrectCount || 0,
                    completed: Boolean(stored.coach?.completed),
                },
            };
        });
        this.quizState = restoredQuizState;
    }

    _ensureSessionLearningMeta() {
        if (!this.sessionUid) return;

        if (this.sessionLearningMeta) return;

        const now = Date.now();
        this.sessionLearningMeta = {
            startTime: now,
            lastTriggerTime: now,
            triggerHistory: [now],
        };
        this._persistSessionLearningMeta(this.sessionLearningMeta);
    }

    _setupMotivationTimer() {
        if (this.motivationTimer || !this.sessionUid) return;
        this.motivationTimer = setInterval(() => {
            this._maybeTriggerMotivation();
        }, MOTIVATION_INTERVAL_MS);
    }

    _maybeTriggerMotivation() {
        if (!this.sessionLearningMeta) return;

        const now = Date.now();
        if (now - this.sessionLearningMeta.lastTriggerTime < MOTIVATION_INTERVAL_MS) {
            return;
        }

        const nextMessage =
            this.sessionLearningMeta.triggerHistory.length % 2 === 0
                ? '🌟 Stay hydrated and keep a healthy posture.'
                : '🚀 Keep up the great work!';

        this.sessionLearningMeta = {
            ...this.sessionLearningMeta,
            lastTriggerTime: now,
            triggerHistory: [...this.sessionLearningMeta.triggerHistory, now],
        };
        this.toastMessages = [...this.toastMessages.slice(-2), nextMessage];
        this._persistSessionLearningMeta(this.sessionLearningMeta);
        this._persistKnowledgeState({ toastMessages: this.toastMessages });

        if (this.container) {
            const toastStack = this.container.querySelector('.kd-toast-stack');
            if (toastStack) {
                toastStack.innerHTML = this.toastMessages
                    .map((msg) => `<div class="kd-toast">${this._escapeHtml(msg)}</div>`)
                    .join('');
            }
        }
    }

    /* ------------------------------------------------------------------ */
    /* Rendering                                                           */
    /* ------------------------------------------------------------------ */

    _renderErrorState() {
        const message = this.error?.message || 'Failed to prepare knowledge document.';
        return `
            <div class="kd-shell">
                <div class="kd-error-card">
                    <h1>Unable to prepare learning content</h1>
                    <p>${this._escapeHtml(message)}</p>
                    <div class="kd-error-actions">
                        <button class="button secondary" data-action="retry-generation">Retry</button>
                        <button class="button ghost" data-action="go-back-learning-path">Back to Learning Path</button>
                    </div>
                </div>
            </div>
        `;
    }

    _renderMissingGoal() {
            return `
            <div class="kd-shell">
                <div class="kd-empty-card">
                    <h1>No active learning goal</h1>
                    <p>Complete onboarding and skill gap analysis to generate a learning path.</p>
                    <button class="button primary" data-action="go-to-onboarding">Start Onboarding</button>
                    </div>
                </div>
            `;
        }

    _renderMissingSession() {
        return `
            <div class="kd-shell">
                <div class="kd-empty-card">
                    <h1>No session selected</h1>
                    <p>Select a session from your learning path to resume learning.</p>
                    <button class="button primary" data-action="go-to-learning-path">View Learning Path</button>
                        </div>
            </div>
        `;
    }

    _renderPreparation() {
        const step = this.loadingStage?.step || 1;
        const total = PREPARATION_STAGES.length;
        const label = this.loadingStage?.label || 'Preparing learning materials...';
        const progress = Math.round((step / total) * 100);

        const statusLabel = (status) => {
            if (status === 'completed') return 'Completed';
            if (status === 'active') return 'In progress…';
            return 'Queued';
        };

        const statusIcon = (status) => {
            if (status === 'completed') return '✅';
            if (status === 'active') return '⚡️';
            return '🕒';
        };

        const legend = [
            { icon: '🧠', label: 'Agent coordination' },
            { icon: '⚙️', label: 'LLM + Retrieval pipelines' },
            { icon: '✅', label: 'Auto-quality checks' },
        ];

        return `
            <div class="kd-shell">
                <section class="kd-card kd-preparation">
                    <header class="kd-preparation-header">
                        <div>
                            <h1>Preparing your learning materials</h1>
                            <p>${this._escapeHtml(label)}</p>
                        </div>
                        <span class="kd-preparation-count">${step}/${total} agents active</span>
                    </header>
                    <div class="kd-preparation-progress">
                        <div class="kd-progress-bar">
                            <div class="kd-progress-value" style="width:${progress}%;"></div>
                            <div class="kd-progress-glow" style="width:${progress}%;"></div>
                        </div>
                        <p>Hang tight! Our multi-agent pipeline is orchestrating your session in real time.</p>
                    </div>
                    <div class="kd-preparation-legend">
                        ${legend
                            .map(
                                (item) => `
                                    <span class="kd-preparation-pill">
                                        <span class="kd-preparation-pill__emoji">${this._escapeHtml(item.icon)}</span>
                                        ${this._escapeHtml(item.label)}
                                </span>
                                `
                            )
                            .join('')}
                    </div>
                    <div class="kd-preparation-grid">
                        ${PREPARATION_STAGES.map((stage) => {
                            const status = this._determineStageStatus(stage.id);
                            const stageClass = `kd-prep-agent--stage-${stage.id}`;
                            const connectors = this._renderStageConnectors(stage.id);
                            return `
                                <article class="kd-prep-agent kd-prep-agent--${status} ${stageClass}">
                                    ${connectors}
                                    <header>
                                        <h3>${this._escapeHtml(stage.title)}</h3>
                                    </header>
                                    <div class="kd-prep-agent__meta">
                                        <span class="kd-prep-agent__badge">${this._escapeHtml(stage.agent)}</span>
                                        <p>${this._escapeHtml(stage.summary)}</p>
                                    </div>
                                    <footer>
                                        <div class="kd-prep-agent__status-group">
                                            ${status === 'active' ? '<span class="kd-prep-agent__pulse"></span>' : ''}
                                            <span class="kd-prep-agent__status">
                                                ${statusIcon(status)} ${statusLabel(status)}
                                </span>
                            </div>
                                    </footer>
                                </article>
                            `;
                        }).join('')}
                        </div>
                </section>
                        </div>
            `;
        }

    _determineStageStatus(stageId) {
        if (this.loadingProgress?.completed?.has(stageId)) {
            return 'completed';
        }
        if (this.loadingProgress?.current === stageId) {
            return 'active';
        }
        return 'pending';
    }

    _renderStageConnectors(stageId) {
        const connectorMap = {
            1: ['down-left', 'down-right'],
            2: ['down-right'],
            3: ['down-left'],
        };
        const directions = connectorMap[stageId] || [];
        return directions
            .map((direction) => `<span class="kd-prep-connector kd-prep-connector--${direction}"></span>`)
            .join('');
    }

    _renderExperience() {
        const section = this.sectionList[this.currentSectionIndex];
        const showQuizzes = this.showQuizzes || this.currentSectionIndex >= this.sectionList.length - 1;
        const sessionTitle = this.session?.title || `Session ${this.sessionIndex + 1}`;

        const toastMarkup = this.toastMessages
            .map((msg) => `<div class="kd-toast">${this._escapeHtml(msg)}</div>`)
            .join('');

        return `
            <div class="kd-shell">
                <div class="kd-header">
                    <div class="kd-header-left">
                        <button class="button ghost" data-action="go-back-learning-path">← Learning Path</button>
                        <div>
                            <h1>${this._escapeHtml(sessionTitle)}</h1>
                            <p>${this._escapeHtml(this.session?.abstract || '')}</p>
                    </div>
                            </div>
                    <div class="kd-header-actions">
                        <button class="button ghost" data-action="regenerate-content">Regenerate</button>
                        <button class="button primary" data-action="complete-session">Complete Session</button>
                        </div>
                        </div>

                <div class="kd-toast-stack">
                    ${toastMarkup}
                    </div>

                <div class="kd-body">
                    <div class="kd-content">
                        ${this._renderKnowledgeHighlights()}
                        ${this._renderDocumentSection(section)}
                        ${showQuizzes ? this._renderQuizSection() : this._renderQuizLock()}
                        ${this._renderFeedbackSection()}
                    </div>
                    <aside class="kd-sidebar">
                        ${this._renderSidebar()}
                    </aside>
                </div>
            </div>
        `;
    }

    _renderDocumentSection(section) {
        const toc = this.sectionList
            .map((item, index) => `
                <button
                    class="kd-toc-item ${index === this.currentSectionIndex ? 'active' : ''}"
                    data-action="goto-section"
                    data-index="${index}"
                >
                    ${index + 1}. ${this._escapeHtml(item.title)}
                </button>
            `)
            .join('');

        const navigationControls = `
            <div class="kd-doc-nav">
                <button class="button outline" data-action="prev-section" ${this.currentSectionIndex <= 0 ? 'disabled' : ''}>
                    ← Previous
                </button>
                <div class="kd-doc-progress">
                    Section ${this.currentSectionIndex + 1} of ${this.sectionList.length}
                </div>
                <button class="button outline" data-action="next-section" ${this.currentSectionIndex >= this.sectionList.length - 1 ? 'disabled' : ''}>
                    Next →
                </button>
            </div>
        `;

        const contentHtml = this._renderMarkdown(section?.content || '');

            return `
            <section class="kd-card kd-document-card">
                <div class="kd-card-header">
                    <div>
                        <h2>Session Knowledge Document</h2>
                        <p>Dive into the curated content prepared for this session. Navigate through sections or jump using the table of contents.</p>
                </div>
                    <div class="kd-doc-meta">
                        <span>${this._escapeHtml(new Date(this.learningContent?.generatedAt || Date.now()).toLocaleString())}</span>
                    </div>
                </div>
                <div class="kd-doc-layout">
                    <nav class="kd-toc">
                        ${toc}
                    </nav>
                    <article class="kd-doc-content">
                        ${contentHtml}
                        ${navigationControls}
                    </article>
                </div>
            </section>
        `;
    }

    _renderQuizLock() {
        const remainingSections = Math.max(this.sectionList.length - this.currentSectionIndex - 1, 0);
        return `
            <section class="kd-card kd-lock-card">
                <h2>Quizzes will unlock soon</h2>
                <p>Complete the remaining ${remainingSections} section${remainingSections === 1 ? '' : 's'} to access tailored quizzes for this session.</p>
                <button class="button primary" data-action="next-section">Continue Reading</button>
                <button class="button ghost" data-action="unlock-quizzes">Unlock Quizzes Now</button>
            </section>
        `;
    }

    _renderQuizSection() {
        if (!this.quizItems.length) {
            return `
                <section class="kd-card kd-quiz-card">
                    <h2>Quiz is still loading</h2>
                    <p>We could not find any quiz questions. Try regenerating the content.</p>
                    <button class="button ghost" data-action="regenerate-content">Regenerate</button>
                </section>
            `;
        }

        const cards = this.quizItems.map((item, index) => this._renderQuizCard(item, index)).join('');

        return `
            <section class="kd-card kd-quiz-card">
                <div class="kd-card-header">
                    <div>
                        <h2>Test Your Knowledge</h2>
                        <p>Answer the questions below and engage with the Socratic coach to deepen your understanding.</p>
                    </div>
                    <button class="button ghost" data-action="reset-quiz">Reset Quiz</button>
                </div>
                <div class="kd-quiz-grid">
                    ${cards}
                </div>
            </section>
        `;
    }

    _renderQuizCard(item, displayIndex) {
        const state = this.quizState[item.id] || {
            status: 'unanswered',
            selected: item.type === 'multiple_choice' ? [] : null,
            coach: {
                messages: [],
                active: false,
                exchanges: 0,
                incorrectCount: 0,
                completed: false,
            },
        };

        const statusClass = state.status === 'correct'
            ? 'kd-quiz-card--correct'
            : state.status === 'incorrect'
                ? 'kd-quiz-card--incorrect'
                : '';

        const questionHeader = `
            <header class="kd-quiz-question-header">
                <span class="kd-quiz-index">${displayIndex + 1}.</span>
                <h3>${this._escapeHtml(item.question)}</h3>
            </header>
        `;

        let body = '';
        if (item.type === 'single_choice') {
            const options = item.options || [];
            body = `
                <div class="kd-quiz-options kd-quiz-options--single">
                    ${options
                        .map((option, idx) => `
                            <label class="kd-quiz-option">
                                <input
                                    type="radio"
                                    name="quiz-${item.id}"
                                    value="${this._escapeHtml(option)}"
                                    data-action="answer-single"
                                    data-question-id="${item.id}"
                                    data-option-index="${idx}"
                                    ${state.selected === idx ? 'checked' : ''}
                                >
                                <span>${this._escapeHtml(option)}</span>
                            </label>
                        `)
                        .join('')}
                </div>
            `;
        } else if (item.type === 'multiple_choice') {
            const options = item.options || [];
            const selected = Array.isArray(state.selected) ? state.selected : [];
            body = `
                <div class="kd-quiz-options kd-quiz-options--multi">
                    ${options
                        .map((option, idx) => `
                            <label class="kd-quiz-option">
                                <input
                                    type="checkbox"
                                    value="${this._escapeHtml(option)}"
                                    data-action="toggle-multi"
                                    data-question-id="${item.id}"
                                    data-option-index="${idx}"
                                    ${selected.includes(idx) ? 'checked' : ''}
                                >
                                <span>${this._escapeHtml(option)}</span>
                            </label>
                        `)
                        .join('')}
                </div>
                <button class="button outline kd-quiz-submit" data-action="submit-multi" data-question-id="${item.id}">
                    Submit Answer
                        </button>
            `;
        } else if (item.type === 'true_false') {
            const selected = typeof state.selected === 'boolean' ? state.selected : null;
            body = `
                <div class="kd-quiz-options kd-quiz-options--tf">
                    <label class="kd-quiz-option">
                        <input
                            type="radio"
                            name="quiz-${item.id}"
                            value="true"
                            data-action="answer-tf"
                            data-question-id="${item.id}"
                            ${selected === true ? 'checked' : ''}
                        >
                        <span>True</span>
                    </label>
                    <label class="kd-quiz-option">
                        <input
                            type="radio"
                            name="quiz-${item.id}"
                            value="false"
                            data-action="answer-tf"
                            data-question-id="${item.id}"
                            ${selected === false ? 'checked' : ''}
                        >
                        <span>False</span>
                    </label>
                    </div>
            `;
        } else if (item.type === 'short_answer') {
            body = `
                <div class="kd-quiz-short-answer">
                    <textarea
                        data-action="input-short-answer"
                        data-question-id="${item.id}"
                        placeholder="Type your answer here..."
                    >${state.selected ? this._escapeHtml(state.selected) : ''}</textarea>
                    <button class="button outline" data-action="submit-short-answer" data-question-id="${item.id}">
                        Submit Answer
                    </button>
                </div>
            `;
        }

        let explanation = '';
        if (state.status !== 'unanswered') {
            explanation = `
                <div class="kd-quiz-explanation">
                    <p class="${state.status === 'correct' ? 'correct' : 'incorrect'}">
                        ${state.status === 'correct' ? '✅ Correct!' : '❌ Not quite. Try engaging with the coach below.'}
                    </p>
                    ${item.explanation ? `<details open><summary>Explanation</summary><p>${this._escapeHtml(item.explanation)}</p></details>` : ''}
                </div>
            `;
        }

        const coach = this._renderCoachPanel(item, state);

        return `
            <article class="kd-quiz-item ${statusClass}" data-question="${item.id}">
                ${questionHeader}
                ${body}
                ${explanation}
                ${coach}
            </article>
        `;
    }

    _renderCoachPanel(item, state) {
        const coach = state.coach || {
            messages: [],
            active: false,
            exchanges: 0,
            incorrectCount: 0,
            completed: false,
        };

        const messagesMarkup = (coach.messages || [])
            .map(
                (msg) => `
                    <div class="kd-coach-msg ${msg.role === 'assistant' ? 'assistant' : 'user'}">
                        <span>${this._escapeHtml(msg.content)}</span>
                    </div>
                `
            )
            .join('');

        const statusBar = coach.completed
            ? `<div class="kd-coach-status success">✅ Coach session completed</div>`
            : coach.active
                ? `<div class="kd-coach-status info">Question ${Math.min(coach.exchanges, 3)} / 3</div>`
                : `<div class="kd-coach-status muted">Answer the question to unlock Socratic coaching.</div>`;

        return `
            <div class="kd-coach-panel" data-coach="${item.id}">
                <header>
                    <h4>💬 Socratic Coach</h4>
                    <button class="button ghost" data-action="reset-coach" data-question-id="${item.id}">Reset</button>
                </header>
                ${statusBar}
                <div class="kd-coach-messages">
                    ${messagesMarkup || '<p class="kd-coach-placeholder">Your coach will appear here once you answer.</p>'}
                    </div>
                <div class="kd-coach-input">
                    <input
                        type="text"
                        data-action="coach-input"
                        data-question-id="${item.id}"
                        placeholder="${coach.active ? 'Respond to your coach...' : 'Answer the question first to chat'}"
                        ${coach.active ? '' : 'disabled'}
                    >
                    <button
                        class="button primary"
                        data-action="send-coach-message"
                        data-question-id="${item.id}"
                        ${coach.active ? '' : 'disabled'}
                    >Send</button>
                </div>
            </div>
        `;
    }

    _renderKnowledgeHighlights() {
        const knowledgePoints = Array.isArray(this.knowledgePoints) ? this.knowledgePoints.slice(0, 6) : [];
        const knowledgeDrafts = Array.isArray(this.knowledgeDrafts) ? this.knowledgeDrafts.slice(0, 3) : [];

        if (!knowledgePoints.length && !knowledgeDrafts.length) {
            return '';
        }

        const pointsList = knowledgePoints
            .map((point, index) => {
                const name = this._escapeHtml(point?.name || `Key Concept ${index + 1}`);
                const type = this._escapeHtml(point?.type || 'concept');
                const summary = this._escapeHtml(point?.summary || point?.description || '');
                return `
                    <li>
                        <div class="kd-highlight-point">
                            <span class="kd-highlight-index">${index + 1}</span>
                            <div>
                                <h4>${name}</h4>
                                <div class="kd-highlight-tags">
                                    <span>${type}</span>
                    </div>
                                ${summary ? `<p>${summary}</p>` : ''}
                            </div>
                        </div>
                    </li>
                `;
            })
            .join('');

        const draftsList = knowledgeDrafts
            .map((draft) => {
                const title = this._escapeHtml(
                    draft?.title ||
                    draft?.section_title ||
                    draft?.knowledge_point ||
                    draft?.name ||
                    'Learning Focus'
                );
                const takeawayRaw = Array.isArray(draft?.key_takeaways)
                    ? draft.key_takeaways.join(', ')
                    : draft?.summary ||
                      draft?.insights ||
                      draft?.draft ||
                      draft?.content ||
                      '';
                const takeaway = takeawayRaw ? this._renderMarkdown(takeawayRaw) : '';
                return `
                    <li>
                        <div class="kd-highlight-draft">
                            <h5>${title}</h5>
                            ${takeaway ? `<div class="kd-draft-content">${takeaway}</div>` : ''}
                    </div>
                    </li>
                `;
            })
            .join('');

                return `
            <section class="kd-card kd-highlights-card">
                <div class="kd-card-header">
                    <div>
                        <h2>Knowledge Prep Summary</h2>
                        <p>Key insights distilled for this session before you dive into the full document.</p>
                    </div>
                </div>
                <div class="kd-highlights-grid">
                    ${knowledgePoints.length ? `
                        <article class="kd-highlight-column">
                            <header>
                                <span class="kd-highlight-label">Knowledge Explorer</span>
                                <h3>Key Concepts (${knowledgePoints.length})</h3>
                            </header>
                            <ul class="kd-highlight-list">
                                ${pointsList}
                            </ul>
                        </article>
                    ` : ''}
                    ${knowledgeDrafts.length ? `
                        <article class="kd-highlight-column">
                            <header>
                                <span class="kd-highlight-label">Draft Insights</span>
                                <h3>Session Focus (${knowledgeDrafts.length})</h3>
                            </header>
                            <ul class="kd-highlight-list kd-highlight-list--drafts">
                                ${draftsList}
                            </ul>
                        </article>
                    ` : ''}
                </div>
            </section>
        `;
    }

    _renderFeedbackSection() {
        return `
            <section class="kd-card kd-feedback-card">
                <div class="kd-card-header">
                    <div>
                        <h2>Share Your Feedback</h2>
                        <p>Your insights help improve the learning experience.</p>
                    </div>
                </div>
                <form class="kd-feedback-form" data-form="session-feedback">
                    <div class="kd-feedback-row">
                        <label>Clarity of Content</label>
                        ${this._renderFeedbackSelector('clarity', this.feedbackDraft.clarity)}
                    </div>
                    <div class="kd-feedback-row">
                        <label>Relevance to Goal</label>
                        ${this._renderFeedbackSelector('relevance', this.feedbackDraft.relevance)}
                    </div>
                    <div class="kd-feedback-row">
                        <label>Depth of Coverage</label>
                        ${this._renderFeedbackSelector('depth', this.feedbackDraft.depth)}
                    </div>
                    <div class="kd-feedback-row">
                        <label>Engagement Level</label>
                        ${this._renderFeedbackFaces('engagement', this.feedbackDraft.engagement)}
                    </div>
                    <div class="kd-feedback-row">
                        <label>Additional Comments</label>
                        <textarea name="comments" placeholder="Share anything else..." data-field="comments">${this._escapeHtml(this.feedbackDraft.comments || '')}</textarea>
                    </div>
                    <div class="kd-feedback-actions">
                        <button type="submit" class="button primary" data-action="submit-feedback">Submit Feedback</button>
                    </div>
                </form>
            </section>
        `;
    }

    _renderFeedbackSelector(name, selected) {
        const options = [1, 2, 3, 4, 5];
        return `
            <div class="kd-feedback-options" data-feedback="${name}">
                ${options
                    .map((value) => `
                        <label>
                            <input
                                type="radio"
                                name="${name}"
                                value="${value}"
                                ${Number(selected) === value ? 'checked' : ''}
                            >
                            <span>${'★'.repeat(value)}</span>
                        </label>
                    `)
                    .join('')}
            </div>
        `;
    }

    _renderFeedbackFaces(name, selected) {
        const options = [
            { value: 'sad', label: '😟' },
            { value: 'neutral', label: '😐' },
            { value: 'happy', label: '😊' },
            { value: 'excited', label: '🤩' },
        ];
        return `
            <div class="kd-feedback-options kd-feedback-options--faces" data-feedback="${name}">
                ${options
                    .map((opt) => `
                        <label>
                            <input
                                type="radio"
                                name="${name}"
                                value="${opt.value}"
                                ${selected === opt.value ? 'checked' : ''}
                            >
                            <span>${opt.label}</span>
                        </label>
                    `)
                    .join('')}
                        </div>
        `;
    }

    _renderSidebar() {
        const tabButtons = `
            <div class="kd-sidebar-tabs">
                <button class="${this.sidebarTab === 'tutor' ? 'active' : ''}" data-action="switch-tab" data-tab="tutor">
                    Tutor Chat
                </button>
                <button class="${this.sidebarTab === 'assessment' ? 'active' : ''}" data-action="switch-tab" data-tab="assessment">
                    Socratic Assessment
                    </button>
            </div>
        `;

        const tutorContent = this._renderTutorTab();
        const assessmentContent = this._renderAssessmentTab();

        return `
            <div class="kd-sidebar-panel">
                <header class="kd-sidebar-header">
                    <h3>🧠 Socrates Tutor</h3>
                    <p>Ask questions or undergo a guided assessment.</p>
                </header>
                ${tabButtons}
                <div class="kd-sidebar-content">
                    ${this.sidebarTab === 'tutor' ? tutorContent : assessmentContent}
                </div>
                <div class="kd-sidebar-meta">
                    <h4>Session Overview</h4>
                    <ul>
                        <li><strong>Goal:</strong> ${this._escapeHtml(this.goal?.learningGoal || this.goal?.refinedGoal || '')}</li>
                        <li><strong>Section:</strong> ${this.currentSectionIndex + 1}/${this.sectionList.length}</li>
                        <li><strong>Generated:</strong> ${this._escapeHtml(new Date(this.learningContent?.generatedAt || Date.now()).toLocaleString())}</li>
                    </ul>
                </div>
            </div>
        `;
    }

    _renderTutorTab() {
        const messagesMarkup = (this.tutorMessages || [])
            .map(
                (msg) => `
                    <div class="kd-chat-msg ${msg.role === 'assistant' ? 'assistant' : 'user'}">
                        <span>${this._escapeHtml(msg.content)}</span>
                    </div>
                `
            )
            .join('');

        return `
            <div class="kd-chat-panel" data-chat="tutor">
                <div class="kd-chat-messages">
                    ${messagesMarkup || '<p class="kd-chat-placeholder">Ask anything about your learning goal.</p>'}
                </div>
                <div class="kd-chat-input">
                    <input type="text" placeholder="Ask the tutor..." data-action="tutor-input">
                    <button class="button primary" data-action="send-tutor-message">Send</button>
                </div>
            </div>
        `;
    }

    _renderAssessmentTab() {
        const sessions = this._getAssessmentSessions();
        if (!this.assessmentBootstrapped && sessions.length && !this.assessmentState.topic) {
            this.assessmentBootstrapped = true;
            setTimeout(() => {
                this._selectAssessmentTopic(sessions[0].value).catch((error) => {
                    console.warn('[KnowledgeDocument] Deferred assessment bootstrap failed', error);
                    this.assessmentBootstrapped = false;
                });
            }, 0);
        }
        const state = this.assessmentState || {};
        const hasTopic = Boolean(state.topic);
        const hasMessages = Array.isArray(state.messages) && state.messages.length > 0;
        const isLoading = Boolean(state.isLoading);
        const completed = Boolean(state.completed);

        const topicOptions = sessions
            .map(
                (item) => `
                    <option value="${this._escapeHtml(item.value)}" ${item.value === this.assessmentState.topic ? 'selected' : ''}>
                        ${this._escapeHtml(item.label)}
                    </option>
                `
            )
            .join('');

        const introCard = `
            <div class="kd-chat-msg assistant kd-chat-msg--intro">
                <span>👋 I'm your Socratic Tutor. ${
                    hasTopic
                        ? 'I\'m preparing your first guided question—share your thinking as we go.'
                        : 'Choose a session topic to begin and I\'ll quiz you step by step.'
                }</span>
                </div>
        `;

        const messagesMarkup = hasMessages
            ? (state.messages || [])
                  .map(
                      (msg) => `
                        <div class="kd-chat-msg ${msg.role === 'assistant' ? 'assistant' : 'user'}">
                            <span>${this._escapeHtml(msg.content)}</span>
                </div>
                    `
                  )
                  .join('')
            : introCard;

        const progressBar = '';

        const showWarning = !completed && !isLoading && (state.incorrectCount || 0) >= 2;
        const warningMarkup = showWarning
            ? `<div class="kd-assessment-warning">⚠️ You seem to be struggling with this topic. Consider reviewing the learning materials.</div>`
            : '';

        const loadingNotice = isLoading
            ? `<div class="kd-assessment-loading">🤔 Socratic tutor is preparing your next question...</div>`
            : '';

        // completed 조건을 제거하여 답을 두 번 해도 계속 응답할 수 있게 함
        const inputDisabled = !hasTopic || isLoading;
        const inputPlaceholder = !hasTopic
            ? 'Choose a session topic to begin.'
            : isLoading
                ? 'Tutor is preparing your first question...'
                : 'Respond to the tutor...';

        const totalAnswers = (state.messages || []).filter((msg) => msg.role === 'user').length;
        const incorrectCount = state.incorrectCount || 0;
        const incorrectRate = totalAnswers > 0 ? incorrectCount / totalAnswers : 0;
        let performanceFeedback = '';
        if (incorrectCount >= 2 || incorrectRate >= 0.5) {
            performanceFeedback = '📊 Performance: Needs more practice. Consider reviewing the session content.';
        } else if (incorrectRate >= 0.3) {
            performanceFeedback = '📊 Performance: Good effort! A bit more practice will help.';
        } else {
            performanceFeedback = '📊 Performance: Excellent understanding!';
        }

        const summaryMarkup = completed
            ? `
                <div class="kd-assessment-summary">
                    <div class="kd-assessment-summary-title">✅ Assessment completed!</div>
                    <p><strong>Statistics:</strong> ${totalAnswers} responses, ${incorrectCount} unclear/incorrect.</p>
                    <p>${performanceFeedback}</p>
                </div>
            `
            : '';

        return `
            <div class="kd-assessment-panel">
                <label class="kd-assessment-select">
                    <span>Select Session Topic</span>
                    <select data-action="select-assessment-topic">
                        <option value="">Choose a topic...</option>
                        ${topicOptions}
                    </select>
                </label>
                <button class="button ghost" data-action="restart-assessment">Start New Assessment</button>
                ${progressBar}
                ${warningMarkup}
                <div class="kd-chat-messages kd-chat-messages--assessment">
                    ${messagesMarkup}
                    ${loadingNotice}
                </div>
                <div class="kd-chat-input">
                    <input
                        type="text"
                        placeholder="${this._escapeHtml(inputPlaceholder)}"
                        data-action="assessment-input"
                        ${inputDisabled ? 'disabled' : ''}
                    >
                    <button
                        class="button primary"
                        data-action="send-assessment-message"
                        ${inputDisabled ? 'disabled' : ''}
                    >
                        Send
                    </button>
                </div>
                ${summaryMarkup}
            </div>
        `;
    }

    /* ------------------------------------------------------------------ */
    /* Event Binding                                                       */
    /* ------------------------------------------------------------------ */

    _bindErrorActions() {
        const retryButton = this.container.querySelector('[data-action="retry-generation"]');
        if (retryButton) {
            retryButton.addEventListener('click', () => {
                this.error = null;
                this.learningContent = null;
                this._prepareLearningContent();
            });
        }

        const backButton = this.container.querySelector('[data-action="go-back-learning-path"]');
        if (backButton) {
            backButton.addEventListener('click', () => router.navigateTo('learning-path'));
        }
    }

    _bindMissingGoalActions() {
        const button = this.container.querySelector('[data-action="go-to-onboarding"]');
        if (button) {
            button.addEventListener('click', () => router.navigateTo('onboarding'));
        }
    }

    _bindMissingSessionActions() {
        const button = this.container.querySelector('[data-action="go-to-learning-path"]');
        if (button) {
            button.addEventListener('click', () => router.navigateTo('learning-path'));
        }
    }

    _bindExperienceEvents() {
        this._bindHeaderEvents();
        this._bindDocumentEvents();
        this._bindQuizEvents();
        this._bindFeedbackEvents();
        this._bindSidebarEvents();
    }

    _bindHeaderEvents() {
        const backButton = this.container.querySelector('[data-action="go-back-learning-path"]');
        if (backButton) {
            backButton.addEventListener('click', () => router.navigateTo('learning-path'));
        }

        const regenerateButton = this.container.querySelector('[data-action="regenerate-content"]');
        if (regenerateButton) {
            regenerateButton.addEventListener('click', () => this._confirmRegenerate());
        }

        const completeButton = this.container.querySelector('[data-action="complete-session"]');
        if (completeButton) {
            completeButton.addEventListener('click', () => this._completeSession());
        }
    }

    _bindDocumentEvents() {
        const prevButton = this.container.querySelector('[data-action="prev-section"]');
        if (prevButton) {
            prevButton.addEventListener('click', () => this._changeSection(-1));
        }

        const nextButton = this.container.querySelector('[data-action="next-section"]');
        if (nextButton) {
            nextButton.addEventListener('click', () => this._changeSection(1));
        }

        const tocButtons = this.container.querySelectorAll('[data-action="goto-section"]');
        tocButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const index = Number(button.dataset.index);
                this._setSection(index);
            });
        });
    }

    _bindQuizEvents() {
        const singleOptions = this.container.querySelectorAll('[data-action="answer-single"]');
        singleOptions.forEach((input) => {
            input.addEventListener('change', (event) => {
                const questionId = event.currentTarget.dataset.questionId;
                const optionIndex = Number(event.currentTarget.dataset.optionIndex);
                this._answerSingleChoice(questionId, optionIndex);
            });
        });

        const multiOptions = this.container.querySelectorAll('[data-action="toggle-multi"]');
        multiOptions.forEach((input) => {
            input.addEventListener('change', (event) => {
                const questionId = event.currentTarget.dataset.questionId;
                const optionIndex = Number(event.currentTarget.dataset.optionIndex);
                this._toggleMultiChoice(questionId, optionIndex, event.currentTarget.checked);
            });
        });

        const submitMultiButtons = this.container.querySelectorAll('[data-action="submit-multi"]');
        submitMultiButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const questionId = btn.dataset.questionId;
                this._submitMultiChoice(questionId);
            });
        });

        const trueFalseInputs = this.container.querySelectorAll('[data-action="answer-tf"]');
        trueFalseInputs.forEach((input) => {
            input.addEventListener('change', (event) => {
                const questionId = event.currentTarget.dataset.questionId;
                const value = event.currentTarget.value === 'true';
                this._answerTrueFalse(questionId, value);
            });
        });

        const shortAnswerInputs = this.container.querySelectorAll('[data-action="input-short-answer"]');
        shortAnswerInputs.forEach((textarea) => {
            textarea.addEventListener('input', (event) => {
                const questionId = event.currentTarget.dataset.questionId;
                this._saveShortAnswerDraft(questionId, event.currentTarget.value);
            });
        });

        const submitShortButtons = this.container.querySelectorAll('[data-action="submit-short-answer"]');
        submitShortButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const questionId = btn.dataset.questionId;
                this._submitShortAnswer(questionId);
            });
        });

        const resetQuizButton = this.container.querySelector('[data-action="reset-quiz"]');
        if (resetQuizButton) {
            resetQuizButton.addEventListener('click', () => this._resetQuiz());
        }

        const unlockQuizzesButton = this.container.querySelector('[data-action="unlock-quizzes"]');
        if (unlockQuizzesButton) {
            unlockQuizzesButton.addEventListener('click', () => this._unlockQuizzes());
        }

        const resetCoachButtons = this.container.querySelectorAll('[data-action="reset-coach"]');
        resetCoachButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const questionId = btn.dataset.questionId;
                this._resetCoach(questionId);
            });
        });

        const coachInputs = this.container.querySelectorAll('[data-action="coach-input"]');
        coachInputs.forEach((input) => {
            input.addEventListener('keypress', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    const questionId = event.currentTarget.dataset.questionId;
                    const value = event.currentTarget.value.trim();
                    if (value) {
                        this._sendCoachMessage(questionId, value);
                        event.currentTarget.value = '';
                    }
                }
            });
        });

        const coachSendButtons = this.container.querySelectorAll('[data-action="send-coach-message"]');
        coachSendButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const container = btn.closest('.kd-coach-panel');
                const input = container?.querySelector('input[data-action="coach-input"]');
                if (!input) return;
                const questionId = btn.dataset.questionId;
                const value = input.value.trim();
                if (value) {
                    this._sendCoachMessage(questionId, value);
                    input.value = '';
                }
            });
        });
    }

    _unlockQuizzes() {
        if (this.showQuizzes) return;
        this.showQuizzes = true;
        this._persistKnowledgeState({ showQuizzes: true });
        this.render(this.container);
    }

    _bindFeedbackEvents() {
        const form = this.container.querySelector('[data-form="session-feedback"]');
        if (!form) return;

        const radioInputs = form.querySelectorAll('input[type="radio"]');
        radioInputs.forEach((input) => {
            input.addEventListener('change', () => {
                const name = input.name;
                this.feedbackDraft[name] = input.value;
                this._persistKnowledgeState({ feedbackDraft: this.feedbackDraft });
            });
        });

        const comments = form.querySelector('textarea[data-field="comments"]');
        if (comments) {
            comments.addEventListener('input', (event) => {
                this.feedbackDraft.comments = event.currentTarget.value;
                this._persistKnowledgeState({ feedbackDraft: this.feedbackDraft });
            });
        }

        form.addEventListener('submit', (event) => {
            event.preventDefault();
            this._submitFeedback();
        });
    }

    _bindSidebarEvents() {
        const tabButtons = this.container.querySelectorAll('[data-action="switch-tab"]');
        tabButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                this.sidebarTab = btn.dataset.tab;
                this._persistKnowledgeState({ sidebarTab: this.sidebarTab });
                this.render(this.container);
            });
        });

        const tutorInput = this.container.querySelector('[data-action="tutor-input"]');
        if (tutorInput) {
            tutorInput.addEventListener('keypress', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    this._sendTutorMessage();
                }
            });
        }

        const tutorSend = this.container.querySelector('[data-action="send-tutor-message"]');
        if (tutorSend) {
            tutorSend.addEventListener('click', () => this._sendTutorMessage());
        }

        const topicSelect = this.container.querySelector('[data-action="select-assessment-topic"]');
        if (topicSelect) {
            topicSelect.addEventListener('change', (event) => {
                const topic = event.currentTarget.value || null;
                this._selectAssessmentTopic(topic);
            });
        }

        const assessmentInput = this.container.querySelector('[data-action="assessment-input"]');
        if (assessmentInput) {
            assessmentInput.addEventListener('keypress', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    this._sendAssessmentMessage();
                }
            });
        }

        const assessmentSend = this.container.querySelector('[data-action="send-assessment-message"]');
        if (assessmentSend) {
            assessmentSend.addEventListener('click', () => this._sendAssessmentMessage());
        }

        const restartButton = this.container.querySelector('[data-action="restart-assessment"]');
        if (restartButton) {
            restartButton.addEventListener('click', () => this._restartAssessment());
        }
    }

    /* ------------------------------------------------------------------ */
    /* Document Navigation                                                 */
    /* ------------------------------------------------------------------ */

    _changeSection(offset) {
        const nextIndex = this.currentSectionIndex + offset;
        this._setSection(nextIndex);
    }

    _setSection(index) {
        if (index < 0 || index >= this.sectionList.length) return;
        this.currentSectionIndex = index;
        const shouldShowQuizzes = this.currentSectionIndex >= this.sectionList.length - 1;
        if (shouldShowQuizzes && !this.showQuizzes) {
            this.showQuizzes = true;
        }
        this._persistKnowledgeState({
            currentSectionIndex: this.currentSectionIndex,
            showQuizzes: this.showQuizzes,
        });
        this.render(this.container);
    }

    _confirmRegenerate() {
        const confirmed = window.confirm(
            'Regenerating will replace the current document and quizzes with newly generated content. Continue?'
        );
        if (!confirmed) return;

        if (!this.sessionUid) return;
        const snapshot = appState.getState();
        const caches = snapshot.documentCaches || {};
        const nextCaches = { ...caches };
        delete nextCaches[this.sessionUid];
        appState.setState({ documentCaches: nextCaches });

        this.learningContent = null;
        this.quizState = {};
        this.toastMessages = [];
        this._persistKnowledgeState({
            quizState: {},
            toastMessages: [],
        });
        this._prepareLearningContent();
    }

    /* ------------------------------------------------------------------ */
    /* Quiz Handling                                                       */
    /* ------------------------------------------------------------------ */

    _answerSingleChoice(questionId, optionIndex) {
        const question = this.quizItems.find((item) => item.id === questionId);
        if (!question) return;

        const isCorrect = optionIndex === question.correctOption;
        this.quizState[questionId] = {
            ...(this.quizState[questionId] || {}),
            type: 'single_choice',
            selected: optionIndex,
            status: isCorrect ? 'correct' : 'incorrect',
            coach: this._activateCoach(questionId, isCorrect),
        };
        this._persistKnowledgeState({ quizState: this.quizState });
        this.render(this.container);
    }

    _toggleMultiChoice(questionId, optionIndex, checked) {
        const question = this.quizItems.find((item) => item.id === questionId);
        if (!question) return;

        const current = Array.isArray(this.quizState[questionId]?.selected)
            ? [...this.quizState[questionId].selected]
            : [];
        if (checked) {
            if (!current.includes(optionIndex)) current.push(optionIndex);
        } else {
            const idx = current.indexOf(optionIndex);
            if (idx >= 0) current.splice(idx, 1);
        }
        this.quizState[questionId] = {
            ...(this.quizState[questionId] || {}),
            type: 'multiple_choice',
            selected: current,
            status: 'unanswered',
        };
        this._persistKnowledgeState({ quizState: this.quizState });
    }

    _submitMultiChoice(questionId) {
        const question = this.quizItems.find((item) => item.id === questionId);
        if (!question) return;

        const selected = Array.isArray(this.quizState[questionId]?.selected)
            ? this.quizState[questionId].selected
            : [];
        const correctSet = new Set(question.correctOptions || []);
        const selectedSet = new Set(selected);
        const isCorrect = selected.length === correctSet.size && selected.every((idx) => correctSet.has(idx));

        this.quizState[questionId] = {
            ...(this.quizState[questionId] || {}),
            type: 'multiple_choice',
            status: isCorrect ? 'correct' : 'incorrect',
            selected,
            coach: this._activateCoach(questionId, isCorrect),
        };
        this._persistKnowledgeState({ quizState: this.quizState });
        this.render(this.container);
    }

    _answerTrueFalse(questionId, value) {
        const question = this.quizItems.find((item) => item.id === questionId);
        if (!question) return;

        const isCorrect = value === question.correctAnswer;
        this.quizState[questionId] = {
            ...(this.quizState[questionId] || {}),
            type: 'true_false',
            selected: value,
            status: isCorrect ? 'correct' : 'incorrect',
            coach: this._activateCoach(questionId, isCorrect),
        };
        this._persistKnowledgeState({ quizState: this.quizState });
        this.render(this.container);
    }

    _saveShortAnswerDraft(questionId, value) {
        this.quizState[questionId] = {
            ...(this.quizState[questionId] || {}),
            type: 'short_answer',
            selected: value,
            status: this.quizState[questionId]?.status || 'unanswered',
        };
        this._persistKnowledgeState({ quizState: this.quizState });
    }

    _submitShortAnswer(questionId) {
        const question = this.quizItems.find((item) => item.id === questionId);
        if (!question) return;
        const userAnswer = (this.quizState[questionId]?.selected || '').trim().toLowerCase();
        const expected = String(question.expectedAnswer || '').trim().toLowerCase();
        if (!userAnswer) {
            window.alert('Please provide an answer before submitting.');
            return;
        }
        const isCorrect = expected && userAnswer === expected;
        this.quizState[questionId] = {
            ...(this.quizState[questionId] || {}),
            type: 'short_answer',
            status: isCorrect ? 'correct' : 'incorrect',
            coach: this._activateCoach(questionId, isCorrect),
        };
        this._persistKnowledgeState({ quizState: this.quizState });
        this.render(this.container);
    }

    _resetQuiz() {
        const confirmed = window.confirm('Reset all quiz answers and coach sessions?');
        if (!confirmed) return;

        this.quizState = {};
        this._persistKnowledgeState({ quizState: this.quizState });
        this.render(this.container);
    }

    _activateCoach(questionId, isCorrect) {
        const question = this.quizItems.find((item) => item.id === questionId);
        if (!question) return null;

        const existing = this.quizState[questionId]?.coach || {};
        const messages = [...(existing.messages || [])];
        const initialPrompt = this._buildCoachIntro(question, isCorrect);

        if (!initialPrompt) {
            return {
                active: false,
                messages,
                exchanges: existing.exchanges || 0,
                incorrectCount: existing.incorrectCount || 0,
                completed: false,
            };
        }

        // Immediately kick off the coach asynchronously
        this._startCoachSession(questionId, initialPrompt);

        return {
            active: true,
            messages,
            exchanges: existing.exchanges || 0,
            incorrectCount: existing.incorrectCount || 0,
            completed: false,
        };
    }

    async _startCoachSession(questionId, introContext) {
        try {
            const response = await API.assessWithSocraticTutor(
                introContext,
                [],
                CHAT_MODEL_PROVIDER,
                CHAT_MODEL_NAME
            );

            const normalizedResponse = this._normalizeTutorResponse(response);
            this._appendCoachMessage(questionId, { role: 'assistant', content: normalizedResponse });
        } catch (error) {
            console.warn('[KnowledgeDocument] Unable to start coach session', error);
            const fallbackPrompt =
                'Let me guide you through this quiz item. Start by telling me what part of the question feels unclear or tricky.';
            const state = this.quizState[questionId];
            if (state?.coach) {
                this.quizState[questionId] = {
                    ...state,
                    coach: {
                        ...state.coach,
                        active: true,
                        messages: [
                            ...(state.coach.messages || []),
                            { role: 'assistant', content: fallbackPrompt },
                        ],
                    },
                };
                this._persistKnowledgeState({ quizState: this.quizState });
                if (this.container) {
                    this.render(this.container);
                }
            }
        }
    }

    _appendCoachMessage(questionId, message) {
        if (!this.quizState[questionId]) return;
        const coach = this.quizState[questionId].coach || {
            messages: [],
            active: true,
            exchanges: 0,
            incorrectCount: 0,
            completed: false,
        };
        const messages = [...coach.messages, message];
        const completed =
            coach.completed ||
            message.role === 'assistant' &&
                /great work|you've got it|excellent understanding|완벽|잘 이해/i.test(message.content);
        const exchanges =
            coach.exchanges + (message.role === 'assistant' && message.content.includes('?') ? 1 : 0);

        this.quizState[questionId] = {
            ...this.quizState[questionId],
            coach: {
                ...coach,
                messages,
                exchanges: Math.min(exchanges, 3),
                completed,
                active: !completed,
            },
        };
        this._persistKnowledgeState({ quizState: this.quizState });
        this.render(this.container);
    }

    async _sendCoachMessage(questionId, content) {
        const state = this.quizState[questionId];
        if (!state || !state.coach?.active) return;

        const coach = state.coach;
        const question = this.quizItems.find((item) => item.id === questionId);
        if (!question) return;

        const messages = [
            ...(coach.messages || []),
            { role: 'user', content },
        ];

        this.quizState[questionId] = {
            ...state,
            coach: {
                ...coach,
                messages,
            },
        };
        this._persistKnowledgeState({ quizState: this.quizState });
        this.render(this.container);

        const topic = this._buildCoachContext(question);

        try {
            const response = await API.assessWithSocraticTutor(
                topic,
                messages.slice(-10),
                CHAT_MODEL_PROVIDER,
                CHAT_MODEL_NAME
            );
            const normalizedResponse = this._normalizeTutorResponse(response);
            this._appendCoachMessage(questionId, { role: 'assistant', content: normalizedResponse });
        } catch (error) {
            console.error('[KnowledgeDocument] Failed to get coach response', error);
            window.alert('Failed to get response from Socratic coach. Please try again.');
        }
    }

    _resetCoach(questionId) {
        if (!this.quizState[questionId]) return;
        this.quizState[questionId] = {
            ...this.quizState[questionId],
            coach: {
                messages: [],
                active: false,
                exchanges: 0,
                incorrectCount: 0,
                completed: false,
            },
        };
        this._persistKnowledgeState({ quizState: this.quizState });
        this.render(this.container);
    }

    /* ------------------------------------------------------------------ */
    /* Feedback Handling                                                   */
    /* ------------------------------------------------------------------ */

    async _submitFeedback() {
        if (!this.goal) return;

        const payload = {
            clarity: Number(this.feedbackDraft.clarity) || null,
            relevance: Number(this.feedbackDraft.relevance) || null,
            depth: Number(this.feedbackDraft.depth) || null,
            engagement: this.feedbackDraft.engagement || null,
            additional_comments: this.feedbackDraft.comments || '',
        };

        try {
            await API.updateLearnerProfile(
                JSON.stringify(this.goal.learnerProfile || {}),
                JSON.stringify(payload),
                JSON.stringify(this.goal.learnerInformation || {}),
                JSON.stringify({
                    ...this.session,
                    if_learned: true,
                }),
                MODEL_PROVIDER,
                MODEL_NAME
            );
            window.alert('Feedback submitted. Thank you!');
            this.feedbackDraft = {
                clarity: '',
                relevance: '',
                depth: '',
                engagement: '',
                comments: '',
            };
            this._persistKnowledgeState({ feedbackDraft: this.feedbackDraft });
            this.render(this.container);
        } catch (error) {
            console.error('[KnowledgeDocument] Failed to submit feedback', error);
            window.alert('Failed to submit feedback. Please try again.');
        }
    }

    async _completeSession() {
        if (!this.goal || !this.session) return;
        const confirmed = window.confirm('Mark this session as complete and update your learner profile?');
        if (!confirmed) return;

        try {
            await API.updateLearnerProfile(
                JSON.stringify(this.goal.learnerProfile || {}),
                JSON.stringify({ notes: 'Session completed' }),
                JSON.stringify(this.goal.learnerInformation || {}),
                JSON.stringify({
                    ...this.session,
                    if_learned: true,
                }),
                MODEL_PROVIDER,
                MODEL_NAME
            );
            window.alert('Session completed! Returning to learning path.');
            router.navigateTo('learning-path');
        } catch (error) {
            console.error('[KnowledgeDocument] Failed to complete session', error);
            window.alert('Failed to update learner profile. Please try again.');
        }
    }

    /* ------------------------------------------------------------------ */
    /* Tutor Chat                                                          */
    /* ------------------------------------------------------------------ */

    async _sendTutorMessage() {
        const input = this.container.querySelector('[data-action="tutor-input"]');
        if (!input) return;
        const value = input.value.trim();
        if (!value) return;

        this.tutorMessages = [...this.tutorMessages, { role: 'user', content: value }];
        this._persistKnowledgeState({ tutorMessages: this.tutorMessages });
        this.render(this.container);

        input.value = '';

        try {
            const response = await API.chatWithTutor(
                this.tutorMessages.slice(-20),
                JSON.stringify(this.goal?.learnerProfile || {}),
                CHAT_MODEL_PROVIDER,
                CHAT_MODEL_NAME
            );
            const normalized = this._normalizeTutorResponse(response);
            this.tutorMessages = [...this.tutorMessages, { role: 'assistant', content: normalized }];
            this._persistKnowledgeState({ tutorMessages: this.tutorMessages });
            this.render(this.container);
        } catch (error) {
            console.error('[KnowledgeDocument] Tutor chat failed', error);
            window.alert('The tutor is unavailable right now. Please try again later.');
        }
    }

    _getAssessmentSessions() {
        if (!this.goal) return [];
        const raw = this.goal.learningPathRaw || {};
        const sessions = raw.learning_path || raw.sessions || this.goal.learningPath || [];
        return sessions.map((session, index) => {
            const title = session?.title || session?.topic || `Session ${index + 1}`;
            return { value: String(title), label: String(title) };
        });
    }

    async _selectAssessmentTopic(topic) {
        if (!topic) {
            this.assessmentState = this._getEmptyAssessmentState();
            this._persistKnowledgeState({ assessmentState: this.assessmentState });
            this.render(this.container);
            return;
        }

        this.assessmentState = this._getEmptyAssessmentState({
            topic,
            isLoading: true,
        });
        this._persistKnowledgeState({ assessmentState: this.assessmentState });
        this.render(this.container);

        try {
            const response = await API.assessWithSocraticTutor(
                topic,
                [],
                CHAT_MODEL_PROVIDER,
                CHAT_MODEL_NAME
            );
            const normalized = this._normalizeTutorResponse(response);
            this.assessmentState = {
                ...this.assessmentState,
                messages: [{ role: 'assistant', content: normalized }],
                questionCount: 1,
                isLoading: false,
            };
            this._persistKnowledgeState({ assessmentState: this.assessmentState });
            this.render(this.container);
        } catch (error) {
            console.error('[KnowledgeDocument] Failed to start assessment', error);
            this.assessmentState = {
                ...this.assessmentState,
                isLoading: false,
            };
            this._persistKnowledgeState({ assessmentState: this.assessmentState });
            window.alert('Failed to start Socratic assessment. Please try another topic.');
        }
    }

    async _sendAssessmentMessage() {
        if (!this.assessmentState.topic) return;
        const input = this.container.querySelector('[data-action="assessment-input"]');
        if (!input) return;

        const value = input.value.trim();
        if (!value) return;

        const messages = [
            ...(this.assessmentState.messages || []),
            { role: 'user', content: value },
        ];

        this.assessmentState = {
            ...this.assessmentState,
            messages,
            isLoading: true,
        };
        this._persistKnowledgeState({ assessmentState: this.assessmentState });
        this.render(this.container);

        input.value = '';

        const uncertaintyMarkers = ['not sure', "don't know", 'confused', '모르겠', '헤깔'];
        const isUncertain = uncertaintyMarkers.some((marker) => value.toLowerCase().includes(marker));

        try {
            const response = await API.assessWithSocraticTutor(
                this.assessmentState.topic,
                messages.slice(-10),
                CHAT_MODEL_PROVIDER,
                CHAT_MODEL_NAME
            );

            const normalizedResponse = this._normalizeTutorResponse(response);
            // Always continue conversation - never mark as completed
            const isIncorrect = this._isResponseIndicatingIncorrect(normalizedResponse);

            this._appendAssessmentMessage(
                { role: 'assistant', content: normalizedResponse },
                { completed: false, incorrect: isIncorrect }
            );
        } catch (error) {
            console.error('[KnowledgeDocument] Assessment response failed', error);
            this.assessmentState = {
                ...this.assessmentState,
                isLoading: false,
            };
            this._persistKnowledgeState({ assessmentState: this.assessmentState });
            window.alert('The Socratic tutor could not respond. Try again shortly.');
        }
    }

    _restartAssessment() {
        // 주제를 초기화하고 상태를 리셋
        this.assessmentState = this._getEmptyAssessmentState();
        this._persistKnowledgeState({ assessmentState: this.assessmentState });
        this.render(this.container);
    }

    _appendAssessmentMessage(message, options = {}) {
        const { completed = false, incorrect = false } = options;
        
        this.assessmentState = {
            ...this.assessmentState,
            messages: [...(this.assessmentState.messages || []), message],
            questionCount: (this.assessmentState.questionCount || 0) + 1,
            incorrectCount: incorrect 
                ? (this.assessmentState.incorrectCount || 0) + 1 
                : (this.assessmentState.incorrectCount || 0),
            completed: false, // 항상 false로 유지하여 계속 응답할 수 있게 함
            isLoading: false,
        };
        this._persistKnowledgeState({ assessmentState: this.assessmentState });
        this.render(this.container);
    }

    _isResponseIndicatingIncorrect(response) {
        if (!response || typeof response !== 'string') return false;
        const lower = response.toLowerCase();
        const incorrectMarkers = [
            'incorrect', 'wrong', 'not quite', 'not right', '틀렸', '잘못',
            'try again', 'think again', '다시 생각', '재고', 'clarify', '명확히'
        ];
        return incorrectMarkers.some(marker => lower.includes(marker));
    }

    /* ------------------------------------------------------------------ */
    /* Helpers                                                             */
    /* ------------------------------------------------------------------ */

    _getEmptyAssessmentState(overrides = {}) {
        return {
            topic: null,
            messages: [],
            questionCount: 0,
            incorrectCount: 0,
            completed: false,
            isLoading: false,
            ...((overrides && typeof overrides === 'object') ? overrides : {}),
        };
    }

    _getLearningPathPayload() {
        const snapshot = appState.getState();
        return snapshot.learningPath || this.goal?.learningPathRaw || { learning_path: this.goal?.learningPath || [] };
    }

    _getLearningSessionPayload() {
        const rawPath = this._getLearningPathPayload();
        const sessions = rawPath.learning_path || rawPath.sessions || rawPath.steps || this.goal?.learningPath || [];
        return sessions[this.sessionIndex] || this.session || {};
    }

    _ensureJsonString(value) {
        if (value == null) return '';
        if (typeof value === 'string') {
            return value;
        }
        try {
            return JSON.stringify(value);
        } catch (error) {
            console.warn('Failed to stringify value', value, error);
            return String(value);
        }
    }

    _extractDocumentString(payload) {
        if (!payload) return '';
        if (typeof payload === 'string') return payload;
        if (payload.document) return this._extractDocumentString(payload.document);
        if (payload.learning_document) return this._extractDocumentString(payload.learning_document);
        if (payload.markdown) return payload.markdown;
        if (Array.isArray(payload)) {
            return payload.map((item) => this._extractDocumentString(item)).join('\n\n');
        }
        return String(payload);
    }

    _normalizeKnowledgePoints(payload) {
        if (!payload) return [];
        if (Array.isArray(payload)) return payload;
        if (payload.knowledge_points) return this._normalizeKnowledgePoints(payload.knowledge_points);
        if (typeof payload === 'string') {
            try {
                return this._normalizeKnowledgePoints(JSON.parse(payload));
            } catch {
                return [];
            }
        }
        return [];
    }

    _normalizeKnowledgeDrafts(payload) {
        if (!payload) return [];
        if (Array.isArray(payload)) return payload;
        if (payload.knowledge_drafts) return this._normalizeKnowledgeDrafts(payload.knowledge_drafts);
        if (typeof payload === 'string') {
            try {
                return this._normalizeKnowledgeDrafts(JSON.parse(payload));
            } catch {
                return [];
            }
        }
        return [];
    }

    _normalizeLearningDocument(payload) {
        if (!payload) return '';
        if (typeof payload === 'string') {
            return payload;
        }
        if (payload.learning_document) {
            return this._normalizeLearningDocument(payload.learning_document);
        }
        if (payload.document) {
            return this._normalizeLearningDocument(payload.document);
        }
        return this._ensureJsonString(payload);
    }

    _normalizeQuizPayload(payload) {
        if (!payload) return {};
        if (payload.document_quiz) return this._normalizeQuizPayload(payload.document_quiz);
        if (typeof payload === 'string') {
            try {
                return this._normalizeQuizPayload(JSON.parse(payload));
            } catch {
                return {};
            }
        }
        return payload;
    }

    _sliceDocumentSections(markdown) {
        if (!markdown) return [];
        const sections = [];
        const regex = /^##\s+(.+)$/gm;
        let match;
        let lastIndex = 0;
        let currentTitle = this.session?.title || 'Overview';
        while ((match = regex.exec(markdown)) !== null) {
            const title = match[1].trim();
            const start = match.index;
            if (sections.length === 0) {
                const intro = markdown.slice(0, start).trim();
                if (intro) {
                    sections.push({
                        title: currentTitle,
                        content: intro,
                        anchor: this._slugify(currentTitle),
                    });
                }
            } else {
                const prev = markdown.slice(lastIndex, start).trim();
                if (prev) {
                    sections.push({
                        title: currentTitle,
                        content: prev,
                        anchor: this._slugify(currentTitle),
                    });
                }
            }
            currentTitle = title;
            lastIndex = regex.lastIndex;
        }
        const tail = markdown.slice(lastIndex).trim();
        if (tail) {
            sections.push({
                title: currentTitle,
                content: tail,
                anchor: this._slugify(currentTitle),
            });
        }
        return sections;
    }

    _normalizeQuizItems(payload) {
        const makeQuestion = (type, question, options = [], extras = {}) => {
            const idBase = `${type}-${question.slice(0, 32).replace(/\s+/g, '-').toLowerCase()}`;
            const id = `${idBase}-${Math.random().toString(16).slice(2, 6)}`;
            return { id, type, question, options, ...extras };
        };

        const asArray = (value) => (Array.isArray(value) ? value : []);
        const items = [];

        const single = asArray(payload.single_choice_questions);
        single.forEach((q, index) => {
            const questionText = q.question || `Single choice question ${index + 1}`;
            items.push(
                makeQuestion('single_choice', questionText, asArray(q.options), {
                    correctOption: typeof q.correct_option === 'number' ? q.correct_option : 0,
                    explanation: q.explanation || '',
                })
            );
        });

        const multi = asArray(payload.multiple_choice_questions);
        multi.forEach((q, index) => {
            const questionText = q.question || `Multiple choice question ${index + 1}`;
            const correct = asArray(q.correct_options).map((value) => Number(value));
            items.push(
                makeQuestion('multiple_choice', questionText, asArray(q.options), {
                    correctOptions: correct,
                    explanation: q.explanation || '',
                })
            );
        });

        const tf = asArray(payload.true_false_questions);
        tf.forEach((q, index) => {
            const questionText = q.question || `True/False question ${index + 1}`;
            const correct = typeof q.correct_answer === 'boolean' ? q.correct_answer : true;
            items.push(
                makeQuestion('true_false', questionText, [], {
                    correctAnswer: correct,
                    explanation: q.explanation || '',
                })
            );
        });

        const short = asArray(payload.short_answer_questions);
        short.forEach((q, index) => {
            const questionText = q.question || `Short answer question ${index + 1}`;
            items.push(
                makeQuestion('short_answer', questionText, [], {
                    expectedAnswer: q.expected_answer || '',
                    explanation: q.explanation || '',
                })
            );
        });

        return items;
    }

    _buildCoachIntro(question, isCorrect) {
        const prompt = [
            `Question: ${question.question}`,
            isCorrect
                ? 'The learner answered correctly. Provide a deeper Socratic question to reinforce understanding.'
                : 'The learner answered incorrectly. Guide them Socratically without revealing the answer.',
        ].join('\n\n');
        return prompt;
    }

    _buildCoachContext(question) {
        return [
            'You are a Socratic tutor guiding a learner through quiz questions.',
            `Question: ${question.question}`,
            'Ask probing questions, avoid giving direct answers unless necessary.',
            'Keep responses concise and focused on one concept.',
        ].join('\n\n');
    }

    _normalizeTutorResponse(response) {
        if (!response) return '';
        if (typeof response === 'string') return response;
        if (response.response) return this._normalizeTutorResponse(response.response);
        if (response.message) return this._normalizeTutorResponse(response.message);
        if (response.result) return this._normalizeTutorResponse(response.result);
        return JSON.stringify(response);
    }

    _renderMarkdown(markdown) {
        if (!markdown) return '<p>No content available.</p>';

        const escape = (text) => this._escapeHtml(text);
        const lines = markdown.split(/\r?\n/);
        let html = '';
        let listType = null;
        let inCode = false;
        let codeBuffer = [];
        
        // Debug: log if we have code blocks
        const hasCodeBlocks = markdown.includes('```');
        if (hasCodeBlocks) {
            console.log('[Markdown] Detected code blocks in content');
        }

        const flushList = () => {
            if (listType === 'ul') {
                html += '</ul>';
            } else if (listType === 'ol') {
                html += '</ol>';
            }
            listType = null;
        };

        const highlightCode = (code) => {
            // Simple syntax highlighting for Python-like code
            // Process line by line, protecting special parts first
            const lines = code.split('\n');
            const highlightedLines = lines.map(line => {
                // First, find and protect strings and comments
                const parts = [];
                let lastIndex = 0;
                let inString = false;
                let stringChar = '';
                let i = 0;
                
                while (i < line.length) {
                    // Check for string start/end
                    if (!inString && (line[i] === '"' || line[i] === "'")) {
                        // Check if it's not escaped
                        if (i === 0 || line[i - 1] !== '\\') {
                            if (lastIndex < i) {
                                parts.push({ type: 'code', text: line.substring(lastIndex, i) });
                            }
                            inString = true;
                            stringChar = line[i];
                            lastIndex = i;
                            i++;
                            // Find string end
                            while (i < line.length) {
                                if (line[i] === stringChar && line[i - 1] !== '\\') {
                                    parts.push({ type: 'string', text: line.substring(lastIndex, i + 1) });
                                    lastIndex = i + 1;
                                    inString = false;
                                    break;
                                }
                                i++;
                            }
                            if (inString) {
                                // Unclosed string
                                parts.push({ type: 'string', text: line.substring(lastIndex) });
                                lastIndex = line.length;
                                break;
                            }
                        }
                    }
                    // Check for comment (only if not in string)
                    if (!inString && line[i] === '#' && (i === 0 || line[i - 1] !== '\\')) {
                        if (lastIndex < i) {
                            parts.push({ type: 'code', text: line.substring(lastIndex, i) });
                        }
                        parts.push({ type: 'comment', text: line.substring(i) });
                        lastIndex = line.length;
                        break;
                    }
                    i++;
                }
                
                if (lastIndex < line.length && !inString) {
                    parts.push({ type: 'code', text: line.substring(lastIndex) });
                }
                
                // Process each part
                let result = '';
                parts.forEach(part => {
                    if (part.type === 'string') {
                        result += `<span class="string">${escape(part.text)}</span>`;
                    } else if (part.type === 'comment') {
                        result += `<span class="comment">${escape(part.text)}</span>`;
                    } else {
                        // Process code part for keywords, functions, numbers, etc.
                        let codeText = escape(part.text);
                        
                        // Class names (after 'class' keyword)
                        codeText = codeText.replace(/class\s+([A-Z][a-zA-Z0-9_]*)/g, 'class <span class="class-name">$1</span>');
                        
                        // Keywords
                        const keywords = ['import', 'from', 'def', 'if', 'else', 'elif', 'for', 'while', 'return', 'try', 'except', 'finally', 'with', 'as', 'pass', 'break', 'continue', 'raise', 'yield', 'lambda', 'and', 'or', 'not', 'in', 'is', 'None', 'True', 'False'];
                        keywords.forEach(keyword => {
                            const regex = new RegExp(`\\b(${keyword})\\b`, 'g');
                            codeText = codeText.replace(regex, (match) => {
                                if (match.includes('<span')) return match;
                                return `<span class="keyword">${match}</span>`;
                            });
                        });
                        
                        // Function calls (word before parenthesis, but not already highlighted)
                        codeText = codeText.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?=\()/g, (match, funcName) => {
                            if (keywords.includes(funcName) || match.includes('<span')) return match;
                            return `<span class="function">${funcName}</span>`;
                        });
                        
                        // Numbers
                        codeText = codeText.replace(/\b(\d+\.?\d*)\b/g, '<span class="number">$1</span>');
                        
                        result += codeText;
                    }
                });
                
                return result || escape(line);
            });
            
            return highlightedLines.join('\n');
        };

        const flushCode = () => {
            if (inCode) {
                const codeText = codeBuffer.join('\n');
                // Only render if there's actual code content
                if (codeText.trim()) {
                    try {
                        const highlighted = highlightCode(codeText);
                        html += `<pre class="kd-code-block"><code>${highlighted}</code></pre>`;
                        console.log('[Markdown] Rendered code block with highlighting, length:', codeText.length);
                    } catch (error) {
                        // Fallback: render without highlighting
                        console.warn('[Markdown] Code highlighting failed, rendering plain:', error);
                        html += `<pre class="kd-code-block"><code>${escape(codeText)}</code></pre>`;
                    }
                } else {
                    console.warn('[Markdown] Empty code block detected');
                }
                codeBuffer = [];
                inCode = false;
            }
        };

        lines.forEach((line) => {
            const trimmed = line.trimEnd();
            
            // Check for code block markers (```)
            if (trimmed.startsWith('```')) {
                if (inCode) {
                    // End of code block
                    flushCode();
                } else {
                    // Start of code block
                    flushList();
                    inCode = true;
                    // Don't include the ``` marker in the code buffer
                }
                return;
            }

            // If we're inside a code block, add to buffer
            if (inCode) {
                codeBuffer.push(line);
                return;
            }

            if (/^[-*+]\s+/.test(trimmed)) {
                flushCode();
                if (listType !== 'ul') {
                    flushList();
                    html += '<ul>';
                    listType = 'ul';
                }
                const item = trimmed.replace(/^[-*+]\s+/, '');
                html += `<li>${this._formatInlineMarkdown(item)}</li>`;
            } else if (trimmed.startsWith('### ')) {
                flushList();
                flushCode();
                html += `<h3>${escape(trimmed.slice(4))}</h3>`;
            } else if (trimmed.startsWith('## ')) {
                flushList();
                flushCode();
                html += `<h2>${escape(trimmed.slice(3))}</h2>`;
            } else if (trimmed.startsWith('# ')) {
                flushList();
                flushCode();
                html += `<h1>${escape(trimmed.slice(2))}</h1>`;
            } else if (trimmed === '') {
                flushList();
                html += '<p></p>';
            } else if (/^\d+\.\s+/.test(trimmed)) {
                flushCode();
                const numberMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
                if (numberMatch) {
                    if (listType !== 'ol') {
                        flushList();
                        html += '<ol>';
                        listType = 'ol';
                    }
                    html += `<li>${this._formatInlineMarkdown(numberMatch[2])}</li>`;
                }
            } else {
                flushList();
                html += `<p>${this._formatInlineMarkdown(trimmed)}</p>`;
            }
        });

        flushList();
        flushCode();
        return html;
    }

    _formatInlineMarkdown(text) {
        if (!text) return '';
        let formatted = this._escapeHtml(text);
        formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        formatted = formatted.replace(/\*(.+?)\*/g, '<em>$1</em>');
        formatted = formatted.replace(/`(.+?)`/g, '<code>$1</code>');
        formatted = formatted.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        return formatted;
    }

    _escapeHtml(value) {
        if (value == null) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    _slugify(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }
}

const knowledgeDocumentPage = new KnowledgeDocumentPage();
export default knowledgeDocumentPage;

