use std::fs;
use std::path::Path;

use super::error::ConfigError;
use super::paths::{
    get_commands_dir_for_runtime, get_global_commands_dir_for_runtime,
    get_settings_path_for_runtime, get_shortcuts_install_path,
};
use crate::types::config::PathConfigType;
use crate::types::enums::AgentRuntime;
use crate::types::PathConfig;

/// Copy skills from source to target directory (recursive)
pub fn copy_skills(source_dir: &Path, target_dir: &Path) -> Result<(), ConfigError> {
    if !source_dir.exists() {
        return Err(ConfigError::NotFound(format!(
            "Bundled skills not found at {}",
            source_dir.display()
        )));
    }

    copy_dir_recursive(source_dir, target_dir)
}

/// Copy commands from source to target directory
pub fn copy_commands(
    source_dir: &Path,
    paths: &PathConfig,
    runtime: AgentRuntime,
) -> Result<(), ConfigError> {
    if !source_dir.exists() {
        // Commands are optional
        return Ok(());
    }

    let target_dir = match paths.config_type {
        PathConfigType::Local => {
            let config_parent = Path::new(&paths.config_path)
                .parent()
                .unwrap_or_else(|| Path::new("."));
            get_commands_dir_for_runtime(config_parent, runtime)
        }
        PathConfigType::Global => get_global_commands_dir_for_runtime(runtime),
    };

    copy_dir_recursive(source_dir, &target_dir)
}

/// Copy shortcuts script to global config directory
pub fn copy_shortcuts(source_path: &Path) -> Result<(), ConfigError> {
    if !source_path.exists() {
        return Err(ConfigError::NotFound(format!(
            "Bundled shortcuts script not found at {}",
            source_path.display()
        )));
    }

    let install_path = get_shortcuts_install_path();
    if let Some(dir) = install_path.parent() {
        if !dir.exists() {
            fs::create_dir_all(dir)?;
        }
    }

    fs::copy(source_path, &install_path)?;
    Ok(())
}

/// Append source line for shortcuts to a shell rc file (idempotent)
pub fn add_shortcuts_source_line(rc_file_path: &Path) -> Result<(), ConfigError> {
    let install_path = get_shortcuts_install_path();
    let source_line = format!("source \"{}\"", install_path.display());

    let content = if rc_file_path.exists() {
        fs::read_to_string(rc_file_path)?
    } else {
        String::new()
    };

    if content.contains(&source_line) {
        return Ok(());
    }

    let newline = if !content.is_empty() && !content.ends_with('\n') {
        "\n"
    } else {
        ""
    };

    let new_content = format!("{content}{newline}{source_line}\n");
    fs::write(rc_file_path, new_content)?;
    Ok(())
}

