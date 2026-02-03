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

use super::agent_slots::{AgentSlots, AGENT_SLOTS_HEIGHT};
use super::app::App;
use super::debug_panel::{DebugPanel, DEBUG_PANEL_HEIGHT};
use super::events::{EventHandler, TuiEvent};
use super::exit_modal::ExitModal;
use super::header::{Header, HEADER_HEIGHT};
use super::legend::{Legend, LEGEND_HEIGHT};
use super::task_tree::{CompletedInfo, TaskTreeWidget};
use super::theme::{NORD0, NORD14, NORD11, TEXT_COLOR, MUTED_COLOR};

/// Run the TUI dashboard.
pub fn run_dashboard(
    parent_id: String,
    parent_title: String,
    graph: TaskGraph,
    runtime_state_path: PathBuf,
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
        3, // default max_parallel_agents, will be configurable via task-008
    );

    // Load initial runtime state if file exists
    app.reload_runtime_state();

    // Create event handler
    let events = EventHandler::new(Some(runtime_state_path), None);

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
                    // Will be handled in task-008 with app.reload_todos()
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
    let bg_block = ratatui::widgets::Block::default()
        .style(Style::default().bg(NORD0));
    frame.render_widget(bg_block, size);

    // Calculate layout constraints
    let mut constraints = vec![
        Constraint::Length(HEADER_HEIGHT),     // Header
        Constraint::Min(5),                    // Main content (task tree + backend status)
        Constraint::Length(AGENT_SLOTS_HEIGHT), // Agent slots
    ];

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
                let duration = obj
                    .get("duration")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
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
        max_slots: 4,
    };
    frame.render_widget(agent_slots, agent_area);

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
        render_completion_bar(frame, chunks[chunk_idx], completed, total, failed, app.elapsed_ms(), app.auto_exit_tick);
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
