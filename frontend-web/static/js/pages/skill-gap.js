import { API } from '../api.js';
import { state as appState } from '../state.js';
import { router } from '../router.js';

const MODEL_PROVIDER = 'shared';
const MODEL_NAME = 'gpt-oss-120b';
const ONBOARDING_STORAGE_KEY = 'gm.onboarding';

class SkillGapPage {
    constructor() {
        this.container = null;
        this.status = 'idle'; // idle | loading | ready | error | empty
        this.error = null;
        this.onboardingData = null;
        this.rawSkillGaps = [];
        this.skillGaps = [];
        this.meta = null;
        this.analysisSource = 'info';
    }

    async initialize() {
        this.status = 'idle';
        this.error = null;
        this.rawSkillGaps = [];
        this.skillGaps = [];
        this.meta = null;
        this.onboardingData = this._loadOnboardingState();
    }

    async render(container) {
        if (!container) return;

        this.container = container;

        if (!this.onboardingData) {
            container.innerHTML = this._renderMissingOnboarding();
            this._bindOnboardingCta();
            return;
        }

        if (this.status === 'idle') {
            this.status = 'loading';
            container.innerHTML = this._renderLoading();
            await this._fetchSkillGaps();
            return;
        }

        if (this.status === 'loading') {
            container.innerHTML = this._renderLoading();
            return;
        }

        if (this.status === 'error') {
            container.innerHTML = this._renderError();
            this._bindRetry();
            return;
        }

        container.innerHTML = this._renderContent();
        this._bindContentEvents();
    }

    _loadOnboardingState() {
        let storedState = null;
        try {
            const raw = localStorage.getItem(ONBOARDING_STORAGE_KEY);
            console.debug('[SkillGap] Raw onboarding storage:', raw);
            if (raw) storedState = JSON.parse(raw);
        } catch (error) {
            console.error('Failed to parse stored onboarding state', error);
        }

        const globalState = appState.getState();
        console.debug('[SkillGap] Global state snapshot:', globalState);
        const stateSnapshot = globalState?.onboarding;
        const merged = storedState || stateSnapshot;

        if (!merged) {
            return null;
        }

        const learningGoal =
            (merged.refinedGoal && merged.refinedGoal.trim().length >= 5 ? merged.refinedGoal : null) ||
            merged.learningGoal ||
            globalState?.toAddGoal?.learningGoal ||
            '';

        if (!learningGoal) {
            return null;
        }

        console.debug('[SkillGap] Loaded onboarding goal:', {
            learningGoal,
            sourceRefined: merged.refinedGoal,
            sourceRaw: merged.learningGoal,
            globalGoal: globalState?.toAddGoal?.learningGoal
        });

        return {
            ...merged,
            learningGoal: merged.learningGoal || globalState?.toAddGoal?.learningGoal || '',
            refinedGoal:
                merged.refinedGoal && merged.refinedGoal.trim().length >= 5
                    ? merged.refinedGoal
                    : learningGoal,
            occupation: merged.occupation || globalState?.learnerOccupation || '',
            otherOccupation: merged.otherOccupation || '',
            learningPreference:
                merged.learningPreference || globalState?.learnerInformationText || '',
            resumeFileName: merged.resumeFileName || '',
        };
    }

    async _fetchSkillGaps() {
        try {
            const response = await this._identifySkillGaps(this.onboardingData);
            this.rawSkillGaps = Array.isArray(response?.skill_gaps) ? response.skill_gaps : [];
            this.skillGaps = this._normalizeSkillGaps(this.rawSkillGaps);
            this.meta = {
                total: this.skillGaps.length,
                gaps: this._countGaps(this.skillGaps),
                summary: this._buildSummary(this.skillGaps),
                cvPath: response?.cv_path || null,
            };
            this.status = this.skillGaps.length ? 'ready' : 'empty';
            this._persistSkillGapState();
        } catch (error) {
            console.error('Failed to identify skill gaps', error);
            this.error = error;
            this.status = 'error';
        }

        if (this.container) {
            await this.render(this.container);
        }
    }

