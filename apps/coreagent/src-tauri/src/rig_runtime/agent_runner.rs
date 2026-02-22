use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolDecisionPolicy {
    ProviderNative,
}

impl ToolDecisionPolicy {
    pub fn current() -> Self {
        Self::ProviderNative
    }

    pub fn uses_heuristic_planner(self) -> bool {
        false
    }

    pub fn enforces_required_tool(self) -> bool {
        false
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShadowDecisionSnapshot {
    pub policy: ToolDecisionPolicy,
    pub heuristic_requires_tool: bool,
    pub provider_native_requires_tool: bool,
    pub tool_count: usize,
}

impl ShadowDecisionSnapshot {
    pub fn build(
        policy: ToolDecisionPolicy,
        heuristic_requires_tool: bool,
        provider_native_requires_tool: bool,
        tool_count: usize,
    ) -> Self {
        Self {
            policy,
            heuristic_requires_tool,
            provider_native_requires_tool,
            tool_count,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ToolDecisionPolicy;

    #[test]
    fn tool_decision_policy_is_provider_native_only() {
        let policy = ToolDecisionPolicy::current();
        assert_eq!(policy, ToolDecisionPolicy::ProviderNative);
        assert!(!policy.uses_heuristic_planner());
        assert!(!policy.enforces_required_tool());
    }
}
