use crate::auth::AuthState;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};

const DEFAULT_REGISTRY_BASE_URL: &str = "http://127.0.0.1:4010";
const DEFAULT_REGISTRY_TIMEOUT_MS: u64 = 8_000;
const DEFAULT_ADVISORY_LIMIT: i32 = 50;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryPermission {
    pub permission_key: String,
    pub required: bool,
    pub risk_level: String,
    pub permission_scope: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistrySkillVersion {
    pub version: String,
    pub digest: String,
    pub signature: String,
    pub runtime: Option<String>,
    pub entrypoint: Option<String>,
    pub artifact_uri: Option<String>,
    pub compatibility_min_app_version: Option<String>,
    pub compatibility_max_app_version: Option<String>,
    pub policy_status: Option<String>,
    pub revoked_at: Option<String>,
    pub permissions: Option<Vec<RegistryPermission>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistrySkillSummary {
    pub skill_id: String,
    pub name: String,
    pub description: String,
    pub latest_version: String,
    pub risk: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistrySkillDetails {
    pub skill_id: String,
    pub name: String,
    pub description: String,
    pub latest_version: String,
    pub risk: String,
    pub versions: Vec<RegistrySkillVersion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkill {
    pub install_id: String,
    pub skill_id: String,
    pub implementation_key: String,
    pub name: String,
    pub install_state: String,
    pub auto_update: bool,
    pub pinned_version: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryAgentSkill {
    pub agent_ability_id: String,
    pub skill_id: String,
    pub implementation_key: String,
    pub name: String,
    pub enabled: bool,
    pub config: serde_json::Value,
    pub install_state: Option<String>,
    pub pinned_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryInstallResponse {
    pub install_id: String,
    pub skill_id: String,
    pub version: String,
    pub implementation_key: String,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryUninstallResponse {
    pub install_id: String,
    pub skill_id: String,
    pub uninstalled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryPinResponse {
    pub install_id: String,
    pub skill_id: String,
    pub version: String,
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryAssignResponse {
    pub agent_ability_id: String,
    pub agent_id: String,
    pub skill_id: String,
    pub implementation_key: String,
    pub assigned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInstallState {
    pub install_id: Option<String>,
    pub installed: bool,
    pub install_state: Option<String>,
    pub auto_update: Option<bool>,
    pub pinned_version: Option<String>,
    pub install_config: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCompatibility {
    pub min_app_version: Option<String>,
    pub max_app_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSpec {
    #[serde(rename = "type")]
    pub runtime_type: String,
    pub entrypoint: String,
    pub compatibility: RuntimeCompatibility,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeArtifact {
    pub uri: Option<String>,
    pub digest: String,
    pub signature: String,
    pub signature_algorithm: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePolicy {
    pub status: String,
    pub risk_level: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAdvisoryBrief {
    pub advisory_id: String,
    pub advisory_type: String,
    pub title: String,
    pub summary: String,
    pub severity: String,
    pub published_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeForceDisable {
    pub required: bool,
    pub reason: Option<String>,
    pub advisory: Option<RuntimeAdvisoryBrief>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHandshake {
    pub skill_id: String,
    pub implementation_key: String,
    pub name: String,
    pub version: String,
    pub install: RuntimeInstallState,
    pub runtime: RuntimeSpec,
    pub artifact: RuntimeArtifact,
    pub policy: RuntimePolicy,
    pub permissions: Vec<RegistryPermission>,
    pub force_disable: RuntimeForceDisable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryAdvisory {
    pub id: String,
    pub skill_id: String,
    pub version: Option<String>,
    pub advisory_type: String,
    pub severity: String,
    pub title: String,
    pub summary: String,
    pub sequence_cursor: Option<String>,
    pub force_disable: Option<bool>,
    pub published_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisoryFeedPage {
    pub next_cursor: Option<String>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisoryFeedResponse {
    pub data: Vec<RegistryAdvisory>,
    pub page: AdvisoryFeedPage,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallSkillInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub auto_update: bool,
    pub install_config: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinSkillInput {
    pub version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignSkillInput {
    pub agent_id: String,
    pub enabled: bool,
    pub config: serde_json::Value,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeExecutionMode {
    Remote,
    LocalDocker,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRuntimeRunInput {
    pub skill_id: String,
    pub version: String,
    pub agent_id: Option<String>,
    pub input: serde_json::Value,
    pub execution_mode: RuntimeExecutionMode,
    pub timeout_seconds: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRunError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRunSummary {
    pub run_id: String,
    pub user_id: String,
    pub skill_id: String,
    pub version: String,
    pub agent_id: Option<String>,
    pub execution_mode: RuntimeExecutionMode,
    pub status: String,
    pub timeout_seconds: u32,
    pub input: serde_json::Value,
    pub output: Option<serde_json::Value>,
    pub error: Option<RuntimeRunError>,
    pub created_at: String,
    pub updated_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRunEvent {
    pub event_id: String,
    pub run_id: String,
    pub sequence: i64,
    pub r#type: String,
    pub status: Option<String>,
    pub message: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRunEventsPage {
    pub next_cursor: Option<String>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRunEventsResponse {
    pub data: Vec<RuntimeRunEvent>,
    pub page: RuntimeRunEventsPage,
}

#[derive(Debug, Clone, Deserialize)]
struct ApiResponse<T> {
    data: T,
}

#[derive(Debug, Clone)]
pub struct SkillsRegistryClient {
    base_url: String,
    http: Client,
}

impl SkillsRegistryClient {
    pub fn from_env() -> Result<Self, String> {
        let base_url = std::env::var("SKILLS_REGISTRY_BASE_URL")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_REGISTRY_BASE_URL.to_string());
        let timeout_ms = std::env::var("SKILLS_REGISTRY_TIMEOUT_MS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(DEFAULT_REGISTRY_TIMEOUT_MS);
        let http = Client::builder()
            .timeout(std::time::Duration::from_millis(timeout_ms))
            .build()
            .map_err(|e| format!("Failed to initialize registry HTTP client: {e}"))?;
        Ok(Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            http,
        })
    }

    pub fn resolve_access_token(auth_state: &AuthState) -> Result<String, String> {
        auth_state
            .get_session()
            .map(|session| session.access_token)
            .filter(|token| !token.trim().is_empty())
            .ok_or_else(|| "No authenticated session found for registry request.".to_string())
    }

    pub async fn list_skills(
        &self,
        access_token: &str,
        query: Option<String>,
    ) -> Result<Vec<RegistrySkillSummary>, String> {
        let mut request = self
            .http
            .get(self.url("/v1/skills"))
            .bearer_auth(access_token);
        if let Some(query) = query {
            let trimmed = query.trim();
            if !trimmed.is_empty() {
                request = request.query(&[("query", trimmed)]);
            }
        }
        self.send_data(request).await
    }

    pub async fn get_skill(
        &self,
        access_token: &str,
        skill_id: &str,
    ) -> Result<RegistrySkillDetails, String> {
        let request = self
            .http
            .get(self.url(&format!("/v1/skills/{skill_id}")))
            .bearer_auth(access_token);
        self.send_data(request).await
    }

    pub async fn get_skill_version(
        &self,
        access_token: &str,
        skill_id: &str,
        version: &str,
    ) -> Result<RegistrySkillVersion, String> {
        let request = self
            .http
            .get(self.url(&format!(
                "/v1/skills/{skill_id}/versions/{version}"
            )))
            .bearer_auth(access_token);
        self.send_data(request).await
    }

    pub async fn list_installed_skills(
        &self,
        access_token: &str,
    ) -> Result<Vec<InstalledSkill>, String> {
        let request = self
            .http
            .get(self.url("/v1/skills/installed"))
            .bearer_auth(access_token);
        self.send_data(request).await
    }

    pub async fn install_skill(
        &self,
        access_token: &str,
        skill_id: &str,
        input: InstallSkillInput,
    ) -> Result<RegistryInstallResponse, String> {
        let request = self
            .http
            .post(self.url(&format!("/v1/skills/{skill_id}/install")))
            .bearer_auth(access_token)
            .json(&input);
        self.send_data(request).await
    }

    pub async fn uninstall_skill(
        &self,
        access_token: &str,
        skill_id: &str,
    ) -> Result<RegistryUninstallResponse, String> {
        let request = self
            .http
            .delete(self.url(&format!("/v1/skills/{skill_id}/install")))
            .bearer_auth(access_token);
        self.send_data(request).await
    }

    pub async fn pin_skill_version(
        &self,
        access_token: &str,
        skill_id: &str,
        version: String,
    ) -> Result<RegistryPinResponse, String> {
        let request = self
            .http
            .post(self.url(&format!("/v1/skills/{skill_id}/install/pin")))
            .bearer_auth(access_token)
            .json(&PinSkillInput { version });
        self.send_data(request).await
    }

    pub async fn assign_skill(
        &self,
        access_token: &str,
        skill_id: &str,
        input: AssignSkillInput,
    ) -> Result<RegistryAssignResponse, String> {
        let request = self
            .http
            .post(self.url(&format!("/v1/skills/{skill_id}/assign")))
            .bearer_auth(access_token)
            .json(&input);
        self.send_data(request).await
    }

    pub async fn list_agent_skills(
        &self,
        access_token: &str,
        agent_id: &str,
    ) -> Result<Vec<RegistryAgentSkill>, String> {
        let request = self
            .http
            .get(self.url(&format!("/v1/agents/{agent_id}/skills")))
            .bearer_auth(access_token);
        self.send_data(request).await
    }

    pub async fn runtime_handshake(
        &self,
        access_token: &str,
        skill_id: &str,
        version: &str,
    ) -> Result<RuntimeHandshake, String> {
        let request = self
            .http
            .get(self.url(&format!(
                "/v1/runtime/skills/{skill_id}/versions/{version}/handshake"
            )))
            .bearer_auth(access_token);
        self.send_data(request).await
    }

    pub async fn advisory_feed(
        &self,
        access_token: &str,
        cursor: Option<String>,
        limit: Option<i32>,
    ) -> Result<AdvisoryFeedResponse, String> {
        let mut request = self
            .http
            .get(self.url("/v1/advisories/feed"))
            .bearer_auth(access_token);
        if let Some(cursor) = cursor {
            let trimmed = cursor.trim();
            if !trimmed.is_empty() {
                request = request.query(&[("cursor", trimmed)]);
            }
        }
        let final_limit = limit
            .unwrap_or(DEFAULT_ADVISORY_LIMIT)
            .clamp(1, 200)
            .to_string();
        request = request.query(&[("limit", final_limit.as_str())]);
        self.send_full(request).await
    }

    pub async fn create_runtime_run(
        &self,
        access_token: &str,
        input: CreateRuntimeRunInput,
    ) -> Result<RuntimeRunSummary, String> {
        let request = self
            .http
            .post(self.url("/v1/runtime/runs"))
            .bearer_auth(access_token)
            .json(&input);
        self.send_data(request).await
    }

    pub async fn get_runtime_run(
        &self,
        access_token: &str,
        run_id: &str,
    ) -> Result<RuntimeRunSummary, String> {
        let request = self
            .http
            .get(self.url(&format!("/v1/runtime/runs/{run_id}")))
            .bearer_auth(access_token);
        self.send_data(request).await
    }

    pub async fn list_runtime_run_events(
        &self,
        access_token: &str,
        run_id: &str,
        cursor: usize,
        limit: usize,
    ) -> Result<RuntimeRunEventsResponse, String> {
        let request = self
            .http
            .get(self.url(&format!("/v1/runtime/runs/{run_id}/events")))
            .bearer_auth(access_token)
            .query(&[("cursor", cursor), ("limit", limit)]);
        self.send_full(request).await
    }

    fn url(&self, path: &str) -> String {
        format!("{}/{}", self.base_url, path.trim_start_matches('/'))
    }

    async fn send_data<T>(&self, request: reqwest::RequestBuilder) -> Result<T, String>
    where
        T: for<'de> Deserialize<'de>,
    {
        let payload: ApiResponse<T> = self.send_full(request).await?;
        Ok(payload.data)
    }

    async fn send_full<T>(&self, request: reqwest::RequestBuilder) -> Result<T, String>
    where
        T: for<'de> Deserialize<'de>,
    {
        let response = request
            .send()
            .await
            .map_err(|e| format!("Registry request failed: {e}"))?;
        if !response.status().is_success() {
            return Err(Self::map_error_response(response.status(), response).await);
        }
        response
            .json::<T>()
            .await
            .map_err(|e| format!("Failed to decode registry response: {e}"))
    }

    async fn map_error_response(status: StatusCode, response: reqwest::Response) -> String {
        let body = response.text().await.unwrap_or_default();
        let message = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|v| {
                v.get("message")
                    .and_then(|m| m.as_str())
                    .map(ToString::to_string)
            })
            .unwrap_or_else(|| {
                if body.trim().is_empty() {
                    "Registry request failed.".to_string()
                } else {
                    body
                }
            });
        format!("Registry request failed ({status}): {message}")
    }
}
