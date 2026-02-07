use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};

/// Backend type for issue tracking
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Backend {
    #[default]
    Linear,
    Jira,
    Local,
}

/// Agent runtime used for skill execution
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentRuntime {
    #[default]
    Claude,
    Opencode,
}

impl fmt::Display for AgentRuntime {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AgentRuntime::Claude => write!(f, "claude"),
            AgentRuntime::Opencode => write!(f, "opencode"),
        }
    }
}

impl FromStr for AgentRuntime {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "claude" => Ok(AgentRuntime::Claude),
            "opencode" => Ok(AgentRuntime::Opencode),
            _ => Err(format!(
                "Unknown runtime: '{s}'. Expected: claude, opencode"
            )),
        }
    }
}

impl fmt::Display for Backend {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Backend::Linear => write!(f, "linear"),
            Backend::Jira => write!(f, "jira"),
            Backend::Local => write!(f, "local"),
        }
    }
}

impl FromStr for Backend {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "linear" => Ok(Backend::Linear),
            "jira" => Ok(Backend::Jira),
            "local" => Ok(Backend::Local),
            _ => Err(format!(
                "Unknown backend: '{s}'. Expected: linear, jira, local"
            )),
        }
    }
}

/// AI model selection
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Model {
    #[default]
    Opus,
    Sonnet,
    Haiku,
}

impl fmt::Display for Model {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Model::Opus => write!(f, "opus"),
            Model::Sonnet => write!(f, "sonnet"),
            Model::Haiku => write!(f, "haiku"),
        }
    }
}

impl FromStr for Model {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "opus" => Ok(Model::Opus),
            "sonnet" => Ok(Model::Sonnet),
            "haiku" => Ok(Model::Haiku),
            _ => Err(format!(
                "Unknown model: '{s}'. Expected: opus, sonnet, haiku"
            )),
        }
    }
}

/// Platform detection
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Darwin,
    Linux,
    Win32,
}

/// Project type detected from filesystem markers
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProjectType {
    Node,
    Android,
    Ios,
    Rust,
    Python,
    MultiPlatform,
    Unknown,
}

/// Build system detected from project configuration files
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BuildSystem {
    Npm,
    Yarn,
    Pnpm,
    Gradle,
    Xcodebuild,
    Cargo,
    Pip,
    Poetry,
    Just,
    Make,
    Unknown,
}

/// Check result status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CheckStatus {
    Pass,
    Fail,
    Warn,
    Skip,
}

/// Task status in the dependency graph
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    Ready,
    InProgress,
    Done,
    Blocked,
    Failed,
}

impl fmt::Display for TaskStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TaskStatus::Pending => write!(f, "pending"),
            TaskStatus::Ready => write!(f, "ready"),
            TaskStatus::InProgress => write!(f, "in_progress"),
            TaskStatus::Done => write!(f, "done"),
            TaskStatus::Blocked => write!(f, "blocked"),
            TaskStatus::Failed => write!(f, "failed"),
        }
    }
}

/// Jira auth method
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JiraAuthMethod {
    ApiToken,
    Oauth,
}

/// Session status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Active,
    Completed,
    Failed,
    Paused,
}

/// Verification result for individual checks
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum VerificationResult {
    Pass,
    Fail,
    #[serde(rename = "N/A")]
    NotApplicable,
}

/// Verification error type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationErrorType {
    Typecheck,
    Tests,
    Lint,
    SubtaskVerify,
}

/// Skill output status values
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SkillOutputStatus {
    SubtaskComplete,
    SubtaskPartial,
    AllComplete,
    AllBlocked,
    NoSubtasks,
    VerificationFailed,
    NeedsWork,
    Pass,
    Fail,
}

impl SkillOutputStatus {
    /// Returns true if this is a terminal status (execution should stop)
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            SkillOutputStatus::SubtaskComplete
                | SkillOutputStatus::AllComplete
                | SkillOutputStatus::AllBlocked
                | SkillOutputStatus::NoSubtasks
                | SkillOutputStatus::VerificationFailed
                | SkillOutputStatus::Pass
                | SkillOutputStatus::Fail
        )
    }
}

/// Pending update types for backend sync
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PendingUpdateType {
    StatusChange,
    AddComment,
    CreateSubtask,
    UpdateDescription,
    AddLabel,
    RemoveLabel,
}

/// Debug event types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DebugEventType {
    RuntimeStateWrite,
    RuntimeStateRead,
    RuntimeWatcherTrigger,
    TaskStateChange,
    PendingUpdateQueue,
    PendingUpdatePush,
    BackendStatusUpdate,
    LockAcquire,
    LockRelease,
    TuiStateReceive,
}

/// Debug event source
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DebugEventSource {
    Loop,
    Tui,
    Push,
    ContextGenerator,
}

