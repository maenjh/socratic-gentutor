import { router } from '../router.js';
import { API } from '../api.js';
import { state as appState } from '../state.js';

class OnboardingPage {
    constructor() {
        this.totalSteps = 2;
        this.storageKey = 'gm.onboarding';
        this.defaultState = {
            step: 1,
            learningGoal: '',
            refinedGoal: '',
            occupation: '',
            otherOccupation: '',
            learningPreference: '',
            resumeFileName: '',
            onboardingComplete: false
        };
        this.state = { ...this.defaultState };
    }

    initialize() {
        const loaded = this.#loadState();
        console.debug('[Onboarding] Loaded from storage:', loaded);
        this.state = loaded;
        const globalState = appState.getState();
        if (globalState && globalState.onboarding) {
            this.state = { ...this.state, ...globalState.onboarding };
        }

        const goalCandidate = (this.state.refinedGoal || this.state.learningGoal || '').trim();
        if (goalCandidate.length < 5) {
            this.state.learningGoal = '';
            this.state.refinedGoal = '';
            this.state.step = 1;
        }

        console.debug('[Onboarding] Loaded state:', { learningGoal: this.state.learningGoal, refinedGoal: this.state.refinedGoal });
    }

    render(container) {
        this.container = container;
        this.container.innerHTML = this.#template();
        this.#cacheDom();
        this.#hydrateFields(true);
        this.#bindEvents();
        this.#updateStepUI();
        this.#updateOccupationView();
        this.#updateFileName();
    }

    #template() {
        const goalValue = this.escapeHtml(this.state.refinedGoal || this.state.learningGoal);
        const stepLabel = `Step ${this.state.step} of ${this.totalSteps}`;
        const progressWidth = this.state.step === 1 ? '50%' : '100%';
        const occupationOptions = [
            '',
            'Software Engineer',
            'Data Scientist',
            'AI Researcher',
            'Product Manager',
            'UI/UX Designer',
            'Other'
        ];

