export type Backend = 'linear' | 'jira' | 'local';
export type Model = 'opus' | 'sonnet' | 'haiku';

/**
 * TUI dashboard configuration options
 */
export interface TuiConfig {
  show_legend?: boolean; // Default: true
  state_dir?: string; // Default: ~/.mobius/state/
  panel_refresh_ms?: number; // Default: 300
  panel_lines?: number; // Default: 8 (lines per agent panel)
}

/**
 * Verification quality gate configuration
 * Used by verify skill to create verification sub-tasks
 */
export interface VerificationConfig {
  coverage_threshold: number; // Minimum test coverage percentage (default: 80)
  require_all_tests_pass: boolean; // Whether all tests must pass (default: true)
  performance_check: boolean; // Enable performance regression checks (default: true)
  security_check: boolean; // Enable security vulnerability checks (default: true)
  max_rework_iterations: number; // Maximum rework cycles before escalation (default: 3)
}

/**
 * Represents an actively running task with its process info
 */
export interface ActiveTask {
  id: string; // Task identifier (e.g., "MOB-126")
  pid: number; // Claude process ID
  pane: string; // tmux pane identifier (e.g., "%0")
  startedAt: string; // ISO timestamp
  worktree?: string; // Worktree path if applicable
}

/**
 * Represents a completed or failed task with timing info
 */
export interface CompletedTask {
  id: string; // Task identifier (e.g., "MOB-126")
  completedAt: string; // ISO timestamp when task finished
  duration: number; // Duration in milliseconds
}

/**
 * Execution state file schema for TUI state tracking
 * Written by mobius.sh, read by TUI dashboard
 *
 * Note: completedTasks and failedTasks support both legacy format (string[])
 * and new format (CompletedTask[]) for backward compatibility.
 */
export interface ExecutionState {
  parentId: string; // Parent issue identifier (e.g., "MOB-11")
  parentTitle: string; // Parent issue title for display

  activeTasks: ActiveTask[]; // Currently running tasks
  completedTasks: (string | CompletedTask)[]; // Completed task identifiers or objects
  failedTasks: (string | CompletedTask)[]; // Failed task identifiers or objects

  startedAt: string; // ISO timestamp - loop start
  updatedAt: string; // ISO timestamp - last update

  loopPid?: number; // PID of the loop process (for cleanup)
  totalTasks?: number; // Total number of tasks (for completion detection)
}

export interface ExecutionConfig {
  delay_seconds: number;
  max_iterations: number;
  model: Model;
  sandbox: boolean;
  container_name: string;
  // Parallel execution and worktree isolation
  max_parallel_agents?: number;
  worktree_path?: string;
  cleanup_on_success?: boolean;
  base_branch?: string;
  // Retry and verification settings
  max_retries?: number; // Maximum retry attempts per task (default: 2)
  verification_timeout?: number; // Timeout for Linear verification in ms (default: 5000)
  // TUI dashboard options
  tui?: TuiConfig;
  // Quality gate verification settings
  verification?: VerificationConfig;
  // Tool filtering - patterns to disable specific MCP tools
  // Supports glob patterns: "mcp__linear__*", "mcp__atlassian__*"
  disallowed_tools?: string[];
}

export type LinearConfig = Record<string, never>;

export interface JiraConfig {
  base_url?: string;
  project_key?: string;
  auth_method?: 'api_token' | 'oauth';
}

export interface LoopConfig {
  backend: Backend;
  linear?: LinearConfig;
  jira?: JiraConfig;
  execution: ExecutionConfig;
}

export interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  message: string;
  required: boolean;
  details?: string;
}

export interface PathConfig {
  type: 'local' | 'global';
  configPath: string;
  skillsPath: string;
  scriptPath: string;
}

export const DEFAULT_CONFIG: LoopConfig = {
  backend: 'linear',
  execution: {
    delay_seconds: 3,
    max_iterations: 50,
    model: 'opus',
    sandbox: true,
    container_name: 'mobius-sandbox',
    // Parallel execution defaults
    max_parallel_agents: 3,
    worktree_path: '../<repo>-worktrees/',
    cleanup_on_success: true,
    base_branch: 'main',
    // Retry and verification defaults
    max_retries: 2,
    verification_timeout: 5000,
    // Quality gate verification defaults
    verification: {
      coverage_threshold: 80,
      require_all_tests_pass: true,
      performance_check: true,
      security_check: true,
      max_rework_iterations: 3,
    },
  },
};

export const BACKEND_SKILLS: Record<Backend, string> = {
  linear: '/execute',
  jira: '/execute',
  local: '/execute',
};

export const BACKEND_ID_PATTERNS: Record<Backend, RegExp> = {
  linear: /^[A-Z]+-[0-9]+$/,
  jira: /^[A-Z]+-[0-9]+$/,
  local: /^LOC-[0-9]+$/,
};
