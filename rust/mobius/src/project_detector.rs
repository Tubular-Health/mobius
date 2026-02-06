use std::collections::HashMap;
use std::fs;
use std::path::Path;

use anyhow::Result;
use regex::Regex;

use crate::types::{BuildSystem, ProjectDetectionResult, ProjectType, VerificationCommands};

/// Parse justfile content and extract recipe names.
/// Matches lines like `recipe-name:` or `recipe-name arg:` at the start of a line.
pub fn parse_justfile_recipes(content: &str) -> Vec<String> {
    let re = Regex::new(r"^(\w[\w-]*)\s*.*:").unwrap();
    let mut recipes = Vec::new();
    for line in content.lines() {
        if let Some(caps) = re.captures(line) {
            let name = caps[1].to_string();
            if name != "default" {
                recipes.push(name);
            }
        }
    }
    recipes
}

/// Map justfile recipe names to verification commands.
fn map_recipes_to_commands(recipes: &[String]) -> VerificationCommands {
    let recipe_set: std::collections::HashSet<&str> = recipes.iter().map(|s| s.as_str()).collect();

    let mut commands = VerificationCommands::default();

    if recipe_set.contains("test") {
        commands.test = Some("just test".to_string());
    }
    if recipe_set.contains("typecheck") {
        commands.typecheck = Some("just typecheck".to_string());
    }
    if recipe_set.contains("lint") {
        commands.lint = Some("just lint".to_string());
    }
    if recipe_set.contains("build") {
        commands.build = Some("just build".to_string());
    }
    if recipe_set.contains("validate") && commands.build.is_none() {
        commands.build = Some("just validate".to_string());
    }

    commands
}

/// Read package.json scripts and fill in missing verification commands.
fn fill_from_package_json(project_path: &Path, commands: &mut VerificationCommands) {
    let pkg_path = project_path.join("package.json");
    let content = match fs::read_to_string(&pkg_path) {
        Ok(c) => c,
        Err(_) => return,
    };

    let pkg: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return,
    };

    let scripts = match pkg.get("scripts").and_then(|s| s.as_object()) {
        Some(s) => s,
        None => return,
    };

    if commands.test.is_none() && scripts.contains_key("test") {
        commands.test = Some("npm run test".to_string());
    }
    if commands.typecheck.is_none() && scripts.contains_key("typecheck") {
        commands.typecheck = Some("npm run typecheck".to_string());
    }
    if commands.lint.is_none() && scripts.contains_key("lint") {
        commands.lint = Some("npm run lint".to_string());
    }
    if commands.build.is_none() && scripts.contains_key("build") {
        commands.build = Some("npm run build".to_string());
    }
}

/// Detect build system from project configuration files.
/// Priority order: just > cargo > make > pnpm > yarn > npm > gradle > poetry > pip
fn detect_build_system(project_path: &Path, has_justfile: bool) -> BuildSystem {
    if has_justfile {
        return BuildSystem::Just;
    }
    if project_path.join("Cargo.toml").exists() {
        return BuildSystem::Cargo;
    }
    if project_path.join("Makefile").exists() {
        return BuildSystem::Make;
    }
    if project_path.join("pnpm-lock.yaml").exists() {
        return BuildSystem::Pnpm;
    }
    if project_path.join("yarn.lock").exists() {
        return BuildSystem::Yarn;
    }
    if project_path.join("package-lock.json").exists() || project_path.join("package.json").exists()
    {
        return BuildSystem::Npm;
    }
    if project_path.join("build.gradle").exists() || project_path.join("build.gradle.kts").exists()
    {
        return BuildSystem::Gradle;
    }
    if project_path.join("pyproject.toml").exists() {
        if let Ok(content) = fs::read_to_string(project_path.join("pyproject.toml")) {
            if content.contains("[tool.poetry]") {
                return BuildSystem::Poetry;
            }
        }
        return BuildSystem::Pip;
    }
    BuildSystem::Unknown
}

