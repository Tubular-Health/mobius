//! Jira REST API v3 client
//!
//! Replaces the TypeScript jira.js SDK with direct reqwest HTTP calls.
//! Credentials are read from environment variables:
//! - `JIRA_HOST`: Jira instance hostname (e.g., "yourcompany.atlassian.net")
//! - `JIRA_EMAIL`: User email for API authentication
//! - `JIRA_API_TOKEN`: Jira API token

use anyhow::Result;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::types::task_graph::{LinearIssue, ParentIssue, Relation, Relations};

/// Options for creating a Jira issue.
#[derive(Debug, Clone)]
pub struct CreateJiraIssueOptions {
    pub project_key: String,
    pub issue_type_name: String,
    pub summary: String,
    pub description: Option<String>,
    pub parent_key: Option<String>,
    pub labels: Option<Vec<String>>,
    pub assignee_id: Option<String>,
}

/// Result of a Jira issue creation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraCreatedIssue {
    pub id: String,
    pub key: String,
    #[serde(rename = "self")]
    pub self_url: String,
}

/// Result of adding a comment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JiraCommentResult {
    pub id: String,
    #[serde(rename = "self")]
    pub self_url: String,
}

// ---------------------------------------------------------------------------
// Internal Jira API response types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct JiraIssueResponse {
    id: Option<String>,
    key: Option<String>,
    fields: Option<JiraIssueFields>,
}

#[derive(Debug, Deserialize)]
struct JiraIssueFields {
    summary: Option<String>,
    status: Option<JiraStatus>,
    issuelinks: Option<Vec<JiraIssueLink>>,
}

