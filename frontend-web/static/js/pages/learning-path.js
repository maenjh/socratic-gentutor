import { API } from '../api.js';
import { state as appState } from '../state.js';
import { router } from '../router.js';

const MODEL_PROVIDER = 'shared';
const MODEL_NAME = 'gpt-oss-120b';
const MIN_SESSIONS = 1;
const MAX_SESSIONS = 10;

class LearningPathPage {
    constructor() {
        this.container = null;
        this.goal = null;
        this.learningPath = [];
        this.loading = false;
        this.error = null;
        this.skillDetailsOpen = false;
        this.rescheduleOpen = false;
        this.expectedSessions = 6;
        this.openSessions = new Set();
    }

    async initialize() {
        this.loading = true;
        this.error = null;
        this.skillDetailsOpen = false;
        this.rescheduleOpen = false;
        this.openSessions = new Set();

        try {
            this._bootstrapStateFromStorage();
            await this._ensureGoalData();
        } catch (error) {
            console.error('[LearningPath] Failed to initialize learning path', error);
            this.error = error;
        } finally {
            this.loading = false;
        }
    }

    render(container) {
        if (!container) return;
        this.container = container;

        if (this.loading) {
            container.innerHTML = `
                <div class="lp-loading">
                    <div class="lp-spinner"></div>
                    <p>Preparing your personalized learning path...</p>
                </div>
            `;
            return;
        }

        if (this.error) {
            container.innerHTML = `
                <div class="lp-error-card">
                    <h2>Unable to load learning path</h2>
                    <p>${this.error.message || 'Please try again in a moment.'}</p>
                    <button class="button primary" data-action="go-to-skill-gap">
                        Return to Skill Gap
                    </button>
                </div>
            `;
            this._bindEvents();
            return;
        }

        if (!this.goal) {
            container.innerHTML = `
                <div class="lp-empty">
                    <h2>Learning path not ready yet</h2>
                    <p>Complete the onboarding and skill gap steps first to generate your learning plan.</p>
                    <button class="button primary" data-action="go-to-skill-gap">
                        Start Skill Gap Analysis
                    </button>
                </div>
            `;
            this._bindEvents();
            return;
        }

        if (!Array.isArray(this.learningPath) || !this.learningPath.length) {
            container.innerHTML = `
                <div class="lp-empty">
                    <h2>No sessions scheduled</h2>
                    <p>We couldn’t find any sessions for your current goal. Try re-running the scheduling process.</p>
                    <div class="lp-empty-actions">
                        <button class="button secondary" data-action="go-to-skill-gap">
                            Update Skill Gap
                        </button>
                        <button class="button primary" data-action="trigger-reschedule">
                            Schedule Learning Path
                        </button>
                    </div>
                </div>
            `;
            this._bindEvents();
            return;
        }

        const { completedSessions, totalSessions, progressPercent } = this._computeProgress();
        const progressMessage =
            progressPercent >= 100
                ? '🎉 Congratulations! All sessions are complete.'
                : '🚀 Keep going! You’re making great progress.';

        container.innerHTML = `
            <div class="lp-wrapper">
                <header class="lp-header">
                    <div>
                        <h1>Learning Path</h1>
                        <p class="lp-subtitle">
                            Track your learning progress through curated sessions tailored to your goals.
                        </p>
                    </div>
                    <button class="button ghost" data-action="go-to-goal-management">
                        Manage Goals
                    </button>
                </header>

                <section class="lp-card">
                    <div class="lp-card-header">
                        <h2>🎯 Current Goal</h2>
                    </div>
                    <textarea class="lp-goal-text" disabled>${this.goal.refinedGoal || this.goal.learningGoal || ''}</textarea>
                </section>

                <section class="lp-card">
                    <div class="lp-card-header">
                        <h2>📊 Overall Progress</h2>
                        <button class="button link" data-action="toggle-skill-details">
                            ${this.skillDetailsOpen ? 'Hide Skill Details' : 'View Skill Details'}
                        </button>
                    </div>
                    <div class="lp-progress">
                        <div class="lp-progress-bar">
                            <div class="lp-progress-fill" style="width: ${progressPercent}%"></div>
                        </div>
                        <p class="lp-progress-label">${completedSessions}/${totalSessions} sessions completed (${progressPercent}%)</p>
                        <p class="lp-progress-message ${progressPercent >= 100 ? 'lp-success' : 'lp-info'}">
                            ${progressMessage}
                        </p>
                    </div>
                    ${this.skillDetailsOpen ? this._renderSkillDetails() : ''}
                </section>

                <section class="lp-card">
                    <div class="lp-card-header">
                        <h2>📖 Learning Sessions</h2>
                        <button class="button outline" data-action="toggle-reschedule">
                            ${this.rescheduleOpen ? 'Close' : 'Re-schedule Learning Path'}
                        </button>
                    </div>
                    ${this.rescheduleOpen ? this._renderReschedulePanel() : ''}
                    <div class="lp-session-grid">
                        ${this.learningPath.map((session, index) => this._renderSessionCard(session, index)).join('')}
                    </div>
                </section>
            </div>
        `;

        this._bindEvents();
    }

