pub mod commands;
pub mod config;
pub mod context;
pub mod executor;
pub mod git_lock;
pub mod jira;
pub mod local_state;
pub mod mermaid_renderer;
pub mod tmux;
pub mod tracker;
pub mod tree_renderer;
pub mod tui;
pub mod types;
pub mod worktree;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(
    name = "mobius",
    version,
    about = "AI-powered issue execution engine",
    long_about = "Mobius orchestrates AI agents to execute issue sub-tasks in parallel with worktree isolation."
)]
struct Cli {
    /// Task ID to execute (auto-routes to loop+TUI)
    #[arg(global = false)]
    task_id: Option<String>,

    /// Bypass container sandbox, run directly on host
    #[arg(long)]
    no_sandbox: bool,

    /// Bypass container sandbox (deprecated, use --no-sandbox)
    #[arg(short, long, hide = true)]
    local: bool,

    /// Backend: linear, jira, or local
    #[arg(short, long)]
    backend: Option<String>,

    /// Model: opus, sonnet, or haiku
    #[arg(short, long)]
    model: Option<String>,

    /// Use sequential execution instead of parallel
    #[arg(short, long)]
    sequential: bool,

    /// Max parallel agents (overrides config)
    #[arg(short, long)]
    parallel: Option<u32>,

    /// Maximum iterations
    #[arg(short = 'n', long)]
    max_iterations: Option<u32>,

    /// Delay between iterations in seconds (sequential mode)
    #[arg(short, long)]
    delay: Option<u32>,

    /// Clear stale state from previous executions before starting
    #[arg(short, long)]
    fresh: bool,

    /// Disable TUI dashboard (use traditional output)
    #[arg(long)]
    no_tui: bool,

    /// Enable debug mode for state drift diagnostics
    #[arg(long, value_name = "VERBOSITY")]
    debug: Option<Option<String>>,

    /// Skip automatic PR submission after successful completion
    #[arg(long)]
    no_submit: bool,

    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Interactive setup wizard
    Setup {
        /// Update skills/commands only (skip config wizard)
        #[arg(short = 'u', long)]
        update_skills: bool,

        /// Update shortcuts script only (skip config wizard)
        #[arg(long)]
        update_shortcuts: bool,

        /// Auto-install CLI tools with confirmation
        #[arg(short, long)]
        install: bool,
    },

    /// Install shortcut scripts (md/mr/me/ms)
    Shortcuts,

    /// Check system requirements and configuration
    Doctor,

    /// Show current configuration
    Config {
        /// Open config in editor
        #[arg(short, long)]
        edit: bool,
    },

    /// List all local issues with their status
    List {
        /// Backend: linear, jira, or local
        #[arg(short, long)]
        backend: Option<String>,
    },

    /// Remove completed issues from local .mobius/issues/ directory
    Clean {
        /// Preview what would be cleaned without deleting
        #[arg(long)]
        dry_run: bool,

        /// Backend: linear, jira, or local
        #[arg(short, long)]
        backend: Option<String>,
    },

    /// Display sub-task dependency tree without execution
    Tree {
        /// Task ID
        task_id: String,

        /// Backend: linear, jira, or local
        #[arg(short, long)]
        backend: Option<String>,

        /// Also output Mermaid diagram
        #[arg(short, long)]
        mermaid: bool,
    },

    /// Execute sub-tasks sequentially (use "loop" for parallel execution)
    Run {
        /// Task ID
        task_id: String,

        /// Maximum iterations
        max_iterations: Option<u32>,

        /// Bypass container sandbox, run directly on host
        #[arg(long)]
        no_sandbox: bool,

        /// Bypass container sandbox (deprecated, use --no-sandbox)
        #[arg(short, long, hide = true)]
        local: bool,

        /// Backend: linear, jira, or local
        #[arg(short, long)]
        backend: Option<String>,

        /// Model: opus, sonnet, or haiku
        #[arg(short, long)]
        model: Option<String>,

        /// Delay between iterations in seconds
        #[arg(short, long)]
        delay: Option<u32>,
    },

