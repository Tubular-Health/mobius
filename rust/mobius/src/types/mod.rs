pub mod config;
pub mod context;
pub mod debug;
pub mod enums;
pub mod task_graph;

// Re-export commonly used types for convenience
pub use config::{
    ExecutionConfig, ExecutionState, LinearConfig, LoopConfig, PathConfig, ProjectDetectionResult,
    VerificationCommands, VerificationConfig,
};
pub use context::{
    ContextMetadata, IssueContext, ParentIssueContext, PendingUpdate, PendingUpdateData,
    PendingUpdatesQueue, RuntimeState, SessionInfo, SkillOutputData, SubTaskContext, SyncLog,
    SyncLogEntry,
};
pub use debug::{DebugConfig, DebugEvent};
pub use enums::{
    Backend, BuildSystem, DebugEventType, DebugVerbosity, Model, PendingUpdateType, Platform,
    ProjectType, SkillOutputStatus, TaskStatus,
};
pub use task_graph::{GraphStats, LinearIssue, Relations, SubTask, TaskGraph};
