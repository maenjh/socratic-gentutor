import { api } from './api.js';
import { state } from './state.js';

// Import all components
export class ChatbotComponent {
    constructor(container) {
        this.container = container;
    }

    async render() {
        this.container.innerHTML = `
            <div class="chatbot-container">
                <div class="chat-messages" id="chat-messages"></div>
                <div class="chat-input-container">
                    <input type="text" id="chat-input" placeholder="Type your message...">
                    <button id="send-message">Send</button>
                </div>
            </div>
        `;
        this.setupEventListeners();
    }

    setupEventListeners() {
        const input = document.getElementById('chat-input');
        const sendButton = document.getElementById('send-message');
        
        sendButton.addEventListener('click', () => this.sendMessage());
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });
    }

    async sendMessage() {
        const input = document.getElementById('chat-input');
        const message = input.value.trim();
        if (!message) return;

        // Add user message to chat
        this.addMessage('user', message);
        input.value = '';

        try {
            // Get response from API (wrap message into messages array and pass minimal learner profile)
            const responseObj = await api.chatWithTutor([{ role: 'user', content: message }], {});
            // Some endpoints return an object with message text; normalize
            const response = responseObj?.message || responseObj?.result || responseObj || '';
            // Add bot response to chat
            this.addMessage('bot', response);
        } catch (error) {
            console.error('Error sending message:', error);
        }
    }

    addMessage(type, content) {
        const messagesContainer = document.getElementById('chat-messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${type}-message`;
        messageDiv.textContent = content;
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

class AgentActivityComponent {
    constructor(container) {
        this.container = container;
    }

    async render() {
        try {
            const agentStatus = state.getState().agentStatus;
            this.container.innerHTML = `
                <div class="agent-status-panel">
                    <div class="agent-status-item">
                        <span class="status-label">Current Task:</span>
                        <span class="status-value">${agentStatus.currentTask || 'None'}</span>
                    </div>
                    <div class="agent-status-item">
                        <span class="status-label">Status:</span>
                        <span class="status-value ${agentStatus.status?.toLowerCase()}">${agentStatus.status || 'Idle'}</span>
                    </div>
                </div>
            `;
        } catch (error) {
            console.error('Error rendering agent status:', error);
            this.container.innerHTML = '<div class="error">Failed to load agent status</div>';
        }
    }
}

// Export components
export const Components = {
    Chatbot: ChatbotComponent,
    AgentActivity: AgentActivityComponent
};