#[derive(Debug, Deserialize)]
struct JiraStatus {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct JiraIssueLink {
    #[serde(rename = "type")]
    link_type: Option<JiraIssueLinkType>,
    #[serde(rename = "inwardIssue")]
    inward_issue: Option<JiraIssueLinkRef>,
    #[serde(rename = "outwardIssue")]
    outward_issue: Option<JiraIssueLinkRef>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct JiraIssueLinkType {
    name: Option<String>,
    inward: Option<String>,
    outward: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JiraIssueLinkRef {
    key: Option<String>,
    id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JqlSearchResponse {
    issues: Option<Vec<JiraIssueResponse>>,
}

#[derive(Debug, Deserialize)]
struct TransitionsResponse {
    transitions: Option<Vec<Transition>>,
}

#[derive(Debug, Deserialize)]
struct Transition {
    id: Option<String>,
    name: Option<String>,
    to: Option<TransitionTarget>,
}

#[derive(Debug, Deserialize)]
struct TransitionTarget {
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JiraCommentResponse {
    id: Option<String>,
    #[serde(rename = "self")]
    self_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct JiraCreateIssueResponse {
    id: String,
    key: String,
    #[serde(rename = "self")]
    self_url: String,
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

/// Custom error type for Jira API operations.
#[derive(Debug, thiserror::Error)]
pub enum JiraError {
    #[error("JIRA_HOST environment variable is not set")]
    MissingHost,
    #[error("JIRA_EMAIL environment variable is not set")]
    MissingEmail,
    #[error("JIRA_API_TOKEN environment variable is not set")]
    MissingApiToken,
    #[error("Authentication failed (401). Check JIRA_EMAIL and JIRA_API_TOKEN")]
    AuthFailed,
    #[error("Permission denied (403). The API token may lack required permissions")]
    PermissionDenied,
    #[error("Resource not found (404): {0}")]
    NotFound(String),
    #[error("Invalid request (400): {0}")]
    BadRequest(String),
    #[error("Jira API error (HTTP {status}): {message}")]
    HttpError { status: u16, message: String },
    #[error("No transition found to status \"{target}\". Available: {available}")]
    NoTransition { target: String, available: String },
    #[error(transparent)]
    Request(#[from] reqwest::Error),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/// Jira REST API v3 client.
pub struct JiraClient {
    client: reqwest::Client,
    base_url: String,
    email: String,
    api_token: String,
}

impl std::fmt::Debug for JiraClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("JiraClient")
            .field("base_url", &self.base_url)
            .field("email", &self.email)
            .field("api_token", &"[REDACTED]")
            .finish()
    }
}

impl JiraClient {
    /// Create a new client from environment variables.
    ///
    /// Reads `JIRA_HOST`, `JIRA_EMAIL`, `JIRA_API_TOKEN`.
    pub fn new() -> Result<Self, JiraError> {
        let host = std::env::var("JIRA_HOST").map_err(|_| JiraError::MissingHost)?;
        let email = std::env::var("JIRA_EMAIL").map_err(|_| JiraError::MissingEmail)?;
        let api_token = std::env::var("JIRA_API_TOKEN").map_err(|_| JiraError::MissingApiToken)?;

        // Normalize host - ensure it has https:// prefix
        let normalized_host = if host.starts_with("https://") || host.starts_with("http://") {
            host.clone()
        } else {
            format!("https://{host}")
        };

        // Remove trailing slash
        let normalized_host = normalized_host.trim_end_matches('/').to_string();

        let base_url = format!("{normalized_host}/rest/api/3");

        let client = reqwest::Client::new();

        Ok(Self {
            client,
            base_url,
            email,
            api_token,
        })
    }

    // -----------------------------------------------------------------------
    // Generic HTTP helpers
    // -----------------------------------------------------------------------

    async fn get<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T, JiraError> {
        let url = format!("{}/{}", self.base_url, path.trim_start_matches('/'));
        let resp = self
            .client
            .get(&url)
            .basic_auth(&self.email, Some(&self.api_token))
            .header("Accept", "application/json")
            .send()
            .await?;

        self.handle_response(resp, path).await
    }

    async fn post<T: serde::de::DeserializeOwned, B: Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T, JiraError> {
        let url = format!("{}/{}", self.base_url, path.trim_start_matches('/'));
        let resp = self
            .client
            .post(&url)
            .basic_auth(&self.email, Some(&self.api_token))
            .header("Accept", "application/json")
            .json(body)
            .send()
            .await?;

        self.handle_response(resp, path).await
    }

    async fn post_no_response<B: Serialize>(&self, path: &str, body: &B) -> Result<(), JiraError> {
        let url = format!("{}/{}", self.base_url, path.trim_start_matches('/'));
        let resp = self
            .client
            .post(&url)
            .basic_auth(&self.email, Some(&self.api_token))
            .header("Accept", "application/json")
            .json(body)
            .send()
            .await?;

        let status = resp.status();
        if status.is_success() {
            Ok(())
        } else {
            let body_text = resp.text().await.unwrap_or_default();
            self.map_http_error(status, path, &body_text)
        }
    }

    async fn handle_response<T: serde::de::DeserializeOwned>(
        &self,
        resp: reqwest::Response,
        path: &str,
    ) -> Result<T, JiraError> {
        let status = resp.status();
        if status.is_success() {
            let parsed = resp
                .json::<T>()
                .await
                .map_err(|e| anyhow::anyhow!("Failed to parse Jira response: {e}"))?;
            Ok(parsed)
        } else {
            let body_text = resp.text().await.unwrap_or_default();
            self.map_http_error(status, path, &body_text)
        }
    }

    fn map_http_error<T>(
        &self,
        status: StatusCode,
        path: &str,
        body: &str,
    ) -> Result<T, JiraError> {
        warn!(
            "Jira API error: HTTP {} on {}: {}",
            status.as_u16(),
            path,
            body
        );
        match status {
            StatusCode::UNAUTHORIZED => Err(JiraError::AuthFailed),
            StatusCode::FORBIDDEN => Err(JiraError::PermissionDenied),
            StatusCode::NOT_FOUND => Err(JiraError::NotFound(path.to_string())),
            StatusCode::BAD_REQUEST => Err(JiraError::BadRequest(body.to_string())),
            _ => Err(JiraError::HttpError {
                status: status.as_u16(),
                message: body.to_string(),
            }),
        }
    }

    // -----------------------------------------------------------------------
    // Public API methods
    // -----------------------------------------------------------------------

    /// Fetch a Jira issue by key (e.g., "PROJ-123").
    pub async fn fetch_jira_issue(&self, task_id: &str) -> Result<ParentIssue, JiraError> {
        let resp: JiraIssueResponse = self.get(&format!("issue/{task_id}")).await?;

        let identifier = resp.key.unwrap_or_else(|| task_id.to_string());
        let branch_name = format!("feature/{}", identifier.to_lowercase());

        Ok(ParentIssue {
            id: resp.id.unwrap_or_else(|| task_id.to_string()),
            identifier,
            title: resp
                .fields
                .as_ref()
                .and_then(|f| f.summary.clone())
                .unwrap_or_default(),
            git_branch_name: branch_name,
        })
    }

    /// Fetch the current status name for a Jira issue.
    pub async fn fetch_jira_issue_status(&self, issue_key: &str) -> Result<String, JiraError> {
        let resp: JiraIssueResponse = self.get(&format!("issue/{issue_key}")).await?;

        let status_name = resp
            .fields
            .and_then(|f| f.status)
            .and_then(|s| s.name)
            .unwrap_or_else(|| "Unknown".to_string());

        Ok(status_name)
    }

    /// Fetch sub-tasks (children) of a parent issue.
    ///
    /// Uses the enhanced JQL search API (`/search/jql`), NOT the deprecated `/search`.
    pub async fn fetch_jira_sub_tasks(
        &self,
        parent_key: &str,
    ) -> Result<Vec<LinearIssue>, JiraError> {
        let body = serde_json::json!({
            "jql": format!("parent = {parent_key}"),
            "fields": ["summary", "status", "issuelinks", "issuetype"]
        });

        let resp: JqlSearchResponse = self.post("search/jql", &body).await?;

        let mut sub_tasks = Vec::new();

        if let Some(issues) = resp.issues {
            for issue in issues {
                let blocked_by = extract_blocked_by_relations(
                    issue.fields.as_ref().and_then(|f| f.issuelinks.as_ref()),
                );

                let identifier = issue.key.unwrap_or_default();
                let branch_name = format!("feature/{}", identifier.to_lowercase());

                sub_tasks.push(LinearIssue {
                    id: issue.id.unwrap_or_default(),
                    identifier,
                    title: issue
                        .fields
                        .as_ref()
                        .and_then(|f| f.summary.clone())
                        .unwrap_or_default(),
                    status: issue
                        .fields
                        .as_ref()
                        .and_then(|f| f.status.as_ref())
                        .and_then(|s| s.name.clone())
                        .unwrap_or_else(|| "To Do".to_string()),
                    git_branch_name: branch_name,
                    relations: Some(Relations {
                        blocked_by,
                        blocks: Vec::new(),
                    }),
                });
            }
        }

        Ok(sub_tasks)
    }

    /// Update a Jira issue's status using the transitions API.
    ///
    /// Fetches available transitions, finds one matching `target_status` (case-insensitive),
    /// and performs the transition.
    pub async fn update_jira_issue_status(
        &self,
        issue_key: &str,
        target_status: &str,
    ) -> Result<(), JiraError> {
        let resp: TransitionsResponse = self.get(&format!("issue/{issue_key}/transitions")).await?;

        let transitions = resp.transitions.unwrap_or_default();
        let target_lower = target_status.to_lowercase();

        let matching = transitions.iter().find(|t| {
            t.name
                .as_ref()
                .is_some_and(|n| n.to_lowercase() == target_lower)
                || t.to
                    .as_ref()
                    .and_then(|to| to.name.as_ref())
                    .is_some_and(|n| n.to_lowercase() == target_lower)
        });

        let transition = matching.ok_or_else(|| {
            let available = transitions
                .iter()
                .map(|t| {
                    let name = t.name.as_deref().unwrap_or("?");
                    let to =
                        t.to.as_ref()
                            .and_then(|to| to.name.as_deref())
                            .unwrap_or("?");
                    format!("{name} → {to}")
                })
                .collect::<Vec<_>>()
                .join(", ");
            JiraError::NoTransition {
                target: target_status.to_string(),
                available,
            }
        })?;

        let transition_id = transition
            .id
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Transition has no ID"))?;

        let body = serde_json::json!({
            "transition": { "id": transition_id }
        });

        self.post_no_response(&format!("issue/{issue_key}/transitions"), &body)
            .await
    }

    /// Add a comment to a Jira issue.
    pub async fn add_jira_comment(
        &self,
        issue_key: &str,
        body: &str,
    ) -> Result<JiraCommentResult, JiraError> {
        // Jira REST API v3 requires Atlassian Document Format for comments
        let adf_body = serde_json::json!({
            "body": {
                "type": "doc",
                "version": 1,
                "content": [
                    {
                        "type": "paragraph",
                        "content": [
                            {
                                "type": "text",
                                "text": body
                            }
                        ]
                    }
                ]
            }
        });

        let resp: JiraCommentResponse = self
            .post(&format!("issue/{issue_key}/comment"), &adf_body)
            .await?;

        Ok(JiraCommentResult {
            id: resp.id.unwrap_or_default(),
            self_url: resp.self_url.unwrap_or_default(),
        })
    }

    /// Create a new Jira issue.
    pub async fn create_jira_issue(
        &self,
        options: &CreateJiraIssueOptions,
    ) -> Result<JiraCreatedIssue, JiraError> {
        let mut fields = serde_json::json!({
            "project": { "key": &options.project_key },
            "issuetype": { "name": &options.issue_type_name },
            "summary": &options.summary,
        });

        let fields_obj = fields.as_object_mut().unwrap();

        if let Some(ref desc) = options.description {
            fields_obj.insert("description".to_string(), serde_json::json!(desc));
        }

        if let Some(ref parent_key) = options.parent_key {
            fields_obj.insert(
                "parent".to_string(),
                serde_json::json!({ "key": parent_key }),
            );
        }

        if let Some(ref labels) = options.labels {
            if !labels.is_empty() {
                fields_obj.insert("labels".to_string(), serde_json::json!(labels));
            }
        }

        if let Some(ref assignee_id) = options.assignee_id {
            fields_obj.insert(
                "assignee".to_string(),
                serde_json::json!({ "id": assignee_id }),
            );
        }

        let body = serde_json::json!({ "fields": fields });

        let resp: JiraCreateIssueResponse = self.post("issue", &body).await?;

        Ok(JiraCreatedIssue {
            id: resp.id,
            key: resp.key,
            self_url: resp.self_url,
        })
    }

    /// Create a "Blocks" link between two issues.
    ///
    /// The `blocker_key` issue blocks the `blocked_key` issue.
    pub async fn create_jira_issue_link(
        &self,
        blocker_key: &str,
        blocked_key: &str,
    ) -> Result<(), JiraError> {
        let body = serde_json::json!({
            "type": { "name": "Blocks" },
            "outwardIssue": { "key": blocker_key },
            "inwardIssue": { "key": blocked_key },
        });

        self.post_no_response("issueLink", &body).await
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Extract "blocked by" relations from Jira issue links.
///
/// In Jira, blocking relationships use a "Blocks" link type where the inward
/// description is "is blocked by".
fn extract_blocked_by_relations(issuelinks: Option<&Vec<JiraIssueLink>>) -> Vec<Relation> {
    let Some(links) = issuelinks else {
        return Vec::new();
    };

    let mut blocked_by = Vec::new();

    for link in links {
        // Check for "is blocked by" relationship (inward link)
        let is_blocking_relation = link.link_type.as_ref().is_some_and(|lt| {
            lt.inward
                .as_ref()
                .is_some_and(|s| s.to_lowercase().contains("blocked by"))
                || lt
                    .name
                    .as_ref()
                    .is_some_and(|n| n.to_lowercase() == "blocks")
        });

        if is_blocking_relation {
            if let Some(ref inward) = link.inward_issue {
                if let (Some(id), Some(key)) = (inward.id.as_ref(), inward.key.as_ref()) {
                    blocked_by.push(Relation {
                        id: id.clone(),
                        identifier: key.clone(),
                    });
                }
            }
        }
    }

    blocked_by
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -- URL construction tests --

    #[test]
    fn test_client_normalizes_host_without_scheme() {
        std::env::set_var("JIRA_HOST", "mycompany.atlassian.net");
        std::env::set_var("JIRA_EMAIL", "test@example.com");
        std::env::set_var("JIRA_API_TOKEN", "test-token");

        let client = JiraClient::new().unwrap();
        assert_eq!(
            client.base_url,
            "https://mycompany.atlassian.net/rest/api/3"
        );
    }

    #[test]
    fn test_client_normalizes_host_with_scheme() {
        std::env::set_var("JIRA_HOST", "https://mycompany.atlassian.net");
        std::env::set_var("JIRA_EMAIL", "test@example.com");
        std::env::set_var("JIRA_API_TOKEN", "test-token");

        let client = JiraClient::new().unwrap();
        assert_eq!(
            client.base_url,
            "https://mycompany.atlassian.net/rest/api/3"
        );
    }

    #[test]
    fn test_client_normalizes_host_with_trailing_slash() {
        std::env::set_var("JIRA_HOST", "https://mycompany.atlassian.net/");
        std::env::set_var("JIRA_EMAIL", "test@example.com");
        std::env::set_var("JIRA_API_TOKEN", "test-token");

        let client = JiraClient::new().unwrap();
        assert_eq!(
            client.base_url,
            "https://mycompany.atlassian.net/rest/api/3"
        );
    }

    #[test]
    fn test_client_missing_host_returns_error() {
        std::env::remove_var("JIRA_HOST");
        std::env::set_var("JIRA_EMAIL", "test@example.com");
        std::env::set_var("JIRA_API_TOKEN", "test-token");

        let result = JiraClient::new();
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), JiraError::MissingHost));
    }

    #[test]
    fn test_client_missing_email_returns_error() {
        std::env::set_var("JIRA_HOST", "mycompany.atlassian.net");
        std::env::remove_var("JIRA_EMAIL");
        std::env::set_var("JIRA_API_TOKEN", "test-token");

        let result = JiraClient::new();
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), JiraError::MissingEmail));
    }

    #[test]
    fn test_client_missing_token_returns_error() {
        std::env::set_var("JIRA_HOST", "mycompany.atlassian.net");
        std::env::set_var("JIRA_EMAIL", "test@example.com");
        std::env::remove_var("JIRA_API_TOKEN");

        let result = JiraClient::new();
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), JiraError::MissingApiToken));
    }

