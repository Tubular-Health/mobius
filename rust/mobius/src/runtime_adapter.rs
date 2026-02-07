use crate::types::ExecutionConfig;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeKind {
    Claude,
    Opencode,
}

pub fn effective_model_for_runtime(
    runtime: RuntimeKind,
    config: &ExecutionConfig,
    raw_model_override: Option<&str>,
) -> String {
    match runtime {
        RuntimeKind::Claude => config.model.to_string(),
        RuntimeKind::Opencode => raw_model_override
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| config.model.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::{effective_model_for_runtime, RuntimeKind};
    use crate::types::ExecutionConfig;

    #[test]
    fn test_effective_model_for_runtime_claude_ignores_raw_override() {
        let config = ExecutionConfig::default();
        let model = effective_model_for_runtime(RuntimeKind::Claude, &config, Some("gpt-5-mini"));
        assert_eq!(model, "opus");
    }

    #[test]
    fn test_effective_model_for_runtime_opencode_uses_non_empty_raw_override() {
        let config = ExecutionConfig::default();
        let model = effective_model_for_runtime(RuntimeKind::Opencode, &config, Some("gpt-5-mini"));
        assert_eq!(model, "gpt-5-mini");
    }

    #[test]
    fn test_effective_model_for_runtime_opencode_ignores_empty_raw_override() {
        let config = ExecutionConfig::default();
        let model = effective_model_for_runtime(RuntimeKind::Opencode, &config, Some("   "));
        assert_eq!(model, "opus");
    }

    #[test]
    fn test_effective_model_for_runtime_without_override_keeps_existing_behavior() {
        let config = ExecutionConfig::default();

        let claude_model = effective_model_for_runtime(RuntimeKind::Claude, &config, None);
        let opencode_model = effective_model_for_runtime(RuntimeKind::Opencode, &config, None);

        assert_eq!(claude_model, "opus");
        assert_eq!(opencode_model, "opus");
    }
}