    _bootstrapStateFromStorage() {
        const stateSnapshot = appState.getState();
        const persisted = this._loadPersistedState();

        if ((!Array.isArray(stateSnapshot.goals) || !stateSnapshot.goals.length) && persisted?.goals?.length) {
            const normalizedPersistedGoals = persisted.goals.map((goal) => this._normalizeGoal(goal));
            appState.setState({
                goals: normalizedPersistedGoals,
                selectedGoalId: persisted.selectedGoalId ?? normalizedPersistedGoals[0]?.id ?? null,
                learnerProfile: persisted.learnerProfile ?? stateSnapshot.learnerProfile,
                learningPath: persisted.learningPath ?? stateSnapshot.learningPath,
                skillGaps: persisted.skillGaps ?? stateSnapshot.skillGaps,
            });
        } else if (Array.isArray(stateSnapshot.goals) && stateSnapshot.goals.length) {
            const normalizedGoals = stateSnapshot.goals.map((goal) => this._normalizeGoal(goal));
            appState.setState({ goals: normalizedGoals });
        }

        const refreshedState = appState.getState();
        const goals = Array.isArray(refreshedState.goals) ? refreshedState.goals : [];
        let selectedGoalId = refreshedState.selectedGoalId;

        if ((!selectedGoalId || !goals.some((goal) => goal.id === selectedGoalId)) && goals.length) {
            selectedGoalId = goals[0].id;
            appState.setState({ selectedGoalId });
        }

        this.goal = goals.find((goal) => goal.id === selectedGoalId) || null;
        this.learningPath = Array.isArray(this.goal?.learningPath)
            ? [...this.goal.learningPath]
            : [];
        this.expectedSessions = this.learningPath.length
            || Math.min(
                MAX_SESSIONS,
                Math.max(MIN_SESSIONS, this.goal?.skillGaps?.length || 6)
            );
        this.selectedGoalId = selectedGoalId || null;
    }

    async _ensureGoalData() {
        if (!this.goal) return;
        if (!Array.isArray(this.goal.learningPath) || !this.goal.learningPath.length) {
            const sessionCount = Math.min(
                MAX_SESSIONS,
                Math.max(MIN_SESSIONS, this.expectedSessions || this.goal.skillGaps?.length || 6)
            );
            await this._scheduleGoal(sessionCount);
        } else {
            this.learningPath = this.goal.learningPath.map((session, index) =>
                this._normalizeSession(session, index)
            );
            this._saveGoal({ ...this.goal, learningPath: this.learningPath });
        }
    }

