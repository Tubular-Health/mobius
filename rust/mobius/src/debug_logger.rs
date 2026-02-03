//! Debug logger utility for state drift diagnostics.
//!
//! Provides a thread-safe singleton logger that:
//! - Maintains a ring buffer of recent events (for TUI display)
//! - Writes to log files at `.mobius/issues/{parentId}/execution/debug-{sessionId}.log`
//! - Outputs to stderr in non-TUI mode with color-coded event types

use std::collections::{HashMap, VecDeque};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::sync::{Mutex, OnceLock};

use chrono::Utc;
use colored::Colorize;

use crate::context::get_execution_path;
use crate::types::debug::{verbosity_event_types, DebugConfig, DebugEvent};
use crate::types::enums::{DebugEventSource, DebugEventType, DebugVerbosity};

/// Maximum events to keep in ring buffer.
const RING_BUFFER_SIZE: usize = 100;

/// Global singleton debug logger.
static DEBUG_LOGGER: OnceLock<Mutex<DebugLogger>> = OnceLock::new();

/// Short labels for event types (for compact console output).
fn event_label(event_type: DebugEventType) -> &'static str {
    match event_type {
        DebugEventType::RuntimeStateWrite => "runtime:state:write",
        DebugEventType::RuntimeStateRead => "runtime:state:read",
        DebugEventType::RuntimeWatcherTrigger => "runtime:watcher",
        DebugEventType::TaskStateChange => "task:state:change",
        DebugEventType::PendingUpdateQueue => "pending:update:queue",
        DebugEventType::PendingUpdatePush => "pending:update:push",
        DebugEventType::BackendStatusUpdate => "backend:status:update",
        DebugEventType::LockAcquire => "lock:acquire",
        DebugEventType::LockRelease => "lock:release",
        DebugEventType::TuiStateReceive => "tui:state:receive",
    }
}

/// Apply color to a label string based on event type.
fn color_label(event_type: DebugEventType, label: &str) -> String {
    match event_type {
        DebugEventType::RuntimeStateWrite => label.blue().to_string(),
        DebugEventType::RuntimeStateRead => label.dimmed().to_string(),
        DebugEventType::RuntimeWatcherTrigger => label.magenta().to_string(),
        DebugEventType::TaskStateChange => label.yellow().to_string(),
        DebugEventType::PendingUpdateQueue => label.cyan().to_string(),
        DebugEventType::PendingUpdatePush => label.green().to_string(),
        DebugEventType::BackendStatusUpdate => label.bright_green().to_string(),
        DebugEventType::LockAcquire => label.dimmed().to_string(),
        DebugEventType::LockRelease => label.dimmed().to_string(),
        DebugEventType::TuiStateReceive => label.bright_blue().to_string(),
    }
}

/// Internal debug logger state.
struct DebugLogger {
    config: DebugConfig,
    ring_buffer: VecDeque<DebugEvent>,
    log_file_path: Option<String>,
}

impl DebugLogger {
    fn new() -> Self {
        Self {
            config: DebugConfig::default(),
            ring_buffer: VecDeque::with_capacity(RING_BUFFER_SIZE),
            log_file_path: None,
        }
    }

    fn initialize(&mut self, parent_id: &str, verbosity: DebugVerbosity) {
        let session_id = format!("{:x}", Utc::now().timestamp_millis());

        self.config = DebugConfig {
            enabled: true,
            verbosity,
            log_to_file: true,
            session_id: Some(session_id.clone()),
        };

        // Set up log file
        let execution_dir = get_execution_path(parent_id);
        if !execution_dir.exists() {
            let _ = fs::create_dir_all(&execution_dir);
        }
        self.log_file_path = Some(
            execution_dir
                .join(format!("debug-{session_id}.log"))
                .to_string_lossy()
                .to_string(),
        );

        // Log initialization
        let mut data = HashMap::new();
        data.insert(
            "event".to_string(),
            serde_json::Value::String("debug_session_start".to_string()),
        );
        data.insert(
            "verbosity".to_string(),
            serde_json::Value::String(format!("{verbosity:?}").to_lowercase()),
        );
        if let Some(ref path) = self.log_file_path {
            data.insert(
                "logFile".to_string(),
                serde_json::Value::String(path.clone()),
            );
        }

        self.log_event(
            DebugEventType::TaskStateChange,
            DebugEventSource::Loop,
            None,
            data,
        );
    }

    fn should_log(&self, event_type: DebugEventType) -> bool {
        if !self.config.enabled {
            return false;
        }
        verbosity_event_types(self.config.verbosity).contains(&event_type)
    }

