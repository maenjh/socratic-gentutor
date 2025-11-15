class GoalManagementPage {
    constructor() {
        this.goals = [];
        this.loading = false;
        this.editingGoal = null;
    }

    async initialize() {
        try {
            this.loading = true;
            this.render(document.getElementById('page-content'));
            
            const response = await API.getGoals();
            this.goals = response.goals;
            
            this.loading = false;
            this.render(document.getElementById('page-content'));
        } catch (error) {
            console.error('Failed to load goals:', error);
            this.loading = false;
            this.render(document.getElementById('page-content'));
        }
    }

    render(container) {
        if (this.loading) {
            container.innerHTML = `
                <div class="loading-container">
                    <div class="spinner"></div>
                    <p>Loading goals...</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="goal-management-page">
                <header class="page-header">
                    <h1>Goal Management</h1>
                    <button class="button primary" onclick="goalManagementPage.showCreateGoalModal()">
                        Create New Goal
                    </button>
                </header>

                <div class="goals-overview">
                    ${this.renderGoalsOverview()}
                </div>

                <div class="goals-grid">
                    ${this.renderGoals()}
                </div>

                ${this.renderGoalModal()}
            </div>
        `;

        // Initialize event listeners after rendering
        this.initializeEventListeners();
    }

    renderGoalsOverview() {
        const activeGoals = this.goals.filter(g => g.status === 'active').length;
        const completedGoals = this.goals.filter(g => g.status === 'completed').length;

        return `
            <div class="overview-cards">
                <div class="overview-card">
                    <h3>Active Goals</h3>
                    <p class="count">${activeGoals}</p>
                </div>
                <div class="overview-card">
                    <h3>Completed Goals</h3>
                    <p class="count">${completedGoals}</p>
                </div>
                <div class="overview-card">
                    <h3>Total Goals</h3>
                    <p class="count">${this.goals.length}</p>
                </div>
            </div>
        `;
    }

    renderGoals() {
        if (!this.goals.length) {
            return `
                <div class="empty-state">
                    <h2>No Goals Set</h2>
                    <p>Start by creating your first learning goal</p>
                    <button class="button primary" onclick="goalManagementPage.showCreateGoalModal()">
                        Create Goal
                    </button>
                </div>
            `;
        }

        return `
            <div class="goals-container">
                ${this.goals.map(goal => `
                    <div class="goal-card ${goal.status}">
                        <div class="goal-header">
                            <h3>${goal.title}</h3>
                            <div class="goal-actions">
                                <button class="icon-button" onclick="goalManagementPage.editGoal('${goal.id}')">
                                    ✏️
                                </button>
                                <button class="icon-button" onclick="goalManagementPage.deleteGoal('${goal.id}')">
                                    🗑️
                                </button>
                            </div>
                        </div>
                        
                        <p class="goal-description">${goal.description}</p>
                        
                        <div class="goal-progress">
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${goal.progress}%"></div>
                            </div>
                            <span class="progress-text">${goal.progress}%</span>
                        </div>
                        
                        <div class="goal-details">
                            <div class="goal-metric">
                                <span class="label">Target Date:</span>
                                <span class="value">${this.formatDate(goal.targetDate)}</span>
                            </div>
                            <div class="goal-metric">
                                <span class="label">Priority:</span>
                                <span class="value ${goal.priority.toLowerCase()}">${goal.priority}</span>
                            </div>
                            <div class="goal-metric">
                                <span class="label">Status:</span>
                                <span class="value ${goal.status.toLowerCase()}">${goal.status}</span>
                            </div>
                        </div>
                        
                        <div class="goal-milestones">
                            <h4>Milestones</h4>
                            <ul class="milestone-list">
                                ${(goal.milestones || []).map(milestone => `
                                    <li class="milestone ${milestone.completed ? 'completed' : ''}">
                                        <input type="checkbox" 
                                            ${milestone.completed ? 'checked' : ''} 
                                            onchange="goalManagementPage.toggleMilestone('${goal.id}', '${milestone.id}')">
                                        <span>${milestone.title}</span>
                                    </li>
                                `).join('')}
                            </ul>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    renderGoalModal() {
        if (!this.editingGoal && !this.showingCreateModal) {
            return '';
        }

        const isEditing = !!this.editingGoal;
        const goal = this.editingGoal || {};

        return `
            <div class="modal" id="goal-modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h2>${isEditing ? 'Edit Goal' : 'Create New Goal'}</h2>
                        <button class="close-button" onclick="goalManagementPage.closeModal()">×</button>
                    </div>
                    
                    <div class="modal-body">
                        <form id="goal-form">
                            <div class="form-group">
                                <label for="goal-title">Goal Title</label>
                                <input type="text" id="goal-title" name="title" 
                                    value="${goal.title || ''}" required>
                            </div>
                            
                            <div class="form-group">
                                <label for="goal-description">Description</label>
                                <textarea id="goal-description" name="description" rows="3"
                                    required>${goal.description || ''}</textarea>
                            </div>
                            
                            <div class="form-group">
                                <label for="goal-target-date">Target Date</label>
                                <input type="date" id="goal-target-date" name="targetDate"
                                    value="${goal.targetDate || ''}" required>
                            </div>
                            
                            <div class="form-group">
                                <label for="goal-priority">Priority</label>
                                <select id="goal-priority" name="priority" required>
                                    <option value="LOW" ${goal.priority === 'LOW' ? 'selected' : ''}>Low</option>
                                    <option value="MEDIUM" ${goal.priority === 'MEDIUM' ? 'selected' : ''}>Medium</option>
                                    <option value="HIGH" ${goal.priority === 'HIGH' ? 'selected' : ''}>High</option>
                                </select>
                            </div>
                            
                            <div class="form-group">
                                <label>Milestones</label>
                                <div id="milestones-container">
                                    ${(goal.milestones || []).map((milestone, index) => `
                                        <div class="milestone-input">
                                            <input type="text" name="milestones[]" 
                                                value="${milestone.title}" required>
                                            <button type="button" class="remove-milestone"
                                                onclick="goalManagementPage.removeMilestone(${index})">×</button>
                                        </div>
                                    `).join('')}
                                </div>
                                <button type="button" class="button secondary"
                                    onclick="goalManagementPage.addMilestone()">
                                    Add Milestone
                                </button>
                            </div>
                        </form>
                    </div>
                    
                    <div class="modal-footer">
                        <button class="button secondary" onclick="goalManagementPage.closeModal()">
                            Cancel
                        </button>
                        <button class="button primary" onclick="goalManagementPage.saveGoal()">
                            ${isEditing ? 'Update' : 'Create'} Goal
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    // Event Handlers
    showCreateGoalModal() {
        this.editingGoal = null;
        this.showingCreateModal = true;
        this.render(document.getElementById('page-content'));
    }

    async editGoal(goalId) {
        try {
            const goal = this.goals.find(g => g.id === goalId);
            this.editingGoal = goal;
            this.render(document.getElementById('page-content'));
        } catch (error) {
            console.error('Failed to edit goal:', error);
        }
    }

    async deleteGoal(goalId) {
        if (!confirm('Are you sure you want to delete this goal?')) {
            return;
        }
        
        try {
            await API.post(`/goals/${goalId}/delete`);
            this.goals = this.goals.filter(g => g.id !== goalId);
            this.render(document.getElementById('page-content'));
        } catch (error) {
            console.error('Failed to delete goal:', error);
        }
    }

    async toggleMilestone(goalId, milestoneId) {
        try {
            await API.post(`/goals/${goalId}/milestones/${milestoneId}/toggle`);
            await this.initialize(); // Reload goals
        } catch (error) {
            console.error('Failed to toggle milestone:', error);
        }
    }

    closeModal() {
        this.editingGoal = null;
        this.showingCreateModal = false;
        this.render(document.getElementById('page-content'));
    }

    addMilestone() {
        const container = document.getElementById('milestones-container');
        const newMilestone = document.createElement('div');
        newMilestone.className = 'milestone-input';
        newMilestone.innerHTML = `
            <input type="text" name="milestones[]" required>
            <button type="button" class="remove-milestone" 
                onclick="this.parentElement.remove()">×</button>
        `;
        container.appendChild(newMilestone);
    }

    removeMilestone(index) {
        const container = document.getElementById('milestones-container');
        container.children[index].remove();
    }

    async saveGoal() {
        const form = document.getElementById('goal-form');
        const formData = new FormData(form);
        
        const goalData = {
            title: formData.get('title'),
            description: formData.get('description'),
            targetDate: formData.get('targetDate'),
            priority: formData.get('priority'),
            milestones: Array.from(formData.getAll('milestones[]'))
                .filter(title => title.trim())
                .map(title => ({ title }))
        };

        try {
            if (this.editingGoal) {
                await API.post(`/goals/${this.editingGoal.id}/update`, goalData);
            } else {
                await API.post('/goals/create', goalData);
            }
            
            await this.initialize(); // Reload goals
            this.closeModal();
        } catch (error) {
            console.error('Failed to save goal:', error);
        }
    }

    // Utility Methods
    formatDate(dateString) {
        return new Date(dateString).toLocaleDateString();
    }

    initializeEventListeners() {
        // Add any necessary event listeners after rendering
        const modal = document.getElementById('goal-modal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal();
                }
            });
        }
    }
}

const goalManagementPage = new GoalManagementPage();
export default goalManagementPage;