    async _scheduleGoal(sessionCount) {
        if (!this.goal) return;
        const learnerProfile = this.goal.learnerProfile || {};

        const normalizedCount = Math.min(MAX_SESSIONS, Math.max(MIN_SESSIONS, sessionCount || 6));

        const response = await API.scheduleLearningPath(
            JSON.stringify(learnerProfile),
            normalizedCount,
            MODEL_PROVIDER,
            MODEL_NAME
        );

        const { sessions, raw } = this._normalizeLearningPathResponse(response);
        const normalizedSessions = sessions.map((session, index) => this._normalizeSession(session, index));

        const updatedGoal = {
            ...this.goal,
            learningPath: normalizedSessions,
            learningPathRaw: raw,
            updatedAt: new Date().toISOString(),
        };

        this.learningPath = normalizedSessions;
        this.expectedSessions = normalizedSessions.length || normalizedCount;
        this._saveGoal(updatedGoal);
    }

    async _rescheduleGoal(sessionCount) {
        if (!this.goal) return;
        const learnerProfile = this.goal.learnerProfile || {};
        const currentPath = this.goal.learningPathRaw?.learning_path || this.goal.learningPath || [];

        const normalizedCount = Math.min(MAX_SESSIONS, Math.max(MIN_SESSIONS, sessionCount || currentPath.length || 6));

        const response = await API.rescheduleLearningPath(
            JSON.stringify(learnerProfile),
            JSON.stringify(currentPath),
            normalizedCount,
            null,
            MODEL_PROVIDER,
            MODEL_NAME
        );

        const { sessions, raw } = this._normalizeLearningPathResponse(response);
        const normalizedSessions = sessions.map((session, index) => this._normalizeSession(session, index));

        const updatedGoal = {
            ...this.goal,
            learningPath: normalizedSessions,
            learningPathRaw: raw,
            updatedAt: new Date().toISOString(),
        };

        this.learningPath = normalizedSessions;
        this.expectedSessions = normalizedSessions.length || normalizedCount;
        this._saveGoal(updatedGoal);
    }

    _renderReschedulePanel() {
        return `
            <div class="lp-reschedule">
                <div class="lp-reschedule-fields">
                    <label for="lp-session-count">Expected Sessions</label>
                    <input
                        id="lp-session-count"
                        type="number"
                        data-ref="expected-sessions"
                        min="${MIN_SESSIONS}"
                        max="${MAX_SESSIONS}"
                        value="${this.expectedSessions}"
                    />
                </div>
                <p class="lp-reschedule-hint">Adjust the number of sessions and re-run the scheduler for a fresh plan.</p>
                <div class="lp-reschedule-actions">
                    <button class="button secondary" data-action="toggle-reschedule">Cancel</button>
                    <button class="button primary" data-action="submit-reschedule">Re-schedule</button>
                </div>
            </div>
        `;
    }

    _renderSessionCard(session, index) {
        const isOpen = this.openSessions.has(index);
        const desiredOutcomes = Array.isArray(session.desired_outcome_when_completed)
            ? session.desired_outcome_when_completed
            : [];

        return `
            <article class="lp-session-card ${session.if_learned ? 'lp-session-card--complete' : ''}" data-session="${index}">
                <header class="lp-session-header">
                    <div>
                        <span class="lp-session-number">${index + 1}</span>
                        <h3>${session.title || `Session ${index + 1}`}</h3>
                    </div>
                    <button class="button link" data-action="toggle-session" data-index="${index}">
                        ${isOpen ? 'Hide Details' : 'View Session Details'}
                    </button>
                </header>

                ${isOpen ? `
                    <div class="lp-session-details">
                        <p>${session.abstract || 'No summary available.'}</p>
                        ${desiredOutcomes.length ? `
                            <div class="lp-session-skills">
                                <h4>Desired Outcomes</h4>
                                <ul>
                                    ${desiredOutcomes
                                        .map(
                                            (outcome) => `
                                                <li>
                                                    <span>${outcome.name}</span>
                                                    <span class="lp-badge">${(outcome.level || '').toLowerCase()}</span>
                                                </li>
                                            `
                                        )
                                        .join('')}
                                </ul>
                            </div>
                        ` : ''}
                    </div>
                ` : ''}

                <footer class="lp-session-footer">
                    <label class="lp-toggle">
                        <input
                            type="checkbox"
                            data-action="toggle-complete"
                            data-index="${index}"
                            ${session.if_learned ? 'checked' : ''}
                        />
                        <span>${session.if_learned ? 'Completed' : 'Keep Learning'}</span>
                    </label>
                    <button class="button primary" data-action="start-session" data-index="${index}">
                        ${session.if_learned ? 'Review Session' : 'Start Learning'}
                    </button>
                </footer>
            </article>
        `;
    }

