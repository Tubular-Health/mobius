use serde::{Deserialize, Serialize};

use super::enums::{AgentRuntime, Backend, BuildSystem, JiraAuthMethod, Platform, ProjectType};

/// TUI dashboard configuration options
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TuiConfig {
    #[serde(default = "default_true")]
    pub show_legend: bool,
    #[serde(default = "default_state_dir")]
    pub state_dir: String,
    #[serde(default = "default_panel_refresh_ms")]
    pub panel_refresh_ms: u32,
    #[serde(default = "default_panel_lines")]
    pub panel_lines: u32,
}

impl Default for TuiConfig {
    fn default() -> Self {
        Self {
            show_legend: true,
            state_dir: default_state_dir(),
            panel_refresh_ms: 300,
            panel_lines: 8,
        }
    }
}

/// Verification quality gate configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationConfig {
    #[serde(default = "default_coverage_threshold")]
    pub coverage_threshold: u32,
    #[serde(default = "default_true")]
    pub require_all_tests_pass: bool,
    #[serde(default = "default_true")]
    pub performance_check: bool,
    #[serde(default = "default_true")]
    pub security_check: bool,
    #[serde(default = "default_max_rework_iterations")]
    pub max_rework_iterations: u32,
}

impl Default for VerificationConfig {
    fn default() -> Self {
        Self {
            coverage_threshold: 80,
            require_all_tests_pass: true,
            performance_check: true,
            security_check: true,
            max_rework_iterations: 3,
        }
    }
}

/// Execution configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionConfig {
    #[serde(default = "default_delay_seconds")]
    pub delay_seconds: u32,
    #[serde(default = "default_max_iterations")]
    pub max_iterations: u32,
    #[serde(default = "default_model_profile")]
    pub model: String,
    #[serde(default = "default_true")]
    pub sandbox: bool,
    #[serde(default = "default_container_name")]
    pub container_name: String,
    #[serde(default = "default_max_parallel_agents")]
    pub max_parallel_agents: Option<u32>,
    #[serde(default = "default_worktree_path")]
    pub worktree_path: Option<String>,
    #[serde(default = "default_cleanup_on_success")]
    pub cleanup_on_success: Option<bool>,
    #[serde(default)]
    pub base_branch: Option<String>,
    #[serde(default = "default_max_retries")]
    pub max_retries: Option<u32>,
    #[serde(default = "default_verification_timeout")]
    pub verification_timeout: Option<u32>,
    #[serde(default)]
    pub tui: Option<TuiConfig>,
    #[serde(default)]
    pub verification: Option<VerificationConfig>,
    #[serde(default)]
    pub disallowed_tools: Option<Vec<String>>,
}

impl Default for ExecutionConfig {
    fn default() -> Self {
        Self {
            delay_seconds: 3,
            max_iterations: 50,
            model: default_model_profile(),
            sandbox: true,
            container_name: "mobius-sandbox".to_string(),
            max_parallel_agents: Some(3),
            worktree_path: Some("../<repo>-worktrees/".to_string()),
            cleanup_on_success: Some(true),
            base_branch: Some("main".to_string()),
            max_retries: Some(2),
            verification_timeout: Some(5000),
            tui: None,
            verification: Some(VerificationConfig::default()),
            disallowed_tools: None,
        }
    }
}

/// Linear backend configuration
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LinearConfig {
    pub team: Option<String>,
    pub project: Option<String>,
    pub default_labels: Option<Vec<String>>,
}

/// Jira backend configuration
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct JiraConfig {
    pub base_url: Option<String>,
    pub project_key: Option<String>,
    pub auth_method: Option<JiraAuthMethod>,
    pub default_labels: Option<Vec<String>>,
}

/// Top-level loop configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoopConfig {
    #[serde(default)]
    pub runtime: AgentRuntime,
    #[serde(default)]
    pub backend: Backend,
    #[serde(default)]
    pub linear: Option<LinearConfig>,
    #[serde(default)]
    pub jira: Option<JiraConfig>,
    #[serde(default)]
    pub execution: ExecutionConfig,
}

impl Default for LoopConfig {
    fn default() -> Self {
        Self {
            runtime: AgentRuntime::Claude,
            backend: Backend::Linear,
            linear: None,
            jira: None,
            execution: ExecutionConfig::default(),
        }
    }
}

/// Represents an actively running task with its process info
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveTask {
    pub id: String,
    pub pid: u32,
    pub pane: String,
    pub started_at: String,
    pub worktree: Option<String>,
}

/// Represents a completed or failed task with timing info
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedTask {
    pub id: String,
    pub completed_at: String,
    pub duration: u64,
}

/// Execution state file schema for TUI state tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionState {
    pub parent_id: String,
    pub parent_title: String,
    pub active_tasks: Vec<ActiveTask>,
    pub completed_tasks: Vec<serde_json::Value>,
    pub failed_tasks: Vec<serde_json::Value>,
    pub started_at: String,
    pub updated_at: String,
    pub loop_pid: Option<u32>,
    pub total_tasks: Option<u32>,
}

/// Result of a single check (e.g., doctor command)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckResult {
    pub name: String,
    pub status: super::enums::CheckStatus,
    pub message: String,
    pub required: bool,
    pub details: Option<String>,
}

/// CLI detection result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliDetectionResult {
    pub tool: String,
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

/// Commands available for project verification steps
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationCommands {
    pub test: Option<String>,
    pub typecheck: Option<String>,
    pub lint: Option<String>,
    pub build: Option<String>,
    pub platform_build: Option<std::collections::HashMap<String, String>>,
}