/// Detect project type and platform targets from filesystem markers.
/// Returns `ProjectDetectionResult` with all detected info.
pub fn detect_project_info(project_path: &str) -> Result<ProjectDetectionResult> {
    let path = Path::new(project_path);
    let mut detected_config_files: Vec<String> = Vec::new();
    let mut platform_targets: Vec<String> = Vec::new();
    let mut project_type = ProjectType::Unknown;

    // Check for justfile
    let has_justfile = path.join("justfile").exists();
    if has_justfile {
        detected_config_files.push("justfile".to_string());
    }

    // Parse justfile recipes and map to commands
    let mut commands = if has_justfile {
        match fs::read_to_string(path.join("justfile")) {
            Ok(content) => {
                let recipes = parse_justfile_recipes(&content);
                map_recipes_to_commands(&recipes)
            }
            Err(_) => VerificationCommands::default(),
        }
    } else {
        VerificationCommands::default()
    };

    // Check package.json
    if path.join("package.json").exists() {
        detected_config_files.push("package.json".to_string());
        project_type = ProjectType::Node;
        fill_from_package_json(path, &mut commands);
    }

    // Check for Android (build.gradle or android/build.gradle)
    if path.join("build.gradle").exists() || path.join("android").join("build.gradle").exists() {
        detected_config_files.push("build.gradle".to_string());
        platform_targets.push("android".to_string());
        let platform_build = commands.platform_build.get_or_insert_with(HashMap::new);
        platform_build.insert("android".to_string(), "gradle assembleDebug".to_string());
        if project_type == ProjectType::Unknown {
            project_type = ProjectType::Android;
        } else {
            project_type = ProjectType::MultiPlatform;
        }
    }

    // Check for iOS (Podfile or ios/*.xcworkspace)
    let has_ios = path.join("Podfile").exists() || has_xcworkspace(path);
    if has_ios {
        if path.join("Podfile").exists() {
            detected_config_files.push("Podfile".to_string());
        }
        platform_targets.push("ios".to_string());
        let platform_build = commands.platform_build.get_or_insert_with(HashMap::new);
        platform_build.insert(
            "ios".to_string(),
            "xcodebuild -workspace ios/*.xcworkspace -scheme App build".to_string(),
        );
        if project_type == ProjectType::Unknown {
            project_type = ProjectType::Ios;
        } else if project_type != ProjectType::MultiPlatform {
            project_type = ProjectType::MultiPlatform;
        }
    }

    // Check for Rust (Cargo.toml)
    if path.join("Cargo.toml").exists() {
        detected_config_files.push("Cargo.toml".to_string());
        if project_type == ProjectType::Unknown {
            project_type = ProjectType::Rust;
        } else {
            project_type = ProjectType::MultiPlatform;
        }
    }

    // Check for Python (pyproject.toml)
    if path.join("pyproject.toml").exists() {
        detected_config_files.push("pyproject.toml".to_string());
        if project_type == ProjectType::Unknown {
            project_type = ProjectType::Python;
        } else {
            project_type = ProjectType::MultiPlatform;
        }
    }

    let build_system = detect_build_system(path, has_justfile);

    Ok(ProjectDetectionResult {
        project_type,
        build_system,
        platform_targets,
        available_commands: commands,
        has_justfile,
        detected_config_files,
    })
}

