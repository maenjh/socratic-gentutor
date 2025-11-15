class AgentActivityComponent {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.activities = [];
        this.init();
    }

    init() {
        this.render();
        this.startPolling();
    }

    render() {
        this.container.innerHTML = `
            <div class="agent-activity-panel">
                ${this.renderActivities()}
            </div>
        `;
    }

    renderActivities() {
        if (!this.activities.length) {
            return `
                <div class="empty-state">
                    <p>No active agents</p>
                </div>
            `;
        }

        return this.activities.map(activity => `
            <div class="agent-activity ${activity.status.toLowerCase()}">
                <div class="activity-header">
                    <span class="agent-name">${activity.agentName}</span>
                    <span class="activity-status">${this.getStatusBadge(activity.status)}</span>
                </div>
                <div class="activity-details">
                    <p class="activity-description">${activity.description}</p>
                    ${this.renderProgress(activity)}
                </div>
            </div>
        `).join('');
    }

    renderProgress(activity) {
        if (!activity.progress && activity.status !== 'IN_PROGRESS') {
            return '';
        }

        return `
            <div class="progress-container">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${activity.progress || 0}%"></div>
                </div>
                <span class="progress-text">${activity.progress || 0}%</span>
            </div>
        `;
    }

    getStatusBadge(status) {
        const badges = {
            'IDLE': '⚪️ Idle',
            'IN_PROGRESS': '🟡 Working',
            'COMPLETED': '🟢 Done',
            'ERROR': '🔴 Error',
            'WAITING': '🟣 Waiting'
        };
        return badges[status] || status;
    }

    async updateActivities() {
        try {
            const response = await API.get('/agents/activities');
            this.activities = response.activities;
            this.render();
        } catch (error) {
            console.error('Failed to update agent activities:', error);
        }
    }

    startPolling() {
        // Update every 5 seconds
        this.pollInterval = setInterval(() => this.updateActivities(), 5000);
    }

    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
        }
    }
}

export default AgentActivityComponent;