/// Ensure runtime settings.json has .mobius/ permissions.
pub fn ensure_runtime_settings(
    project_dir: &Path,
    runtime: AgentRuntime,
) -> Result<(), ConfigError> {
    let settings_path = get_settings_path_for_runtime(project_dir, runtime);
    let mobius_permissions = [
        "Bash(mkdir */.mobius/*)",
        "Bash(mkdir -p */.mobius/*)",
        "Bash(mkdir .mobius/*)",
        "Bash(mkdir -p .mobius/*)",
        "Bash(ls .mobius/*)",
        "Bash(ls */.mobius/*)",
        "Write(.mobius/**)",
        "Edit(.mobius/**)",
    ];

    let mut settings: serde_json::Value = if settings_path.exists() {
        let content = fs::read_to_string(&settings_path)?;
        serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    let permissions = settings
        .as_object_mut()
        .unwrap()
        .entry("permissions")
        .or_insert_with(|| serde_json::json!({}));

    let allow = permissions
        .as_object_mut()
        .unwrap()
        .entry("allow")
        .or_insert_with(|| serde_json::json!([]));

    let allow_arr = allow.as_array_mut().unwrap();

    let mut added = 0;
    for perm in &mobius_permissions {
        let perm_val = serde_json::Value::String(perm.to_string());
        if !allow_arr.contains(&perm_val) {
            allow_arr.push(perm_val);
            added += 1;
        }
    }

    if added > 0 {
        if let Some(dir) = settings_path.parent() {
            if !dir.exists() {
                fs::create_dir_all(dir)?;
            }
        }
        let formatted = serde_json::to_string_pretty(&settings)
            .map_err(|e| ConfigError::ParseError(e.to_string()))?;
        fs::write(&settings_path, format!("{formatted}\n"))?;
    }

    Ok(())
}

/// Backwards-compatible wrapper for Claude settings path.
pub fn ensure_claude_settings(project_dir: &Path) -> Result<(), ConfigError> {
    ensure_runtime_settings(project_dir, AgentRuntime::Claude)
}

/// Recursively copy a directory
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), ConfigError> {
    if !dst.exists() {
        fs::create_dir_all(dst)?;
    }

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_copy_skills_creates_target() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("source");
        let target = tmp.path().join("target");

        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("skill.md"), "# Skill").unwrap();

        copy_skills(&source, &target).unwrap();
        assert!(target.join("skill.md").exists());
    }

    #[test]
    fn test_copy_skills_missing_source() {
        let tmp = tempfile::tempdir().unwrap();
        let result = copy_skills(&tmp.path().join("nonexistent"), &tmp.path().join("target"));
        assert!(result.is_err());
    }

    #[test]
    fn test_copy_commands_optional() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = PathConfig {
            config_type: PathConfigType::Local,
            config_path: tmp.path().join("config.yaml").to_string_lossy().to_string(),
            skills_path: String::new(),
            script_path: String::new(),
        };
        // Non-existent source should succeed (commands are optional)
        let result = copy_commands(
            &tmp.path().join("nonexistent"),
            &paths,
            AgentRuntime::Claude,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn test_copy_commands_local_runtime_path() {
        let tmp = tempfile::tempdir().unwrap();
        let source = tmp.path().join("commands-source");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("test.md"), "# Command").unwrap();

        let paths = PathConfig {
            config_type: PathConfigType::Local,
            config_path: tmp
                .path()
                .join("mobius.config.yaml")
                .to_string_lossy()
                .to_string(),
            skills_path: String::new(),
            script_path: String::new(),
        };

        copy_commands(&source, &paths, AgentRuntime::Opencode).unwrap();
        assert!(tmp
            .path()
            .join(".opencode")
            .join("commands")
            .join("test.md")
            .exists());
    }

    #[test]
    fn test_add_shortcuts_source_line_creates_file() {
        let tmp = tempfile::tempdir().unwrap();
        let rc_path = tmp.path().join(".bashrc");

        add_shortcuts_source_line(&rc_path).unwrap();
        let content = fs::read_to_string(&rc_path).unwrap();
        assert!(content.contains("source"));
        assert!(content.contains("shortcuts.sh"));
    }

    #[test]
    fn test_add_shortcuts_source_line_idempotent() {
        let tmp = tempfile::tempdir().unwrap();
        let rc_path = tmp.path().join(".bashrc");

        add_shortcuts_source_line(&rc_path).unwrap();
        let content1 = fs::read_to_string(&rc_path).unwrap();

        add_shortcuts_source_line(&rc_path).unwrap();
        let content2 = fs::read_to_string(&rc_path).unwrap();

        assert_eq!(content1, content2, "Source line should not be duplicated");
    }

    #[test]
    fn test_add_shortcuts_source_line_appends_to_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let rc_path = tmp.path().join(".bashrc");
        fs::write(&rc_path, "export PATH=/usr/bin\n").unwrap();

        add_shortcuts_source_line(&rc_path).unwrap();
        let content = fs::read_to_string(&rc_path).unwrap();
        assert!(content.starts_with("export PATH=/usr/bin\n"));
        assert!(content.contains("source"));
    }

    #[test]
    fn test_ensure_claude_settings_creates_file() {
        let tmp = tempfile::tempdir().unwrap();
        ensure_runtime_settings(tmp.path(), AgentRuntime::Claude).unwrap();

        let settings_path = tmp.path().join(".claude").join("settings.json");
        assert!(settings_path.exists());

        let content = fs::read_to_string(&settings_path).unwrap();
        let settings: serde_json::Value = serde_json::from_str(&content).unwrap();
        let allow = settings["permissions"]["allow"].as_array().unwrap();
        assert!(allow.len() >= 8);
        assert!(allow.contains(&serde_json::Value::String("Write(.mobius/**)".to_string())));
    }

    #[test]
    fn test_ensure_claude_settings_idempotent() {
        let tmp = tempfile::tempdir().unwrap();
        ensure_runtime_settings(tmp.path(), AgentRuntime::Claude).unwrap();
        ensure_runtime_settings(tmp.path(), AgentRuntime::Claude).unwrap();

        let settings_path = tmp.path().join(".claude").join("settings.json");
        let content = fs::read_to_string(&settings_path).unwrap();
        let settings: serde_json::Value = serde_json::from_str(&content).unwrap();
        let allow = settings["permissions"]["allow"].as_array().unwrap();
        // Should still be exactly 8, not 16
        assert_eq!(allow.len(), 8);
    }

    #[test]
    fn test_ensure_claude_settings_preserves_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let claude_dir = tmp.path().join(".claude");
        fs::create_dir_all(&claude_dir).unwrap();
        let settings_path = claude_dir.join("settings.json");
        let existing = serde_json::json!({
            "permissions": {
                "allow": ["Bash(git *)"]
            },
            "custom_key": "value"
        });
        fs::write(
            &settings_path,
            serde_json::to_string_pretty(&existing).unwrap(),
        )
        .unwrap();

        ensure_runtime_settings(tmp.path(), AgentRuntime::Claude).unwrap();

        let content = fs::read_to_string(&settings_path).unwrap();
        let settings: serde_json::Value = serde_json::from_str(&content).unwrap();
        // Should preserve existing permissions
        let allow = settings["permissions"]["allow"].as_array().unwrap();
        assert!(allow.contains(&serde_json::Value::String("Bash(git *)".to_string())));
        // Should add mobius permissions
        assert!(allow.contains(&serde_json::Value::String("Write(.mobius/**)".to_string())));
        // Should preserve custom key
        assert_eq!(settings["custom_key"], "value");
    }

    #[test]
    fn test_ensure_runtime_settings_opencode_creates_file() {
        let tmp = tempfile::tempdir().unwrap();
        ensure_runtime_settings(tmp.path(), AgentRuntime::Opencode).unwrap();

        let settings_path = tmp.path().join(".opencode").join("settings.json");
        assert!(settings_path.exists());
    }

    #[test]
    fn test_copy_dir_recursive() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("src");
        let dst = tmp.path().join("dst");

        fs::create_dir_all(src.join("sub")).unwrap();
        fs::write(src.join("file.txt"), "hello").unwrap();
        fs::write(src.join("sub").join("nested.txt"), "world").unwrap();

        copy_dir_recursive(&src, &dst).unwrap();

        assert!(dst.join("file.txt").exists());
        assert!(dst.join("sub").join("nested.txt").exists());
        assert_eq!(fs::read_to_string(dst.join("file.txt")).unwrap(), "hello");
        assert_eq!(
            fs::read_to_string(dst.join("sub").join("nested.txt")).unwrap(),
            "world"
        );
    }
}
