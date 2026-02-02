use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Instant;

use crate::types::context::{RuntimeActiveTask, RuntimeCompletedTask, RuntimeState};
use crate::types::debug::DebugEvent;
use crate::types::enums::{Backend, TaskStatus};
use crate::types::task_graph::{TaskGraph, SubTask};

/// Application state for the TUI dashboard.
pub struct App {
    pub parent_id: String,
    pub parent_title: String,
    pub graph: TaskGraph,
    pub api_graph: TaskGraph,
    pub backend: Backend,
    pub runtime_state: Option<RuntimeState>,
    pub start_time: Instant,
    pub show_legend: bool,
    pub show_debug: bool,
    pub show_exit_modal: bool,
    pub is_complete: bool,
    pub debug_events: Vec<DebugEvent>,
    pub pending_count: usize,
    pub runtime_state_path: PathBuf,
    pub should_quit: bool,
    pub auto_exit_tick: Option<u8>,
}

impl App {
    pub fn new(
        parent_id: String,
        parent_title: String,
        graph: TaskGraph,
        api_graph: TaskGraph,
        backend: Backend,
        runtime_state_path: PathBuf,
    ) -> Self {
        Self {
            parent_id,
            parent_title,
            graph,
            api_graph,
            backend,
            runtime_state: None,
            start_time: Instant::now(),
            show_legend: true,
            show_debug: false,
            show_exit_modal: false,
            is_complete: false,
            debug_events: Vec::new(),
            pending_count: 0,
            runtime_state_path,
            should_quit: false,
            auto_exit_tick: None,
        }
    }

    /// Reload runtime state from the state file on disk.
    pub fn reload_runtime_state(&mut self) {
        if let Ok(content) = std::fs::read_to_string(&self.runtime_state_path) {
            if let Ok(state) = serde_json::from_str::<RuntimeState>(&content) {
                self.runtime_state = Some(state);
                self.check_completion();
            }
        }
    }

    /// Check if execution is complete (all tasks in terminal state).
    fn check_completion(&mut self) {
        let Some(state) = &self.runtime_state else {
            return;
        };

        let total = self.graph.tasks.len();
        let completed = state.completed_tasks.len();
        let failed = state.failed_tasks.len();

        if completed + failed >= total && total > 0 && !self.is_complete {
            self.is_complete = true;
            self.auto_exit_tick = Some(2);
        }
    }

    /// Handle tick event (called every second).
    pub fn on_tick(&mut self) {
        if let Some(ref mut ticks) = self.auto_exit_tick {
            if *ticks == 0 {
                self.should_quit = true;
            } else {
                *ticks -= 1;
            }
        }
    }

    /// Handle 'q' key press.
    pub fn on_quit_key(&mut self) {
        if self.is_complete {
            self.should_quit = true;
        } else if self.has_active_tasks() {
            self.show_exit_modal = true;
        } else {
            self.should_quit = true;
        }
    }

    /// Handle exit confirmation from modal.
    pub fn confirm_exit(&mut self) {
        self.kill_loop_process();
        self.should_quit = true;
    }

    /// Cancel exit modal.
    pub fn cancel_exit(&mut self) {
        self.show_exit_modal = false;
    }

    /// Toggle debug panel visibility.
    pub fn toggle_debug(&mut self) {
        self.show_debug = !self.show_debug;
    }

    /// Check if there are active tasks.
    pub fn has_active_tasks(&self) -> bool {
        self.runtime_state
            .as_ref()
            .map(|s| !s.active_tasks.is_empty())
            .unwrap_or(false)
    }

    /// Get the elapsed time since TUI start in milliseconds.
    pub fn elapsed_ms(&self) -> u64 {
        self.start_time.elapsed().as_millis() as u64
    }

    /// Get status overrides based on runtime state.
    pub fn status_overrides(&self) -> HashMap<String, TaskStatus> {
        let mut overrides = HashMap::new();
        let Some(state) = &self.runtime_state else {
            return overrides;
        };

        // Completed tasks -> done
        for entry in &state.completed_tasks {
            if let Some(id) = extract_task_id(entry) {
                overrides.insert(id, TaskStatus::Done);
            }
        }

        // Active tasks -> in_progress (unless already done)
        for task in &state.active_tasks {
            overrides.entry(task.id.clone()).or_insert(TaskStatus::InProgress);
        }

        // Failed tasks -> failed (unless already done)
        for entry in &state.failed_tasks {
            if let Some(id) = extract_task_id(entry) {
                overrides.entry(id).or_insert(TaskStatus::Failed);
            }
        }

        overrides
    }

    /// Get the effective status for a task, considering overrides.
    pub fn effective_status(&self, task: &SubTask) -> TaskStatus {
        let overrides = self.status_overrides();
        overrides
            .get(&task.id)
            .copied()
            .unwrap_or(task.status)
    }

    /// Get active task info by task ID.
    pub fn active_task_info(&self, task_id: &str) -> Option<&RuntimeActiveTask> {
        self.runtime_state
            .as_ref()?
            .active_tasks
            .iter()
            .find(|t| t.id == task_id)
    }

    /// Get completed task info by task ID.
    pub fn completed_task_info(&self, task_id: &str) -> Option<RuntimeCompletedTask> {
        let state = self.runtime_state.as_ref()?;
        for entry in &state.completed_tasks {
            if let Some(obj) = entry.as_object() {
                if obj.get("id").and_then(|v| v.as_str()) == Some(task_id) {
                    return serde_json::from_value(entry.clone()).ok();
                }
            }
            // Legacy format: plain string ID
            if entry.as_str() == Some(task_id) {
                return Some(RuntimeCompletedTask {
                    id: task_id.to_string(),
                    completed_at: String::new(),
                    duration: 0,
                });
            }
        }
        None
    }

    /// Get execution summary for exit modal.
    pub fn execution_summary(&self) -> (usize, usize, usize) {
        let total = self.graph.tasks.len();
        let state = self.runtime_state.as_ref();
        let completed = state.map(|s| s.completed_tasks.len()).unwrap_or(0);
        let failed = state.map(|s| s.failed_tasks.len()).unwrap_or(0);
        (completed, total, failed)
    }

    /// Kill the loop process if running.
    fn kill_loop_process(&self) {
        if let Some(state) = &self.runtime_state {
            if let Some(pid) = state.loop_pid {
                unsafe {
                    libc::kill(pid as i32, libc::SIGTERM);
                }
            }
        }
    }
}

/// Extract a task ID from a completed/failed task entry.
/// Supports both string IDs and `{id: "..."}` object format.
fn extract_task_id(value: &serde_json::Value) -> Option<String> {
    if let Some(s) = value.as_str() {
        return Some(s.to_string());
    }
    value
        .as_object()?
        .get("id")?
        .as_str()
        .map(String::from)
}
