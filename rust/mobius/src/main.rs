pub mod config;
pub mod git_lock;
pub mod jira;
pub mod local_state;
pub mod mermaid_renderer;
pub mod tmux;
pub mod tree_renderer;
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
            Command::Setup { .. } => todo!("setup command"),
            Command::Shortcuts => todo!("shortcuts command"),
            Command::Doctor => todo!("doctor command"),
            Command::Config { .. } => todo!("config command"),
            Command::List { .. } => todo!("list command"),
            Command::Clean { .. } => todo!("clean command"),
            Command::Tree { .. } => todo!("tree command"),
            Command::Run { .. } => todo!("run command"),
            Command::Loop { .. } => todo!("loop command"),
            Command::Submit { .. } => todo!("submit command"),
            Command::Push { .. } => todo!("push command"),
            Command::Pull { .. } => todo!("pull command"),
            Command::SetId { .. } => todo!("set-id command"),
            Command::Tui { .. } => todo!("tui command"),
        },
        None => {
            if let Some(_task_id) = cli.task_id {
                todo!("default command: auto-route to loop+TUI")
            } else {
                // No command and no task ID - show help
                use clap::CommandFactory;
                Cli::command().print_help().unwrap();
                println!();
            }
        }
    }
}
