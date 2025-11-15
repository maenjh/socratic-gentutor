class LearnerProfilePage {
    constructor() {
        this.profile = null;
        this.loading = false;
        this.editMode = false;
    }

    async initialize() {
        try {
            this.loading = true;
            this.render(document.getElementById('page-content'));
            
            const response = await API.getProfile();
            this.profile = response.profile;
            
            this.loading = false;
            this.render(document.getElementById('page-content'));
        } catch (error) {
            console.error('Failed to load profile:', error);
            this.loading = false;
            this.render(document.getElementById('page-content'));
        }
    }

    render(container) {
        if (this.loading) {
            container.innerHTML = `
                <div class="loading-container">
                    <div class="spinner"></div>
                    <p>Loading profile...</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="learner-profile-page">
                <header class="page-header">
                    <h1>My Profile</h1>
                    <button class="button" onclick="learnerProfilePage.toggleEditMode()">
                        ${this.editMode ? 'Cancel' : 'Edit Profile'}
                    </button>
                </header>

                ${this.editMode ? this.renderProfileForm() : this.renderProfileView()}

                <div class="profile-sections">
                    <div class="achievements-section">
                        <h2>Achievements</h2>
                        ${this.renderAchievements()}
                    </div>

                    <div class="skills-section">
                        <h2>Skills & Expertise</h2>
                        ${this.renderSkills()}
                    </div>

                    <div class="learning-history-section">
                        <h2>Learning History</h2>
                        ${this.renderLearningHistory()}
                    </div>

                    <div class="preferences-section">
                        <h2>Learning Preferences</h2>
                        ${this.renderPreferences()}
                    </div>
                </div>
            </div>
        `;
    }

    renderProfileView() {
        if (!this.profile) {
            return `
                <div class="empty-state">
                    <p>Profile not found. Please complete the onboarding process.</p>
                    <button class="button primary" onclick="router.navigate('/onboarding')">
                        Start Onboarding
                    </button>
                </div>
            `;
        }

        return `
            <div class="profile-overview">
                <div class="profile-header">
                    <div class="profile-avatar">
                        <img src="${this.profile.avatar || '/static/img/default-avatar.png'}" 
                            alt="Profile Avatar">
                    </div>
                    <div class="profile-info">
                        <h2>${this.profile.name}</h2>
                        <p class="profile-level">Level ${this.profile.level}</p>
                        <p class="profile-bio">${this.profile.bio}</p>
                    </div>
                </div>

                <div class="profile-stats">
                    <div class="stat-card">
                        <h3>Learning Hours</h3>
                        <p>${this.formatLearningTime(this.profile.learningTime)}</p>
                    </div>
                    <div class="stat-card">
                        <h3>Completed Goals</h3>
                        <p>${this.profile.completedGoals}</p>
                    </div>
                    <div class="stat-card">
                        <h3>Mastered Skills</h3>
                        <p>${this.profile.masteredSkills}</p>
                    </div>
                </div>
            </div>
        `;
    }

    renderProfileForm() {
        return `
            <form id="profile-form" class="profile-form">
                <div class="form-group">
                    <label for="name">Name</label>
                    <input type="text" id="name" name="name" 
                        value="${this.profile?.name || ''}" required>
                </div>

                <div class="form-group">
                    <label for="bio">Bio</label>
                    <textarea id="bio" name="bio" rows="3">${this.profile?.bio || ''}</textarea>
                </div>

                <div class="form-group">
                    <label for="avatar">Profile Picture</label>
                    <input type="file" id="avatar" name="avatar" accept="image/*">
                </div>

                <div class="form-group">
                    <label for="email">Email</label>
                    <input type="email" id="email" name="email" 
                        value="${this.profile?.email || ''}" required>
                </div>

                <div class="form-actions">
                    <button type="button" class="button secondary" 
                        onclick="learnerProfilePage.toggleEditMode()">
                        Cancel
                    </button>
                    <button type="button" class="button primary" 
                        onclick="learnerProfilePage.saveProfile()">
                        Save Changes
                    </button>
                </div>
            </form>
        `;
    }

    renderAchievements() {
        if (!this.profile?.achievements?.length) {
            return `
                <div class="empty-state">
                    <p>No achievements yet. Start learning to earn badges!</p>
                </div>
            `;
        }

        return `
            <div class="achievements-grid">
                ${this.profile.achievements.map(achievement => `
                    <div class="achievement-card ${achievement.unlocked ? 'unlocked' : 'locked'}">
                        <div class="achievement-icon">
                            ${achievement.icon}
                        </div>
                        <div class="achievement-info">
                            <h3>${achievement.title}</h3>
                            <p>${achievement.description}</p>
                            ${achievement.unlocked ? 
                                `<span class="unlock-date">Unlocked: ${this.formatDate(achievement.unlockedDate)}</span>` :
                                '<span class="locked-message">Keep learning to unlock!</span>'}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    renderSkills() {
        if (!this.profile?.skills?.length) {
            return `
                <div class="empty-state">
                    <p>No skills recorded yet. Complete assessments to track your expertise.</p>
                </div>
            `;
        }

        return `
            <div class="skills-grid">
                ${this.profile.skills.map(skill => `
                    <div class="skill-card">
                        <div class="skill-header">
                            <h3>${skill.name}</h3>
                            <span class="skill-level ${this.getSkillLevelClass(skill.level)}">
                                Level ${skill.level}
                            </span>
                        </div>
                        <div class="skill-progress">
                            <div class="progress-bar">
                                <div class="progress-fill" 
                                    style="width: ${(skill.level / 5) * 100}%"></div>
                            </div>
                        </div>
                        <div class="skill-details">
                            <p>${skill.description}</p>
                            <div class="skill-endorsements">
                                ${this.renderEndorsements(skill.endorsements)}
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    renderEndorsements(endorsements) {
        if (!endorsements?.length) return '';

        return `
            <div class="endorsements">
                <span class="endorsement-count">
                    ${endorsements.length} endorsement${endorsements.length === 1 ? '' : 's'}
                </span>
                <div class="endorser-avatars">
                    ${endorsements.slice(0, 3).map(endorser => `
                        <img src="${endorser.avatar}" alt="${endorser.name}" 
                            title="${endorser.name}">
                    `).join('')}
                    ${endorsements.length > 3 ? 
                        `<span class="more-endorsers">+${endorsements.length - 3}</span>` : 
                        ''}
                </div>
            </div>
        `;
    }

    renderLearningHistory() {
        if (!this.profile?.learningHistory?.length) {
            return `
                <div class="empty-state">
                    <p>No learning history yet. Start your learning journey!</p>
                </div>
            `;
        }

        return `
            <div class="learning-timeline">
                ${this.profile.learningHistory.map(entry => `
                    <div class="timeline-entry">
                        <div class="entry-date">
                            ${this.formatDate(entry.date)}
                        </div>
                        <div class="entry-content">
                            <h3>${entry.title}</h3>
                            <p>${entry.description}</p>
                            ${entry.achievement ? `
                                <div class="entry-achievement">
                                    🏆 Achievement Unlocked: ${entry.achievement}
                                </div>
                            ` : ''}
                            ${entry.skills ? `
                                <div class="entry-skills">
                                    Skills: ${entry.skills.join(', ')}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    renderPreferences() {
        if (!this.profile?.preferences) {
            return `
                <div class="empty-state">
                    <p>No learning preferences set. Update your profile to customize your learning experience.</p>
                </div>
            `;
        }

        const { preferences } = this.profile;

        return `
            <div class="preferences-grid">
                <div class="preference-card">
                    <h3>Learning Style</h3>
                    <p>${preferences.learningStyle}</p>
                </div>

                <div class="preference-card">
                    <h3>Preferred Resources</h3>
                    <ul class="resource-list">
                        ${preferences.preferredResources.map(resource => `
                            <li>${resource}</li>
                        `).join('')}
                    </ul>
                </div>

                <div class="preference-card">
                    <h3>Study Schedule</h3>
                    <p>Preferred Time: ${preferences.studySchedule.preferredTime}</p>
                    <p>Weekly Hours: ${preferences.studySchedule.weeklyHours}</p>
                </div>

                <div class="preference-card">
                    <h3>Communication</h3>
                    <p>Preferred Method: ${preferences.communication.method}</p>
                    <p>Frequency: ${preferences.communication.frequency}</p>
                </div>
            </div>
        `;
    }

    // Event Handlers
    toggleEditMode() {
        this.editMode = !this.editMode;
        this.render(document.getElementById('page-content'));
    }

    async saveProfile() {
        const form = document.getElementById('profile-form');
        const formData = new FormData(form);
        
        try {
            const avatarFile = formData.get('avatar');
            if (avatarFile.size > 0) {
                // Handle avatar upload first
                const avatarResponse = await this.uploadAvatar(avatarFile);
                formData.set('avatarUrl', avatarResponse.url);
            }
            
            const profileData = Object.fromEntries(formData);
            await API.updateProfile(profileData);
            
            this.editMode = false;
            await this.initialize(); // Reload profile
        } catch (error) {
            console.error('Failed to save profile:', error);
        }
    }

    async uploadAvatar(file) {
        const formData = new FormData();
        formData.append('avatar', file);
        
        const response = await fetch('/api/profile/avatar', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) throw new Error('Failed to upload avatar');
        return await response.json();
    }

    // Utility Methods
    formatLearningTime(minutes) {
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        return `${hours}h ${remainingMinutes}m`;
    }

    formatDate(dateString) {
        return new Date(dateString).toLocaleDateString();
    }

    getSkillLevelClass(level) {
        if (level >= 4) return 'expert';
        if (level >= 3) return 'advanced';
        if (level >= 2) return 'intermediate';
        return 'beginner';
    }
}

const learnerProfilePage = new LearnerProfilePage();
export default learnerProfilePage;