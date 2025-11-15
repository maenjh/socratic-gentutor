import { state } from './state.js';
import { router } from './router.js';
import { Components } from './components.js';

// Import page modules (many pages export default instances)
import onboarding from './pages/onboarding.js';
import learningPath from './pages/learning-path.js';
import skillGap from './pages/skill-gap.js';
import knowledgeDocument from './pages/knowledge-document.js';
import learnerProfile from './pages/learner-profile.js';
import goalManagement from './pages/goal-management.js';
import dashboard from './pages/dashboard.js';

// Initialize the application when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Register routes (use the data-page keys from index.html)
        router.addRoute('onboarding', onboarding);
        router.addRoute('learning-path', learningPath);
        router.addRoute('skill-gap', skillGap);
        router.addRoute('resume-learning', knowledgeDocument);
        router.addRoute('my-profile', learnerProfile);
        router.addRoute('goal-management', goalManagement);
        router.addRoute('dashboard', dashboard);

        // Initialize router
        router.init();
        
        // Initialize agent activity panel
        const agentPanel = document.getElementById('agent-activity-panel');
        if (agentPanel) {
            const agentActivity = new Components.AgentActivity(agentPanel);
            await agentActivity.render();
        }

        // Load saved state
        state.load();

        // Set up auto-save timer
        setInterval(() => {
            state.persist();
        }, 60000); // Save every minute
    } catch (error) {
        console.error('Error initializing application:', error);
    }
});