    async _identifySkillGaps(onboardingData) {
        const refined = onboardingData.refinedGoal;
        const raw = onboardingData.learningGoal;
        const learningGoal =
            refined && refined.trim().length >= 5
                ? refined.trim()
                : raw?.trim() || '';

        if (!learningGoal || learningGoal.length < 5) {
            throw new Error('학습 목표가 비어 있거나 너무 짧습니다. 최소 5자 이상 구체적으로 입력해주세요.');
        }

        console.debug('[SkillGap] Using learning goal:', learningGoal, {
            refinedGoal: onboardingData.refinedGoal,
            rawGoal: onboardingData.learningGoal,
        });

        const occupationValue =
            onboardingData.occupation === 'Other'
                ? onboardingData.otherOccupation || 'Other'
                : onboardingData.occupation || 'Unknown';

        const learnerInformation = {
            occupation: occupationValue,
            learning_style: onboardingData.learningPreference || '',
        };

        return await API.identifySkillGapWithInfo(
            learningGoal,
            learnerInformation,
            null,
            MODEL_PROVIDER,
            MODEL_NAME
        );
    }

    _normalizeSkillGaps(skills) {
        if (!Array.isArray(skills)) return [];

        return skills.map((skill, index) => {
            const name = skill.name || skill.skill_name || `Skill ${index + 1}`;
            const requiredLevel = this._normalizeLevel(
                skill.required_level ?? skill.requiredLevel ?? 'intermediate'
            );
            const currentLevel = this._normalizeLevel(
                skill.current_level ?? skill.currentLevel ?? 'beginner'
            );
            const analysis =
                skill.analysis ||
                skill.details ||
                skill.summary ||
                'No detailed analysis available.';
            const recommendations =
                skill.recommendations ||
                skill.improvement_points ||
                skill.suggestions ||
                [];
            const isGap =
                typeof skill.is_gap === 'boolean'
                    ? skill.is_gap
                    : this._levelToRank(currentLevel) < this._levelToRank(requiredLevel);

            return {
                index,
                name,
                requiredLevel,
                currentLevel,
                analysis,
                recommendations: Array.isArray(recommendations)
                    ? recommendations
                    : [recommendations].filter(Boolean),
                isGap,
                expanded: false,
            };
        });
    }

    _normalizeLevel(level) {
        if (typeof level === 'number') {
            return ['unlearned', 'beginner', 'intermediate', 'advanced'][Math.min(Math.max(level, 0), 3)] ?? 'beginner';
        }

        const normalized = String(level || '')
            .toLowerCase()
            .replace(/[^a-z]/g, '');

        const allowed = ['unlearned', 'beginner', 'intermediate', 'advanced'];
        if (allowed.includes(normalized)) {
            return normalized;
        }

        if (normalized === 'novice') return 'beginner';
        if (normalized === 'expert') return 'advanced';
        return 'beginner';
    }

    _levelToRank(level) {
        switch (level) {
            case 'advanced':
                return 3;
            case 'intermediate':
                return 2;
            case 'beginner':
                return 1;
            default:
                return 0;
        }
    }

    _buildSummary(skills) {
        const total = skills.length;
        const gaps = this._countGaps(skills);

        if (!total) {
            return 'No skills identified yet. Try refreshing the analysis.';
        }

        const gapLabel = gaps === 1 ? 'skill gap' : 'skill gaps';
        return `There are ${total} skills in total, with ${gaps} ${gapLabel} identified.`;
    }

    _countGaps(skills) {
        return skills.filter((skill) => skill.isGap).length;
    }

