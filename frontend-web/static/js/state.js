class StateManager {
    constructor() {
        this.data = {
            onboardingCardIndex: 0,
            isRefiningLearningGoal: false,
            learnerOccupation: '',
            learnerInformationText: '',
            learnerInformation: '',
            toAddGoal: { learningGoal: '' },
            completedOnboarding: false,
            goals: [],
            selectedGoalId: null,
            learningPath: null,
            skillGaps: [],
            documentCaches: {},
            sessionLearningTimes: {},
            knowledgeSessionState: {},
            agentStatus: {},
            selectedPage: 'onboarding'
        };
        
        this.listeners = new Set();
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    notify() {
        this.listeners.forEach(listener => listener(this.data));
    }

    setState(updates) {
        this.data = { ...this.data, ...updates };
        this.notify();
        this.persist();
    }

    getState() {
        return this.data;
    }

    persist() {
        try {
            localStorage.setItem('appState', JSON.stringify(this.data));
        } catch (error) {
            console.error('Failed to persist state:', error);
        }
    }

    load() {
        try {
            const savedState = localStorage.getItem('appState');
            if (savedState) {
                this.data = { ...this.data, ...JSON.parse(savedState) };
                this.notify();
            }
        } catch (error) {
            console.error('Failed to load state:', error);
        }
    }

    reset() {
        this.data = {
            user: null,
            goals: [],
            selectedGoalId: null,
            learningPath: null,
            skillGaps: [],
            documentCaches: {},
            sessionLearningTimes: {},
            knowledgeSessionState: {},
            completedOnboarding: false,
            agentStatus: {},
        };
        localStorage.removeItem('appState');
        this.notify();
    }
}

const state = new StateManager();
state.load();

export { state };