/// Debug verbosity level
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DebugVerbosity {
    Minimal,
    Normal,
    Verbose,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_backend_from_str() {
        assert_eq!(Backend::from_str("linear").unwrap(), Backend::Linear);
        assert_eq!(Backend::from_str("Linear").unwrap(), Backend::Linear);
        assert_eq!(Backend::from_str("JIRA").unwrap(), Backend::Jira);
        assert_eq!(Backend::from_str("local").unwrap(), Backend::Local);
        assert!(Backend::from_str("unknown").is_err());
    }

    #[test]
    fn test_backend_display() {
        assert_eq!(Backend::Linear.to_string(), "linear");
        assert_eq!(Backend::Jira.to_string(), "jira");
        assert_eq!(Backend::Local.to_string(), "local");
    }

    #[test]
    fn test_runtime_from_str() {
        assert_eq!(
            AgentRuntime::from_str("claude").unwrap(),
            AgentRuntime::Claude
        );
        assert_eq!(
            AgentRuntime::from_str("Opencode").unwrap(),
            AgentRuntime::Opencode
        );
        assert!(AgentRuntime::from_str("unknown").is_err());
    }

    #[test]
    fn test_runtime_display() {
        assert_eq!(AgentRuntime::Claude.to_string(), "claude");
        assert_eq!(AgentRuntime::Opencode.to_string(), "opencode");
    }

    #[test]
    fn test_model_from_str() {
        assert_eq!(Model::from_str("opus").unwrap(), Model::Opus);
        assert_eq!(Model::from_str("Sonnet").unwrap(), Model::Sonnet);
        assert_eq!(Model::from_str("HAIKU").unwrap(), Model::Haiku);
        assert!(Model::from_str("gpt4").is_err());
    }

    #[test]
    fn test_backend_serde_roundtrip() {
        let backend = Backend::Linear;
        let json = serde_json::to_string(&backend).unwrap();
        assert_eq!(json, "\"linear\"");
        let parsed: Backend = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, backend);
    }

    #[test]
    fn test_model_serde_roundtrip() {
        let model = Model::Opus;
        let json = serde_json::to_string(&model).unwrap();
        assert_eq!(json, "\"opus\"");
        let parsed: Model = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, model);
    }

    #[test]
    fn test_runtime_serde_roundtrip() {
        let runtime = AgentRuntime::Opencode;
        let json = serde_json::to_string(&runtime).unwrap();
        assert_eq!(json, "\"opencode\"");
        let parsed: AgentRuntime = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, runtime);
    }

    #[test]
    fn test_project_type_serde() {
        let pt = ProjectType::MultiPlatform;
        let json = serde_json::to_string(&pt).unwrap();
        assert_eq!(json, "\"multi-platform\"");
        let parsed: ProjectType = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, pt);
    }

    #[test]
    fn test_verification_result_serde() {
        let pass = VerificationResult::Pass;
        assert_eq!(serde_json::to_string(&pass).unwrap(), "\"PASS\"");

        let na = VerificationResult::NotApplicable;
        assert_eq!(serde_json::to_string(&na).unwrap(), "\"N/A\"");

        let parsed: VerificationResult = serde_json::from_str("\"N/A\"").unwrap();
        assert_eq!(parsed, VerificationResult::NotApplicable);
    }

    #[test]
    fn test_task_status_serde_roundtrip() {
        let statuses = [
            (TaskStatus::Pending, "\"pending\""),
            (TaskStatus::Ready, "\"ready\""),
            (TaskStatus::InProgress, "\"in_progress\""),
            (TaskStatus::Done, "\"done\""),
            (TaskStatus::Blocked, "\"blocked\""),
            (TaskStatus::Failed, "\"failed\""),
        ];

        for (status, expected_json) in statuses {
            let json = serde_json::to_string(&status).unwrap();
            assert_eq!(json, expected_json);
            let deserialized: TaskStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(deserialized, status);
        }
    }

    #[test]
    fn test_skill_output_status_serde() {
        let status = SkillOutputStatus::SubtaskComplete;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"SUBTASK_COMPLETE\"");
        let deserialized: SkillOutputStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, status);

        // Test all variants
        let all = [
            (SkillOutputStatus::SubtaskComplete, "SUBTASK_COMPLETE"),
            (SkillOutputStatus::SubtaskPartial, "SUBTASK_PARTIAL"),
            (SkillOutputStatus::AllComplete, "ALL_COMPLETE"),
            (SkillOutputStatus::AllBlocked, "ALL_BLOCKED"),
            (SkillOutputStatus::NoSubtasks, "NO_SUBTASKS"),
            (SkillOutputStatus::VerificationFailed, "VERIFICATION_FAILED"),
            (SkillOutputStatus::NeedsWork, "NEEDS_WORK"),
            (SkillOutputStatus::Pass, "PASS"),
            (SkillOutputStatus::Fail, "FAIL"),
        ];
        for (variant, expected) in all {
            let json = serde_json::to_string(&variant).unwrap();
            assert_eq!(json, format!("\"{expected}\""));
        }
    }

    #[test]
    fn test_skill_output_status_is_terminal() {
        assert!(SkillOutputStatus::SubtaskComplete.is_terminal());
        assert!(SkillOutputStatus::AllComplete.is_terminal());
        assert!(SkillOutputStatus::AllBlocked.is_terminal());
        assert!(SkillOutputStatus::NoSubtasks.is_terminal());
        assert!(SkillOutputStatus::VerificationFailed.is_terminal());
        assert!(SkillOutputStatus::Pass.is_terminal());
        assert!(SkillOutputStatus::Fail.is_terminal());
        assert!(!SkillOutputStatus::SubtaskPartial.is_terminal());
        assert!(!SkillOutputStatus::NeedsWork.is_terminal());
    }

    #[test]
    fn test_pending_update_type_serde() {
        let update_type = PendingUpdateType::StatusChange;
        let json = serde_json::to_string(&update_type).unwrap();
        assert_eq!(json, "\"status_change\"");
        let deserialized: PendingUpdateType = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, update_type);
    }

    #[test]
    fn test_debug_event_type_serde() {
        let event = DebugEventType::RuntimeStateWrite;
        let json = serde_json::to_string(&event).unwrap();
        assert_eq!(json, "\"runtime_state_write\"");
        let deserialized: DebugEventType = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, event);
    }

    #[test]
    fn test_debug_verbosity_serde() {
        let verbosity = DebugVerbosity::Verbose;
        let json = serde_json::to_string(&verbosity).unwrap();
        assert_eq!(json, "\"verbose\"");
        let deserialized: DebugVerbosity = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized, verbosity);
    }
}
