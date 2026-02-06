//! Parser for Claude CLI's stream-json output format.
//!
//! Extracts token usage from the JSONL output that Claude CLI produces
//! when invoked with `--output-format stream-json`.

use std::fs;
use std::path::Path;

/// Token usage data extracted from Claude CLI output.
#[derive(Debug, Clone, Default)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

/// Parse the final token usage from a completed Claude CLI output file.
///
/// Reads the file and searches backwards for the final `{"type":"result",...}`
/// line which contains the cumulative token usage for the entire conversation.
pub fn parse_final_tokens(file_path: &Path) -> Option<TokenUsage> {
    let content = fs::read_to_string(file_path).ok()?;
    // Search lines in reverse for the result event
    for line in content.lines().rev() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        // Look for result type which has final cumulative usage
        if trimmed.contains("\"type\":\"result\"") || trimmed.contains("\"type\": \"result\"") {
            return extract_usage_from_line(trimmed);
        }
    }
    None
}

/// Parse current token usage from a running Claude CLI output file.
///
/// Scans backwards for the latest line containing token usage data,
/// which can appear in various event types (`message_delta`, `result`, etc.).
pub fn parse_current_tokens(file_path: &Path) -> Option<TokenUsage> {
    let content = fs::read_to_string(file_path).ok()?;
    for line in content.lines().rev() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.contains("\"input_tokens\"") || trimmed.contains("\"inputTokens\"") {
            if let Some(usage) = extract_usage_from_line(trimmed) {
                return Some(usage);
            }
        }
    }
    None
}

/// Extract input_tokens and output_tokens from a JSON line.
///
/// Handles both snake_case (`input_tokens`) and camelCase (`inputTokens`) keys.
fn extract_usage_from_line(line: &str) -> Option<TokenUsage> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;

    // Try nested under "usage" key first (result events)
    if let Some(usage) = value.get("usage") {
        return extract_usage_from_value(usage);
    }

    // Try nested under "result" -> "usage"
    if let Some(result) = value.get("result") {
        if let Some(usage) = result.get("usage") {
            return extract_usage_from_value(usage);
        }
    }

    // Try top-level (some delta events embed usage directly)
    extract_usage_from_value(&value)
}

/// Extract token counts from a JSON value that contains token fields.
fn extract_usage_from_value(value: &serde_json::Value) -> Option<TokenUsage> {
    let input = value
        .get("input_tokens")
        .or_else(|| value.get("inputTokens"))
        .and_then(|v| v.as_u64())?;
    let output = value
        .get("output_tokens")
        .or_else(|| value.get("outputTokens"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    Some(TokenUsage {
        input_tokens: input,
        output_tokens: output,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn test_parse_final_tokens_result_event() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        writeln!(file, r#"{{"type":"message_start","message":{{"id":"msg_01"}}}}"#).unwrap();
        writeln!(file, r#"{{"type":"content_block_delta","delta":{{"text":"hello"}}}}"#).unwrap();
        writeln!(
            file,
            r#"{{"type":"result","subtype":"success","usage":{{"input_tokens":1500,"output_tokens":350}}}}"#
        )
        .unwrap();

        let usage = parse_final_tokens(file.path()).unwrap();
        assert_eq!(usage.input_tokens, 1500);
        assert_eq!(usage.output_tokens, 350);
    }

    #[test]
    fn test_parse_final_tokens_no_result() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        writeln!(file, r#"{{"type":"message_start"}}"#).unwrap();
        writeln!(file, r#"{{"type":"content_block_delta"}}"#).unwrap();

        assert!(parse_final_tokens(file.path()).is_none());
    }

    #[test]
    fn test_parse_current_tokens_finds_latest() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        writeln!(
            file,
            r#"{{"type":"message_delta","usage":{{"input_tokens":100,"output_tokens":50}}}}"#
        )
        .unwrap();
        writeln!(
            file,
            r#"{{"type":"message_delta","usage":{{"input_tokens":200,"output_tokens":80}}}}"#
        )
        .unwrap();

        let usage = parse_current_tokens(file.path()).unwrap();
        // Should find the last line (200/80)
        assert_eq!(usage.input_tokens, 200);
        assert_eq!(usage.output_tokens, 80);
    }

    #[test]
    fn test_parse_current_tokens_empty_file() {
        let file = tempfile::NamedTempFile::new().unwrap();
        assert!(parse_current_tokens(file.path()).is_none());
    }

    #[test]
    fn test_parse_current_tokens_nonexistent_file() {
        assert!(parse_current_tokens(Path::new("/tmp/nonexistent_mobius_test_file.jsonl")).is_none());
    }

    #[test]
    fn test_extract_usage_camel_case() {
        let line = r#"{"type":"result","usage":{"inputTokens":500,"outputTokens":100}}"#;
        let usage = extract_usage_from_line(line).unwrap();
        assert_eq!(usage.input_tokens, 500);
        assert_eq!(usage.output_tokens, 100);
    }

    #[test]
    fn test_extract_usage_nested_result() {
        let line =
            r#"{"type":"result","result":{"usage":{"input_tokens":999,"output_tokens":111}}}"#;
        let usage = extract_usage_from_line(line).unwrap();
        assert_eq!(usage.input_tokens, 999);
        assert_eq!(usage.output_tokens, 111);
    }

    #[test]
    fn test_extract_usage_missing_output_tokens() {
        let line = r#"{"usage":{"input_tokens":42}}"#;
        let usage = extract_usage_from_line(line).unwrap();
        assert_eq!(usage.input_tokens, 42);
        assert_eq!(usage.output_tokens, 0);
    }

    #[test]
    fn test_extract_usage_no_tokens() {
        let line = r#"{"type":"content_block_delta","delta":{"text":"hi"}}"#;
        assert!(extract_usage_from_line(line).is_none());
    }
}
