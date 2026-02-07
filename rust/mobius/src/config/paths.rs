use std::env;
use std::path::{Path, PathBuf};

use super::loader::read_config_with_env;
use crate::types::config::PathConfigType;
use crate::types::enums::AgentRuntime;
use crate::types::PathConfig;

/// Get the global config directory (~/.config/mobius or $XDG_CONFIG_HOME/mobius)
pub fn get_global_config_dir() -> PathBuf {
    let base = if let Ok(xdg) = env::var("XDG_CONFIG_HOME") {
        PathBuf::from(xdg)
    } else if let Some(home) = dirs::home_dir() {
        home.join(".config")
    } else {
        PathBuf::from(".config")
    };
    base.join("mobius")
}

/// Get the global skills directory (~/.claude/skills)
pub fn get_global_skills_dir() -> PathBuf {
    get_global_skills_dir_for_runtime(AgentRuntime::Claude)
}

/// Get the global commands directory (~/.claude/commands)
pub fn get_global_commands_dir() -> PathBuf {
    get_global_commands_dir_for_runtime(AgentRuntime::Claude)
}

fn runtime_dir_name(runtime: AgentRuntime) -> &'static str {
    match runtime {
        AgentRuntime::Claude => ".claude",
        AgentRuntime::Opencode => ".opencode",
    }
}

fn resolve_runtime_from_config(config_path: &Path) -> AgentRuntime {
    read_config_with_env(&config_path.to_string_lossy()).map_or(AgentRuntime::Claude, |c| c.runtime)
}

pub fn get_global_runtime_dir(runtime: AgentRuntime) -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(runtime_dir_name(runtime))
}

pub fn get_global_skills_dir_for_runtime(runtime: AgentRuntime) -> PathBuf {
    get_global_runtime_dir(runtime).join("skills")
}

pub fn get_global_commands_dir_for_runtime(runtime: AgentRuntime) -> PathBuf {
    get_global_runtime_dir(runtime).join("commands")
}

pub fn get_skills_dir_for_runtime(base_dir: &Path, runtime: AgentRuntime) -> PathBuf {
    base_dir.join(runtime_dir_name(runtime)).join("skills")
}

pub fn get_commands_dir_for_runtime(base_dir: &Path, runtime: AgentRuntime) -> PathBuf {
    base_dir.join(runtime_dir_name(runtime)).join("commands")
}

pub fn get_settings_path_for_runtime(base_dir: &Path, runtime: AgentRuntime) -> PathBuf {
    base_dir
        .join(runtime_dir_name(runtime))
        .join("settings.json")
}

/// Walk up from start_dir looking for mobius.config.yaml
pub fn find_local_config(start_dir: Option<&Path>) -> Option<PathBuf> {
    let start = match start_dir {
        Some(dir) => dir.to_path_buf(),
        None => env::current_dir().ok()?,
    };

    let mut dir = start.as_path();

    loop {
        let config_path = dir.join("mobius.config.yaml");
        if config_path.exists() {
            return Some(config_path);
        }

        match dir.parent() {
            Some(parent) if parent != dir => dir = parent,
            _ => break,
        }
    }

    None
}

/// Resolve paths for local or global installation.
/// Priority: local config (walk up tree) > global config
pub fn resolve_paths() -> PathConfig {
    if let Some(local_config) = find_local_config(None) {
        let runtime = resolve_runtime_from_config(&local_config);
        let project_root = local_config.parent().unwrap_or_else(|| Path::new("."));
        return PathConfig {
            config_type: PathConfigType::Local,
            config_path: local_config.to_string_lossy().to_string(),
            skills_path: get_skills_dir_for_runtime(project_root, runtime)
                .to_string_lossy()
                .to_string(),
            script_path: String::new(),
        };
    }

    let global_config_dir = get_global_config_dir();
    let global_config_path = global_config_dir.join("config.yaml");
    let runtime = resolve_runtime_from_config(&global_config_path);
    PathConfig {
        config_type: PathConfigType::Global,
        config_path: global_config_path.to_string_lossy().to_string(),
        skills_path: get_global_skills_dir_for_runtime(runtime)
            .to_string_lossy()
            .to_string(),
        script_path: String::new(),
    }
}

/// Get paths for a specific installation type (used by setup)
pub fn get_paths_for_type(config_type: PathConfigType, project_dir: Option<&Path>) -> PathConfig {
    get_paths_for_type_with_runtime(config_type, project_dir, AgentRuntime::Claude)
}