    /// Execute sub-tasks with parallel execution and worktree isolation
    Loop {
        /// Task ID
        task_id: String,

        /// Bypass container sandbox, run directly on host
        #[arg(long)]
        no_sandbox: bool,

        /// Bypass container sandbox (deprecated, use --no-sandbox)
        #[arg(short, long, hide = true)]
        local: bool,

        /// Backend: linear, jira, or local
        #[arg(short, long)]
        backend: Option<String>,

        /// Model: opus, sonnet, or haiku
        #[arg(short, long)]
        model: Option<String>,

        /// Max parallel agents (overrides config)
        #[arg(short, long)]
        parallel: Option<u32>,

        /// Maximum iterations
        #[arg(short = 'n', long)]
        max_iterations: Option<u32>,

        /// Clear stale state from previous executions before starting
        #[arg(short, long)]
        fresh: bool,

        /// Enable debug mode for state drift diagnostics
        #[arg(long, value_name = "VERBOSITY")]
        debug: Option<Option<String>>,

        /// Skip automatic PR submission after successful completion
        #[arg(long)]
        no_submit: bool,
    },

    /// Create a pull request (auto-detects issue from branch name if not specified)
    Submit {
        /// Task ID
        task_id: Option<String>,

        /// Backend: linear, jira, or local
        #[arg(short, long)]
        backend: Option<String>,

        /// Model: opus, sonnet, or haiku
        #[arg(short, long)]
        model: Option<String>,

        /// Create as draft PR
        #[arg(short, long)]
        draft: bool,

        /// Skip automatic status update to "In Review" after PR creation
        #[arg(long)]
        skip_status_update: bool,
    },

    /// Push pending local changes to Linear/Jira
    Push {
        /// Parent ID
        parent_id: Option<String>,

        /// Backend: linear, jira, or local
        #[arg(short, long)]
        backend: Option<String>,

        /// Show pending changes without pushing
        #[arg(long)]
        dry_run: bool,

        /// Push all issues with pending updates
        #[arg(short, long)]
        all: bool,

        /// Generate and push loop execution summary
        #[arg(long)]
        summary: bool,
    },

    /// Fetch fresh context from Linear/Jira
    Pull {
        /// Task ID
        task_id: Option<String>,

        /// Backend: linear, jira, or local
        #[arg(short, long)]
        backend: Option<String>,
    },

    /// Set or show the current task ID
    SetId {
        /// Task ID
        task_id: Option<String>,

        /// Backend: linear, jira, or local
        #[arg(short, long)]
        backend: Option<String>,

        /// Clear the current task ID
        #[arg(short, long)]
        clear: bool,
    },

