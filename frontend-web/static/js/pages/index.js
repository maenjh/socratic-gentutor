import { state } from '../state.js';
import { api } from '../api.js';
import { Components } from '../components.js';

export class Pages {
    static async renderPage(pageName, container) {
        switch (pageName) {
            case 'onboarding':
                return this.renderOnboarding(container);
            case 'learning-path':
                return this.renderLearningPath(container);
            case 'skill-gap':
                return this.renderSkillGap(container);
            case 'resume-learning':
                return this.renderResumeLearning(container);
            case 'my-profile':
                return this.renderMyProfile(container);
            case 'goal-management':
                return this.renderGoalManagement(container);
            case 'dashboard':
                return this.renderDashboard(container);
            default:
                container.innerHTML = '<div class="error">Page not found</div>';
        }
    }

    static async renderOnboarding(container) {
        container.innerHTML = `
            <div class="page onboarding-page">
                <h1>Welcome to AI Tutor</h1>
                <div class="onboarding-content">
                    <p>Let's get started with your learning journey!</p>
                    <div id="chatbot-container"></div>
                </div>
            </div>
        `;
        
        const chatbotContainer = document.getElementById('chatbot-container');
        if (chatbotContainer) {
            const chatbot = new Components.Chatbot(chatbotContainer);
            await chatbot.render();
        }
    }

