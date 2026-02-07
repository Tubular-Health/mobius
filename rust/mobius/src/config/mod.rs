pub mod error;
pub mod loader;
pub mod paths;
pub mod setup;

pub use error::ConfigError;
pub use loader::{config_exists, read_config, read_config_with_env, validate_config, write_config};
pub use paths::{find_local_config, get_paths_for_type, resolve_paths};
pub use setup::{
    add_shortcuts_source_line, copy_commands, copy_shortcuts, copy_skills, ensure_claude_settings,
};
