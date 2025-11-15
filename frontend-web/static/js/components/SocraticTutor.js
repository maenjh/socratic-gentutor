class SocraticTutorComponent {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.conversation = [];
        this.context = null;
        this.init();
    }

    init() {
        this.render();
        this.initializeChatbot();
    }

    render() {
        this.container.innerHTML = `
            <div class="socratic-tutor">
                <div class="tutor-header">
                    <h2>Socratic Tutor</h2>
                    <div class="context-indicator">
                        ${this.renderContextIndicator()}
                    </div>
                </div>

                <div class="tutor-content">
                    <div class="chat-area" id="socratic-chat"></div>
                    
                    <div class="learning-context">
                        ${this.renderLearningContext()}
                    </div>
                </div>
            </div>
        `;
    }

    renderContextIndicator() {
        if (!this.context) {
            return `<span class="no-context">No active learning context</span>`;
        }

        return `
            <div class="active-context">
                <span class="context-label">Current Topic:</span>
                <span class="context-value">${this.context.topic}</span>
                <button class="change-context" onclick="socraticTutor.changeContext()">
                    Change
                </button>
            </div>
        `;
    }

    renderLearningContext() {
        if (!this.context) {
            return `
                <div class="empty-context">
                    <p>Select a learning context to begin</p>
                    <button class="button primary" onclick="socraticTutor.selectContext()">
                        Select Topic
                    </button>
                </div>
            `;
        }

        return `
            <div class="context-details">
                <h3>Learning Context</h3>
                
                <div class="topic-info">
                    <h4>${this.context.topic}</h4>
                    <p>${this.context.description}</p>
                </div>

                <div class="learning-objectives">
                    <h4>Objectives</h4>
                    <ul>
                        ${this.context.objectives.map(obj => `
                            <li class="${obj.completed ? 'completed' : ''}">${obj.text}</li>
                        `).join('')}
                    </ul>
                </div>

                <div class="key-concepts">
                    <h4>Key Concepts</h4>
                    <div class="concept-chips">
                        ${this.context.concepts.map(concept => `
                            <div class="concept-chip">
                                ${concept}
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="context-actions">
                    <button class="button secondary" onclick="socraticTutor.reviewConcepts()">
                        Review Concepts
                    </button>
                    <button class="button primary" onclick="socraticTutor.testUnderstanding()">
                        Test Understanding
                    </button>
                </div>
            </div>
        `;
    }

    initializeChatbot() {
        this.chatbot = new ChatbotComponent('socratic-chat', {
            aiName: 'Socratic Tutor',
            placeholder: 'Ask a question or discuss the topic...',
            messageHandler: this.handleMessage.bind(this)
        });
    }

    async handleMessage(message) {
        if (!this.context) {
            return {
                content: 'Please select a learning context first before we begin our discussion.',
                type: 'error'
            };
        }

        try {
            const response = await API.post('/socratic/chat', {
                message,
                context: {
                    topic: this.context.topic,
                    concepts: this.context.concepts,
                    progress: this.context.progress
                }
            });

            // Update context if needed
            if (response.contextUpdate) {
                this.updateContext(response.contextUpdate);
            }

            return {
                content: response.message,
                type: 'response',
                suggestions: response.suggestions
            };
        } catch (error) {
            console.error('Failed to get tutor response:', error);
            return {
                content: 'I apologize, but I encountered an error. Please try again.',
                type: 'error'
            };
        }
    }

    async selectContext() {
        try {
            // Show topic selection modal
            const topics = await API.get('/topics/available');
            
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <h2>Select Learning Topic</h2>
                    <div class="topics-grid">
                        ${topics.map(topic => `
                            <div class="topic-card" onclick="socraticTutor.setContext('${topic.id}')">
                                <h3>${topic.name}</h3>
                                <p>${topic.description}</p>
                                <div class="topic-meta">
                                    <span class="difficulty ${topic.difficulty.toLowerCase()}">
                                        ${topic.difficulty}
                                    </span>
                                    <span class="duration">${topic.estimatedDuration}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
        } catch (error) {
            console.error('Failed to load topics:', error);
        }
    }

    async setContext(topicId) {
        try {
            const response = await API.post('/socratic/context', { topicId });
            this.context = response.context;
            this.render();
            
            // Remove modal
            const modal = document.querySelector('.modal');
            if (modal) modal.remove();
            
            // Welcome message
            this.chatbot.addMessage({
                content: `Great! Let's start discussing ${this.context.topic}. What would you like to know?`,
                sender: 'ai',
                timestamp: new Date()
            });
        } catch (error) {
            console.error('Failed to set context:', error);
        }
    }

    async changeContext() {
        if (confirm('Changing context will clear the current conversation. Continue?')) {
            this.conversation = [];
            this.selectContext();
        }
    }

    async reviewConcepts() {
        try {
            const response = await API.post('/socratic/review', {
                topic: this.context.topic,
                concepts: this.context.concepts
            });
            
            this.chatbot.addMessage({
                content: response.review,
                sender: 'ai',
                timestamp: new Date()
            });
        } catch (error) {
            console.error('Failed to get concept review:', error);
        }
    }

    async testUnderstanding() {
        try {
            const response = await API.post('/socratic/test', {
                topic: this.context.topic,
                progress: this.context.progress
            });
            
            this.chatbot.addMessage({
                content: response.question,
                sender: 'ai',
                timestamp: new Date(),
                isTest: true
            });
        } catch (error) {
            console.error('Failed to get test question:', error);
        }
    }

    updateContext(update) {
        this.context = {
            ...this.context,
            ...update
        };
        this.render();
    }
}

export default SocraticTutorComponent;