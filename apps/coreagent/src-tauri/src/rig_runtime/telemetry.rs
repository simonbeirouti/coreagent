use crate::ai_client::StreamEvent;
use tauri::ipc::Channel;

pub const TOOL_CALL_STARTED: &str = "tool_call_started";
pub const TOOL_CALL_SUCCEEDED: &str = "tool_call_succeeded";
pub const TOOL_CALL_FAILED: &str = "tool_call_failed";
pub const TOOL_BUDGET_EXHAUSTED: &str = "tool_budget_exhausted";
pub const AGENT_TURN_STARTED: &str = "agent_turn_started";
pub const AGENT_TURN_COMPLETED: &str = "agent_turn_completed";

pub fn emit_event(
    on_event: &Channel<StreamEvent>,
    event_code: &str,
    provider: &str,
    tool_name: Option<&str>,
    details: &str,
) {
    let mut content = format!("[event:{}][provider:{}]", event_code, provider);
    if let Some(tool) = tool_name {
        content.push_str(&format!("[tool:{}]", tool));
    }
    content.push(' ');
    content.push_str(details);
    content.push('\n');
    let _ = on_event.send(StreamEvent::Delta { content });
}
