//! Linear GraphQL API client
//!
//! Provides a Rust client for the Linear GraphQL API, mirroring the
//! TypeScript implementation in `src/lib/linear.ts`.
//!
//! Credentials are read from environment variables:
//! - `LINEAR_API_KEY` (fallback `LINEAR_API_TOKEN`): API key for authentication

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::types::task_graph::{LinearIssue, ParentIssue, Relation, Relations};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LINEAR_API_URL: &str = "https://api.linear.app/graphql";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/// Custom error type for Linear API operations.
#[derive(Debug, thiserror::Error)]
pub enum LinearError {
    #[error("LINEAR_API_KEY (or LINEAR_API_TOKEN) environment variable is not set")]
    MissingApiKey,
    #[error("Authentication failed (401). Check LINEAR_API_KEY")]
    AuthFailed,
    #[error("Permission denied (403). The API key may lack required permissions")]
    PermissionDenied,
    #[error("HTTP error ({status}): {message}")]
    HttpError { status: u16, message: String },
    #[error("GraphQL error: {0}")]
    GraphQL(String),
    #[error("No workflow state found matching \"{0}\"")]
    StatusNotFound(String),
    #[error(transparent)]
    Request(#[from] reqwest::Error),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

// ---------------------------------------------------------------------------
// GraphQL response envelope
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct GraphQLResponse<T> {
    data: Option<T>,
    errors: Option<Vec<GraphQLError>>,
}

#[derive(Debug, Deserialize)]
struct GraphQLError {
    message: String,
}

// ---------------------------------------------------------------------------
// Response types for specific queries
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct IssueData {
    issue: Option<IssueNode>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueNode {
    id: String,
    identifier: String,
    title: String,
    branch_name: Option<String>,
    state: Option<StateNode>,
    team: Option<TeamRef>,
    inverse_relations: Option<InverseRelationsConnection>,
}

#[derive(Debug, Deserialize)]
struct StateNode {
    id: Option<String>,
    name: String,
}

#[derive(Debug, Deserialize)]
struct TeamRef {
    id: String,
}

#[derive(Debug, Deserialize)]
struct InverseRelationsConnection {
    nodes: Vec<InverseRelationNode>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InverseRelationNode {
    #[serde(rename = "type")]
    relation_type: String,
    issue: RelatedIssueRef,
}

#[derive(Debug, Deserialize)]
struct RelatedIssueRef {
    id: String,
    identifier: String,
}

// -- Sub-task query responses --

#[derive(Debug, Deserialize)]
struct IssuesData {
    issues: IssuesConnection,
}

#[derive(Debug, Deserialize)]
struct IssuesConnection {
    nodes: Vec<IssueNode>,
}

// -- Team workflow states --

#[derive(Debug, Deserialize)]
struct TeamData {
    team: TeamNode,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TeamNode {
    states: StatesConnection,
}

#[derive(Debug, Deserialize)]
struct StatesConnection {
    nodes: Vec<StateNode>,
}

// -- Mutation responses --

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueUpdateData {
    issue_update: Option<IssueUpdatePayload>,
}

#[derive(Debug, Deserialize)]
struct IssueUpdatePayload {
    success: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommentCreateData {
    comment_create: Option<CommentCreatePayload>,
}

#[derive(Debug, Deserialize)]
struct CommentCreatePayload {
    success: bool,
    comment: Option<CommentNode>,
}

#[derive(Debug, Deserialize)]
struct CommentNode {
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueCreateData {
    issue_create: Option<IssueCreatePayload>,
}

#[derive(Debug, Deserialize)]
struct IssueCreatePayload {
    success: bool,
    issue: Option<CreatedIssueNode>,
}

#[derive(Debug, Deserialize)]
struct CreatedIssueNode {
    id: String,
    identifier: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct IssueRelationCreateData {
    issue_relation_create: Option<IssueRelationCreatePayload>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct IssueRelationCreatePayload {
    success: bool,
}

// ---------------------------------------------------------------------------
// Public input / output types
// ---------------------------------------------------------------------------

/// Options for creating a Linear issue.
#[derive(Debug, Clone, Serialize)]
pub struct CreateLinearIssueInput {
    pub team_id: String,
    pub title: String,
    pub description: Option<String>,
    pub parent_id: Option<String>,
    pub blocked_by: Vec<String>,
    pub labels: Vec<String>,
    pub priority: Option<i32>,
}

/// Result of a Linear issue creation.
#[derive(Debug, Clone)]
pub struct CreatedIssue {
    pub id: String,
    pub identifier: String,
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/// Linear GraphQL API client.
pub struct LinearClient {
    client: reqwest::Client,
    api_key: String,
}

impl std::fmt::Debug for LinearClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LinearClient")
            .field("api_key", &"[REDACTED]")
            .finish()
    }
}

impl LinearClient {
    /// Create a new client from environment variables.
    ///
    /// Reads `LINEAR_API_KEY` with fallback to `LINEAR_API_TOKEN`.
    pub fn new() -> Result<Self, LinearError> {
        let api_key = std::env::var("LINEAR_API_KEY")
            .or_else(|_| std::env::var("LINEAR_API_TOKEN"))
            .map_err(|_| LinearError::MissingApiKey)?;

        Ok(Self {
            client: reqwest::Client::new(),
            api_key,
        })
    }

    // -----------------------------------------------------------------------
    // Generic GraphQL helper
    // -----------------------------------------------------------------------

    async fn graphql<T: serde::de::DeserializeOwned>(
        &self,
        query: &str,
        variables: serde_json::Value,
    ) -> Result<T, LinearError> {
        let body = serde_json::json!({
            "query": query,
            "variables": variables,
        });

        let resp = self
            .client
            .post(LINEAR_API_URL)
            .header("Authorization", &self.api_key)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;

        let status = resp.status();
        if status == reqwest::StatusCode::UNAUTHORIZED {
            return Err(LinearError::AuthFailed);
        }
        if status == reqwest::StatusCode::FORBIDDEN {
            return Err(LinearError::PermissionDenied);
        }
        if !status.is_success() {
            let body_text = resp.text().await.unwrap_or_default();
            warn!("Linear API error: HTTP {} : {}", status.as_u16(), body_text);
            return Err(LinearError::HttpError {
                status: status.as_u16(),
                message: body_text,
            });
        }

        let gql_resp: GraphQLResponse<T> = resp
            .json()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to parse Linear response: {e}"))?;

        if let Some(errors) = gql_resp.errors {
            if !errors.is_empty() {
                let msg = errors
                    .iter()
                    .map(|e| e.message.as_str())
                    .collect::<Vec<_>>()
                    .join("; ");
                return Err(LinearError::GraphQL(msg));
            }
        }

        gql_resp
            .data
            .ok_or_else(|| LinearError::GraphQL("No data in response".to_string()))
    }

    // -----------------------------------------------------------------------
    // Public API methods
    // -----------------------------------------------------------------------

    /// Fetch a Linear issue by identifier (e.g., "TUB-293").
    pub async fn fetch_linear_issue(&self, identifier: &str) -> Result<ParentIssue, LinearError> {
        let query = r#"
            query GetIssue($id: String!) {
                issue(id: $id) {
                    id
                    identifier
                    title
                    branchName
                }
            }
        "#;

        let data: IssueData = self
            .graphql(query, serde_json::json!({ "id": identifier }))
            .await?;

        let issue = data
            .issue
            .ok_or_else(|| LinearError::GraphQL(format!("Issue {} not found", identifier)))?;

        let branch_name = issue
            .branch_name
            .filter(|b| !b.is_empty())
            .unwrap_or_else(|| format!("feat/{}", identifier.to_lowercase()));

        Ok(ParentIssue {
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title,
            git_branch_name: branch_name,
        })
    }

    /// Fetch sub-tasks (children) of a parent issue.
    pub async fn fetch_linear_sub_tasks(
        &self,
        parent_id: &str,
    ) -> Result<Vec<LinearIssue>, LinearError> {
        let query = r#"
            query GetSubTasks($parentId: ID!) {
                issues(filter: { parent: { id: { eq: $parentId } } }) {
                    nodes {
                        id
                        identifier
                        title
                        branchName
                        state { name }
                        inverseRelations {
                            nodes {
                                type
                                issue { id identifier }
                            }
                        }
                    }
                }
            }
        "#;

        let data: IssuesData = self
            .graphql(query, serde_json::json!({ "parentId": parent_id }))
            .await?;

        let issues = data
            .issues
            .nodes
            .into_iter()
            .map(|node| {
                let status = node
                    .state
                    .as_ref()
                    .map(|s| s.name.clone())
                    .unwrap_or_else(|| "Backlog".to_string());

                let branch_name = node
                    .branch_name
                    .filter(|b| !b.is_empty())
                    .unwrap_or_else(|| format!("feat/{}", node.identifier.to_lowercase()));

                let blocked_by: Vec<Relation> = node
                    .inverse_relations
                    .as_ref()
                    .map(|ir| {
                        ir.nodes
                            .iter()
                            .filter(|r| r.relation_type == "blocks")
                            .map(|r| Relation {
                                id: r.issue.id.clone(),
                                identifier: r.issue.identifier.clone(),
                            })
                            .collect()
                    })
                    .unwrap_or_default();

                LinearIssue {
                    id: node.id,
                    identifier: node.identifier,
                    title: node.title,
                    status,
                    git_branch_name: branch_name,
                    relations: Some(Relations {
                        blocked_by,
                        blocks: Vec::new(),
                    }),
                }
            })
            .collect();

        Ok(issues)
    }

    /// Fetch the current status name for a Linear issue.
    pub async fn fetch_linear_issue_status(&self, identifier: &str) -> Result<String, LinearError> {
        let query = r#"
            query GetIssueStatus($id: String!) {
                issue(id: $id) {
                    state { name }
                }
            }
        "#;

        let data: IssueData = self
            .graphql(query, serde_json::json!({ "id": identifier }))
            .await?;

        let issue = data
            .issue
            .ok_or_else(|| LinearError::GraphQL(format!("Issue {} not found", identifier)))?;

        Ok(issue
            .state
            .map(|s| s.name)
            .unwrap_or_else(|| "Unknown".to_string()))
    }

    /// Update a Linear issue's workflow status.
    ///
    /// Two-step process: fetch the issue's team workflow states, find the
    /// matching state (case-insensitive), then mutate.
    pub async fn update_linear_issue_status(
        &self,
        issue_id: &str,
        new_status: &str,
    ) -> Result<(), LinearError> {
        // Step 1: fetch the issue to get its team ID
        let issue_query = r#"
            query GetIssueTeam($id: String!) {
                issue(id: $id) {
                    id
                    identifier
                    title
                    team { id }
                }
            }
        "#;

        let issue_data: IssueData = self
            .graphql(issue_query, serde_json::json!({ "id": issue_id }))
            .await?;

        let issue = issue_data
            .issue
            .ok_or_else(|| LinearError::GraphQL(format!("Issue {} not found", issue_id)))?;

        let team_id = issue
            .team
            .ok_or_else(|| LinearError::GraphQL("Issue has no team".to_string()))?
            .id;

        // Step 2: fetch workflow states for the team
        let states_query = r#"
            query GetTeamStates($teamId: String!) {
                team(id: $teamId) {
                    states {
                        nodes { id name }
                    }
                }
            }
        "#;

        let team_data: TeamData = self
            .graphql(states_query, serde_json::json!({ "teamId": team_id }))
            .await?;

        let target_lower = new_status.to_lowercase();
        let target_state = team_data
            .team
            .states
            .nodes
            .iter()
            .find(|s| s.name.to_lowercase() == target_lower);

        let state_id = match target_state {
            Some(s) => {
                s.id.as_ref()
                    .ok_or_else(|| LinearError::StatusNotFound(new_status.to_string()))?
            }
            None => return Err(LinearError::StatusNotFound(new_status.to_string())),
        };

        // Step 3: update the issue
        let mutation = r#"
            mutation UpdateIssueStatus($id: String!, $stateId: String!) {
                issueUpdate(id: $id, input: { stateId: $stateId }) {
                    success
                }
            }
        "#;

        let update_data: IssueUpdateData = self
            .graphql(
                mutation,
                serde_json::json!({ "id": issue_id, "stateId": state_id }),
            )
            .await?;

        match update_data.issue_update {
            Some(payload) if payload.success => Ok(()),
            _ => Err(LinearError::GraphQL(
                "issueUpdate mutation returned success=false".to_string(),
            )),
        }
    }

    /// Add a comment to a Linear issue.
    pub async fn add_linear_comment(
        &self,
        issue_id: &str,
        body: &str,
    ) -> Result<String, LinearError> {
        let mutation = r#"
            mutation AddComment($issueId: String!, $body: String!) {
                commentCreate(input: { issueId: $issueId, body: $body }) {
                    success
                    comment { id }
                }
            }
        "#;

        let data: CommentCreateData = self
            .graphql(
                mutation,
                serde_json::json!({ "issueId": issue_id, "body": body }),
            )
            .await?;

        match data.comment_create {
            Some(payload) if payload.success => {
                let comment_id = payload
                    .comment
                    .map(|c| c.id)
                    .unwrap_or_else(|| "unknown".to_string());
                Ok(comment_id)
            }
            _ => Err(LinearError::GraphQL(
                "commentCreate mutation returned success=false".to_string(),
            )),
        }
    }

    /// Create a new Linear issue.
    pub async fn create_linear_issue(
        &self,
        input: &CreateLinearIssueInput,
    ) -> Result<CreatedIssue, LinearError> {
        let mut issue_input = serde_json::json!({
            "teamId": input.team_id,
            "title": input.title,
        });

        let obj = issue_input.as_object_mut().unwrap();
        if let Some(ref desc) = input.description {
            obj.insert("description".to_string(), serde_json::json!(desc));
        }
        if let Some(ref parent_id) = input.parent_id {
            obj.insert("parentId".to_string(), serde_json::json!(parent_id));
        }
        if let Some(priority) = input.priority {
            obj.insert("priority".to_string(), serde_json::json!(priority));
        }
        if !input.labels.is_empty() {
            obj.insert("labelIds".to_string(), serde_json::json!(input.labels));
        }

        let mutation = r#"
            mutation CreateIssue($input: IssueCreateInput!) {
                issueCreate(input: $input) {
                    success
                    issue { id identifier }
                }
            }
        "#;

        let data: IssueCreateData = self
            .graphql(mutation, serde_json::json!({ "input": issue_input }))
            .await?;

        let payload = data
            .issue_create
            .ok_or_else(|| LinearError::GraphQL("No issueCreate payload".to_string()))?;

        if !payload.success {
            return Err(LinearError::GraphQL(
                "issueCreate mutation returned success=false".to_string(),
            ));
        }

        let created = payload
            .issue
            .ok_or_else(|| LinearError::GraphQL("No issue in create response".to_string()))?;

        // Create blocking relations
        for blocker_id in &input.blocked_by {
            let rel_mutation = r#"
                mutation CreateRelation($issueId: String!, $relatedIssueId: String!, $type: IssueRelationType!) {
                    issueRelationCreate(input: { issueId: $issueId, relatedIssueId: $relatedIssueId, type: $type }) {
                        success
                    }
                }
            "#;

            let _: IssueRelationCreateData = self
                .graphql(
                    rel_mutation,
                    serde_json::json!({
                        "issueId": blocker_id,
                        "relatedIssueId": created.id,
                        "type": "blocks",
                    }),
                )
                .await?;
        }

        Ok(CreatedIssue {
            id: created.id,
            identifier: created.identifier,
        })
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -- Client construction tests --

    #[test]
    fn test_client_missing_api_key_returns_error() {
        std::env::remove_var("LINEAR_API_KEY");
        std::env::remove_var("LINEAR_API_TOKEN");

        let result = LinearClient::new();
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), LinearError::MissingApiKey));
    }

    #[test]
    fn test_client_reads_linear_api_key() {
        std::env::set_var("LINEAR_API_KEY", "lin_api_test123");
        std::env::remove_var("LINEAR_API_TOKEN");

        let client = LinearClient::new().unwrap();
        assert_eq!(client.api_key, "lin_api_test123");

        std::env::remove_var("LINEAR_API_KEY");
    }

    #[test]
    fn test_client_falls_back_to_linear_api_token() {
        std::env::remove_var("LINEAR_API_KEY");
        std::env::set_var("LINEAR_API_TOKEN", "lin_token_fallback");

        let client = LinearClient::new().unwrap();
        assert_eq!(client.api_key, "lin_token_fallback");

        std::env::remove_var("LINEAR_API_TOKEN");
    }

    #[test]
    fn test_client_prefers_api_key_over_token() {
        std::env::set_var("LINEAR_API_KEY", "primary");
        std::env::set_var("LINEAR_API_TOKEN", "secondary");

        let client = LinearClient::new().unwrap();
        assert_eq!(client.api_key, "primary");

        std::env::remove_var("LINEAR_API_KEY");
        std::env::remove_var("LINEAR_API_TOKEN");
    }

    // -- Response type parsing tests --

    #[test]
    fn test_parse_issue_response() {
        let json = serde_json::json!({
            "data": {
                "issue": {
                    "id": "abc-123",
                    "identifier": "TUB-293",
                    "title": "Implement feature X",
                    "branchName": "feat/tub-293-implement-feature-x",
                    "state": null,
                    "team": null,
                    "inverseRelations": null
                }
            }
        });

        let resp: GraphQLResponse<IssueData> = serde_json::from_value(json).unwrap();
        let issue = resp.data.unwrap().issue.unwrap();
        assert_eq!(issue.id, "abc-123");
        assert_eq!(issue.identifier, "TUB-293");
        assert_eq!(issue.title, "Implement feature X");
        assert_eq!(
            issue.branch_name.unwrap(),
            "feat/tub-293-implement-feature-x"
        );
    }

    #[test]
    fn test_parse_issues_response_with_relations() {
        let json = serde_json::json!({
            "data": {
                "issues": {
                    "nodes": [
                        {
                            "id": "task-1",
                            "identifier": "TUB-294",
                            "title": "Sub-task A",
                            "branchName": "feat/tub-294",
                            "state": { "name": "In Progress" },
                            "team": null,
                            "inverseRelations": {
                                "nodes": [
                                    {
                                        "type": "blocks",
                                        "issue": { "id": "task-0", "identifier": "TUB-293" }
                                    },
                                    {
                                        "type": "relates",
                                        "issue": { "id": "task-9", "identifier": "TUB-300" }
                                    }
                                ]
                            }
                        },
                        {
                            "id": "task-2",
                            "identifier": "TUB-295",
                            "title": "Sub-task B",
                            "branchName": null,
                            "state": { "name": "Backlog" },
                            "team": null,
                            "inverseRelations": { "nodes": [] }
                        }
                    ]
                }
            }
        });

        let resp: GraphQLResponse<IssuesData> = serde_json::from_value(json).unwrap();
        let nodes = resp.data.unwrap().issues.nodes;
        assert_eq!(nodes.len(), 2);

        // First node: has one "blocks" relation and one "relates" relation
        let first = &nodes[0];
        assert_eq!(first.identifier, "TUB-294");
        let inv = first.inverse_relations.as_ref().unwrap();
        let blocks: Vec<_> = inv
            .nodes
            .iter()
            .filter(|r| r.relation_type == "blocks")
            .collect();
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].issue.identifier, "TUB-293");

        // Second node: no relations
        let second = &nodes[1];
        assert_eq!(second.identifier, "TUB-295");
        assert!(second.branch_name.is_none());
    }

    #[test]
    fn test_parse_team_states_response() {
        let json = serde_json::json!({
            "data": {
                "team": {
                    "states": {
                        "nodes": [
                            { "id": "state-1", "name": "Backlog" },
                            { "id": "state-2", "name": "In Progress" },
                            { "id": "state-3", "name": "Done" }
                        ]
                    }
                }
            }
        });

        let resp: GraphQLResponse<TeamData> = serde_json::from_value(json).unwrap();
        let states = resp.data.unwrap().team.states.nodes;
        assert_eq!(states.len(), 3);
        assert_eq!(states[0].name, "Backlog");
        assert_eq!(states[2].name, "Done");
    }

    #[test]
    fn test_parse_comment_create_response() {
        let json = serde_json::json!({
            "data": {
                "commentCreate": {
                    "success": true,
                    "comment": { "id": "comment-abc" }
                }
            }
        });

        let resp: GraphQLResponse<CommentCreateData> = serde_json::from_value(json).unwrap();
        let payload = resp.data.unwrap().comment_create.unwrap();
        assert!(payload.success);
        assert_eq!(payload.comment.unwrap().id, "comment-abc");
    }

    #[test]
    fn test_parse_issue_create_response() {
        let json = serde_json::json!({
            "data": {
                "issueCreate": {
                    "success": true,
                    "issue": { "id": "new-id", "identifier": "TUB-500" }
                }
            }
        });

        let resp: GraphQLResponse<IssueCreateData> = serde_json::from_value(json).unwrap();
        let payload = resp.data.unwrap().issue_create.unwrap();
        assert!(payload.success);
        let issue = payload.issue.unwrap();
        assert_eq!(issue.id, "new-id");
        assert_eq!(issue.identifier, "TUB-500");
    }

    #[test]
    fn test_parse_issue_update_response() {
        let json = serde_json::json!({
            "data": {
                "issueUpdate": {
                    "success": true
                }
            }
        });

        let resp: GraphQLResponse<IssueUpdateData> = serde_json::from_value(json).unwrap();
        let payload = resp.data.unwrap().issue_update.unwrap();
        assert!(payload.success);
    }

    #[test]
    fn test_parse_graphql_error_response() {
        let json = serde_json::json!({
            "data": null,
            "errors": [
                { "message": "Entity not found" },
                { "message": "Another error" }
            ]
        });

        let resp: GraphQLResponse<IssueData> = serde_json::from_value(json).unwrap();
        assert!(resp.data.is_none());
        let errors = resp.errors.unwrap();
        assert_eq!(errors.len(), 2);
        assert_eq!(errors[0].message, "Entity not found");
    }

    // -- Error display tests --

    #[test]
    fn test_error_display_missing_api_key() {
        let err = LinearError::MissingApiKey;
        assert!(err.to_string().contains("LINEAR_API_KEY"));
    }

    #[test]
    fn test_error_display_auth_failed() {
        let err = LinearError::AuthFailed;
        assert!(err.to_string().contains("401"));
    }

    #[test]
    fn test_error_display_permission_denied() {
        let err = LinearError::PermissionDenied;
        assert!(err.to_string().contains("403"));
    }

    #[test]
    fn test_error_display_status_not_found() {
        let err = LinearError::StatusNotFound("In Review".to_string());
        assert!(err.to_string().contains("In Review"));
    }

    #[test]
    fn test_error_display_graphql() {
        let err = LinearError::GraphQL("Entity not found".to_string());
        assert!(err.to_string().contains("Entity not found"));
    }

    #[test]
    fn test_error_display_http() {
        let err = LinearError::HttpError {
            status: 500,
            message: "Internal error".to_string(),
        };
        assert!(err.to_string().contains("500"));
        assert!(err.to_string().contains("Internal error"));
    }

    // -- Relation filtering logic test --

    #[test]
    fn test_relation_filtering_blocks_only() {
        let relations = InverseRelationsConnection {
            nodes: vec![
                InverseRelationNode {
                    relation_type: "blocks".to_string(),
                    issue: RelatedIssueRef {
                        id: "blocker-1".to_string(),
                        identifier: "TUB-100".to_string(),
                    },
                },
                InverseRelationNode {
                    relation_type: "relates".to_string(),
                    issue: RelatedIssueRef {
                        id: "related-1".to_string(),
                        identifier: "TUB-200".to_string(),
                    },
                },
                InverseRelationNode {
                    relation_type: "blocks".to_string(),
                    issue: RelatedIssueRef {
                        id: "blocker-2".to_string(),
                        identifier: "TUB-101".to_string(),
                    },
                },
                InverseRelationNode {
                    relation_type: "duplicate".to_string(),
                    issue: RelatedIssueRef {
                        id: "dup-1".to_string(),
                        identifier: "TUB-300".to_string(),
                    },
                },
            ],
        };

        let blocked_by: Vec<Relation> = relations
            .nodes
            .iter()
            .filter(|r| r.relation_type == "blocks")
            .map(|r| Relation {
                id: r.issue.id.clone(),
                identifier: r.issue.identifier.clone(),
            })
            .collect();

        assert_eq!(blocked_by.len(), 2);
        assert_eq!(blocked_by[0].identifier, "TUB-100");
        assert_eq!(blocked_by[1].identifier, "TUB-101");
    }

    // -- Branch name fallback test --

    #[test]
    fn test_branch_name_fallback() {
        // When branchName is None, should generate from identifier
        let branch = None::<String>
            .filter(|b: &String| !b.is_empty())
            .unwrap_or_else(|| format!("feat/{}", "TUB-293".to_lowercase()));
        assert_eq!(branch, "feat/tub-293");

        // When branchName is empty string, should generate from identifier
        let branch = Some(String::new())
            .filter(|b| !b.is_empty())
            .unwrap_or_else(|| format!("feat/{}", "TUB-293".to_lowercase()));
        assert_eq!(branch, "feat/tub-293");

        // When branchName is set, use it
        let branch = Some("custom-branch".to_string())
            .filter(|b| !b.is_empty())
            .unwrap_or_else(|| format!("feat/{}", "TUB-293".to_lowercase()));
        assert_eq!(branch, "custom-branch");
    }

    // -- Debug impl test --

    #[test]
    fn test_debug_redacts_api_key() {
        std::env::set_var("LINEAR_API_KEY", "super-secret");
        let client = LinearClient::new().unwrap();
        let debug = format!("{:?}", client);
        assert!(debug.contains("REDACTED"));
        assert!(!debug.contains("super-secret"));
        std::env::remove_var("LINEAR_API_KEY");
    }
}
