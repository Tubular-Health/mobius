use std::collections::HashMap;
use std::io;
use std::path::PathBuf;
use std::time::Duration;

use crossterm::event::{KeyCode, KeyModifiers};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::Terminal;

use crate::types::task_graph::TaskGraph;

use super::agent_progress::{calculate_height, AgentProgress};
use super::agent_slots::{AgentSlots, AGENT_SLOTS_HEIGHT};
use super::app::App;
use super::debug_panel::{DebugPanel, DEBUG_PANEL_HEIGHT};
use super::events::{EventHandler, TuiEvent};
use super::exit_modal::ExitModal;
use super::header::{Header, HEADER_HEIGHT};
use super::legend::{Legend, LEGEND_HEIGHT};
use super::task_tree::{CompletedInfo, TaskTreeWidget};
use super::theme::{MUTED_COLOR, NORD0, NORD11, NORD14, TEXT_COLOR};

#[derive(Debug, Default, PartialEq, Eq)]
struct TokenAggregation {
    total: u64,
    per_model: Vec<(String, u64)>,
}

/// Run the TUI dashboard.
pub fn run_dashboard(
    parent_id: String,
    parent_title: String,
    graph: TaskGraph,
    runtime_state_path: PathBuf,
    max_parallel_agents: usize,
) -> anyhow::Result<()> {
    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    let backend_term = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend_term)?;
    terminal.clear()?;

    // Create app state
    let mut app = App::new(
        parent_id,
        parent_title,
        graph,
        runtime_state_path.clone(),
        max_parallel_agents,
    );

    // Load initial runtime state if file exists
    app.reload_runtime_state();

    // Create event handler with todos directory watcher
    let todos_dir = app.todos_dir();
    let events = EventHandler::new(Some(runtime_state_path), Some(todos_dir));

    // Main event loop
    loop {
        terminal.draw(|frame| render_dashboard(frame, &app))?;

        if app.should_quit {
            break;
        }

        // Poll for events with a timeout
        if let Some(event) = events.next(Duration::from_millis(100)) {
            match event {
                TuiEvent::Key(key) => handle_key_event(&mut app, key),
                TuiEvent::StateFileChanged => {
                    app.reload_runtime_state();
                }
                TuiEvent::TodosChanged => {
                    app.reload_todos();
                }
                TuiEvent::Tick => {
                    app.on_tick();
                }
            }
        }
    }

    // Restore terminal
    disable_raw_mode()?;
    execute!(io::stdout(), LeaveAlternateScreen)?;
    terminal.show_cursor()?;

    Ok(())
}

fn handle_key_event(app: &mut App, key: crossterm::event::KeyEvent) {
    // Handle exit modal first
    if app.show_exit_modal {
        match key.code {
            KeyCode::Char('y') | KeyCode::Char('Y') | KeyCode::Enter => {
                app.confirm_exit();
            }
            KeyCode::Char('n') | KeyCode::Char('N') | KeyCode::Esc => {
                app.cancel_exit();
            }
            _ => {}
        }
        return;
    }

    // Handle completion state (any key exits)
    if app.is_complete {
        match key.code {
            KeyCode::Char('q') | KeyCode::Enter | KeyCode::Char(' ') => {
                app.should_quit = true;
            }
            _ => {}
        }
        return;
    }

    // Normal mode key handling
    match key.code {
        KeyCode::Char('q') => app.on_quit_key(),
        KeyCode::Char('d') => app.toggle_debug(),
        KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
            app.on_quit_key();
        }
        _ => {}
    }
}