    _persistSkillGapState() {
        try {
            const current = appState.getState();
            const onboardingSnapshot = {
                ...(current.onboarding || {}),
                ...(this.onboardingData || {}),
                refinedGoal:
                    this.onboardingData?.refinedGoal &&
                    this.onboardingData.refinedGoal.trim().length >= 5
                        ? this.onboardingData.refinedGoal
                        : this.onboardingData?.learningGoal || '',
                skillGaps: this.rawSkillGaps,
            };

            appState.setState({
                skillGaps: this.rawSkillGaps,
                onboarding: onboardingSnapshot,
                completedOnboarding: true,
            });

            try {
                localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(onboardingSnapshot));
            } catch (error) {
                console.warn('Failed to persist onboarding snapshot to storage', error);
            }
        } catch (error) {
            console.warn('Failed to persist skill gap state', error);
        }
    }

    _renderLoading() {
        return `
            <div class="skill-gap-shell">
                <div class="skill-gap-loading">
                    <div class="skill-gap-spinner"></div>
                    <p>Analyzing your skill gaps...</p>
                </div>
            </div>
        `;
    }

    _renderError() {
        const message =
            this.error?.message ||
            'Failed to analyze skill gaps. Please check your connection and try again.';

        return `
            <div class="skill-gap-shell">
                <header class="skill-gap-header">
                    <div>
                        <h1>Skill Gap Analysis</h1>
                        <p>Review and confirm your skill gaps.</p>
                    </div>
                </header>
                <div class="skill-gap-error">
                    <p>${this._escapeHtml(message)}</p>
                    <button class="skill-gap-btn" data-action="retry-analysis">Retry</button>
                </div>
            </div>
        `;
    }

    _renderMissingOnboarding() {
        return `
            <div class="skill-gap-shell">
                <header class="skill-gap-header">
                    <div>
                        <h1>Skill Gap Analysis</h1>
                        <p>Complete the onboarding flow to analyze your skills.</p>
                    </div>
                </header>
                <div class="skill-gap-error">
                    <p>We couldn't find onboarding information. Please finish onboarding first.</p>
                    <button class="skill-gap-btn skill-gap-btn--primary" data-action="go-to-onboarding">
                        Go to Onboarding
                    </button>
                </div>
            </div>
        `;
    }

    _renderEmptyState() {
        return `
            <div class="skill-gap-shell">
                <header class="skill-gap-header">
                    <div>
                        <h1>Skill Gap Analysis</h1>
                        <p>Review and confirm your skill gaps.</p>
                    </div>
                    <div class="skill-gap-header-actions">
                        <button class="skill-gap-btn" data-action="refresh-analysis">Refresh Analysis</button>
                    </div>
                </header>
                <div class="skill-gap-banner">
                    <span class="skill-gap-banner__icon">ℹ️</span>
                    <span id="skill-gap-summary">${this.meta?.summary || 'No skills identified yet. Try refreshing the analysis.'}</span>
                </div>
                <div class="skill-gap-empty">
                    <p>No skill gaps identified yet. Try refreshing the analysis.</p>
                </div>
            </div>
        `;
    }

    _renderContent() {
        if (this.status === 'empty') {
            return this._renderEmptyState();
        }

        return `
            <div class="skill-gap-shell">
                <header class="skill-gap-header">
                    <div>
                        <h1>Skill Gap Analysis</h1>
                        <p>Review and confirm your skill gaps.</p>
                    </div>
                    <div class="skill-gap-header-actions">
                        <button class="skill-gap-btn" data-action="refresh-analysis">Refresh Analysis</button>
                    </div>
                </header>

                <div class="skill-gap-banner">
                    <span class="skill-gap-banner__icon">ℹ️</span>
                    <span id="skill-gap-summary">${this._escapeHtml(this.meta?.summary || '')}</span>
                </div>

                <section class="skill-gap-list" id="skill-gap-list">
                    ${this.skillGaps.map((skill) => this._renderSkillCard(skill)).join('')}
                </section>

                <footer class="skill-gap-footer">
                    <button class="skill-gap-btn" data-action="refresh-analysis">Re-run Analysis</button>
                    <button class="skill-gap-btn skill-gap-btn--primary" data-action="schedule-learning-path">
                        Save & Continue
                    </button>
                </footer>
            </div>
        `;
    }

    _renderSkillCard(skill) {
        const levels = ['unlearned', 'beginner', 'intermediate', 'advanced'];

        const renderLevel = (role, activeLevel) =>
            levels
                .map(
                    (level) => `
                <button
                    type="button"
                    class="skill-gap-pill ${level === activeLevel ? 'skill-gap-pill--active' : ''}"
                    data-action="set-level"
                    data-role="${role}"
                    data-level="${level}"
                    data-index="${skill.index}"
                >
                    ${level}
                </button>
            `
                )
                .join('');

        const recommendations = skill.recommendations?.length
            ? `
                <ul class="skill-gap-recommendations">
                    ${skill.recommendations
                        .map((item) => `<li>${this._escapeHtml(item)}</li>`)
                        .join('')}
                </ul>
            `
            : '';

        return `
            <article class="skill-gap-card ${skill.isGap ? 'skill-gap-card--gap' : ''}" data-skill-card="${skill.index}">
                <header class="skill-gap-card__header">
                    <div>
                        <h2>${this._escapeHtml(skill.name)}</h2>
                        <p>${this._formatLevelText(skill.currentLevel)} → ${this._formatLevelText(
            skill.requiredLevel
        )}</p>
                    </div>
                    <label class="skill-gap-switch">
                        <input type="checkbox" data-action="mark-gap" data-index="${skill.index}" ${
            skill.isGap ? 'checked' : ''
        }>
                        <span class="skill-gap-switch__slider"></span>
                        <span class="skill-gap-switch__label">Mark as Gap</span>
                    </label>
                </header>

                <div class="skill-gap-card__levels">
                    <div class="skill-gap-level-group">
                        <p>Required Level</p>
                        <div class="skill-gap-pill-row">
                            ${renderLevel('required', skill.requiredLevel)}
                        </div>
                    </div>
                    <div class="skill-gap-level-group">
                        <p>Current Level</p>
                        <div class="skill-gap-pill-row">
                            ${renderLevel('current', skill.currentLevel)}
                        </div>
                    </div>
                </div>

                <div class="skill-gap-details">
                    <button class="skill-gap-details__toggle" data-action="toggle-details" data-index="${skill.index}">
                        <span>More Analysis Details</span>
                        <span class="skill-gap-details__icon" data-icon="${skill.index}">⌄</span>
                    </button>
                    <div class="skill-gap-details__content" data-details="${skill.index}">
                        <p>${this._escapeHtml(skill.analysis)}</p>
                        ${recommendations}
                    </div>
                </div>
            </article>
        `;
    }

    _formatLevelText(level) {
        return level.charAt(0).toUpperCase() + level.slice(1);
    }

    _bindOnboardingCta() {
        const button = this.container.querySelector('[data-action="go-to-onboarding"]');
        if (button) {
            button.addEventListener('click', () => router.navigateTo('onboarding'));
        }
    }

    _bindRetry() {
        const button = this.container.querySelector('[data-action="retry-analysis"]');
        if (button) {
            button.addEventListener('click', () => this._refreshAnalysis());
        }
    }

    _bindContentEvents() {
        const refreshButtons = this.container.querySelectorAll('[data-action="refresh-analysis"]');
        refreshButtons.forEach((btn) => {
            btn.addEventListener('click', () => this._refreshAnalysis());
        });

        const detailButtons = this.container.querySelectorAll('[data-action="toggle-details"]');
        detailButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const index = Number(btn.dataset.index);
                this._toggleDetails(index, btn);
            });
        });

        const gapToggles = this.container.querySelectorAll('[data-action="mark-gap"]');
        gapToggles.forEach((input) => {
            input.addEventListener('change', (event) => {
                const index = Number(event.currentTarget.dataset.index);
                this._toggleGap(index, event.currentTarget.checked);
            });
        });

        const levelButtons = this.container.querySelectorAll('[data-action="set-level"]');
        levelButtons.forEach((btn) => {
            btn.addEventListener('click', (event) => {
                const target = event.currentTarget;
                const index = Number(target.dataset.index);
                const role = target.dataset.role;
                const level = target.dataset.level;
                this._setSkillLevel(index, role, level);
            });
        });

        const scheduleButton = this.container.querySelector(
            '[data-action="schedule-learning-path"]'
        );
        if (scheduleButton) {
            scheduleButton.addEventListener('click', () => this._scheduleLearningPath(scheduleButton));
        }
    }

    _toggleDetails(index, trigger) {
        const content = this.container.querySelector(`[data-details="${index}"]`);
        const icon = this.container.querySelector(`[data-icon="${index}"]`);

        if (!content) return;

        const isExpanded = content.classList.toggle('skill-gap-details__content--expanded');
        if (icon) {
            icon.classList.toggle('skill-gap-details__icon--expanded', isExpanded);
        }
        if (trigger) {
            trigger.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
        }
    }

    _toggleGap(index, isChecked) {
        const skill = this.skillGaps.find((item) => item.index === index);
        if (!skill) return;

        skill.isGap = isChecked;
        if (this.rawSkillGaps[index]) {
            this.rawSkillGaps[index].is_gap = isChecked;
        }

        const card = this.container.querySelector(`[data-skill-card="${index}"]`);
        if (card) {
            card.classList.toggle('skill-gap-card--gap', isChecked);
        }

        this._recalculateMeta();
        this._persistSkillGapState();
    }

    _updateSummaryText() {
        const summary = this.container.querySelector('#skill-gap-summary');
        if (summary && this.meta?.summary) {
            summary.textContent = this.meta.summary;
        }
    }

    _setSkillLevel(index, role, level) {
        const skill = this.skillGaps.find((item) => item.index === index);
        if (!skill) return;
        if (!['required', 'current'].includes(role)) return;

        const normalizedLevel = this._normalizeLevel(level);
        if (role === 'required') {
            skill.requiredLevel = normalizedLevel;
            if (this.rawSkillGaps[index]) {
                this.rawSkillGaps[index].required_level = normalizedLevel;
                this.rawSkillGaps[index].requiredLevel = normalizedLevel;
            }
        } else {
            skill.currentLevel = normalizedLevel;
            if (this.rawSkillGaps[index]) {
                this.rawSkillGaps[index].current_level = normalizedLevel;
                this.rawSkillGaps[index].currentLevel = normalizedLevel;
            }
        }

        const computedGap =
            this._levelToRank(skill.currentLevel) < this._levelToRank(skill.requiredLevel);
        skill.isGap = computedGap;
        if (this.rawSkillGaps[index]) {
            this.rawSkillGaps[index].is_gap = computedGap;
        }

        this._refreshSkillCard(index);
        this._recalculateMeta();
        this._persistSkillGapState();
    }

    _refreshSkillCard(index) {
        const skill = this.skillGaps.find((item) => item.index === index);
        if (!skill || !this.container) return;

        const card = this.container.querySelector(`[data-skill-card="${index}"]`);
        if (!card) return;

        ['required', 'current'].forEach((role) => {
            const activeLevel = role === 'required' ? skill.requiredLevel : skill.currentLevel;
            const buttons = card.querySelectorAll(
                `[data-action="set-level"][data-role="${role}"][data-index="${index}"]`
            );
            buttons.forEach((btn) => {
                btn.classList.toggle('skill-gap-pill--active', btn.dataset.level === activeLevel);
            });
        });

        const toggle = card.querySelector('[data-action="mark-gap"]');
        if (toggle) {
            toggle.checked = !!skill.isGap;
        }
        card.classList.toggle('skill-gap-card--gap', !!skill.isGap);
    }

    _recalculateMeta() {
        if (!this.meta) return;
        this.meta.gaps = this._countGaps(this.skillGaps);
        this.meta.summary = this._buildSummary(this.skillGaps);
        this._updateSummaryText();
    }

    async _scheduleLearningPath(button) {
        if (!this.onboardingData) return;

        const originalLabel = button.textContent;
        button.disabled = true;
        button.textContent = 'Saving...';

        const learningGoal = this.onboardingData.refinedGoal || this.onboardingData.learningGoal;
        const learnerInformation = {
            occupation:
                this.onboardingData.occupation === 'Other'
                    ? this.onboardingData.otherOccupation || 'Other'
                    : this.onboardingData.occupation || 'Unknown',
            learning_style: this.onboardingData.learningPreference || '',
        };

        try {
            let profileResponse;
            if (this.meta?.cvPath) {
                profileResponse = await API.createLearnerProfile(
                    this.meta.cvPath,
                    learningGoal,
                    this.rawSkillGaps,
                    MODEL_PROVIDER,
                    MODEL_NAME
                );
            } else {
                profileResponse = await API.createLearnerProfileWithInfo(
                    learnerInformation,
                    learningGoal,
                    this.rawSkillGaps,
                    MODEL_PROVIDER,
                    MODEL_NAME
                );
            }

            console.debug('[SkillGap] Profile response received:', profileResponse);

            const profilePayload = profileResponse?.learner_profile ?? profileResponse ?? {};
            const profileForScheduling =
                typeof profilePayload === 'string' ? profilePayload : JSON.stringify(profilePayload);

            let learningPathResponse = profileResponse?.learning_path;
            if (!learningPathResponse) {
                const targetSessions = Math.min(
                    10,
                    Math.max(4, Array.isArray(this.rawSkillGaps) ? this.rawSkillGaps.length || 6 : 6)
                );
                console.debug(
                    '[SkillGap] Scheduling learning path',
                    { targetSessions, skillGapCount: this.rawSkillGaps?.length }
                );
                const scheduleResponse = await API.scheduleLearningPath(
                    profileForScheduling,
                    targetSessions,
                    MODEL_PROVIDER,
                    MODEL_NAME
                );
                console.debug('[SkillGap] Schedule response:', scheduleResponse);
                learningPathResponse =
                    scheduleResponse?.learning_path ?? scheduleResponse ?? { steps: [] };
            }

            const normalizedProfile =
                typeof profilePayload === 'string'
                    ? (() => {
                          try {
                              return JSON.parse(profilePayload);
                          } catch (error) {
                              console.warn('[SkillGap] Failed to parse profile payload', error);
                              return { raw: profilePayload };
                          }
                      })()
                    : profilePayload;

            const normalizedLearningPath =
                typeof learningPathResponse === 'string'
                    ? (() => {
                          try {
                              return JSON.parse(learningPathResponse);
                          } catch (error) {
                              console.warn(
                                  '[SkillGap] Failed to parse learning path payload',
                                  error
                              );
                              return { raw: learningPathResponse, steps: [] };
                          }
                      })()
                    : learningPathResponse;

            const learningPathSessions = Array.isArray(normalizedLearningPath?.learning_path)
                ? normalizedLearningPath.learning_path
                : Array.isArray(normalizedLearningPath?.steps)
                    ? normalizedLearningPath.steps
                    : Array.isArray(normalizedLearningPath)
                        ? normalizedLearningPath
                        : [];

            const stateSnapshot = appState.getState();
            const existingGoals = Array.isArray(stateSnapshot.goals) ? [...stateSnapshot.goals] : [];
            let selectedGoalId = stateSnapshot.selectedGoalId;

            if (
                selectedGoalId === null ||
                selectedGoalId === undefined ||
                !existingGoals.some((goal) => goal.id === selectedGoalId)
            ) {
                selectedGoalId = Date.now();
            }

            const existingIndex = existingGoals.findIndex((goal) => goal.id === selectedGoalId);
            const goalRecord = {
                id: selectedGoalId,
                learningGoal,
                refinedGoal: this.onboardingData.refinedGoal || learningGoal,
                skillGaps: this.rawSkillGaps,
                learnerProfile: normalizedProfile,
                learningPath: learningPathSessions,
                learningPathRaw: normalizedLearningPath,
                createdAt:
                    existingIndex >= 0 && existingGoals[existingIndex]?.createdAt
                        ? existingGoals[existingIndex].createdAt
                        : new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            if (existingIndex >= 0) {
                existingGoals[existingIndex] = { ...existingGoals[existingIndex], ...goalRecord };
            } else {
                existingGoals.push(goalRecord);
            }

            appState.setState({
                learnerProfile: normalizedProfile,
                learningPath: normalizedLearningPath,
                skillGaps: this.rawSkillGaps,
                goals: existingGoals,
                documentCaches: {},
                sessionLearningTimes: {},
                knowledgeSessionState: {},
                selectedGoalId,
                onboarding: {
                    ...(stateSnapshot.onboarding || {}),
                    ...(this.onboardingData || {}),
                    skillGaps: this.rawSkillGaps,
                },
                completedOnboarding: true,
            });

            try {
                localStorage.setItem(
                    'learning.path.state',
                    JSON.stringify({
                        goals: existingGoals,
                        selectedGoalId,
                        learnerProfile: normalizedProfile,
                        learningPath: normalizedLearningPath,
                        skillGaps: this.rawSkillGaps,
                        updatedAt: new Date().toISOString(),
                    })
                );
            } catch (error) {
                console.warn('Failed to persist learning path snapshot', error);
            }

            router.navigateTo('learning-path');
        } catch (error) {
            console.error('Failed to schedule learning path', error);
            alert('Failed to save and continue. Please try again.');
        } finally {
            button.disabled = false;
            button.textContent = originalLabel;
        }
    }

    _refreshAnalysis() {
        this.onboardingData = this._loadOnboardingState();
        this.status = this.onboardingData ? 'idle' : 'empty';
        this.error = null;
        this.rawSkillGaps = [];
        this.skillGaps = [];
        this.meta = null;

        if (!this.container) return;
        this.render(this.container);
    }

    _escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

const skillGapPage = new SkillGapPage();
export default skillGapPage;