class DashboardPage {
    constructor() {
        this.analytics = null;
        this.loading = false;
        this.charts = {};
    }

    async initialize() {
        try {
            this.loading = true;
            this.render(document.getElementById('page-content'));
            
            const response = await API.getAnalytics();
            this.analytics = response;
            
            this.loading = false;
            this.render(document.getElementById('page-content'));
            this.initializeCharts();
        } catch (error) {
            console.error('Failed to load analytics:', error);
            this.loading = false;
            this.render(document.getElementById('page-content'));
        }
    }

    render(container) {
        if (this.loading) {
            container.innerHTML = `
                <div class="loading-container">
                    <div class="spinner"></div>
                    <p>Loading analytics...</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="dashboard-page">
                <header class="page-header">
                    <h1>Analytics Dashboard</h1>
                    <div class="header-actions">
                        <button class="button" onclick="dashboardPage.exportData()">
                            Export Data
                        </button>
                        <button class="button" onclick="dashboardPage.initialize()">
                            Refresh
                        </button>
                    </div>
                </header>

                <div class="dashboard-grid">
                    ${this.renderOverviewCards()}
                    
                    <div class="chart-container">
                        <h2>Learning Progress</h2>
                        <canvas id="progress-chart"></canvas>
                    </div>
                    
                    <div class="chart-container">
                        <h2>Skill Distribution</h2>
                        <canvas id="skills-chart"></canvas>
                    </div>
                    
                    <div class="chart-container">
                        <h2>Time Spent by Topic</h2>
                        <canvas id="time-chart"></canvas>
                    </div>
                    
                    <div class="chart-container">
                        <h2>Goal Completion Rate</h2>
                        <canvas id="goals-chart"></canvas>
                    </div>
                </div>

                <div class="recent-activity">
                    <h2>Recent Activity</h2>
                    ${this.renderRecentActivity()}
                </div>

                <div class="recommendations">
                    <h2>Recommendations</h2>
                    ${this.renderRecommendations()}
                </div>
            </div>
        `;
    }

    renderOverviewCards() {
        if (!this.analytics) return '';

        const {totalLearningTime, completedGoals, masteredSkills, averageScore} = this.analytics;

        return `
            <div class="overview-cards">
                <div class="overview-card">
                    <h3>Total Learning Time</h3>
                    <p class="metric">${this.formatLearningTime(totalLearningTime)}</p>
                </div>
                
                <div class="overview-card">
                    <h3>Completed Goals</h3>
                    <p class="metric">${completedGoals}</p>
                </div>
                
                <div class="overview-card">
                    <h3>Mastered Skills</h3>
                    <p class="metric">${masteredSkills}</p>
                </div>
                
                <div class="overview-card">
                    <h3>Average Score</h3>
                    <p class="metric">${averageScore}%</p>
                </div>
            </div>
        `;
    }

    renderRecentActivity() {
        if (!this.analytics?.recentActivity?.length) {
            return `
                <div class="empty-state">
                    <p>No recent activity to display</p>
                </div>
            `;
        }

        return `
            <div class="activity-timeline">
                ${this.analytics.recentActivity.map(activity => `
                    <div class="activity-item ${activity.type.toLowerCase()}">
                        <div class="activity-icon">
                            ${this.getActivityIcon(activity.type)}
                        </div>
                        <div class="activity-content">
                            <p class="activity-title">${activity.description}</p>
                            <p class="activity-time">${this.formatDate(activity.timestamp)}</p>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    renderRecommendations() {
        if (!this.analytics?.recommendations?.length) {
            return `
                <div class="empty-state">
                    <p>No recommendations available</p>
                </div>
            `;
        }

        return `
            <div class="recommendations-grid">
                ${this.analytics.recommendations.map(rec => `
                    <div class="recommendation-card">
                        <div class="recommendation-header">
                            <h3>${rec.title}</h3>
                            <span class="priority ${rec.priority.toLowerCase()}">
                                ${rec.priority}
                            </span>
                        </div>
                        <p>${rec.description}</p>
                        <div class="recommendation-actions">
                            <button class="button" 
                                onclick="dashboardPage.applyRecommendation('${rec.id}')">
                                Apply
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    initializeCharts() {
        if (!this.analytics) return;

        // Progress Chart
        const progressCtx = document.getElementById('progress-chart').getContext('2d');
        this.charts.progress = new Chart(progressCtx, {
            type: 'line',
            data: {
                labels: this.analytics.progressData.dates,
                datasets: [{
                    label: 'Learning Progress',
                    data: this.analytics.progressData.values,
                    borderColor: '#1a73e8',
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false
            }
        });

        // Skills Chart
        const skillsCtx = document.getElementById('skills-chart').getContext('2d');
        this.charts.skills = new Chart(skillsCtx, {
            type: 'radar',
            data: {
                labels: this.analytics.skillsData.categories,
                datasets: [{
                    label: 'Current Level',
                    data: this.analytics.skillsData.values,
                    backgroundColor: 'rgba(26, 115, 232, 0.2)',
                    borderColor: '#1a73e8'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false
            }
        });

        // Time Chart
        const timeCtx = document.getElementById('time-chart').getContext('2d');
        this.charts.time = new Chart(timeCtx, {
            type: 'doughnut',
            data: {
                labels: this.analytics.timeData.topics,
                datasets: [{
                    data: this.analytics.timeData.values,
                    backgroundColor: [
                        '#1a73e8',
                        '#34a853',
                        '#fbbc05',
                        '#ea4335',
                        '#4285f4'
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false
            }
        });

        // Goals Chart
        const goalsCtx = document.getElementById('goals-chart').getContext('2d');
        this.charts.goals = new Chart(goalsCtx, {
            type: 'bar',
            data: {
                labels: this.analytics.goalsData.categories,
                datasets: [{
                    label: 'Completed',
                    data: this.analytics.goalsData.completed,
                    backgroundColor: '#34a853'
                }, {
                    label: 'In Progress',
                    data: this.analytics.goalsData.inProgress,
                    backgroundColor: '#fbbc05'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { stacked: true },
                    y: { stacked: true }
                }
            }
        });
    }

    // Event Handlers
    async exportData() {
        try {
            const response = await API.get('/analytics/export');
            const blob = new Blob([JSON.stringify(response, null, 2)], {
                type: 'application/json'
            });
            
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `learning-analytics-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            console.error('Failed to export data:', error);
        }
    }

    async applyRecommendation(recId) {
        try {
            await API.post(`/recommendations/${recId}/apply`);
            await this.initialize(); // Refresh dashboard
        } catch (error) {
            console.error('Failed to apply recommendation:', error);
        }
    }

    // Utility Methods
    formatLearningTime(minutes) {
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        return `${hours}h ${remainingMinutes}m`;
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) { // Less than 1 minute
            return 'Just now';
        } else if (diff < 3600000) { // Less than 1 hour
            const minutes = Math.floor(diff / 60000);
            return `${minutes}m ago`;
        } else if (diff < 86400000) { // Less than 1 day
            const hours = Math.floor(diff / 3600000);
            return `${hours}h ago`;
        } else {
            return date.toLocaleDateString();
        }
    }

    getActivityIcon(type) {
        const icons = {
            GOAL_COMPLETED: '🎯',
            SKILL_MASTERED: '⭐',
            QUIZ_COMPLETED: '📝',
            LEARNING_SESSION: '📚',
            ACHIEVEMENT: '🏆'
        };
        return icons[type] || '📌';
    }
}

const dashboardPage = new DashboardPage();
export default dashboardPage;