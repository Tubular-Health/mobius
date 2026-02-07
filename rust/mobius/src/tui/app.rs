use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Instant;

use crate::types::context::{
    AgentTodoFile, RuntimeActiveTask, RuntimeCompletedTask, RuntimeState, SessionInfo,
};
use crate::types::debug::DebugEvent;
use crate::types::enums::{SessionStatus, TaskStatus};
use crate::types::task_graph::{SubTask, TaskGraph};

/// Application state for the TUI dashboard.
pub struct App {
    pub parent_id: String,
    pub parent_title: String,
    pub graph: TaskGraph,
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
    pub agent_todos: HashMap<String, AgentTodoFile>,
    pub max_parallel_agents: usize,
    pub token_history: Vec<u64>,
    last_token_total: u64,
}

impl App {
    pub fn new(
        parent_id: String,
        parent_title: String,
        graph: TaskGraph,
        runtime_state_path: PathBuf,
        max_parallel_agents: usize,
    ) -> Self {
        Self {
            parent_id,
            parent_title,
            graph,
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
            agent_todos: HashMap::new(),
            max_parallel_agents,
            token_history: Vec::new(),
            last_token_total: 0,
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

    /// Get the path to the todos directory (sibling to runtime.json).
    pub fn todos_dir(&self) -> PathBuf {
        self.runtime_state_path.parent().unwrap().join("todos")
    }

    /// Reload agent todo files from the todos directory.
    pub fn reload_todos(&mut self) {
        self.agent_todos.clear();
        let todos_dir = self.todos_dir();
        let entries = match std::fs::read_dir(&todos_dir) {
            Ok(entries) => entries,
            Err(_) => return,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if let Ok(todo_file) = serde_json::from_str::<AgentTodoFile>(&content) {
                        self.agent_todos
                            .insert(todo_file.subtask_id.clone(), todo_file);
                    }
                }
            }
        }
    }

    /// Check if execution is complete (all tasks in terminal state).
    fn check_completion(&mut self) {
        let total = self.graph.tasks.len();
        let (completed, failed) = self
            .runtime_state
            .as_ref()
            .map(|state| (state.completed_tasks.len(), state.failed_tasks.len()))
            .unwrap_or((0, 0));

        let session_terminal = self.has_terminal_session_status();

        if ((completed + failed >= total && total > 0) || session_terminal) && !self.is_complete {
            self.is_complete = true;
            self.auto_exit_tick = Some(2);
        }
    }

    /// Handle tick event (called every second).
    pub fn on_tick(&mut self) {
        // Catch completion transitions even if file watchers miss an event.
        self.check_completion();

        if let Some(ref mut ticks) = self.auto_exit_tick {
            if *ticks == 0 {
                self.should_quit = true;
            } else {
                *ticks -= 1;
            }
        }

        // Sample token usage for sparkline history
        let current = self.current_total_tokens();
        if current != self.last_token_total {
            self.token_history.push(current);
            if self.token_history.len() > 60 {
                self.token_history.remove(0);
            }
            self.last_token_total = current;
        }
    }

    /// Get combined total tokens (input + output) from runtime state.
    fn current_total_tokens(&self) -> u64 {
        self.runtime_state
            .as_ref()
            .map(|s| s.total_input_tokens.unwrap_or(0) + s.total_output_tokens.unwrap_or(0))
            .unwrap_or(0)
    }