    fn log_event(
        &mut self,
        event_type: DebugEventType,
        source: DebugEventSource,
        task_id: Option<String>,
        data: HashMap<String, serde_json::Value>,
    ) {
        if !self.should_log(event_type) {
            return;
        }

        let event = DebugEvent {
            timestamp: Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            event_type,
            source,
            task_id,
            data,
        };

        // Add to ring buffer
        self.ring_buffer.push_back(event.clone());
        if self.ring_buffer.len() > RING_BUFFER_SIZE {
            self.ring_buffer.pop_front();
        }

        // Write to log file
        if self.config.log_to_file {
            self.write_to_file(&event);
        }

        // Write to stderr for non-TUI mode
        self.write_to_stderr(&event);
    }

    fn get_recent_events(&self, count: usize) -> Vec<DebugEvent> {
        let len = self.ring_buffer.len();
        let start = len.saturating_sub(count);
        self.ring_buffer.iter().skip(start).cloned().collect()
    }

    fn format_for_file(event: &DebugEvent) -> String {
        let time = event
            .timestamp
            .split('T')
            .nth(1)
            .unwrap_or(&event.timestamp)
            .trim_end_matches('Z');
        let task_part = event
            .task_id
            .as_ref()
            .map(|id| format!(" [{id}]"))
            .unwrap_or_default();
        let data_str = if event.data.is_empty() {
            String::new()
        } else {
            format!(" {}", serde_json::to_string(&event.data).unwrap_or_default())
        };

        format!(
            "[DEBUG {time}] {}{task_part}{data_str}\n",
            event_label(event.event_type)
        )
    }

    fn format_for_console(event: &DebugEvent) -> String {
        let time = event
            .timestamp
            .split('T')
            .nth(1)
            .unwrap_or(&event.timestamp);
        // Take HH:mm:ss.SSS (12 chars)
        let time = &time[..time.len().min(12)];

        let label = format!("{:<22}", event_label(event.event_type));
        let colored_label = color_label(event.event_type, &label);

        let task_part = event
            .task_id
            .as_ref()
            .map(|id| format!("{} ", format!("[{id}]").white()))
            .unwrap_or_default();

        // Format data key=value pairs
        let data_parts: Vec<String> = event
            .data
            .iter()
            .filter(|(_, v)| !v.is_null())
            .map(|(key, value)| {
                let value_str = match value {
                    serde_json::Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                format!("{key}={value_str}")
            })
            .collect();
        let data_str = data_parts.join(" ");

        format!(
            "{} {colored_label} {task_part}{}",
            format!("[DEBUG {time}]").dimmed(),
            data_str.dimmed()
        )
    }

    fn write_to_file(&self, event: &DebugEvent) {
        let Some(ref path) = self.log_file_path else {
            return;
        };

        let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
            return;
        };

        let _ = file.write_all(Self::format_for_file(event).as_bytes());
    }

    fn write_to_stderr(&self, event: &DebugEvent) {
        // Only write to stderr if not in TUI mode
        if std::env::var("MOBIUS_TUI_MODE").as_deref() != Ok("true") {
            eprintln!("{}", Self::format_for_console(event));
        }
    }
}

// --- Public convenience API ---

/// Initialize the debug logger for a session.
///
/// Creates a new debug session with the given parent ID and verbosity level.
/// Sets up log file at `.mobius/issues/{parent_id}/execution/debug-{session_id}.log`.
pub fn initialize_debug_logger(parent_id: &str, verbosity: DebugVerbosity) {
    let logger = DEBUG_LOGGER.get_or_init(|| Mutex::new(DebugLogger::new()));
    if let Ok(mut guard) = logger.lock() {
        guard.initialize(parent_id, verbosity);
    }
}

/// Log a debug event.
///
/// Events are filtered by the current verbosity level. If the event type is not
/// included in the current verbosity, the event is silently dropped.
pub fn debug_log(
    event_type: DebugEventType,
    source: DebugEventSource,
    task_id: Option<&str>,
    data: HashMap<String, serde_json::Value>,
) {
    let logger = DEBUG_LOGGER.get_or_init(|| Mutex::new(DebugLogger::new()));
    if let Ok(mut guard) = logger.lock() {
        guard.log_event(event_type, source, task_id.map(|s| s.to_string()), data);
    }
}

/// Check if debug mode is enabled.
pub fn is_debug_enabled() -> bool {
    let Some(logger) = DEBUG_LOGGER.get() else {
        return false;
    };
    if let Ok(guard) = logger.lock() {
        return guard.config.enabled;
    }
    false
}

/// Get recent debug events for TUI display.
///
/// Returns up to `count` most recent events from the ring buffer.
pub fn get_recent_debug_events(count: usize) -> Vec<DebugEvent> {
    let Some(logger) = DEBUG_LOGGER.get() else {
        return Vec::new();
    };
    if let Ok(guard) = logger.lock() {
        return guard.get_recent_events(count);
    }
    Vec::new()
}