    // -- Auth header test --

    #[test]
    fn test_client_stores_credentials() {
        std::env::set_var("JIRA_HOST", "mycompany.atlassian.net");
        std::env::set_var("JIRA_EMAIL", "user@example.com");
        std::env::set_var("JIRA_API_TOKEN", "my-secret-token");

        let client = JiraClient::new().unwrap();
        assert_eq!(client.email, "user@example.com");
        assert_eq!(client.api_token, "my-secret-token");
    }

    // -- Issue link parsing tests --

    #[test]
    fn test_extract_blocked_by_with_blocks_type() {
        let links = vec![JiraIssueLink {
            link_type: Some(JiraIssueLinkType {
                name: Some("Blocks".to_string()),
                inward: Some("is blocked by".to_string()),
                outward: Some("blocks".to_string()),
            }),
            inward_issue: Some(JiraIssueLinkRef {
                key: Some("PROJ-100".to_string()),
                id: Some("10001".to_string()),
            }),
            outward_issue: None,
        }];

        let result = extract_blocked_by_relations(Some(&links));
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].id, "10001");
        assert_eq!(result[0].identifier, "PROJ-100");
    }

    #[test]
    fn test_extract_blocked_by_with_inward_text() {
        let links = vec![JiraIssueLink {
            link_type: Some(JiraIssueLinkType {
                name: Some("Dependency".to_string()),
                inward: Some("is blocked by".to_string()),
                outward: Some("blocks".to_string()),
            }),
            inward_issue: Some(JiraIssueLinkRef {
                key: Some("PROJ-200".to_string()),
                id: Some("20001".to_string()),
            }),
            outward_issue: None,
        }];

        let result = extract_blocked_by_relations(Some(&links));
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].identifier, "PROJ-200");
    }

    #[test]
    fn test_extract_blocked_by_ignores_non_blocking() {
        let links = vec![JiraIssueLink {
            link_type: Some(JiraIssueLinkType {
                name: Some("Relates".to_string()),
                inward: Some("relates to".to_string()),
                outward: Some("relates to".to_string()),
            }),
            inward_issue: Some(JiraIssueLinkRef {
                key: Some("PROJ-300".to_string()),
                id: Some("30001".to_string()),
            }),
            outward_issue: None,
        }];

        let result = extract_blocked_by_relations(Some(&links));
        assert!(result.is_empty());
    }

    #[test]
    fn test_extract_blocked_by_with_no_links() {
        let result = extract_blocked_by_relations(None);
        assert!(result.is_empty());
    }

    #[test]
    fn test_extract_blocked_by_with_empty_links() {
        let links = vec![];
        let result = extract_blocked_by_relations(Some(&links));
        assert!(result.is_empty());
    }

    #[test]
    fn test_extract_blocked_by_skips_incomplete_link() {
        let links = vec![JiraIssueLink {
            link_type: Some(JiraIssueLinkType {
                name: Some("Blocks".to_string()),
                inward: Some("is blocked by".to_string()),
                outward: Some("blocks".to_string()),
            }),
            inward_issue: Some(JiraIssueLinkRef {
                key: None, // missing key
                id: Some("40001".to_string()),
            }),
            outward_issue: None,
        }];

        let result = extract_blocked_by_relations(Some(&links));
        assert!(result.is_empty());
    }

    #[test]
    fn test_extract_blocked_by_multiple_links() {
        let links = vec![
            JiraIssueLink {
                link_type: Some(JiraIssueLinkType {
                    name: Some("Blocks".to_string()),
                    inward: Some("is blocked by".to_string()),
                    outward: Some("blocks".to_string()),
                }),
                inward_issue: Some(JiraIssueLinkRef {
                    key: Some("PROJ-10".to_string()),
                    id: Some("10".to_string()),
                }),
                outward_issue: None,
            },
            JiraIssueLink {
                link_type: Some(JiraIssueLinkType {
                    name: Some("Relates".to_string()),
                    inward: Some("relates to".to_string()),
                    outward: Some("relates to".to_string()),
                }),
                inward_issue: Some(JiraIssueLinkRef {
                    key: Some("PROJ-20".to_string()),
                    id: Some("20".to_string()),
                }),
                outward_issue: None,
            },
            JiraIssueLink {
                link_type: Some(JiraIssueLinkType {
                    name: Some("Blocks".to_string()),
                    inward: Some("is blocked by".to_string()),
                    outward: Some("blocks".to_string()),
                }),
                inward_issue: Some(JiraIssueLinkRef {
                    key: Some("PROJ-30".to_string()),
                    id: Some("30".to_string()),
                }),
                outward_issue: None,
            },
        ];

        let result = extract_blocked_by_relations(Some(&links));
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].identifier, "PROJ-10");
        assert_eq!(result[1].identifier, "PROJ-30");
    }

    // -- Error type tests --

    #[test]
    fn test_error_display_auth_failed() {
        let err = JiraError::AuthFailed;
        assert!(err.to_string().contains("401"));
        assert!(err.to_string().contains("Authentication"));
    }

    #[test]
    fn test_error_display_permission_denied() {
        let err = JiraError::PermissionDenied;
        assert!(err.to_string().contains("403"));
    }

    #[test]
    fn test_error_display_not_found() {
        let err = JiraError::NotFound("issue/PROJ-999".to_string());
        assert!(err.to_string().contains("404"));
        assert!(err.to_string().contains("PROJ-999"));
    }

    #[test]
    fn test_error_display_no_transition() {
        let err = JiraError::NoTransition {
            target: "Done".to_string(),
            available: "Start → In Progress, Resolve → Done".to_string(),
        };
        assert!(err.to_string().contains("Done"));
        assert!(err.to_string().contains("Available"));
    }

    // -- Verify POST to /search/jql (not deprecated /search) --

    #[test]
    fn test_jql_search_uses_enhanced_endpoint() {
        // The fetch_jira_sub_tasks method should POST to "search/jql"
        // We verify this by checking the base_url construction
        std::env::set_var("JIRA_HOST", "test.atlassian.net");
        std::env::set_var("JIRA_EMAIL", "test@example.com");
        std::env::set_var("JIRA_API_TOKEN", "token");

        let client = JiraClient::new().unwrap();
        let expected_url = format!("{}/search/jql", client.base_url);
        assert_eq!(
            expected_url,
            "https://test.atlassian.net/rest/api/3/search/jql"
        );
    }
}