fn render_dashboard(frame: &mut ratatui::Frame, app: &App) {
    let size = frame.area();

    // Clear background
    let bg_block = ratatui::widgets::Block::default().style(Style::default().bg(NORD0));
    frame.render_widget(bg_block, size);

    // Calculate layout constraints
    let has_agent_progress = !app.agent_todos.is_empty();
    let mut constraints = vec![
        Constraint::Length(HEADER_HEIGHT),      // Header
        Constraint::Min(5),                     // Main content (task tree + backend status)
        Constraint::Length(AGENT_SLOTS_HEIGHT), // Agent slots
        Constraint::Length(1),                  // Token summary
    ];

    if has_agent_progress {
        constraints.push(Constraint::Length(calculate_height(app.agent_todos.len())));
    }

    if app.show_legend {
        constraints.push(Constraint::Length(LEGEND_HEIGHT));
    }

    if app.show_debug {
        constraints.push(Constraint::Length(DEBUG_PANEL_HEIGHT));
    }

    // Completion bar
    if app.is_complete {
        constraints.push(Constraint::Length(2));
    }

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints(constraints)
        .split(size);

    let mut chunk_idx = 0;

    // Render header
    let header = Header {
        parent_id: &app.parent_id,
        parent_title: &app.parent_title,
        elapsed_ms: app.elapsed_ms(),
        has_runtime: app.runtime_state.is_some(),
    };
    frame.render_widget(header, chunks[chunk_idx]);
    chunk_idx += 1;

    // Render main content (task tree + backend status side by side)
    let main_area = chunks[chunk_idx];
    chunk_idx += 1;

    // Build status overrides and timing maps
    let status_overrides = app.status_overrides();
    let mut active_elapsed: HashMap<String, u64> = HashMap::new();
    let mut completed_info: HashMap<String, CompletedInfo> = HashMap::new();

    if let Some(state) = &app.runtime_state {
        for task in &state.active_tasks {
            if let Ok(started) = chrono::DateTime::parse_from_rfc3339(&task.started_at) {
                let elapsed = chrono::Utc::now()
                    .signed_duration_since(started)
                    .num_milliseconds()
                    .max(0) as u64;
                active_elapsed.insert(task.id.clone(), elapsed);
            }
        }

        for entry in &state.completed_tasks {
            if let Some(obj) = entry.as_object() {
                let id = obj
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let duration = obj.get("duration").and_then(|v| v.as_u64()).unwrap_or(0);
                if !id.is_empty() {
                    completed_info.insert(id, CompletedInfo { duration });
                }
            }
        }
    }

    let task_tree = TaskTreeWidget {
        graph: &app.graph,
        status_overrides: &status_overrides,
        active_elapsed: &active_elapsed,
        completed_info: &completed_info,
    };
    frame.render_widget(task_tree, main_area);

    // Render agent slots
    let agent_area = chunks[chunk_idx];
    chunk_idx += 1;

    let active_ids: Vec<String> = app
        .runtime_state
        .as_ref()
        .map(|s| s.active_tasks.iter().map(|t| t.id.clone()).collect())
        .unwrap_or_default();

    let agent_slots = AgentSlots {
        active_tasks: &active_ids,
        max_slots: app.max_parallel_agents,
    };
    frame.render_widget(agent_slots, agent_area);

    let token_area = chunks[chunk_idx];
    chunk_idx += 1;
    render_token_summary(frame, token_area, aggregate_tokens(app));

    // Render agent progress (if any todos exist)
    if has_agent_progress {
        let progress_area = chunks[chunk_idx];
        chunk_idx += 1;

        let agent_progress = AgentProgress {
            todos: &app.agent_todos,
        };
        frame.render_widget(agent_progress, progress_area);
    }

    // Render legend (if shown)
    if app.show_legend {
        frame.render_widget(Legend, chunks[chunk_idx]);
        chunk_idx += 1;
    }

    // Render debug panel (if shown)
    if app.show_debug {
        let debug = DebugPanel {
            events: &app.debug_events,
            pending_count: app.pending_count,
            max_lines: 8,
        };
        frame.render_widget(debug, chunks[chunk_idx]);
        chunk_idx += 1;
    }

    // Render completion bar
    if app.is_complete {
        let (completed, total, failed) = app.execution_summary();
        render_completion_bar(
            frame,
            chunks[chunk_idx],
            completed,
            total,
            failed,
            app.elapsed_ms(),
            app.auto_exit_tick,
        );
    }

    // Render exit modal on top (last, so it overlays everything)
    if app.show_exit_modal {
        let (completed, total, failed) = app.execution_summary();
        let active_count = app
            .runtime_state
            .as_ref()
            .map(|s| s.active_tasks.len())
            .unwrap_or(0);

        let modal = ExitModal {
            active_agent_count: active_count,
            completed,
            total,
            failed,
            elapsed_ms: app.elapsed_ms(),
        };
        frame.render_widget(modal, size);
    }
}