/// Check if ios/ directory contains any .xcworkspace entries.
fn has_xcworkspace(project_path: &Path) -> bool {
    let ios_dir = project_path.join("ios");
    match fs::read_dir(&ios_dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().ends_with(".xcworkspace")),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_file(dir: &Path, name: &str, content: &str) {
        let file_path = dir.join(name);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(file_path, content).unwrap();
    }

    // --- parse_justfile_recipes tests ---

    #[test]
    fn test_parse_justfile_recipes_basic() {
        let content = "test:\n\tcargo test\n\nbuild:\n\tcargo build\n";
        let recipes = parse_justfile_recipes(content);
        assert_eq!(recipes, vec!["test", "build"]);
    }

    #[test]
    fn test_parse_justfile_recipes_with_args() {
        let content = "test filter='': \n\tcargo test {{filter}}\n\nlint:\n\tcargo clippy\n";
        let recipes = parse_justfile_recipes(content);
        assert_eq!(recipes, vec!["test", "lint"]);
    }

    #[test]
    fn test_parse_justfile_recipes_skips_default() {
        let content = "default:\n\tjust test\n\ntest:\n\tcargo test\n";
        let recipes = parse_justfile_recipes(content);
        assert_eq!(recipes, vec!["test"]);
    }

    #[test]
    fn test_parse_justfile_recipes_with_hyphens() {
        let content = "type-check:\n\ttsc\n\nrun-tests:\n\tpytest\n";
        let recipes = parse_justfile_recipes(content);
        assert_eq!(recipes, vec!["type-check", "run-tests"]);
    }

    #[test]
    fn test_parse_justfile_recipes_empty_content() {
        let recipes = parse_justfile_recipes("");
        assert!(recipes.is_empty());
    }

    // --- detect_build_system tests ---

    #[test]
    fn test_detect_build_system_justfile_highest_priority() {
        let dir = TempDir::new().unwrap();
        create_file(dir.path(), "justfile", "test:\n");
        create_file(dir.path(), "Cargo.toml", "[package]");
        assert_eq!(detect_build_system(dir.path(), true), BuildSystem::Just);
    }

    #[test]
    fn test_detect_build_system_cargo() {
        let dir = TempDir::new().unwrap();
        create_file(dir.path(), "Cargo.toml", "[package]");
        assert_eq!(detect_build_system(dir.path(), false), BuildSystem::Cargo);
    }

    #[test]
    fn test_detect_build_system_make() {
        let dir = TempDir::new().unwrap();
        create_file(dir.path(), "Makefile", "all:");
        assert_eq!(detect_build_system(dir.path(), false), BuildSystem::Make);
    }

    #[test]
    fn test_detect_build_system_pnpm() {
        let dir = TempDir::new().unwrap();
        create_file(dir.path(), "pnpm-lock.yaml", "");
        assert_eq!(detect_build_system(dir.path(), false), BuildSystem::Pnpm);
    }

    #[test]
    fn test_detect_build_system_yarn() {
        let dir = TempDir::new().unwrap();
        create_file(dir.path(), "yarn.lock", "");
        assert_eq!(detect_build_system(dir.path(), false), BuildSystem::Yarn);
    }

    #[test]
    fn test_detect_build_system_npm_from_lockfile() {
        let dir = TempDir::new().unwrap();
        create_file(dir.path(), "package-lock.json", "{}");
        assert_eq!(detect_build_system(dir.path(), false), BuildSystem::Npm);
    }

    #[test]
    fn test_detect_build_system_npm_from_package_json() {
        let dir = TempDir::new().unwrap();
        create_file(dir.path(), "package.json", "{}");
        assert_eq!(detect_build_system(dir.path(), false), BuildSystem::Npm);
    }

    #[test]
    fn test_detect_build_system_gradle() {
        let dir = TempDir::new().unwrap();
        create_file(dir.path(), "build.gradle", "");
        assert_eq!(detect_build_system(dir.path(), false), BuildSystem::Gradle);
    }

    #[test]
    fn test_detect_build_system_poetry() {
        let dir = TempDir::new().unwrap();
        create_file(
            dir.path(),
            "pyproject.toml",
            "[tool.poetry]\nname = \"foo\"",
        );
        assert_eq!(detect_build_system(dir.path(), false), BuildSystem::Poetry);
    }

    #[test]
    fn test_detect_build_system_pip() {
        let dir = TempDir::new().unwrap();
        create_file(dir.path(), "pyproject.toml", "[project]\nname = \"foo\"");
        assert_eq!(detect_build_system(dir.path(), false), BuildSystem::Pip);
    }

    #[test]
    fn test_detect_build_system_unknown() {
        let dir = TempDir::new().unwrap();
        assert_eq!(detect_build_system(dir.path(), false), BuildSystem::Unknown);
    }

    // --- detect_project_info tests ---

    #[test]
    fn test_detect_node_project() {
        let dir = TempDir::new().unwrap();
        create_file(
            dir.path(),
            "package.json",
            r#"{"scripts": {"test": "jest", "build": "tsc"}}"#,
        );
        let result = detect_project_info(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(result.project_type, ProjectType::Node);
        assert_eq!(result.build_system, BuildSystem::Npm);
        assert!(result
            .detected_config_files
            .contains(&"package.json".to_string()));
        assert_eq!(
            result.available_commands.test,
            Some("npm run test".to_string())
        );
        assert_eq!(
            result.available_commands.build,
            Some("npm run build".to_string())
        );
    }

    #[test]
    fn test_detect_rust_project() {
        let dir = TempDir::new().unwrap();
        create_file(dir.path(), "Cargo.toml", "[package]\nname = \"foo\"");
        let result = detect_project_info(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(result.project_type, ProjectType::Rust);
        assert_eq!(result.build_system, BuildSystem::Cargo);
        assert!(result
            .detected_config_files
            .contains(&"Cargo.toml".to_string()));
    }

    #[test]
    fn test_detect_python_project() {
        let dir = TempDir::new().unwrap();
        create_file(dir.path(), "pyproject.toml", "[project]\nname = \"foo\"");
        let result = detect_project_info(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(result.project_type, ProjectType::Python);
        assert_eq!(result.build_system, BuildSystem::Pip);
    }

    #[test]
    fn test_detect_android_project() {
        let dir = TempDir::new().unwrap();
        create_file(
            dir.path(),
            "build.gradle",
            "apply plugin: 'com.android.application'",
        );
        let result = detect_project_info(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(result.project_type, ProjectType::Android);
        assert!(result.platform_targets.contains(&"android".to_string()));
        let pb = result.available_commands.platform_build.as_ref().unwrap();
        assert_eq!(pb.get("android"), Some(&"gradle assembleDebug".to_string()));
    }

    #[test]
    fn test_detect_android_nested() {
        let dir = TempDir::new().unwrap();
        create_file(dir.path(), "android/build.gradle", "");
        let result = detect_project_info(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(result.project_type, ProjectType::Android);
        assert!(result.platform_targets.contains(&"android".to_string()));
    }

    #[test]
    fn test_detect_ios_podfile() {
        let dir = TempDir::new().unwrap();
        create_file(dir.path(), "Podfile", "platform :ios, '13.0'");
        let result = detect_project_info(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(result.project_type, ProjectType::Ios);
        assert!(result.platform_targets.contains(&"ios".to_string()));
        assert!(result
            .detected_config_files
            .contains(&"Podfile".to_string()));
    }

    #[test]
    fn test_detect_ios_xcworkspace() {
        let dir = TempDir::new().unwrap();
        create_file(
            dir.path(),
            "ios/App.xcworkspace/contents.xcworkspacedata",
            "",
        );
        let result = detect_project_info(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(result.project_type, ProjectType::Ios);
        assert!(result.platform_targets.contains(&"ios".to_string()));
    }

    #[test]
    fn test_detect_multi_platform_node_android() {
        let dir = TempDir::new().unwrap();
        create_file(dir.path(), "package.json", r#"{"scripts": {}}"#);
        create_file(dir.path(), "build.gradle", "");
        let result = detect_project_info(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(result.project_type, ProjectType::MultiPlatform);
        assert!(result.platform_targets.contains(&"android".to_string()));
    }

    #[test]
    fn test_detect_multi_platform_node_ios() {
        let dir = TempDir::new().unwrap();
        create_file(dir.path(), "package.json", r#"{"scripts": {}}"#);
        create_file(dir.path(), "Podfile", "");
        let result = detect_project_info(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(result.project_type, ProjectType::MultiPlatform);
        assert!(result.platform_targets.contains(&"ios".to_string()));
    }

    #[test]
    fn test_detect_multi_platform_node_rust() {
        let dir = TempDir::new().unwrap();
        create_file(dir.path(), "package.json", r#"{"scripts": {}}"#);
        create_file(dir.path(), "Cargo.toml", "[package]");
        let result = detect_project_info(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(result.project_type, ProjectType::MultiPlatform);
    }

    #[test]
    fn test_detect_multi_platform_node_python() {
        let dir = TempDir::new().unwrap();
        create_file(dir.path(), "package.json", r#"{"scripts": {}}"#);
        create_file(dir.path(), "pyproject.toml", "[project]");
        let result = detect_project_info(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(result.project_type, ProjectType::MultiPlatform);
    }

    #[test]
    fn test_justfile_commands_override_package_json() {
        let dir = TempDir::new().unwrap();
        create_file(
            dir.path(),
            "justfile",
            "test:\n\tcargo test\n\nbuild:\n\tcargo build\n",
        );
        create_file(
            dir.path(),
            "package.json",
            r#"{"scripts": {"test": "jest", "build": "tsc", "lint": "eslint"}}"#,
        );
        let result = detect_project_info(dir.path().to_str().unwrap()).unwrap();
        assert!(result.has_justfile);
        assert_eq!(result.build_system, BuildSystem::Just);
        // justfile commands take priority
        assert_eq!(
            result.available_commands.test,
            Some("just test".to_string())
        );
        assert_eq!(
            result.available_commands.build,
            Some("just build".to_string())
        );
        // lint not in justfile, falls back to package.json
        assert_eq!(
            result.available_commands.lint,
            Some("npm run lint".to_string())
        );
    }

    #[test]
    fn test_detect_unknown_project() {
        let dir = TempDir::new().unwrap();
        let result = detect_project_info(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(result.project_type, ProjectType::Unknown);
        assert_eq!(result.build_system, BuildSystem::Unknown);
        assert!(result.platform_targets.is_empty());
        assert!(result.detected_config_files.is_empty());
        assert!(!result.has_justfile);
    }

    #[test]
    fn test_justfile_validate_recipe_maps_to_build() {
        let dir = TempDir::new().unwrap();
        create_file(dir.path(), "justfile", "validate:\n\tcargo clippy\n");
        let result = detect_project_info(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(
            result.available_commands.build,
            Some("just validate".to_string())
        );
    }

    #[test]
    fn test_justfile_build_takes_priority_over_validate() {
        let dir = TempDir::new().unwrap();
        create_file(
            dir.path(),
            "justfile",
            "build:\n\tcargo build\n\nvalidate:\n\tcargo clippy\n",
        );
        let result = detect_project_info(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(
            result.available_commands.build,
            Some("just build".to_string())
        );
    }
}
