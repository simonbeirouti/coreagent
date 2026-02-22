#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimeExecutorMode {
    Api,
}

impl RuntimeExecutorMode {
    pub fn current() -> Self {
        Self::Api
    }

    pub fn as_str(&self) -> &'static str {
        "api"
    }
}

pub fn should_pre_read_attachment_content(_mode: RuntimeExecutorMode, _implementation_key: &str) -> bool {
    // In API mode, runtime command skills can infer inputs from attachment excerpts
    // (for example pandas/deep-analysis/regex skills). If we gate pre-read to only
    // attachment_read, downstream docker tools run without required context and fail
    // with validation errors like "missing rows and no parseable CSV attachment context".
    //
    // Markers are extracted from the latest user message only, so pre-read remains scoped
    // to the current turn rather than historical conversation attachments.
    true
}

pub fn contains_attachment_markers(message: &str) -> bool {
    message.contains("[File:path:") || message.contains("[Screenshot:path:")
}

pub fn should_add_attachment_hint(message: &str) -> bool {
    contains_attachment_markers(message)
}

#[cfg(test)]
mod tests {
    use super::{should_pre_read_attachment_content, RuntimeExecutorMode};

    #[test]
    fn runtime_executor_mode_is_api_only() {
        let mode = RuntimeExecutorMode::current();
        assert_eq!(mode, RuntimeExecutorMode::Api);
        assert_eq!(mode.as_str(), "api");
    }

    #[test]
    fn api_executor_prereads_for_runtime_skills() {
        assert!(should_pre_read_attachment_content(
            RuntimeExecutorMode::Api,
            "attachment_read"
        ));
        assert!(should_pre_read_attachment_content(
            RuntimeExecutorMode::Api,
            "coreagent.py.pandas_summary"
        ));
        assert!(should_pre_read_attachment_content(
            RuntimeExecutorMode::Api,
            "coreagent.py.deep_analysis"
        ));
    }

    #[test]
    fn api_executor_always_prereads_attachment_content() {
        assert!(should_pre_read_attachment_content(
            RuntimeExecutorMode::Api,
            "attachment_read"
        ));
        assert!(should_pre_read_attachment_content(
            RuntimeExecutorMode::Api,
            "coreagent.py.deep_analysis"
        ));
    }
}
