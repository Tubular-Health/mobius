export type Backend = 'linear' | 'jira';
export type Model = 'opus' | 'sonnet' | 'haiku';

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
}

export interface LinearConfig {
  // Linear MCP auto-configures via Claude Code
}

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
  },
};

export const BACKEND_SKILLS: Record<Backend, string> = {
  linear: '/execute-linear-issue',
  jira: '/execute-jira-issue',
};

export const BACKEND_ID_PATTERNS: Record<Backend, RegExp> = {
  linear: /^[A-Z]+-[0-9]+$/,
  jira: /^[A-Z]+-[0-9]+$/,
};