fn render_completion_bar(
    frame: &mut ratatui::Frame,
    area: Rect,
    completed: usize,
    total: usize,
    failed: usize,
    elapsed_ms: u64,
    auto_exit_tick: Option<u8>,
) {
    use super::header::format_duration;

    let status_color = if failed > 0 { NORD11 } else { NORD14 };
    let status_text = if failed > 0 {
        "Execution completed with failures"
    } else {
        "Execution completed successfully"
    };

    let exit_text = match auto_exit_tick {
        Some(n) => format!("Exiting in {}s... (press any key to exit now)", n),
        None => "Press any key to exit".to_string(),
    };

    let line1 = Line::from(vec![
        Span::styled(
            format!("  {} ", status_text),
            Style::default().fg(status_color),
        ),
        Span::styled(
            format!(
                "Total: {} | Done: {} | Failed: {} | Runtime: {}",
                total,
                completed,
                failed,
                format_duration(elapsed_ms)
            ),
            Style::default().fg(TEXT_COLOR),
        ),
    ]);

    let line2 = Line::from(Span::styled(
        format!("  {}", exit_text),
        Style::default().fg(MUTED_COLOR),
    ));

    frame.render_widget(line1, Rect::new(area.x, area.y, area.width, 1));
    if area.height > 1 {
        frame.render_widget(line2, Rect::new(area.x, area.y + 1, area.width, 1));
    }
}

fn aggregate_tokens(app: &App) -> TokenAggregation {
    let Some(raw_state) = app.runtime_state_raw.as_ref() else {
        return TokenAggregation::default();
    };

    let active_tasks = raw_state
        .get("activeTasks")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut per_model_map: HashMap<String, u64> = HashMap::new();
    let mut summed_active_total = 0u64;

    for task in active_tasks {
        let model = task
            .get("model")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("unknown")
            .to_string();

        let task_total =
            read_token_count(&task, &["tokens", "token", "totalTokens", "total_tokens"])
                .or_else(|| {
                    let input =
                        read_token_count(&task, &["inputTokens", "input_tokens", "inputToken"])
                            .unwrap_or(0);
                    let output =
                        read_token_count(&task, &["outputTokens", "output_tokens", "outputToken"])
                            .unwrap_or(0);
                    if input > 0 || output > 0 {
                        Some(input.saturating_add(output))
                    } else {
                        None
                    }
                })
                .unwrap_or(0);

        summed_active_total = summed_active_total.saturating_add(task_total);
        if task_total > 0 {
            let entry = per_model_map.entry(model).or_insert(0);
            *entry = entry.saturating_add(task_total);
        }
    }

    let mut per_model: Vec<(String, u64)> = per_model_map.into_iter().collect();
    per_model.sort_by(|a, b| a.0.cmp(&b.0));

    let total = if let Some(total_tokens) = read_token_count(
        raw_state,
        &["tokens", "token", "totalTokens", "total_tokens"],
    ) {
        total_tokens
    } else {
        let total_input = read_token_count(
            raw_state,
            &["totalInputTokens", "total_input_tokens", "totalInputToken"],
        )
        .unwrap_or(0);
        let total_output = read_token_count(
            raw_state,
            &[
                "totalOutputTokens",
                "total_output_tokens",
                "totalOutputToken",
            ],
        )
        .unwrap_or(0);

        if total_input > 0 || total_output > 0 {
            total_input.saturating_add(total_output)
        } else {
            summed_active_total
        }
    };

    TokenAggregation { total, per_model }
}

