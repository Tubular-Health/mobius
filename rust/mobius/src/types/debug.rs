use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::enums::{DebugEventSource, DebugEventType, DebugVerbosity};

/// A single debug event entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DebugEvent {
    pub timestamp: String,
    #[serde(rename = "type")]
    pub event_type: DebugEventType,
    pub source: DebugEventSource,
    #[serde(rename = "taskId", default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    pub data: HashMap<String, serde_json::Value>,
}

/// Debug mode configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugConfig {
    pub enabled: bool,
    pub verbosity: DebugVerbosity,
    pub log_to_file: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
}

impl Default for DebugConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            verbosity: DebugVerbosity::Normal,
            log_to_file: false,
            session_id: None,
        }
    }
}

/// Debug verbosity levels determine what events are logged.
///
/// Returns the list of event types that should be captured at each verbosity level.
pub fn verbosity_event_types(verbosity: DebugVerbosity) -> &'static [DebugEventType] {
    match verbosity {
        DebugVerbosity::Minimal => &[
            DebugEventType::TaskStateChange,
            DebugEventType::BackendStatusUpdate,
        ],
        DebugVerbosity::Normal => &[
            DebugEventType::TaskStateChange,
            DebugEventType::PendingUpdateQueue,
            DebugEventType::PendingUpdatePush,
            DebugEventType::BackendStatusUpdate,
            DebugEventType::TuiStateReceive,
        ],
        DebugVerbosity::Verbose => &[
            DebugEventType::RuntimeStateWrite,
            DebugEventType::RuntimeStateRead,
            DebugEventType::RuntimeWatcherTrigger,
            DebugEventType::TaskStateChange,
            DebugEventType::PendingUpdateQueue,
            DebugEventType::PendingUpdatePush,
            DebugEventType::BackendStatusUpdate,
            DebugEventType::LockAcquire,
            DebugEventType::LockRelease,
            DebugEventType::TuiStateReceive,
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_debug_config_default() {
        let config = DebugConfig::default();
        assert!(!config.enabled);
        assert_eq!(config.verbosity, DebugVerbosity::Normal);
        assert!(!config.log_to_file);
        assert!(config.session_id.is_none());
    }

    #[test]
    fn test_debug_config_serde_roundtrip() {
        let config = DebugConfig {
            enabled: true,
            verbosity: DebugVerbosity::Verbose,
            log_to_file: true,
            session_id: Some("session-123".to_string()),
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: DebugConfig = serde_json::from_str(&json).unwrap();
        assert!(parsed.enabled);
        assert_eq!(parsed.verbosity, DebugVerbosity::Verbose);
        assert!(parsed.log_to_file);
        assert_eq!(parsed.session_id, Some("session-123".to_string()));
    }

    #[test]
    fn test_debug_event_serde_roundtrip() {
        let mut data = HashMap::new();
        data.insert(
            "taskId".to_string(),
            serde_json::Value::String("MOB-125".to_string()),
        );
        data.insert(
            "newStatus".to_string(),
            serde_json::Value::String("done".to_string()),
        );

        let event = DebugEvent {
            timestamp: "2024-01-15T14:30:00.123Z".to_string(),
            event_type: DebugEventType::TaskStateChange,
            source: DebugEventSource::Loop,
            task_id: Some("MOB-125".to_string()),
            data,
        };

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"type\":\"task_state_change\""));
        assert!(json.contains("\"source\":\"loop\""));

        let parsed: DebugEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.event_type, DebugEventType::TaskStateChange);
        assert_eq!(parsed.source, DebugEventSource::Loop);
        assert_eq!(parsed.task_id, Some("MOB-125".to_string()));
    }

    #[test]
    fn test_verbosity_levels() {
        let minimal = verbosity_event_types(DebugVerbosity::Minimal);
        assert_eq!(minimal.len(), 2);
        assert!(minimal.contains(&DebugEventType::TaskStateChange));

        let normal = verbosity_event_types(DebugVerbosity::Normal);
        assert_eq!(normal.len(), 5);
        assert!(normal.contains(&DebugEventType::PendingUpdateQueue));

        let verbose = verbosity_event_types(DebugVerbosity::Verbose);
        assert_eq!(verbose.len(), 10);
        assert!(verbose.contains(&DebugEventType::LockAcquire));
        assert!(verbose.contains(&DebugEventType::RuntimeStateWrite));
    }
}
