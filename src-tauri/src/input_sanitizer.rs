use unicode_normalization::UnicodeNormalization;

/// Maximum allowed message length (reasonable for AI context windows)
const MAX_MESSAGE_LENGTH: usize = 32_000;

/// Represents the result of sanitizing input
#[derive(Debug, Clone)]
pub struct SanitizedInput {
    pub content: String,
    #[allow(dead_code)]
    pub was_modified: bool,
}

/// Sanitizes user input messages for storage and AI processing
///
/// This function performs several security and normalization operations:
/// - Length validation (max 32,000 characters)
/// - Unicode normalization to NFC form (prevents homoglyph attacks)
/// - Whitespace normalization (collapses multiple spaces/newlines)
/// - Removes null bytes and dangerous control characters (except newlines/tabs)
/// - Trims leading/trailing whitespace
pub fn sanitize_message(input: &str) -> Result<SanitizedInput, String> {
    let original = input;

    // Step 1: Length validation
    if original.len() > MAX_MESSAGE_LENGTH {
        return Err(format!(
            "Message too long: {} characters (maximum: {})",
            original.len(),
            MAX_MESSAGE_LENGTH
        ));
    }

    // Step 2: Unicode normalization to NFC form
    // This prevents homoglyph attacks and ensures consistent representation
    let normalized = original.nfc().collect::<String>();

    // Step 3: Remove null bytes and dangerous control characters
    // Keep newlines (\n), tabs (\t), and carriage returns (\r)
    let mut cleaned = String::new();
    for ch in normalized.chars() {
        match ch {
            '\0' => {
                // Skip null bytes entirely
                continue;
            }
            // Allow newlines, tabs, and carriage returns
            '\n' | '\r' | '\t' => {
                cleaned.push(ch);
            }
            // Remove other control characters (0x00-0x1F, 0x7F-0x9F except allowed ones)
            ch if ch.is_control() => {
                // Skip all other control characters
                continue;
            }
            // Allow everything else
            _ => {
                cleaned.push(ch);
            }
        }
    }

    // Step 4: Whitespace normalization
    // Collapse multiple consecutive spaces and newlines
    let mut whitespace_normalized = String::new();
    let mut prev_was_space = false;
    let mut prev_was_newline = false;

    for ch in cleaned.chars() {
        match ch {
            ' ' => {
                if !prev_was_space {
                    whitespace_normalized.push(' ');
                    prev_was_space = true;
                    prev_was_newline = false;
                }
                // Skip additional consecutive spaces
            }
            '\n' => {
                if !prev_was_newline {
                    whitespace_normalized.push('\n');
                    prev_was_newline = true;
                    prev_was_space = false;
                }
                // Skip additional consecutive newlines
            }
            '\r' => {
                // Handle \r\n sequences - normalize to just \n
                // This will be handled by the \n case above
                continue;
            }
            _ => {
                whitespace_normalized.push(ch);
                prev_was_space = false;
                prev_was_newline = false;
            }
        }
    }

    // Step 5: Trim leading/trailing whitespace
    let trimmed = whitespace_normalized.trim();

    // Determine if the input was modified
    let was_modified = trimmed != original;

    Ok(SanitizedInput {
        content: trimmed.to_string(),
        was_modified,
    })
}

/// Escapes user content for safe inclusion in AI prompts
///
/// This prevents prompt injection by:
/// - Escaping characters that could be interpreted as prompt structure
/// - Wrapping user content in clear delimiters
/// - Adding markers to distinguish user input from instructions
pub fn escape_for_prompt(input: &str) -> String {
    // First sanitize the input
    let sanitized = match sanitize_message(input) {
        Ok(sanitized) => sanitized,
        Err(_) => {
            // If sanitization fails, return a safe default
            return "[ERROR: Invalid input]".to_string();
        }
    };

    // Escape characters that could interfere with prompt structure
    let mut escaped = String::new();

    for ch in sanitized.content.chars() {
        match ch {
            // Escape markdown-like headers that could create new sections
            '#' if escaped.ends_with('\n') => {
                escaped.push_str("\\#");
            }
            // Escape potential instruction markers
            '-' if escaped.ends_with('\n') && escaped.chars().rev().nth(1) == Some('-') => {
                // Handle cases like "--" at line start
                escaped.push_str("\\-");
            }
            // Escape colon at line start (common in YAML-like structures)
            ':' if escaped.ends_with('\n') => {
                escaped.push_str("\\:");
            }
            // Escape potential JSON/object markers
            '{' | '}' | '[' | ']' | '"' | '\'' => {
                escaped.push('\\');
                escaped.push(ch);
            }
            // Escape backslashes that could escape our delimiters
            '\\' => {
                escaped.push_str("\\\\");
            }
            // Allow safe characters
            _ => {
                escaped.push(ch);
            }
        }
    }

    // Wrap in clear delimiters to separate user content from system instructions
    format!("[USER_INPUT_START]\n{}\n[USER_INPUT_END]", escaped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normal_message() {
        let input = "Hello, how are you?";
        let result = sanitize_message(input).unwrap();
        assert_eq!(result.content, input);
        assert!(!result.was_modified);
    }

    #[test]
    fn test_whitespace_normalization() {
        let input = "  Hello   world  \n\n\n  Test  ";
        let result = sanitize_message(input).unwrap();
        assert_eq!(result.content, "Hello world \n Test");
        assert!(result.was_modified);
    }

    #[test]
    fn test_length_limit() {
        let input = "a".repeat(MAX_MESSAGE_LENGTH + 1);
        let result = sanitize_message(&input);
        assert!(result.is_err());
    }

    #[test]
    fn test_null_byte_removal() {
        let input = "Hello\x00world";
        let result = sanitize_message(input).unwrap();
        assert_eq!(result.content, "Helloworld");
        assert!(result.was_modified);
    }

    #[test]
    fn test_control_character_removal() {
        let input = "Hello\x01world\x7Ftest";
        let result = sanitize_message(input).unwrap();
        assert_eq!(result.content, "Helloworldtest");
        assert!(result.was_modified);
    }

    #[test]
    fn test_unicode_normalization() {
        // Test with combining characters that should be normalized
        let input = "café"; // This might be represented as c+a+f+e + combining accent
        let result = sanitize_message(input).unwrap();
        // Should be normalized to composed form
        assert_eq!(result.content, "café");
    }

    #[test]
    fn test_prompt_escaping() {
        let input = "Hello # world\n- item1\n- item2\n{key: value}";
        let escaped = escape_for_prompt(input);
        assert!(escaped.starts_with("[USER_INPUT_START]\n"));
        assert!(escaped.ends_with("\n[USER_INPUT_END]"));
        assert!(escaped.contains("\\{")); // { should be escaped
        assert!(escaped.contains("\\}")); // } should be escaped
    }

    #[test]
    fn test_prompt_escaping_invalid_input() {
        let input = "a".repeat(MAX_MESSAGE_LENGTH + 1);
        let escaped = escape_for_prompt(&input);
        assert_eq!(escaped, "[ERROR: Invalid input]");
    }
}