    /// Launch interactive TUI dashboard for monitoring task execution
    Tui {
        /// Task ID
        task_id: String,

        /// Hide the status legend
        #[arg(long)]
        no_legend: bool,

        /// Directory for execution state files
        #[arg(long)]
        state_dir: Option<String>,

        /// Agent panel refresh interval in ms
        #[arg(long)]
        refresh: Option<u32>,

        /// Number of output lines per agent panel
        #[arg(long)]
        lines: Option<u32>,
    },
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Some(command) => match command {
            Command::Setup {
                update_skills,
                update_shortcuts,
                install,
            } => {
                if let Err(e) = commands::setup::run(update_skills, update_shortcuts, install) {
                    eprintln!("Setup error: {}", e);
                    std::process::exit(1);
                }
            }
            Command::Shortcuts => {
                if let Err(e) = commands::shortcuts::run() {
                    eprintln!("Shortcuts error: {}", e);
                    std::process::exit(1);
                }
            }
            Command::Doctor => {
                if let Err(e) = commands::doctor::run() {
                    eprintln!("Doctor error: {}", e);
                    std::process::exit(1);
                }
            }
            Command::Config { edit } => {
                if let Err(e) = commands::config::run(edit) {
                    eprintln!("Config error: {}", e);
                    std::process::exit(1);
                }
            }
            Command::List { backend } => {
                if let Err(e) = commands::list::run(backend.as_deref()) {
                    eprintln!("List error: {}", e);
                    std::process::exit(1);
                }
            }
            Command::Clean { dry_run, backend } => {
                if let Err(e) = commands::clean::run(dry_run, backend.as_deref()) {
                    eprintln!("Clean error: {}", e);
                    std::process::exit(1);
                }
            }
            Command::Tree {
                task_id,
                backend,
                mermaid,
            } => {
                if let Err(e) = commands::tree::run(&task_id, backend.as_deref(), mermaid) {
                    eprintln!("Tree error: {}", e);
                    std::process::exit(1);
                }
            }
            Command::Run {
                task_id,
                max_iterations,
                no_sandbox,
                local: _,
                backend,
                model,
                delay,
            } => {
                if let Err(e) = commands::run::run(
                    &task_id,
                    max_iterations,
                    no_sandbox,
                    backend.as_deref(),
                    model.as_deref(),
                    delay,
                ) {
                    eprintln!("Run error: {}", e);
                    std::process::exit(1);
                }
            }
            Command::Loop {
                task_id,
                no_sandbox: _,
                local: _,
                backend,
                model,
                parallel,
                max_iterations,
                fresh,
                debug,
                no_submit,
            } => {
                if let Err(e) = commands::loop_cmd::run(
                    &task_id,
                    false,
                    backend.as_deref(),
                    model.as_deref(),
                    parallel,
                    max_iterations,
                    fresh,
                    debug.as_ref().map(|d| d.as_deref()),
                    no_submit,
                ) {
                    eprintln!("Loop error: {}", e);
                    std::process::exit(1);
                }
            }
            Command::Submit {
                task_id,
                backend,
                model,
                draft,
                skip_status_update,
            } => {
                if let Err(e) = commands::submit::run(
                    task_id.as_deref(),
                    backend.as_deref(),
                    model.as_deref(),
                    draft,
                    skip_status_update,
                ) {
                    eprintln!("Submit error: {}", e);
                    std::process::exit(1);
                }
            }
            Command::Push {
                parent_id,
                backend,
                dry_run,
                all,
                summary,
            } => {
                if let Err(e) = commands::push::run(
                    parent_id.as_deref(),
                    backend.as_deref(),
                    dry_run,
                    all,
                    summary,
                ) {
                    eprintln!("Push error: {}", e);
                    std::process::exit(1);
                }
            }
            Command::Pull { task_id, backend } => {
                if let Err(e) = commands::pull::run(task_id.as_deref(), backend.as_deref()) {
                    eprintln!("Pull error: {}", e);
                    std::process::exit(1);
                }
            }
            Command::SetId {
                task_id,
                backend,
                clear,
            } => {
                if let Err(e) =
                    commands::set_id::run(task_id.as_deref(), backend.as_deref(), clear)
                {
                    eprintln!("Set-id error: {}", e);
                    std::process::exit(1);
                }
            }
            Command::Tui {
                task_id,
                no_legend: _,
                state_dir,
                refresh: _,
                lines: _,
            } => {
                // Resolve runtime state path
                let mobius_path = local_state::get_project_mobius_path();
                let state_path = if let Some(dir) = state_dir {
                    std::path::PathBuf::from(dir).join("runtime.json")
                } else {
                    mobius_path
                        .join("issues")
                        .join(&task_id)
                        .join("execution")
                        .join("runtime.json")
                };

                // Read sub-tasks from local state and build graph
                let issues = local_state::read_local_subtasks_as_linear_issues(&task_id);
                let graph = types::task_graph::build_task_graph(&task_id, &task_id, &issues);
                let api_graph = graph.clone();

                // Read parent title
                let parent_title = local_state::read_parent_spec(&task_id)
                    .map(|p| p.title)
                    .unwrap_or_else(|| task_id.clone());

                if let Err(e) = tui::dashboard::run_dashboard(
                    task_id,
                    parent_title,
                    graph,
                    api_graph,
                    types::enums::Backend::Local,
                    state_path,
                ) {
                    eprintln!("TUI error: {}", e);
                    std::process::exit(1);
                }
            }
        },
        None => {
            if let Some(task_id) = cli.task_id {
                // Default command: auto-route to loop or run based on flags
                if cli.sequential {
                    if let Err(e) = commands::run::run(
                        &task_id,
                        cli.max_iterations,
                        cli.no_sandbox || cli.local,
                        cli.backend.as_deref(),
                        cli.model.as_deref(),
                        cli.delay,
                    ) {
                        eprintln!("Run error: {}", e);
                        std::process::exit(1);
                    }
                } else {
                    if let Err(e) = commands::loop_cmd::run(
                        &task_id,
                        cli.no_sandbox || cli.local,
                        cli.backend.as_deref(),
                        cli.model.as_deref(),
                        cli.parallel,
                        cli.max_iterations,
                        cli.fresh,
                        cli.debug.as_ref().map(|d| d.as_deref()),
                        cli.no_submit,
                    ) {
                        eprintln!("Loop error: {}", e);
                        std::process::exit(1);
                    }
                }
            } else {
                // No command and no task ID - show help
                use clap::CommandFactory;
                Cli::command().print_help().unwrap();
                println!();
            }
        }
    }
}
