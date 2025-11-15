class GapIdentificationComponent {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.gaps = [];
        this.analyzing = false;
        this.init();
    }

    init() {
        this.render();
    }

    render() {
        this.container.innerHTML = `
            <div class="gap-identification">
                <div class="gap-header">
                    <h2>Skill Gap Analysis</h2>
                    ${!this.analyzing ? `
                        <button class="button primary" onclick="gapIdentification.startAnalysis()">
                            Start Analysis
                        </button>
                    ` : `
                        <div class="analyzing-indicator">
                            <div class="spinner"></div>
                            <span>Analyzing skills...</span>
                        </div>
                    `}
                </div>

                <div class="gap-content">
                    ${this.analyzing ? this.renderAnalyzing() : this.renderGaps()}
                </div>
            </div>
        `;
    }

    renderAnalyzing() {
        return `
            <div class="analyzing-state">
                <div class="analysis-steps">
                    <div class="step ${this.currentStep >= 1 ? 'completed' : ''}">
                        Gathering current skills
                    </div>
                    <div class="step ${this.currentStep >= 2 ? 'completed' : ''}">
                        Analyzing skill requirements
                    </div>
                    <div class="step ${this.currentStep >= 3 ? 'completed' : ''}">
                        Identifying gaps
                    </div>
                    <div class="step ${this.currentStep >= 4 ? 'completed' : ''}">
                        Generating recommendations
                    </div>
                </div>
            </div>
        `;
    }

    renderGaps() {
        if (!this.gaps.length) {
            return `
                <div class="empty-state">
                    <p>No skill gaps analyzed yet. Click "Start Analysis" to begin.</p>
                </div>
            `;
        }

        return `
            <div class="gaps-grid">
                ${this.gaps.map(gap => this.renderGapCard(gap)).join('')}
            </div>
        `;
    }

    renderGapCard(gap) {
        return `
            <div class="gap-card">
                <div class="gap-header">
                    <h3>${gap.skillName}</h3>
                    <span class="gap-level ${this.getGapLevelClass(gap.gapSize)}">
                        ${this.formatGapLevel(gap.gapSize)}
                    </span>
                </div>

                <div class="gap-levels">
                    <div class="level current">
                        <span class="label">Current</span>
                        <div class="level-bar">
                            <div class="level-fill" style="width: ${(gap.currentLevel / 5) * 100}%"></div>
                        </div>
                        <span class="value">${gap.currentLevel}/5</span>
                    </div>
                    <div class="level required">
                        <span class="label">Required</span>
                        <div class="level-bar">
                            <div class="level-fill" style="width: ${(gap.requiredLevel / 5) * 100}%"></div>
                        </div>
                        <span class="value">${gap.requiredLevel}/5</span>
                    </div>
                </div>

                <div class="gap-details">
                    <p>${gap.description}</p>
                    
                    <div class="gap-recommendations">
                        <h4>Recommendations</h4>
                        <ul>
                            ${gap.recommendations.map(rec => `
                                <li>${rec}</li>
                            `).join('')}
                        </ul>
                    </div>

                    <div class="gap-resources">
                        <h4>Learning Resources</h4>
                        <div class="resource-links">
                            ${gap.resources.map(resource => `
                                <a href="${resource.url}" target="_blank" class="resource-link">
                                    ${this.getResourceIcon(resource.type)}
                                    <span>${resource.title}</span>
                                </a>
                            `).join('')}
                        </div>
                    </div>
                </div>

                <div class="gap-actions">
                    <button class="button" onclick="gapIdentification.addToLearningPath('${gap.id}')">
                        Add to Learning Path
                    </button>
                </div>
            </div>
        `;
    }

    getGapLevelClass(gapSize) {
        if (gapSize <= 1) return 'small';
        if (gapSize <= 2) return 'medium';
        return 'large';
    }

    formatGapLevel(gapSize) {
        if (gapSize <= 1) return 'Small Gap';
        if (gapSize <= 2) return 'Medium Gap';
        return 'Large Gap';
    }

    getResourceIcon(type) {
        const icons = {
            'video': '🎥',
            'article': '📄',
            'course': '📚',
            'exercise': '✍️',
            'tutorial': '👨‍🏫'
        };
        return icons[type] || '📎';
    }

    async startAnalysis() {
        try {
            this.analyzing = true;
            this.currentStep = 1;
            this.render();

            // Simulate analysis steps
            await this.simulateAnalysisStep(1);
            await this.simulateAnalysisStep(2);
            await this.simulateAnalysisStep(3);
            await this.simulateAnalysisStep(4);

            // Get actual gaps from API
            const response = await API.post('/skill-gap/analyze');
            this.gaps = response.gaps;

            this.analyzing = false;
            this.render();
        } catch (error) {
            console.error('Failed to analyze skill gaps:', error);
            this.analyzing = false;
            this.render();
        }
    }

    async simulateAnalysisStep(step) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.currentStep = step;
        this.render();
    }

    async addToLearningPath(gapId) {
        try {
            await API.post('/learning-path/add-gap', { gapId });
            // Show success message or update UI
        } catch (error) {
            console.error('Failed to add gap to learning path:', error);
        }
    }
}

export default GapIdentificationComponent;