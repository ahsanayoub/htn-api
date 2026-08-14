- Does not deploy to production or merge to main without explicit user instruction — treats deployment as gated until told otherwise; after committing, reports the commit hash and git status, then stops pending explicit confirmation. Confidence: 0.9
- After code modifications, holds off on running production sync scripts or other data-modifying operations against live systems until explicit user approval, even if verification passes. Confidence: 0.85# General Taste Preferences

- Sends brief, action-oriented directives (e.g., "continue") often accompanied by IDE context tags (file/line references) to signal the agent should proceed with the current task, preferring minimal prompts over elaborated explanations. Confidence: 0.7
- Does not deploy to production or merge to main without explicit user instruction — treats deployment as gated until told otherwise; after committing, reports the commit hash and stops pending explicit confirmation. Confidence: 0.9
