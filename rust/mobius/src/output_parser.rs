//! Skill output parser module
//!
//! Parses structured output from skills, extracting status, issue updates,
//! and actions from skill stdout/files. Supports YAML and JSON formats.

use anyhow::{bail, Result};
use serde_json::Value as JsonValue;

use crate::types::{SkillOutputData, SkillOutputStatus};

/// Parse structured output from a skill.
///
/// Supports both YAML and JSON formats. The function first attempts to extract
/// a structured block from raw pane content (which may contain conversation text),
/// then parses the extracted block as JSON or YAML.
pub fn parse_skill_output(raw_output: &str) -> Result<SkillOutputData> {
    let trimmed = raw_output.trim();
    if trimmed.is_empty() {
        bail!("Skill output is empty");
    }

    // First, try to extract a structured block from the raw output
    let content_to_parse = extract_structured_block(trimmed).unwrap_or(trimmed.to_string());

    // Try JSON first (faster), then YAML
    let parsed: Result<SkillOutputData, _> = serde_json::from_str(&content_to_parse);
    if let Ok(data) = parsed {
        validate_skill_output(&data)?;
        return Ok(data);
    }

    let parsed: Result<SkillOutputData, _> = serde_yaml::from_str(&content_to_parse);
    match parsed {
        Ok(data) => {
            validate_skill_output(&data)?;
            Ok(data)
        }
        Err(yaml_err) => {
            bail!(
                "Failed to parse skill output as JSON or YAML: {}. Input: {}",
                yaml_err,
                truncate_for_error(&content_to_parse, 200)
            )
        }
    }
}

/// Extract the status from skill output without full parsing.
///
/// Useful for quick status checks without validating all fields.
/// Handles raw tmux pane content by extracting the structured block first.
pub fn extract_status(raw_output: &str) -> Option<SkillOutputStatus> {
    let trimmed = raw_output.trim();
    if trimmed.is_empty() {
        return None;
    }

    let content_to_parse = extract_structured_block(trimmed).unwrap_or(trimmed.to_string());

    // Try JSON first, then YAML
    if let Ok(value) = serde_json::from_str::<JsonValue>(&content_to_parse) {
        if let Some(status_str) = value.get("status").and_then(|s| s.as_str()) {
            return parse_status_str(status_str);
        }
    }

    if let Ok(value) = serde_yaml::from_str::<JsonValue>(&content_to_parse) {
        if let Some(status_str) = value.get("status").and_then(|s| s.as_str()) {
            return parse_status_str(status_str);
        }
    }

    None
}

/// Extract structured output block from raw pane content.
///
/// The raw output from tmux panes contains the entire Claude conversation.
/// The structured output is a YAML or JSON block typically at the end,
/// delimited by `---` markers (YAML front matter style) or code fences.
fn extract_structured_block(raw_output: &str) -> Option<String> {
    // Strategy 1: Look for YAML blocks with --- delimiters
    if let Some(block) = extract_yaml_front_matter(raw_output) {
        return Some(block);
    }

    // Strategy 2: Look for code-fenced YAML (```yaml\n...\n```)
    if let Some(block) = extract_fenced_yaml(raw_output) {
        return Some(block);
    }

    // Strategy 3: Look for code-fenced JSON (```json\n...\n```)
    if let Some(block) = extract_fenced_json(raw_output) {
        return Some(block);
    }

    // Strategy 4: Try to find a JSON object with status field
    if let Some(block) = extract_raw_json_object(raw_output) {
        return Some(block);
    }

    None
}

/// Strategy 1: Extract YAML front matter blocks (---\n...\n---)
fn extract_yaml_front_matter(raw_output: &str) -> Option<String> {
    let re = regex::Regex::new(r"---\s*\n[\s\S]*?\n---").ok()?;
    let matches: Vec<_> = re.find_iter(raw_output).collect();

    // Check blocks from end to start (most recent first)
    for m in matches.iter().rev() {
        let block = m.as_str();
        // Remove the --- delimiters
        let content = block
            .trim_start_matches("---")
            .trim_end_matches("---")
            .trim();
        if content.contains("status:") {
            return Some(content.to_string());
        }
    }
    None
}