    _renderSkillDetails() {
        const profile = this.goal?.learnerProfile || {};
        const cognitiveStatus = profile.cognitive_status || {};
        const mastered = Array.isArray(cognitiveStatus.mastered_skills) ? cognitiveStatus.mastered_skills : [];
        const inProgress = Array.isArray(cognitiveStatus.in_progress_skills) ? cognitiveStatus.in_progress_skills : [];
        const skillGaps = Array.isArray(this.goal?.skillGaps) ? this.goal.skillGaps : [];

        if (!mastered.length && !inProgress.length && !skillGaps.length) {
            return `<p class="lp-skill-empty">No detailed skill information available yet.</p>`;
        }

        const masteredHtml = mastered.length
            ? `
                <div class="lp-skill-section">
                    <h3>Mastered Skills</h3>
                    <div class="lp-skill-grid">
                        ${mastered
                            .map(
                                (skill) => `
                                    <div class="lp-skill-chip lp-skill-chip--mastered">
                                        <strong>${skill.name}</strong>
                                        <span>${(skill.proficiency_level || '').toLowerCase()}</span>
                                    </div>
                                `
                            )
                            .join('')}
                    </div>
                </div>
            `
            : '';

        const inProgressHtml = inProgress.length
            ? `
                <div class="lp-skill-section">
                    <h3>Skills In Progress</h3>
                    <div class="lp-skill-grid">
                        ${inProgress
                            .map(
                                (skill) => `
                                    <div class="lp-skill-chip lp-skill-chip--progress">
                                        <strong>${skill.name}</strong>
                                        <span>Current: ${(skill.current_proficiency_level || '').toLowerCase()}</span>
                                        <span>Target: ${(skill.required_proficiency_level || '').toLowerCase()}</span>
                                    </div>
                                `
                            )
                            .join('')}
                    </div>
                </div>
            `
            : '';

        const gapsHtml = skillGaps.length
            ? `
                <div class="lp-skill-section">
                    <h3>Identified Gaps</h3>
                    <div class="lp-skill-grid">
                        ${skillGaps
                            .map(
                                (gap) => `
                                    <div class="lp-skill-chip lp-skill-chip--gap">
                                        <strong>${gap.name || gap.skill_name || 'Skill'}</strong>
                                        <span>Required: ${(gap.required_level || gap.requiredLevel || 'N/A').toLowerCase()}</span>
                                        <span>Current: ${(gap.current_level || gap.currentLevel || 'N/A').toLowerCase()}</span>
                                    </div>
                                `
                            )
                            .join('')}
                    </div>
                </div>
            `
            : '';

        return `
            <div class="lp-skill-details">
                ${masteredHtml}
                ${inProgressHtml}
                ${gapsHtml}
            </div>
        `;
    }