        return `
            <div class="onboarding-shell">
                <header class="onboarding-header">
                    <div>
                        <h1>Socratic AI Tutoring System</h1>
                        <p>Start your goal-oriented and personalized learning journey — we'll help you set a clear learning goal and tailor a path for you.</p>
                    </div>
                    <div class="onboarding-header-actions">
                        <button class="onboarding-btn onboarding-btn--danger" id="reset-btn">Reset</button>
                        <button class="onboarding-btn" id="settings-btn">Settings</button>
                    </div>
                </header>

                <div class="onboarding-tagline">
                    Personalized onboarding in two simple steps
                </div>

                <div class="onboarding-step-indicator">
                    <span id="step-label">${stepLabel}</span>
                    <div class="onboarding-step-indicator__bar">
                        <div class="onboarding-step-indicator__value" id="step-progress" style="width: ${progressWidth};"></div>
                    </div>
                </div>

                <article class="onboarding-card ${this.state.step !== 1 ? 'hidden' : ''}" id="goal-card">
                    <h2>Set Learning Goal</h2>
                    <p class="onboarding-card-info">🚀 Please enter your role and specific learning goal. You can also refine it with AI suggestions.</p>
                    <div class="onboarding-form-group">
                        <label for="learning-goal">Enter your learning goal</label>
                        <textarea id="learning-goal" placeholder="e.g. Become proficient in building production-ready ML pipelines for data scientists">${goalValue}</textarea>
                    </div>
                    <div class="onboarding-actions">
                        <button class="onboarding-btn" id="refine-goal-btn">AI로 목표 개선하기</button>
                        <button class="onboarding-btn onboarding-btn--primary" id="goal-next-btn">Next</button>
                    </div>
                </article>

                <article class="onboarding-card ${this.state.step !== 2 ? 'hidden' : ''}" id="info-card">
                    <h2>Share Your Information</h2>
                    <p class="onboarding-card-info">🧠 Please provide your information (Text or PDF) to enhance personalized experience.</p>

                    <div class="onboarding-form-group">
                        <label for="occupation">Select your occupation</label>
                        <select id="occupation">
                            ${occupationOptions.map(option => `
                                <option value="${option}" ${this.state.occupation === option ? 'selected' : ''}>
                                    ${option ? option : 'Choose an option'}
                                </option>
                            `).join('')}
                        </select>
                    </div>

                    <div class="onboarding-form-group ${this.state.occupation === 'Other' ? '' : 'hidden'}" id="other-occupation-group">
                        <label for="other-occupation">Please specify your occupation</label>
                        <input id="other-occupation" type="text" placeholder="Your occupation" value="${this.escapeHtml(this.state.otherOccupation)}">
                    </div>

                    <div class="onboarding-form-group">
                        <label>Upload a PDF with your information (optional)</label>
                        <div class="onboarding-file-upload">
                            <label class="onboarding-file-upload__trigger" for="cv-upload">📄 Drag and drop file here</label>
                            <input id="cv-upload" type="file" accept=".pdf" hidden>
                            <p class="onboarding-file-upload__hint">Limit 200MB per file • PDF</p>
                            <p class="onboarding-file-upload__hint ${this.state.resumeFileName ? '' : 'hidden'}" id="file-name">Uploaded: ${this.escapeHtml(this.state.resumeFileName)}</p>
                        </div>
                    </div>

                    <div class="onboarding-form-group">
                        <label for="learning-preference">Learning preferences (optional)</label>
                        <textarea id="learning-preference" placeholder="[Optional] Enter your learning preferences and style">${this.escapeHtml(this.state.learningPreference)}</textarea>
                    </div>

                    <div class="onboarding-actions onboarding-actions--split">
                        <button class="onboarding-btn" id="info-prev-btn">Previous</button>
                        <button class="onboarding-btn onboarding-btn--primary" id="info-submit-btn">Save & Continue</button>
                    </div>
                </article>
            </div>
            <div class="onboarding-toast-stack" id="toast-stack"></div>
        `;
    }

    #cacheDom() {
        this.toastStack = document.getElementById('toast-stack');
        this.stepLabel = document.getElementById('step-label');
        this.stepProgress = document.getElementById('step-progress');
        this.goalCard = document.getElementById('goal-card');
        this.infoCard = document.getElementById('info-card');
        this.learningGoalInput = document.getElementById('learning-goal');
        this.refineGoalBtn = document.getElementById('refine-goal-btn');
        this.goalNextBtn = document.getElementById('goal-next-btn');
        this.infoPrevBtn = document.getElementById('info-prev-btn');
        this.infoSubmitBtn = document.getElementById('info-submit-btn');
        this.resetBtn = document.getElementById('reset-btn');
        this.settingsBtn = document.getElementById('settings-btn');
        this.occupationSelect = document.getElementById('occupation');
        this.otherOccupationGroup = document.getElementById('other-occupation-group');
        this.otherOccupationInput = document.getElementById('other-occupation');
        this.cvUploadInput = document.getElementById('cv-upload');
        this.fileNameLabel = document.getElementById('file-name');
        this.learningPreferenceInput = document.getElementById('learning-preference');
    }

    #bindEvents() {
        this.goalNextBtn.addEventListener('click', () => this.#goToStepTwo());
        this.infoPrevBtn.addEventListener('click', () => this.#setStep(1));
        this.infoSubmitBtn.addEventListener('click', () => this.#submitInformation());
        this.refineGoalBtn.addEventListener('click', () => this.#refineGoal());
        this.resetBtn.addEventListener('click', () => this.#resetOnboarding());
        this.settingsBtn.addEventListener('click', () => {
            this.#showToast('info', 'Settings', 'Customization options are coming soon.');
        });

        this.learningGoalInput.addEventListener('input', (event) => {
            const value = event.target.value;
            console.debug('[Onboarding] Input event value:', value);
            this.state.learningGoal = value;
            this.state.refinedGoal = value;
            this.#saveState();
        });

        this.occupationSelect.addEventListener('change', () => {
            this.state.occupation = this.occupationSelect.value;
            this.#updateOccupationView();
            this.#saveState();
        });

        if (this.otherOccupationInput) {
            this.otherOccupationInput.addEventListener('input', (event) => {
                this.state.otherOccupation = event.target.value;
                this.#saveState();
            });
        }

        this.learningPreferenceInput.addEventListener('input', (event) => {
            this.state.learningPreference = event.target.value;
            this.#saveState();
        });

        this.cvUploadInput.addEventListener('change', (event) => this.#handleResumeUpload(event));
    }

    #hydrateFields(resetGoal = false) {
        const goalValue = resetGoal ? '' : (this.state.refinedGoal || this.state.learningGoal || '');
        this.learningGoalInput.value = goalValue;
        if (this.occupationSelect) {
            this.occupationSelect.value = this.state.occupation || '';
        }
        if (this.otherOccupationInput) {
            this.otherOccupationInput.value = this.state.otherOccupation || '';
        }
        if (this.learningPreferenceInput) {
            this.learningPreferenceInput.value = this.state.learningPreference || '';
        }
    }

    #goToStepTwo() {
        const goal = this.learningGoalInput.value.trim();
        console.debug('[Onboarding] Next clicked with goal:', goal);
        if (!goal) {
            this.#showToast('error', 'Validation', 'Please input your learning goal before proceeding.');
            return;
        }

        if (goal.length < 5) {
            this.#showToast('error', 'Validation', 'Please enter at least 5 characters to describe your goal.');
            return;
        }

        this.state.learningGoal = goal;
        this.state.refinedGoal = goal;
        console.debug('[Onboarding] Step set to 2 with state goal:', {
            learningGoal: this.state.learningGoal,
            refinedGoal: this.state.refinedGoal,
        });
        this.#setStep(2);
        this.#saveState();
    }

    #setStep(step) {
        this.state.step = step;
        this.#updateStepUI();
        this.#saveState();
    }

    #updateStepUI() {
        if (!this.goalCard || !this.infoCard) return;
        this.goalCard.classList.toggle('hidden', this.state.step !== 1);
        this.infoCard.classList.toggle('hidden', this.state.step !== 2);
        if (this.stepLabel) {
            this.stepLabel.textContent = `Step ${this.state.step} of ${this.totalSteps}`;
        }
        if (this.stepProgress) {
            this.stepProgress.style.width = this.state.step === 1 ? '50%' : '100%';
        }
    }

    #updateOccupationView() {
        if (!this.otherOccupationGroup) return;
        const showOther = this.occupationSelect.value === 'Other';
        this.otherOccupationGroup.classList.toggle('hidden', !showOther);
    }

    #updateFileName() {
        if (!this.fileNameLabel) return;
        if (this.state.resumeFileName) {
            this.fileNameLabel.textContent = `Uploaded: ${this.state.resumeFileName}`;
            this.fileNameLabel.classList.remove('hidden');
        } else {
            this.fileNameLabel.textContent = '';
            this.fileNameLabel.classList.add('hidden');
        }
    }

    async #refineGoal() {
        const goal = this.learningGoalInput.value.trim();
        if (!goal) {
            this.#showToast('error', 'Validation', 'Please enter a learning goal before refining.');
            return;
        }

        this.refineGoalBtn.disabled = true;
        this.refineGoalBtn.textContent = '개선 중...';

        try {
            // Use centralized API client with configured backendBaseUrl
            const data = await API.refineLearningGoal(goal, '');
            let refined = data?.refinedGoal || data?.refined_goal || '';

            if (!refined) {
                refined = `${goal} (refined)`;
            }

            this.learningGoalInput.value = refined;
            this.state.refinedGoal = refined;
            this.state.learningGoal = goal;
            this.#saveState();
            this.#showToast('success', 'Success', 'Learning goal refined successfully.');
        } catch (error) {
            console.error('Failed to refine goal:', error);
            this.#showToast('error', 'Error', 'Failed to refine learning goal. Try again later.');
        } finally {
            this.refineGoalBtn.disabled = false;
            this.refineGoalBtn.textContent = 'AI로 목표 개선하기';
        }
    }

    #submitInformation() {
        const occupation = this.occupationSelect.value;
        const otherOccupation = this.otherOccupationInput ? this.otherOccupationInput.value.trim() : '';
        const learningPreference = this.learningPreferenceInput.value.trim();

        if (!occupation) {
            this.#showToast('error', 'Validation', 'Please select your occupation.');
            return;
        }

        if (occupation === 'Other' && !otherOccupation) {
            this.#showToast('error', 'Validation', 'Please specify your occupation.');
            return;
        }

        this.state.occupation = occupation;
        this.state.otherOccupation = occupation === 'Other' ? otherOccupation : '';
        this.state.learningPreference = learningPreference;
        this.state.onboardingComplete = true;
        console.debug('[Onboarding] Submitting info with state:', {
            learningGoal: this.state.learningGoal,
            refinedGoal: this.state.refinedGoal,
            onboardingState: this.state,
        });
        this.#saveState();

        appState.setState({
            learnerOccupation: this.state.occupation,
            learnerInformationText: this.state.learningPreference,
            completedOnboarding: true,
            onboarding: { ...this.state }
        });

        this.#showToast('success', 'Onboarding Complete', 'Skill gap analysis will start using your provided data.');
        setTimeout(() => {
            router.navigateTo('skill-gap');
        }, 1200);
    }

    #handleResumeUpload(event) {
        const file = event.target.files?.[0];
        if (file) {
            this.state.resumeFileName = file.name;
            this.#updateFileName();
            this.#saveState();
        }
    }

    #resetOnboarding() {
        this.state = { ...this.defaultState };
        localStorage.removeItem(this.storageKey);
        try {
            localStorage.removeItem('appState');
        } catch (error) {
            console.error('Failed to clear appState', error);
        }
        this.#saveState({ reset: true });
        this.#hydrateFields(true);
        this.#updateStepUI();
        this.#updateOccupationView();
        this.#updateFileName();
        this.#showToast('info', 'Reset', 'Onboarding data cleared.');
    }

    #showToast(type, title, message) {
        if (!this.toastStack) return;
        const toast = document.createElement('div');
        toast.className = `onboarding-toast onboarding-toast--${type}`;
        toast.innerHTML = `
            <p class="onboarding-toast__title">${title}</p>
            <p class="onboarding-toast__message">${message}</p>
        `;
        this.toastStack.appendChild(toast);
        setTimeout(() => toast.remove(), 2800);
    }

    #saveState(options = {}) {
        const goal = (this.state.learningGoal || '').trim();
        const refined = (this.state.refinedGoal || '').trim();
        if (goal && refined.length < 5) {
            this.state.refinedGoal = goal;
        }

        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.state));
        } catch (error) {
            console.error('Failed to persist onboarding state', error);
        }
        if (options.reset) {
            appState.setState({
                onboarding: { ...this.state },
                toAddGoal: { learningGoal: '' },
                learningPath: null,
                skillGaps: [],
            });
        } else {
            appState.setState({ onboarding: { ...this.state } });
        }
    }

    #loadState() {
        try {
            const raw = localStorage.getItem(this.storageKey);
            console.debug('[Onboarding] Raw stored state:', raw);
            if (!raw) {
                return { ...this.defaultState };
            }
            const parsed = JSON.parse(raw);
            if (parsed.learningGoal && (!parsed.refinedGoal || parsed.refinedGoal.trim().length < 5)) {
                parsed.refinedGoal = parsed.learningGoal;
            }
            return { ...this.defaultState, ...parsed };
        } catch (error) {
            console.error('Failed to load onboarding state', error);
            return { ...this.defaultState };
        }
    }

    escapeHtml(value) {
        if (!value) return '';
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}

const onboarding = new OnboardingPage();
export default onboarding;