/// Get paths for a specific installation type and runtime
pub fn get_paths_for_type_with_runtime(
    config_type: PathConfigType,
    project_dir: Option<&Path>,
    runtime: AgentRuntime,
) -> PathConfig {
    match config_type {
        PathConfigType::Local => {
            let dir = project_dir
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
            PathConfig {
                config_type: PathConfigType::Local,
                config_path: dir.join("mobius.config.yaml").to_string_lossy().to_string(),
                skills_path: get_skills_dir_for_runtime(&dir, runtime)
                    .to_string_lossy()
                    .to_string(),
                script_path: String::new(),
            }
        }
        PathConfigType::Global => {
            let global_config_dir = get_global_config_dir();
            PathConfig {
                config_type: PathConfigType::Global,
                config_path: global_config_dir
                    .join("config.yaml")
                    .to_string_lossy()
                    .to_string(),
                skills_path: get_global_skills_dir_for_runtime(runtime)
                    .to_string_lossy()
                    .to_string(),
                script_path: String::new(),
            }
        }
    }
}

/// Get the shortcuts install path (~/.config/mobius/shortcuts.sh)
pub fn get_shortcuts_install_path() -> PathBuf {
    get_global_config_dir().join("shortcuts.sh")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_local_config_with_temp_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("mobius.config.yaml");
        std::fs::write(&config_path, "backend: linear\n").unwrap();

        let found = find_local_config(Some(tmp.path()));
        assert!(found.is_some());
        assert_eq!(found.unwrap(), config_path);
    }

    #[test]
    fn test_find_local_config_walks_up() {
        let tmp = tempfile::tempdir().unwrap();
        let config_path = tmp.path().join("mobius.config.yaml");
        std::fs::write(&config_path, "backend: linear\n").unwrap();

        let subdir = tmp.path().join("src").join("lib");
        std::fs::create_dir_all(&subdir).unwrap();

        let found = find_local_config(Some(&subdir));
        assert!(found.is_some());
        assert_eq!(found.unwrap(), config_path);
    }

    #[test]
    fn test_find_local_config_returns_none() {
        let tmp = tempfile::tempdir().unwrap();
        let found = find_local_config(Some(tmp.path()));
        assert!(found.is_none());
    }

    #[test]
    fn test_resolve_paths_returns_global_fallback() {
        // When run from a temp dir with no config, should return global
        let tmp = tempfile::tempdir().unwrap();
        // We can't easily set cwd, but we can test get_paths_for_type
        let paths = get_paths_for_type(PathConfigType::Global, None);
        assert_eq!(paths.config_type, PathConfigType::Global);
        assert!(paths.config_path.contains("config.yaml"));
        // Verify tmp exists to suppress unused warning
        assert!(tmp.path().exists());
    }

    #[test]
    fn test_get_paths_for_type_local() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = get_paths_for_type(PathConfigType::Local, Some(tmp.path()));
        assert_eq!(paths.config_type, PathConfigType::Local);
        assert!(paths.config_path.contains("mobius.config.yaml"));
        assert!(paths.skills_path.contains(".claude"));
    }

    #[test]
    fn test_get_paths_for_type_with_runtime_opencode_local() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = get_paths_for_type_with_runtime(
            PathConfigType::Local,
            Some(tmp.path()),
            AgentRuntime::Opencode,
        );
        assert_eq!(paths.config_type, PathConfigType::Local);
        assert!(paths.skills_path.contains(".opencode"));
    }

    #[test]
    fn test_get_paths_for_type_global() {
        let paths = get_paths_for_type(PathConfigType::Global, None);
        assert_eq!(paths.config_type, PathConfigType::Global);
        assert!(paths.config_path.contains("config.yaml"));
    }

    #[test]
    fn test_get_global_dirs_for_runtime() {
        let claude_skills = get_global_skills_dir_for_runtime(AgentRuntime::Claude);
        let opencode_skills = get_global_skills_dir_for_runtime(AgentRuntime::Opencode);
        assert!(claude_skills.to_string_lossy().contains(".claude"));
        assert!(opencode_skills.to_string_lossy().contains(".opencode"));
    }

    #[test]
    fn test_get_global_config_dir() {
        let dir = get_global_config_dir();
        let dir_str = dir.to_string_lossy();
        assert!(dir_str.contains("mobius"));
    }

    #[test]
    fn test_get_shortcuts_install_path() {
        let path = get_shortcuts_install_path();
        let path_str = path.to_string_lossy();
        assert!(path_str.contains("shortcuts.sh"));
        assert!(path_str.contains("mobius"));
    }
}