    _bindEvents() {
        if (!this.container) return;
        const scope = this.container;

        scope.querySelectorAll('[data-action="go-to-skill-gap"]').forEach((button) => {
            button.addEventListener('click', () => router.navigateTo('skill-gap'));
        });

        scope.querySelectorAll('[data-action="go-to-goal-management"]').forEach((button) => {
            button.addEventListener('click', () => router.navigateTo('goal-management'));
        });

        scope.querySelectorAll('[data-action="toggle-skill-details"]').forEach((button) => {
            button.addEventListener('click', () => {
                this.skillDetailsOpen = !this.skillDetailsOpen;
                this.render(this.container);
            });
        });

        scope.querySelectorAll('[data-action="toggle-reschedule"]').forEach((button) => {
            button.addEventListener('click', () => {
                this.rescheduleOpen = !this.rescheduleOpen;
                this.render(this.container);
            });
        });

        scope.querySelectorAll('[data-action="trigger-reschedule"]').forEach((button) => {
            button.addEventListener('click', async () => {
                this.rescheduleOpen = true;
                if (this.container) {
                    this.render(this.container);
                }
            });
        });

        const sessionInput = scope.querySelector('[data-ref="expected-sessions"]');
        if (sessionInput) {
            sessionInput.addEventListener('change', (event) => {
                const value = Number.parseInt(event.target.value, 10);
                if (!Number.isNaN(value)) {
                    this.expectedSessions = Math.min(MAX_SESSIONS, Math.max(MIN_SESSIONS, value));
                }
            });
        }

        scope.querySelectorAll('[data-action="submit-reschedule"]').forEach((button) => {
            button.addEventListener('click', async () => {
                try {
                    this.loading = true;
                    this.render(this.container);
                    await this._rescheduleGoal(this.expectedSessions);
                    this.rescheduleOpen = false;
                } catch (error) {
                    console.error('[LearningPath] Reschedule failed', error);
                    this.error = error;
                } finally {
                    this.loading = false;
                    this.render(this.container);
                }
            });
        });

        scope.querySelectorAll('[data-action="toggle-session"]').forEach((button) => {
            button.addEventListener('click', () => {
                const index = Number.parseInt(button.dataset.index, 10);
                if (this.openSessions.has(index)) {
                    this.openSessions.delete(index);
                } else {
                    this.openSessions.add(index);
                }
                this.render(this.container);
            });
        });

        scope.querySelectorAll('[data-action="toggle-complete"]').forEach((input) => {
            input.addEventListener('change', () => {
                const index = Number.parseInt(input.dataset.index, 10);
                this._toggleCompletion(index, input.checked);
            });
        });

        scope.querySelectorAll('[data-action="start-session"]').forEach((button) => {
            button.addEventListener('click', () => {
                const index = Number.parseInt(button.dataset.index, 10);
                this._startSession(index);
            });
        });
    }

    _toggleCompletion(index, isCompleted) {
        if (!this.goal || !this.learningPath[index]) return;
        const updatedSessions = this.learningPath.map((session, idx) =>
            idx === index ? { ...session, if_learned: isCompleted } : session
        );
        const updatedGoal = { ...this.goal, learningPath: updatedSessions };
        this.learningPath = updatedSessions;
        this._saveGoal(updatedGoal);
        if (this.container) {
            this.render(this.container);
        }
    }

    _startSession(index) {
        if (!this.goal || !this.learningPath[index]) return;
        const rawPath = this.goal.learningPathRaw || { learning_path: this.learningPath };
        appState.setState({
            selectedGoalId: this.goal.id,
            selectedSessionIndex: index,
            learningPath: rawPath,
        });
        this._persistSnapshot({
            goals: appState.getState().goals,
            selectedGoalId: this.goal.id,
            learnerProfile: this.goal.learnerProfile,
            learningPath: rawPath,
            skillGaps: this.goal.skillGaps,
        });
        router.navigateTo('resume-learning');
    }

    _computeProgress() {
        const total = Array.isArray(this.learningPath) ? this.learningPath.length : 0;
        const completed = total
            ? this.learningPath.filter((session) => Boolean(session.if_learned)).length
            : 0;
        const percent = total ? Math.round((completed / total) * 100) : 0;
        return { totalSessions: total, completedSessions: completed, progressPercent: percent };
    }