/// Strategy 2: Extract fenced YAML blocks (```yaml\n...\n```)
fn extract_fenced_yaml(raw_output: &str) -> Option<String> {
    let re = regex::Regex::new(r"```ya?ml\s*\n([\s\S]*?)\n```").ok()?;
    let matches: Vec<_> = re.captures_iter(raw_output).collect();

    for cap in matches.iter().rev() {
        let content = cap.get(1)?.as_str().trim();
        if content.contains("status:") {
            return Some(content.to_string());
        }
    }
    None
}

/// Strategy 3: Extract fenced JSON blocks (```json\n...\n```)
fn extract_fenced_json(raw_output: &str) -> Option<String> {
    let re = regex::Regex::new(r"```json\s*\n([\s\S]*?)\n```").ok()?;
    let matches: Vec<_> = re.captures_iter(raw_output).collect();

    for cap in matches.iter().rev() {
        let content = cap.get(1)?.as_str().trim();
        if content.contains("\"status\"") {
            return Some(content.to_string());
        }
    }
    None
}

/// Strategy 4: Extract raw JSON objects with brace matching
fn extract_raw_json_object(raw_output: &str) -> Option<String> {
    let re = regex::Regex::new(r#"\{[^{}]*"status"\s*:\s*"[A-Z_]+""#).ok()?;
    let matches: Vec<_> = re.find_iter(raw_output).collect();

    for m in matches.iter().rev() {
        let match_start = m.start();
        // Find the closing brace by counting braces
        let mut brace_count = 0i32;
        let mut end_pos = match_start;
        for (j, ch) in raw_output[match_start..].char_indices() {
            if ch == '{' {
                brace_count += 1;
            }
            if ch == '}' {
                brace_count -= 1;
            }
            if brace_count == 0 {
                end_pos = match_start + j + 1;
                break;
            }
        }
        let json_candidate = &raw_output[match_start..end_pos];
        if let Ok(value) = serde_json::from_str::<JsonValue>(json_candidate) {
            if value.get("status").is_some() {
                return Some(json_candidate.to_string());
            }
        }
    }
    None
}

/// Validate status-specific required fields after serde deserialization.
///
/// While serde handles type-level validation, this catches semantic constraints
/// like NEEDS_WORK requiring either execute format or verify format fields.
fn validate_skill_output(data: &SkillOutputData) -> Result<()> {
    match data {
        SkillOutputData::NeedsWork {
            subtask_id,
            issues,
            suggested_fixes,
            failing_subtasks,
            ..
        } => {
            let has_execute_format = subtask_id.is_some();
            let has_verify_format = failing_subtasks
                .as_ref()
                .map(|fs| !fs.is_empty())
                .unwrap_or(false);

            if !has_execute_format && !has_verify_format {
                bail!(
                    "NEEDS_WORK requires either subtaskId (string) or failingSubtasks (non-empty array)"
                );
            }

            // For execute format without verify format, issues and suggestedFixes are required
            if has_execute_format && !has_verify_format {
                if issues.is_none() || issues.as_ref().map(|i| i.is_empty()).unwrap_or(true) {
                    bail!("NEEDS_WORK with subtaskId requires issues (non-empty array)");
                }
                if suggested_fixes.is_none()
                    || suggested_fixes
                        .as_ref()
                        .map(|f| f.is_empty())
                        .unwrap_or(true)
                {
                    bail!("NEEDS_WORK with subtaskId requires suggestedFixes (non-empty array)");
                }
            }
            Ok(())
        }
        // Other variants are fully validated by serde's type system
        _ => Ok(()),
    }
}

/// Check if the skill output indicates a terminal state (execution should stop)
pub fn is_terminal_status(data: &SkillOutputData) -> bool {
    matches!(
        data,
        SkillOutputData::SubtaskComplete { .. }
            | SkillOutputData::AllComplete { .. }
            | SkillOutputData::AllBlocked { .. }
            | SkillOutputData::NoSubtasks { .. }
            | SkillOutputData::VerificationFailed { .. }
            | SkillOutputData::Pass { .. }
            | SkillOutputData::Fail { .. }
    )
}

/// Check if the skill output indicates success
pub fn is_success_status(data: &SkillOutputData) -> bool {
    matches!(
        data,
        SkillOutputData::SubtaskComplete { .. }
            | SkillOutputData::AllComplete { .. }
            | SkillOutputData::Pass { .. }
    )
}

/// Check if the skill output indicates failure
pub fn is_failure_status(data: &SkillOutputData) -> bool {
    matches!(
        data,
        SkillOutputData::VerificationFailed { .. } | SkillOutputData::Fail { .. }
    )
}

/// Get the SkillOutputStatus enum value from SkillOutputData
pub fn get_status(data: &SkillOutputData) -> SkillOutputStatus {
    match data {
        SkillOutputData::SubtaskComplete { .. } => SkillOutputStatus::SubtaskComplete,
        SkillOutputData::SubtaskPartial { .. } => SkillOutputStatus::SubtaskPartial,
        SkillOutputData::AllComplete { .. } => SkillOutputStatus::AllComplete,
        SkillOutputData::AllBlocked { .. } => SkillOutputStatus::AllBlocked,
        SkillOutputData::NoSubtasks { .. } => SkillOutputStatus::NoSubtasks,
        SkillOutputData::VerificationFailed { .. } => SkillOutputStatus::VerificationFailed,
        SkillOutputData::NeedsWork { .. } => SkillOutputStatus::NeedsWork,
        SkillOutputData::Pass { .. } => SkillOutputStatus::Pass,
        SkillOutputData::Fail { .. } => SkillOutputStatus::Fail,
    }
}

/// Parse a status string into the SkillOutputStatus enum
fn parse_status_str(s: &str) -> Option<SkillOutputStatus> {
    match s {
        "SUBTASK_COMPLETE" => Some(SkillOutputStatus::SubtaskComplete),
        "SUBTASK_PARTIAL" => Some(SkillOutputStatus::SubtaskPartial),
        "ALL_COMPLETE" => Some(SkillOutputStatus::AllComplete),
        "ALL_BLOCKED" => Some(SkillOutputStatus::AllBlocked),
        "NO_SUBTASKS" => Some(SkillOutputStatus::NoSubtasks),
        "VERIFICATION_FAILED" => Some(SkillOutputStatus::VerificationFailed),
        "NEEDS_WORK" => Some(SkillOutputStatus::NeedsWork),
        "PASS" => Some(SkillOutputStatus::Pass),
        "FAIL" => Some(SkillOutputStatus::Fail),
        _ => None,
    }
}

/// Truncate a string for error messages
fn truncate_for_error(s: &str, max_len: usize) -> &str {
    if s.len() <= max_len {
        s
    } else {
        &s[..max_len]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Format Parsing Tests ---

    #[test]
    fn test_parse_json_format() {
        let json_input = r#"{
            "status": "SUBTASK_COMPLETE",
            "timestamp": "2026-01-28T16:45:00Z",
            "subtaskId": "MOB-177",
            "parentId": "MOB-161",
            "commitHash": "f2ccd9e",
            "filesModified": ["src/lib/feature.ts"],
            "verificationResults": {
                "typecheck": "PASS",
                "tests": "PASS",
                "lint": "PASS",
                "subtaskVerify": "PASS"
            }
        }"#;

        let result = parse_skill_output(json_input).unwrap();
        match &result {
            SkillOutputData::SubtaskComplete {
                subtask_id,
                commit_hash,
                files_modified,
                ..
            } => {
                assert_eq!(subtask_id, "MOB-177");
                assert_eq!(commit_hash, "f2ccd9e");
                assert_eq!(files_modified, &["src/lib/feature.ts"]);
            }
            _ => panic!("Expected SubtaskComplete, got {:?}", result),
        }
    }

    #[test]
    fn test_parse_yaml_format() {
        let yaml_input = r#"
status: SUBTASK_COMPLETE
timestamp: "2026-01-28T16:45:00Z"
subtaskId: MOB-177
parentId: MOB-161
commitHash: f2ccd9e
filesModified:
  - src/lib/feature.ts
verificationResults:
  typecheck: PASS
  tests: PASS
  lint: PASS
  subtaskVerify: PASS
"#;

        let result = parse_skill_output(yaml_input).unwrap();
        match &result {
            SkillOutputData::SubtaskComplete {
                subtask_id,
                commit_hash,
                files_modified,
                ..
            } => {
                assert_eq!(subtask_id, "MOB-177");
                assert_eq!(commit_hash, "f2ccd9e");
                assert_eq!(files_modified, &["src/lib/feature.ts"]);
            }
            _ => panic!("Expected SubtaskComplete, got {:?}", result),
        }
    }

    #[test]
    fn test_parse_json_and_yaml_produce_same_result() {
        let json_input =
            r#"{"status":"PASS","timestamp":"2026-01-28T16:45:00Z","details":"All good"}"#;
        let yaml_input = "status: PASS\ntimestamp: \"2026-01-28T16:45:00Z\"\ndetails: All good\n";

        let json_result = parse_skill_output(json_input).unwrap();
        let yaml_result = parse_skill_output(yaml_input).unwrap();

        assert_eq!(get_status(&json_result), get_status(&yaml_result));
        match (&json_result, &yaml_result) {
            (
                SkillOutputData::Pass {
                    details: d1,
                    timestamp: t1,
                    ..
                },
                SkillOutputData::Pass {
                    details: d2,
                    timestamp: t2,
                    ..
                },
            ) => {
                assert_eq!(d1, d2);
                assert_eq!(t1, t2);
            }
            _ => panic!("Expected both to be Pass"),
        }
    }

    // --- Extraction Strategy Tests ---

    #[test]
    fn test_extract_yaml_front_matter() {
        let raw = r#"
Some conversation output here...
Agent thinking about things...

---
status: PASS
timestamp: "2026-01-28T16:45:00Z"
---

More stuff after
"#;

        let block = extract_structured_block(raw).unwrap();
        assert!(block.contains("status: PASS"));
        assert!(block.contains("timestamp:"));
    }

    #[test]
    fn test_extract_fenced_yaml() {
        let raw = r#"
Here is the result:

```yaml
status: ALL_COMPLETE
timestamp: "2026-01-28T16:45:00Z"
parentId: MOB-161
completedCount: 5
```

Done!
"#;

        let block = extract_structured_block(raw).unwrap();
        assert!(block.contains("status: ALL_COMPLETE"));
        assert!(block.contains("completedCount: 5"));
    }

    #[test]
    fn test_extract_fenced_json() {
        let raw = r#"
Here is the structured output:

```json
{
  "status": "FAIL",
  "timestamp": "2026-01-28T16:45:00Z",
  "reason": "Tests failed"
}
```

End of output.
"#;

        let block = extract_structured_block(raw).unwrap();
        assert!(block.contains("\"status\": \"FAIL\""));
        assert!(block.contains("\"reason\": \"Tests failed\""));
    }

    #[test]
    fn test_extract_raw_json_object() {
        let raw = r#"
Lots of conversation noise here...
The agent did some work.
Result: {"status": "PASS", "timestamp": "2026-01-28T16:45:00Z"}
More noise after the JSON.
"#;

        let block = extract_structured_block(raw).unwrap();
        assert!(block.contains("\"status\": \"PASS\""));
    }

    // --- Status Validation Tests ---

    #[test]
    fn test_validate_subtask_complete() {
        let input = r#"{
            "status": "SUBTASK_COMPLETE",
            "timestamp": "2026-01-28T16:45:00Z",
            "subtaskId": "MOB-177",
            "commitHash": "abc123",
            "filesModified": ["src/file.ts"],
            "verificationResults": {
                "typecheck": "PASS",
                "tests": "PASS",
                "lint": "PASS",
                "subtaskVerify": "PASS"
            }
        }"#;
        let result = parse_skill_output(input);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_verification_failed() {
        let input = r#"{
            "status": "VERIFICATION_FAILED",
            "timestamp": "2026-01-28T16:45:00Z",
            "subtaskId": "MOB-177",
            "errorType": "tests",
            "errorOutput": "Test failed: expected 2 but got 3",
            "attemptedFixes": ["Updated expected value"],
            "uncommittedFiles": ["src/lib/feature.ts"]
        }"#;
        let result = parse_skill_output(input);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_needs_work_execute_format() {
        let input = r#"{
            "status": "NEEDS_WORK",
            "timestamp": "2026-01-28T16:45:00Z",
            "subtaskId": "MOB-177",
            "issues": ["Missing error handling"],
            "suggestedFixes": ["Add try-catch block"]
        }"#;
        let result = parse_skill_output(input);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_needs_work_verify_format() {
        let input = r#"{
            "status": "NEEDS_WORK",
            "timestamp": "2026-01-28T16:45:00Z",
            "failingSubtasks": [
                {
                    "id": "uuid-123",
                    "identifier": "MOB-178",
                    "issues": [
                        {
                            "type": "logic_error",
                            "description": "Missing null check"
                        }
                    ]
                }
            ],
            "verificationTaskId": "task-VG"
        }"#;
        let result = parse_skill_output(input);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_needs_work_missing_both_formats() {
        let input = r#"{
            "status": "NEEDS_WORK",
            "timestamp": "2026-01-28T16:45:00Z"
        }"#;
        let result = parse_skill_output(input);
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("NEEDS_WORK requires either subtaskId"));
    }

    #[test]
    fn test_validate_all_complete() {
        let input = r#"{
            "status": "ALL_COMPLETE",
            "timestamp": "2026-01-28T16:45:00Z",
            "parentId": "MOB-161",
            "completedCount": 5
        }"#;
        let result = parse_skill_output(input);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_all_blocked() {
        let input = r#"{
            "status": "ALL_BLOCKED",
            "timestamp": "2026-01-28T16:45:00Z",
            "parentId": "MOB-161",
            "blockedCount": 3,
            "waitingOn": ["MOB-176", "MOB-175"]
        }"#;
        let result = parse_skill_output(input);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_no_subtasks() {
        let input = r#"{
            "status": "NO_SUBTASKS",
            "timestamp": "2026-01-28T16:45:00Z",
            "parentId": "MOB-161"
        }"#;
        let result = parse_skill_output(input);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_pass() {
        let input = r#"{
            "status": "PASS",
            "timestamp": "2026-01-28T16:45:00Z",
            "details": "Everything looks good"
        }"#;
        let result = parse_skill_output(input);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_fail() {
        let input = r#"{
            "status": "FAIL",
            "timestamp": "2026-01-28T16:45:00Z",
            "reason": "Tests failed"
        }"#;
        let result = parse_skill_output(input);
        assert!(result.is_ok());
    }

    // --- Error Cases ---

    #[test]
    fn test_parse_invalid_json() {
        let input = "{ invalid json }";
        let result = parse_skill_output(input);
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("Failed to parse skill output"));
    }

    #[test]
    fn test_parse_missing_required_fields() {
        // Missing subtaskId for SUBTASK_COMPLETE
        let input = r#"{
            "status": "SUBTASK_COMPLETE",
            "timestamp": "2026-01-28T16:45:00Z"
        }"#;
        let result = parse_skill_output(input);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_empty_input() {
        let result = parse_skill_output("");
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("empty"));
    }

    #[test]
    fn test_parse_no_structured_block_found() {
        let input = "Just some random conversation text with no structured output at all.";
        let result = parse_skill_output(input);
        assert!(result.is_err());
    }

    // --- Utility Function Tests ---

    #[test]
    fn test_is_terminal_status() {
        let terminal_cases = vec![
            r#"{"status":"SUBTASK_COMPLETE","timestamp":"T","subtaskId":"X","commitHash":"h","filesModified":[],"verificationResults":{"typecheck":"PASS","tests":"PASS","lint":"PASS"}}"#,
            r#"{"status":"ALL_COMPLETE","timestamp":"T","parentId":"P","completedCount":1}"#,
            r#"{"status":"ALL_BLOCKED","timestamp":"T","parentId":"P","blockedCount":1,"waitingOn":["X"]}"#,
            r#"{"status":"NO_SUBTASKS","timestamp":"T","parentId":"P"}"#,
            r#"{"status":"VERIFICATION_FAILED","timestamp":"T","subtaskId":"X","errorType":"t","errorOutput":"e","attemptedFixes":[],"uncommittedFiles":[]}"#,
            r#"{"status":"PASS","timestamp":"T"}"#,
            r#"{"status":"FAIL","timestamp":"T","reason":"r"}"#,
        ];

        for input in terminal_cases {
            let data = parse_skill_output(input).unwrap();
            assert!(
                is_terminal_status(&data),
                "Expected terminal for: {}",
                input
            );
        }

        // Non-terminal cases
        let non_terminal = r#"{"status":"SUBTASK_PARTIAL","timestamp":"T","subtaskId":"X","progressMade":["a"],"remainingWork":["b"]}"#;
        let data = parse_skill_output(non_terminal).unwrap();
        assert!(!is_terminal_status(&data));

        let non_terminal = r#"{"status":"NEEDS_WORK","timestamp":"T","subtaskId":"X","issues":["i"],"suggestedFixes":["f"]}"#;
        let data = parse_skill_output(non_terminal).unwrap();
        assert!(!is_terminal_status(&data));
    }

    #[test]
    fn test_is_success_status() {
        let pass = parse_skill_output(r#"{"status":"PASS","timestamp":"T"}"#).unwrap();
        assert!(is_success_status(&pass));

        let complete = parse_skill_output(
            r#"{"status":"SUBTASK_COMPLETE","timestamp":"T","subtaskId":"X","commitHash":"h","filesModified":[],"verificationResults":{"typecheck":"PASS","tests":"PASS","lint":"PASS"}}"#,
        )
        .unwrap();
        assert!(is_success_status(&complete));

        let all_complete = parse_skill_output(
            r#"{"status":"ALL_COMPLETE","timestamp":"T","parentId":"P","completedCount":1}"#,
        )
        .unwrap();
        assert!(is_success_status(&all_complete));

        // Failure is not success
        let fail = parse_skill_output(r#"{"status":"FAIL","timestamp":"T","reason":"r"}"#).unwrap();
        assert!(!is_success_status(&fail));
    }

    #[test]
    fn test_is_failure_status() {
        let fail = parse_skill_output(r#"{"status":"FAIL","timestamp":"T","reason":"r"}"#).unwrap();
        assert!(is_failure_status(&fail));

        let verification_failed = parse_skill_output(
            r#"{"status":"VERIFICATION_FAILED","timestamp":"T","subtaskId":"X","errorType":"t","errorOutput":"e","attemptedFixes":[],"uncommittedFiles":[]}"#,
        )
        .unwrap();
        assert!(is_failure_status(&verification_failed));

        // Success is not failure
        let pass = parse_skill_output(r#"{"status":"PASS","timestamp":"T"}"#).unwrap();
        assert!(!is_failure_status(&pass));
    }

    // --- Extract Status Tests ---

    #[test]
    fn test_extract_status_from_json() {
        let input = r#"{"status": "PASS", "timestamp": "T"}"#;
        assert_eq!(extract_status(input), Some(SkillOutputStatus::Pass));
    }

    #[test]
    fn test_extract_status_from_yaml() {
        let input = "---\nstatus: FAIL\ntimestamp: T\nreason: test\n---\n";
        assert_eq!(extract_status(input), Some(SkillOutputStatus::Fail));
    }

    #[test]
    fn test_extract_status_empty_input() {
        assert_eq!(extract_status(""), None);
        assert_eq!(extract_status("   "), None);
    }

    #[test]
    fn test_extract_status_no_status_field() {
        let input = r#"{"foo": "bar"}"#;
        assert_eq!(extract_status(input), None);
    }

    #[test]
    fn test_extract_status_invalid_status_value() {
        let input = r#"{"status": "INVALID_STATUS"}"#;
        assert_eq!(extract_status(input), None);
    }

    // --- Extraction from noisy content ---

    #[test]
    fn test_extract_from_noisy_pane_content() {
        let noise = "Agent is working...\nThinking about things...\n".repeat(50);
        let raw = format!(
            "{}```yaml\nstatus: PASS\ntimestamp: \"2026-01-28T16:45:00Z\"\n```\n{}",
            noise, noise
        );

        let result = parse_skill_output(&raw);
        assert!(result.is_ok());
        assert!(is_success_status(&result.unwrap()));
    }

    #[test]
    fn test_extract_last_block_when_multiple_present() {
        let raw = r#"
---
status: FAIL
timestamp: "2026-01-28T15:00:00Z"
reason: "First attempt failed"
---

Agent retrying...

---
status: PASS
timestamp: "2026-01-28T16:45:00Z"
---
"#;

        // Should extract the last block (PASS), not the first (FAIL)
        let status = extract_status(raw);
        assert_eq!(status, Some(SkillOutputStatus::Pass));
    }

    #[test]
    fn test_subtask_partial_validation() {
        let input = r#"{
            "status": "SUBTASK_PARTIAL",
            "timestamp": "2026-01-28T16:45:00Z",
            "subtaskId": "MOB-177",
            "progressMade": ["Implemented core function"],
            "remainingWork": ["Add unit tests"]
        }"#;
        let result = parse_skill_output(input);
        assert!(result.is_ok());
        match result.unwrap() {
            SkillOutputData::SubtaskPartial {
                subtask_id,
                progress_made,
                remaining_work,
                ..
            } => {
                assert_eq!(subtask_id, "MOB-177");
                assert_eq!(progress_made, vec!["Implemented core function"]);
                assert_eq!(remaining_work, vec!["Add unit tests"]);
            }
            other => panic!("Expected SubtaskPartial, got {:?}", other),
        }
    }
}
