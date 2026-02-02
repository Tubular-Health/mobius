use serde::{Deserialize, Serialize};

/// Linear issue data structure (subset of what Linear returns)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinearIssue {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub status: String,
    #[serde(default)]
    pub git_branch_name: String,
    #[serde(default)]
    pub relations: Option<Relations>,
}

/// Blocking relations for an issue
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Relations {
    #[serde(default)]
    pub blocked_by: Vec<Relation>,
    #[serde(default)]
    pub blocks: Vec<Relation>,
}

/// A single relation reference
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Relation {
    pub id: String,
    pub identifier: String,
}
