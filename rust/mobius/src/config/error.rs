use std::fmt;

/// Errors that can occur during configuration operations
#[derive(Debug)]
pub enum ConfigError {
    /// Config file not found at expected path
    NotFound(String),
    /// Failed to parse config file (YAML syntax error)
    ParseError(String),
    /// IO error reading/writing config
    IoError(std::io::Error),
    /// Config validation failed
    ValidationError(Vec<String>),
    /// Invalid path encountered
    InvalidPath(String),
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ConfigError::NotFound(path) => write!(f, "Config file not found: {path}"),
            ConfigError::ParseError(msg) => write!(f, "Config parse error: {msg}"),
            ConfigError::IoError(err) => write!(f, "Config IO error: {err}"),
            ConfigError::ValidationError(errors) => {
                writeln!(f, "Config validation failed:")?;
                for err in errors {
                    writeln!(f, "  - {err}")?;
                }
                Ok(())
            }
            ConfigError::InvalidPath(msg) => write!(f, "Invalid path: {msg}"),
        }
    }
}

impl std::error::Error for ConfigError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            ConfigError::IoError(err) => Some(err),
            _ => None,
        }
    }
}

impl From<std::io::Error> for ConfigError {
    fn from(err: std::io::Error) -> Self {
        ConfigError::IoError(err)
    }
}

impl From<serde_yaml::Error> for ConfigError {
    fn from(err: serde_yaml::Error) -> Self {
        ConfigError::ParseError(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_config_error_display() {
        let err = ConfigError::NotFound("/path/to/config.yaml".to_string());
        assert!(err.to_string().contains("/path/to/config.yaml"));

        let err = ConfigError::ParseError("invalid YAML".to_string());
        assert!(err.to_string().contains("invalid YAML"));

        let err = ConfigError::ValidationError(vec!["error 1".to_string(), "error 2".to_string()]);
        let display = err.to_string();
        assert!(display.contains("error 1"));
        assert!(display.contains("error 2"));

        let err = ConfigError::InvalidPath("bad path".to_string());
        assert!(err.to_string().contains("bad path"));
    }

    #[test]
    fn test_config_error_from_io() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
        let config_err: ConfigError = io_err.into();
        assert!(matches!(config_err, ConfigError::IoError(_)));
    }
}