/// Result of detecting project type, build system, and available commands
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDetectionResult {
    pub project_type: ProjectType,
    pub build_system: BuildSystem,
    pub platform_targets: Vec<String>,
    pub available_commands: VerificationCommands,
    pub has_justfile: bool,
    pub detected_config_files: Vec<String>,
}

/// Verify command extracted from a sub-task description
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubTaskVerifyCommand {
    pub subtask_id: String,
    pub title: String,
    pub command: String,
}

/// Install method for platform tools
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallMethod {
    pub platform: Platform,
    pub method: String,
    pub command: String,
    pub url: Option<String>,
}

/// Path configuration for local vs global config resolution
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathConfig {
    #[serde(rename = "type")]
    pub config_type: PathConfigType,
    pub config_path: String,
    pub skills_path: String,
    pub script_path: String,
}

/// Whether config was found locally or globally
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PathConfigType {
    Local,
    Global,
}

// Default value helpers
fn default_true() -> bool {
    true
}

fn default_state_dir() -> String {
    "~/.mobius/state/".to_string()
}

fn default_panel_refresh_ms() -> u32 {
    300
}

fn default_panel_lines() -> u32 {
    8
}

fn default_coverage_threshold() -> u32 {
    80
}

fn default_max_rework_iterations() -> u32 {
    3
}

fn default_delay_seconds() -> u32 {
    3
}

fn default_max_iterations() -> u32 {
    50
}

fn default_model_profile() -> String {
    "opus".to_string()
}

fn default_container_name() -> String {
    "mobius-sandbox".to_string()
}

fn default_max_parallel_agents() -> Option<u32> {
    Some(3)
}

fn default_worktree_path() -> Option<String> {
    Some("../<repo>-worktrees/".to_string())
}

fn default_cleanup_on_success() -> Option<bool> {
    Some(true)
}

fn default_max_retries() -> Option<u32> {
    Some(2)
}

fn default_verification_timeout() -> Option<u32> {
    Some(5000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_loop_config_default_matches_typescript() {
        let config = LoopConfig::default();
        assert_eq!(config.runtime, AgentRuntime::Claude);
        assert_eq!(config.backend, Backend::Linear);
        assert_eq!(config.execution.delay_seconds, 3);
        assert_eq!(config.execution.max_iterations, 50);
        assert_eq!(config.execution.model, "opus");
        assert!(config.execution.sandbox);
        assert_eq!(config.execution.container_name, "mobius-sandbox");
        assert_eq!(config.execution.max_parallel_agents, Some(3));
        assert_eq!(
            config.execution.worktree_path,
            Some("../<repo>-worktrees/".to_string())
        );
        assert_eq!(config.execution.cleanup_on_success, Some(true));
        assert_eq!(config.execution.base_branch, Some("main".to_string()));
        assert_eq!(config.execution.max_retries, Some(2));
        assert_eq!(config.execution.verification_timeout, Some(5000));

        let verification = config.execution.verification.unwrap();
        assert_eq!(verification.coverage_threshold, 80);
        assert!(verification.require_all_tests_pass);
        assert!(verification.performance_check);
        assert!(verification.security_check);
        assert_eq!(verification.max_rework_iterations, 3);
    }

    #[test]
    fn test_loop_config_serde_roundtrip() {
        let config = LoopConfig::default();
        let json = serde_json::to_string(&config).unwrap();
        let parsed: LoopConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.runtime, config.runtime);
        assert_eq!(parsed.backend, config.backend);
        assert_eq!(
            parsed.execution.delay_seconds,
            config.execution.delay_seconds
        );
    }

    #[test]
    fn test_loop_config_yaml_roundtrip() {
        let config = LoopConfig::default();
        let yaml = serde_yaml::to_string(&config).unwrap();
        let parsed: LoopConfig = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed.runtime, config.runtime);
        assert_eq!(parsed.backend, config.backend);
        assert_eq!(parsed.execution.model, config.execution.model);
    }

    #[test]
    fn test_execution_state_serde() {
        let state = ExecutionState {
            parent_id: "MOB-100".to_string(),
            parent_title: "Test".to_string(),
            active_tasks: vec![],
            completed_tasks: vec![
                serde_json::Value::String("MOB-101".to_string()),
                serde_json::json!({"id": "MOB-102", "completedAt": "2024-01-01T00:00:00Z", "duration": 5000}),
            ],
            failed_tasks: vec![],
            started_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
            loop_pid: Some(1234),
            total_tasks: Some(10),
        };

        let json = serde_json::to_string(&state).unwrap();
        let parsed: ExecutionState = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.parent_id, "MOB-100");
        assert_eq!(parsed.completed_tasks.len(), 2);
    }

    #[test]
    fn test_project_detection_result_serde() {
        let result = ProjectDetectionResult {
            project_type: ProjectType::Node,
            build_system: BuildSystem::Just,
            platform_targets: vec![],
            available_commands: VerificationCommands {
                test: Some("just test".to_string()),
                typecheck: Some("just typecheck".to_string()),
                lint: Some("just lint".to_string()),
                build: Some("just build".to_string()),
                platform_build: None,
            },
            has_justfile: true,
            detected_config_files: vec!["justfile".to_string(), "package.json".to_string()],
        };

        let json = serde_json::to_string(&result).unwrap();
        let parsed: ProjectDetectionResult = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.project_type, ProjectType::Node);
        assert_eq!(parsed.build_system, BuildSystem::Just);
        assert!(parsed.has_justfile);
    }
}
