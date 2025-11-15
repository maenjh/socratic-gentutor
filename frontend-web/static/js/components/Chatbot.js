class ChatbotComponent {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.messages = [];
        this.options = {
            placeholder: 'Type your message...',
            aiName: 'AI Tutor',
            userName: 'You',
            ...options
        };
        this.init();
    }

    init() {
        this.render();
        this.attachEventListeners();
    }

    render() {
        this.container.innerHTML = `
            <div class="chatbot-container">
                <div class="chat-messages" id="chat-messages">
                    ${this.renderMessages()}
                </div>
                <div class="chat-input-container">
                    <textarea 
                        class="chat-input" 
                        placeholder="${this.options.placeholder}"
                        rows="1"
                        id="chat-input"
                    ></textarea>
                    <button class="send-button" id="send-button">
                        <span>Send</span>
                    </button>
                </div>
            </div>
        `;
    }

    renderMessages() {
        return this.messages.map(msg => `
            <div class="message ${msg.sender === 'ai' ? 'ai' : 'user'}">
                <div class="message-content">
                    <div class="message-header">
                        <span class="sender-name">
                            ${msg.sender === 'ai' ? this.options.aiName : this.options.userName}
                        </span>
                        <span class="message-time">
                            ${this.formatTime(msg.timestamp)}
                        </span>
                    </div>
                    <div class="message-text">
                        ${this.formatMessage(msg.content)}
                    </div>
                </div>
            </div>
        `).join('');
    }

    async sendMessage(content) {
        if (!content.trim()) return;

        // Add user message
        this.addMessage({
            content,
            sender: 'user',
            timestamp: new Date()
        });

        try {
            // Show typing indicator
            this.showTypingIndicator();

            // Send to backend
            const response = await API.sendMessage(content);

            // Remove typing indicator
            this.hideTypingIndicator();

            // Add AI response
            this.addMessage({
                content: response.message,
                sender: 'ai',
                timestamp: new Date()
            });
        } catch (error) {
            console.error('Failed to send message:', error);
            this.hideTypingIndicator();
            this.showError('Failed to send message. Please try again.');
        }
    }

    addMessage(message) {
        this.messages.push(message);
        this.updateMessages();
        this.scrollToBottom();
    }

    updateMessages() {
        const messagesContainer = document.getElementById('chat-messages');
        if (messagesContainer) {
            messagesContainer.innerHTML = this.renderMessages();
        }
    }

    scrollToBottom() {
        const messagesContainer = document.getElementById('chat-messages');
        if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }

    showTypingIndicator() {
        const messagesContainer = document.getElementById('chat-messages');
        if (messagesContainer) {
            const indicator = document.createElement('div');
            indicator.className = 'typing-indicator';
            indicator.innerHTML = `
                <div class="typing-animation">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            `;
            messagesContainer.appendChild(indicator);
            this.scrollToBottom();
        }
    }

    hideTypingIndicator() {
        const indicator = document.querySelector('.typing-indicator');
        if (indicator) {
            indicator.remove();
        }
    }

    showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = message;
        this.container.appendChild(errorDiv);
        setTimeout(() => errorDiv.remove(), 3000);
    }

    attachEventListeners() {
        const input = document.getElementById('chat-input');
        const sendButton = document.getElementById('send-button');

        if (input) {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage(input.value);
                    input.value = '';
                }
            });

            // Auto-resize textarea
            input.addEventListener('input', () => {
                input.style.height = 'auto';
                input.style.height = input.scrollHeight + 'px';
            });
        }

        if (sendButton) {
            sendButton.addEventListener('click', () => {
                const input = document.getElementById('chat-input');
                this.sendMessage(input.value);
                input.value = '';
                input.style.height = 'auto';
            });
        }
    }

    formatTime(timestamp) {
        return new Date(timestamp).toLocaleTimeString();
    }

    formatMessage(content) {
        // Convert markdown-style code blocks to HTML
        return content.replace(/```(\w+)?\n([\s\S]+?)```/g, '<pre><code>$2</code></pre>')
                     .replace(/`([^`]+)`/g, '<code>$1</code>')
                     .replace(/\n/g, '<br>');
    }
}

export default ChatbotComponent;