    /// Get the token history slice for sparkline rendering.
    pub fn token_history(&self) -> &[u64] {
        &self.token_history
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
            overrides
                .entry(task.id.clone())
                .or_insert(TaskStatus::InProgress);
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
        overrides.get(&task.id).copied().unwrap_or(task.status)
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
                    input_tokens: None,
                    output_tokens: None,
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

    fn has_terminal_session_status(&self) -> bool {
        let Some(execution_dir) = self.runtime_state_path.parent() else {
            return false;
        };

        let session_path = execution_dir.join("session.json");
        let Ok(content) = std::fs::read_to_string(session_path) else {
            return false;
        };

        let Ok(session) = serde_json::from_str::<SessionInfo>(&content) else {
            return false;
        };

        matches!(
            session.status,
            SessionStatus::Completed | SessionStatus::Failed
        )
    }
}

/// Extract a task ID from a completed/failed task entry.
/// Supports both string IDs and `{id: "..."}` object format.
fn extract_task_id(value: &serde_json::Value) -> Option<String> {
    if let Some(s) = value.as_str() {
        return Some(s.to_string());
    }
    value.as_object()?.get("id")?.as_str().map(String::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::task_graph::TaskGraph;

    fn make_graph(total: usize) -> TaskGraph {
        let mut tasks = HashMap::new();
        for i in 0..total {
            let id = format!("task-{:03}", i + 1);
            tasks.insert(
                id.clone(),
                SubTask {
                    id: id.clone(),
                    identifier: id.clone(),
                    title: format!("Task {}", i + 1),
                    status: TaskStatus::Pending,
                    blocked_by: Vec::new(),
                    blocks: Vec::new(),
                    git_branch_name: String::new(),
                },
            );
        }

        TaskGraph {
            parent_id: "MOB-1".to_string(),
            parent_identifier: "MOB-1".to_string(),
            tasks,
            edges: HashMap::new(),
        }
    }

    fn make_runtime_state(total: usize, completed: usize, failed: usize) -> serde_json::Value {
        let completed_tasks: Vec<_> = (0..completed)
            .map(|i| serde_json::json!({ "id": format!("task-{:03}", i + 1) }))
            .collect();

        let failed_tasks: Vec<_> = (0..failed)
            .map(|i| serde_json::json!({ "id": format!("task-{:03}", completed + i + 1) }))
            .collect();

        serde_json::json!({
            "parentId": "MOB-1",
            "parentTitle": "Parent",
            "activeTasks": [],
            "completedTasks": completed_tasks,
            "failedTasks": failed_tasks,
            "startedAt": "2026-02-07T00:00:00Z",
            "updatedAt": "2026-02-07T00:00:00Z",
            "loopPid": 123,
            "totalTasks": total
        })
    }

    fn unique_execution_dir(test_name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "mobius-app-tests-{}-{}-{}",
            test_name,
            std::process::id(),
            nanos
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn check_completion_marks_complete_when_all_tasks_terminal() {
        let exec_dir = unique_execution_dir("all-terminal");
        let runtime_path = exec_dir.join("runtime.json");

        let runtime = make_runtime_state(2, 1, 1);
        std::fs::write(
            &runtime_path,
            serde_json::to_string_pretty(&runtime).unwrap(),
        )
        .unwrap();

        let mut app = App::new(
            "MOB-1".to_string(),
            "Parent".to_string(),
            make_graph(2),
            runtime_path,
            3,
        );

        app.reload_runtime_state();

        assert!(app.is_complete);
        assert_eq!(app.auto_exit_tick, Some(2));

        let _ = std::fs::remove_dir_all(exec_dir);
    }

    #[test]
    fn check_completion_marks_complete_when_session_failed() {
        let exec_dir = unique_execution_dir("session-failed");
        let runtime_path = exec_dir.join("runtime.json");
        let session_path = exec_dir.join("session.json");

        let runtime = make_runtime_state(8, 5, 2);
        std::fs::write(
            &runtime_path,
            serde_json::to_string_pretty(&runtime).unwrap(),
        )
        .unwrap();

        let session = serde_json::json!({
            "parentId": "MOB-1",
            "backend": "linear",
            "startedAt": "2026-02-07T00:00:00Z",
            "worktreePath": null,
            "status": "failed"
        });
        std::fs::write(
            &session_path,
            serde_json::to_string_pretty(&session).unwrap(),
        )
        .unwrap();

        let mut app = App::new(
            "MOB-1".to_string(),
            "Parent".to_string(),
            make_graph(8),
            runtime_path,
            3,
        );

        app.reload_runtime_state();

        assert!(app.is_complete);
        assert_eq!(app.auto_exit_tick, Some(2));

        let _ = std::fs::remove_dir_all(exec_dir);
    }
}