fn read_token_count(node: &serde_json::Value, keys: &[&str]) -> Option<u64> {
    for key in keys {
        let Some(value) = node.get(key) else {
            continue;
        };
        match value {
            serde_json::Value::Number(n) => {
                if let Some(v) = n.as_u64() {
                    return Some(v);
                }
            }
            serde_json::Value::String(s) => {
                let trimmed = s.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Ok(v) = trimmed.parse::<u64>() {
                    return Some(v);
                }
            }
            _ => {}
        }
    }
    None
}

fn render_token_summary(frame: &mut ratatui::Frame, area: Rect, tokens: TokenAggregation) {
    let details = if tokens.per_model.is_empty() {
        String::new()
    } else {
        let mut parts = Vec::with_capacity(tokens.per_model.len());
        for (model, count) in tokens.per_model {
            parts.push(format!("{}: {}", model, count));
        }
        format!(" | {}", parts.join(", "))
    };

    let line = if tokens.total == 0 && details.is_empty() {
        Line::from(Span::styled("Tokens: -", Style::default().fg(MUTED_COLOR)))
    } else {
        Line::from(Span::styled(
            format!("Tokens: {}{}", tokens.total, details),
            Style::default().fg(TEXT_COLOR),
        ))
    };

    frame.render_widget(line, area);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap as StdHashMap;

    fn empty_graph() -> TaskGraph {
        TaskGraph {
            parent_id: "MOB-1".into(),
            parent_identifier: "MOB-1".into(),
            tasks: StdHashMap::new(),
            edges: StdHashMap::new(),
        }
    }

    #[test]
    fn aggregate_tokens_handles_missing_and_null_fields() {
        let raw = serde_json::json!({
            "activeTasks": [
                { "id": "task-1", "model": "gpt-5", "inputTokens": "10", "outputTokens": 5 },
                { "id": "task-2", "model": null, "tokens": "7" },
                { "id": "task-3", "model": "", "tokens": null },
                { "id": "task-4" }
            ]
        });

        let app = App {
            parent_id: "MOB-1".into(),
            parent_title: "Parent".into(),
            graph: empty_graph(),
            runtime_state: None,
            runtime_state_raw: Some(raw),
            start_time: std::time::Instant::now(),
            show_legend: true,
            show_debug: false,
            show_exit_modal: false,
            is_complete: false,
            debug_events: Vec::new(),
            pending_count: 0,
            runtime_state_path: PathBuf::from("runtime.json"),
            should_quit: false,
            auto_exit_tick: None,
            agent_todos: HashMap::new(),
            max_parallel_agents: 3,
        };

        let aggregation = aggregate_tokens(&app);
        assert_eq!(aggregation.total, 22);
        assert_eq!(
            aggregation.per_model,
            vec![("gpt-5".to_string(), 15), ("unknown".to_string(), 7)]
        );
    }

    #[test]
    fn aggregate_tokens_prefers_runtime_total_when_available() {
        let raw = serde_json::json!({
            "activeTasks": [
                { "id": "task-1", "model": "a", "tokens": 2 },
                { "id": "task-2", "model": "b", "tokens": 3 }
            ],
            "totalTokens": "99"
        });

        let app = App {
            parent_id: "MOB-1".into(),
            parent_title: "Parent".into(),
            graph: empty_graph(),
            runtime_state: None,
            runtime_state_raw: Some(raw),
            start_time: std::time::Instant::now(),
            show_legend: true,
            show_debug: false,
            show_exit_modal: false,
            is_complete: false,
            debug_events: Vec::new(),
            pending_count: 0,
            runtime_state_path: PathBuf::from("runtime.json"),
            should_quit: false,
            auto_exit_tick: None,
            agent_todos: HashMap::new(),
            max_parallel_agents: 3,
        };

        let aggregation = aggregate_tokens(&app);
        assert_eq!(aggregation.total, 99);
        assert_eq!(
            aggregation.per_model,
            vec![("a".to_string(), 2), ("b".to_string(), 3)]
        );
    }
}