    static async renderLearningPath(container) {
        try {
            const learningPath = await api.getLearningPath();
            container.innerHTML = `
                <div class="page learning-path-page">
                    <h1>Your Learning Path</h1>
                    <div class="learning-path-content">
                        ${this.#renderLearningPathContent(learningPath)}
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error loading learning path:', error);
            container.innerHTML = '<div class="error">Failed to load learning path</div>';
        }
    }

    static #renderLearningPathContent(path) {
        if (!path || !path.length) {
            return '<p>No learning path available yet. Complete onboarding to get started!</p>';
        }

        return `
            <div class="learning-path-steps">
                ${path.map((step, index) => `
                    <div class="learning-step ${step.status}">
                        <div class="step-number">${index + 1}</div>
                        <div class="step-content">
                            <h3>${step.title}</h3>
                            <p>${step.description}</p>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    static async renderSkillGap(container) {
        try {
            const skillGaps = await api.getSkillGaps();
            container.innerHTML = `
                <div class="page skill-gap-page">
                    <h1>Skill Gap Analysis</h1>
                    <div class="skill-gap-content">
                        ${this.#renderSkillGapsContent(skillGaps)}
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error loading skill gaps:', error);
            container.innerHTML = '<div class="error">Failed to load skill gaps</div>';
        }
    }

    static #renderSkillGapsContent(gaps) {
        if (!gaps || !gaps.length) {
            return '<p>No skill gaps identified yet. Complete assessments to see your gaps.</p>';
        }

        return `
            <div class="skill-gaps-list">
                ${gaps.map(gap => `
                    <div class="skill-gap-item">
                        <h3>${gap.skillName}</h3>
                        <div class="progress-bar">
                            <div class="progress" style="width: ${gap.currentLevel}%"></div>
                        </div>
                        <p>Current Level: ${gap.currentLevel}%</p>
                        <p>Target Level: ${gap.targetLevel}%</p>
                    </div>
                `).join('')}
            </div>
        `;
    }

    static async renderResumeLearning(container) {
        try {
            const documents = await api.getKnowledgeDocuments();
            container.innerHTML = `
                <div class="page knowledge-document-page">
                    <h1>Resume Learning</h1>
                    <div class="knowledge-document-content">
                        ${this.#renderDocumentsContent(documents)}
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error loading documents:', error);
            container.innerHTML = '<div class="error">Failed to load learning materials</div>';
        }
    }

    static #renderDocumentsContent(documents) {
        if (!documents || !documents.length) {
            return '<p>No learning materials available yet.</p>';
        }

        return `
            <div class="documents-list">
                ${documents.map(doc => `
                    <div class="document-item">
                        <h3>${doc.title}</h3>
                        <p>${doc.description}</p>
                        <button class="document-btn" data-id="${doc.id}">Continue Learning</button>
                    </div>
                `).join('')}
            </div>
        `;
    }

    static async renderMyProfile(container) {
        try {
            const profile = await api.getLearnerProfile();
            container.innerHTML = `
                <div class="page profile-page">
                    <h1>My Profile</h1>
                    <div class="profile-content">
                        ${this.#renderProfileContent(profile)}
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error loading profile:', error);
            container.innerHTML = '<div class="error">Failed to load profile</div>';
        }
    }

    static #renderProfileContent(profile) {
        return `
            <div class="profile-details">
                <div class="profile-section">
                    <h2>Personal Information</h2>
                    <p><strong>Name:</strong> ${profile.name || 'Not set'}</p>
                    <p><strong>Learning Style:</strong> ${profile.learningStyle || 'Not determined'}</p>
                </div>
                <div class="profile-section">
                    <h2>Learning Progress</h2>
                    <p><strong>Completed Topics:</strong> ${profile.completedTopics || 0}</p>
                    <p><strong>Mastered Skills:</strong> ${profile.masteredSkills || 0}</p>
                </div>
            </div>
        `;
    }

    static async renderGoalManagement(container) {
        try {
            const goals = await api.getGoals();
            container.innerHTML = `
                <div class="page goal-management-page">
                    <h1>Goal Management</h1>
                    <div class="goals-content">
                        ${this.#renderGoalsContent(goals)}
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error loading goals:', error);
            container.innerHTML = '<div class="error">Failed to load goals</div>';
        }
    }

    static #renderGoalsContent(goals) {
        return `
            <div class="goals-list">
                ${goals.map(goal => `
                    <div class="goal-item">
                        <h3>${goal.title}</h3>
                        <p>${goal.description}</p>
                        <div class="goal-progress">
                            <div class="progress-bar">
                                <div class="progress" style="width: ${goal.progress}%"></div>
                            </div>
                            <span>${goal.progress}% Complete</span>
                        </div>
                    </div>
                `).join('')}
            </div>
            <button class="add-goal-btn">Add New Goal</button>
        `;
    }

    static async renderDashboard(container) {
        try {
            const analytics = await api.getAnalytics();
            container.innerHTML = `
                <div class="page dashboard-page">
                    <h1>Analytics Dashboard</h1>
                    <div class="dashboard-content">
                        ${this.#renderAnalyticsContent(analytics)}
                    </div>
                </div>
            `;
            this.#initializeCharts(analytics);
        } catch (error) {
            console.error('Error loading analytics:', error);
            container.innerHTML = '<div class="error">Failed to load analytics</div>';
        }
    }

    static #renderAnalyticsContent(analytics) {
        return `
            <div class="analytics-grid">
                <div class="analytics-card">
                    <h3>Learning Progress</h3>
                    <canvas id="progressChart"></canvas>
                </div>
                <div class="analytics-card">
                    <h3>Skills Mastery</h3>
                    <canvas id="skillsChart"></canvas>
                </div>
                <div class="analytics-card">
                    <h3>Learning Time</h3>
                    <canvas id="timeChart"></canvas>
                </div>
            </div>
        `;
    }

    static #initializeCharts(analytics) {
        // Progress Chart
        const progressCtx = document.getElementById('progressChart')?.getContext('2d');
        if (progressCtx) {
            new Chart(progressCtx, {
                type: 'line',
                data: {
                    labels: analytics.progress.labels,
                    datasets: [{
                        label: 'Learning Progress',
                        data: analytics.progress.data,
                        borderColor: '#4CAF50',
                        tension: 0.1
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: {
                            beginAtZero: true,
                            max: 100
                        }
                    }
                }
            });
        }

        // Skills Chart
        const skillsCtx = document.getElementById('skillsChart')?.getContext('2d');
        if (skillsCtx) {
            new Chart(skillsCtx, {
                type: 'radar',
                data: {
                    labels: analytics.skills.labels,
                    datasets: [{
                        label: 'Current Level',
                        data: analytics.skills.data,
                        backgroundColor: 'rgba(75, 192, 192, 0.2)',
                        borderColor: '#4CAF50',
                        borderWidth: 1
                    }]
                },
                options: {
                    scales: {
                        r: {
                            beginAtZero: true,
                            max: 100
                        }
                    }
                }
            });
        }

        // Time Chart
        const timeCtx = document.getElementById('timeChart')?.getContext('2d');
        if (timeCtx) {
            new Chart(timeCtx, {
                type: 'bar',
                data: {
                    labels: analytics.time.labels,
                    datasets: [{
                        label: 'Learning Time (hours)',
                        data: analytics.time.data,
                        backgroundColor: '#2196F3'
                    }]
                },
                options: {
                    responsive: true,
                    scales: {
                        y: {
                            beginAtZero: true
                        }
                    }
                }
            });
        }
    }
}