    _saveGoal(goal) {
        const normalizedGoal = this._normalizeGoal(goal);
        const stateSnapshot = appState.getState();
        const goals = Array.isArray(stateSnapshot.goals) ? [...stateSnapshot.goals] : [];
        const index = goals.findIndex((item) => item.id === normalizedGoal.id);
        if (index >= 0) {
            goals[index] = normalizedGoal;
        } else {
            goals.push(normalizedGoal);
        }
        appState.setState({
            goals,
            selectedGoalId: normalizedGoal.id,
            learnerProfile: normalizedGoal.learnerProfile,
            learningPath: normalizedGoal.learningPathRaw,
            skillGaps: normalizedGoal.skillGaps,
        });
        this.goal = normalizedGoal;
        this.learningPath = normalizedGoal.learningPath;
        this._persistSnapshot({
            goals,
            selectedGoalId: normalizedGoal.id,
            learnerProfile: normalizedGoal.learnerProfile,
            learningPath: normalizedGoal.learningPathRaw,
            skillGaps: normalizedGoal.skillGaps,
        });
    }

    _persistSnapshot(snapshot) {
        try {
            localStorage.setItem(
                'learning.path.state',
                JSON.stringify({
                    ...snapshot,
                    updatedAt: new Date().toISOString(),
                })
            );
        } catch (error) {
            console.warn('[LearningPath] Failed to persist snapshot', error);
        }
    }

    _normalizeGoal(goal) {
        if (!goal) return null;
        const normalizedPath = this._normalizeLearningPathResponse(
            goal.learningPathRaw || { learning_path: goal.learningPath || [] }
        );
        const sessions = normalizedPath.sessions.map((session, index) =>
            this._normalizeSession(session, index)
        );
        return {
            id: goal.id ?? Date.now(),
            learningGoal: goal.learningGoal || goal.refinedGoal || '',
            refinedGoal: goal.refinedGoal || goal.learningGoal || '',
            skillGaps: Array.isArray(goal.skillGaps) ? goal.skillGaps : [],
            learnerProfile: goal.learnerProfile || {},
            learningPath: sessions,
            learningPathRaw: normalizedPath.raw,
            createdAt: goal.createdAt || new Date().toISOString(),
            updatedAt: goal.updatedAt || new Date().toISOString(),
        };
    }

    _normalizeLearningPathResponse(payload) {
        if (!payload) {
            return { sessions: [], raw: { learning_path: [] } };
        }

        if (Array.isArray(payload)) {
            return { sessions: payload, raw: { learning_path: payload } };
        }

        if (typeof payload === 'string') {
            try {
                const parsed = JSON.parse(payload);
                return this._normalizeLearningPathResponse(parsed);
            } catch (error) {
                console.warn('[LearningPath] Failed to parse learning path payload', error);
                return { sessions: [], raw: { learning_path: [] } };
            }
        }

        if (Array.isArray(payload.learning_path)) {
            return { sessions: payload.learning_path, raw: payload };
        }

        if (Array.isArray(payload.steps)) {
            return { sessions: payload.steps, raw: { learning_path: payload.steps } };
        }

        return { sessions: [], raw: { learning_path: [] } };
    }

    _normalizeSession(session, index) {
        const desired = Array.isArray(session?.desired_outcome_when_completed)
            ? session.desired_outcome_when_completed
            : Array.isArray(session?.desiredOutcomeWhenCompleted)
                ? session.desiredOutcomeWhenCompleted
                : [];

        return {
            id: session.id || `Session ${index + 1}`,
            title: session.title || `Session ${index + 1}`,
            abstract: session.abstract || session.description || '',
            if_learned: Boolean(session.if_learned),
            desired_outcome_when_completed: desired,
            associated_skills: Array.isArray(session.associated_skills) ? session.associated_skills : [],
        };
    }

    _loadPersistedState() {
        try {
            const raw = localStorage.getItem('learning.path.state');
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (error) {
            console.warn('[LearningPath] Failed to parse persisted state', error);
            return null;
        }
    }
}

const learningPathPage = new LearningPathPage();
export default learningPathPage;

