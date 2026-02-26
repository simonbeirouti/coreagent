use async_openai::{
    types::chat::{
        ChatCompletionRequestMessage, ChatCompletionRequestMessageContentPartImage,
        ChatCompletionRequestMessageContentPartText, ChatCompletionRequestUserMessage,
        ChatCompletionRequestUserMessageContent, ChatCompletionRequestUserMessageContentPart,
        CreateChatCompletionRequestArgs, ImageDetail, ImageUrl,
    },
    Client as OpenAIClient,
};
use base64::{engine::general_purpose, Engine as _};
use reqwest::Client as HttpClient;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::{Cursor, Read};
use zip::ZipArchive;

const USER_FILES_BUCKET: &str = "user-files";
const MAX_ATTACHMENTS_DEFAULT: usize = 5;
const MAX_FILE_BYTES_DEFAULT: usize = 5 * 1024 * 1024;
const MAX_PROVIDER_IMAGE_BYTES: usize = 5 * 1024 * 1024;
const MAX_TEXT_CHARS_DEFAULT: usize = 16_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedAttachmentMarker {
    pub storage_path: String,
    pub file_name: String,
    pub file_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentReadInput {
    attachments: Option<Vec<AttachmentRequest>>,
    max_attachments: Option<usize>,
    max_file_bytes: Option<usize>,
    max_chars: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentRequest {
    path: Option<String>,
    storage_path: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentReadItem {
    storage_path: String,
    file_name: String,
    file_type: String,
    status: String,
    summary: String,
    content_excerpt: Option<String>,
    truncated: bool,
    metadata: serde_json::Value,
    error: Option<String>,
}

pub struct AttachmentReadService;

impl AttachmentReadService {
    fn is_storage_object_missing(status: reqwest::StatusCode, body: &str) -> bool {
        let normalized = body.to_ascii_lowercase();
        (status == reqwest::StatusCode::NOT_FOUND || status == reqwest::StatusCode::BAD_REQUEST)
            && (normalized.contains("object not found")
                || normalized.contains("\"error\":\"not_found\"")
                || normalized.contains("\"statuscode\":\"404\""))
    }

    fn is_missing_object_error(error: &str) -> bool {
        error.contains("storage_object_not_found:")
    }

    pub fn extract_file_markers(content: &str) -> Vec<ParsedAttachmentMarker> {
        let mut markers = Vec::new();
        let mut seen_paths = HashSet::new();

        let mut remaining = content;
        let file_start_tag = "[File:path:";
        while let Some(start) = remaining.find(file_start_tag) {
            let after_start = &remaining[start + file_start_tag.len()..];
            let Some(end) = after_start.find(']') else {
                break;
            };
            let block = &after_start[..end];
            remaining = &after_start[end + 1..];

            let mut path = String::new();
            let mut name = String::new();
            let mut file_type = String::new();

            if let Some(name_idx) = block.find("|name:") {
                path = block[..name_idx].to_string();
                let rest = &block[name_idx + "|name:".len()..];
                if let Some(type_idx) = rest.find("|type:") {
                    name = rest[..type_idx].to_string();
                    file_type = rest[type_idx + "|type:".len()..].to_string();
                }
            }

            if path.is_empty() || file_type.is_empty() {
                continue;
            }

            let storage_path = path.trim().to_string();
            let normalized = Self::normalize_storage_path(&storage_path);
            if !seen_paths.insert(normalized) {
                continue;
            }

            markers.push(ParsedAttachmentMarker {
                storage_path,
                file_name: name.trim().to_string(),
                file_type: file_type.trim().to_ascii_lowercase(),
            });
        }

        let mut remaining = content;
        let screenshot_start_tag = "[Screenshot:path:";
        while let Some(start) = remaining.find(screenshot_start_tag) {
            let after_start = &remaining[start + screenshot_start_tag.len()..];
            let Some(end) = after_start.find(']') else {
                break;
            };
            let raw_path = after_start[..end].trim().to_string();
            remaining = &after_start[end + 1..];

            if raw_path.is_empty() {
                continue;
            }

            let normalized = Self::normalize_storage_path(&raw_path);
            if !seen_paths.insert(normalized) {
                continue;
            }

            let file_name = raw_path
                .rsplit('/')
                .next()
                .filter(|name| !name.is_empty())
                .unwrap_or("screenshot.png")
                .to_string();
            let extension = file_name
                .rsplit('.')
                .next()
                .map(|ext| ext.to_ascii_lowercase())
                .unwrap_or_else(|| "png".to_string());
            let file_type = match extension.as_str() {
                "png" | "jpg" | "jpeg" | "gif" | "webp" => extension,
                _ => "png".to_string(),
            };

            markers.push(ParsedAttachmentMarker {
                storage_path: raw_path,
                file_name,
                file_type,
            });
        }

        markers
    }

    pub async fn execute(
        latest_user_message: &str,
        arguments: &serde_json::Value,
        access_token: &str,
    ) -> serde_json::Value {
        let input = serde_json::from_value::<AttachmentReadInput>(arguments.clone()).unwrap_or(
            AttachmentReadInput {
                attachments: None,
                max_attachments: None,
                max_file_bytes: None,
                max_chars: None,
            },
        );
        let max_attachments = input
            .max_attachments
            .unwrap_or(MAX_ATTACHMENTS_DEFAULT)
            .clamp(1, 10);
        let max_file_bytes = input
            .max_file_bytes
            .unwrap_or(MAX_FILE_BYTES_DEFAULT)
            .clamp(256 * 1024, MAX_FILE_BYTES_DEFAULT);
        let max_chars = input.max_chars.unwrap_or(MAX_TEXT_CHARS_DEFAULT).clamp(500, 64_000);
        eprintln!(
            "[ATTACHMENT_READ] execute start max_attachments={} max_file_bytes={} max_chars={}",
            max_attachments, max_file_bytes, max_chars
        );

        let markers = Self::extract_file_markers(latest_user_message);
        let marker_paths = markers
            .iter()
            .map(|marker| Self::normalize_storage_path(&marker.storage_path))
            .collect::<Vec<_>>();
        eprintln!(
            "[ATTACHMENT_READ] extracted markers count={} paths={:?}",
            markers.len(),
            marker_paths
        );
        if markers.is_empty() {
            eprintln!("[ATTACHMENT_READ] no attachment markers found in latest user message");
            return serde_json::json!({
                "status": "failed",
                "summary": "No attached file markers were found in the current message.",
                "readCount": 0,
                "results": [],
                "error": {
                    "code": "no_attachment_markers",
                    "message": "Attachment tool only reads files explicitly attached in the active user message."
                }
            });
        }

        let by_path = markers
            .iter()
            .map(|m| (Self::normalize_storage_path(&m.storage_path), m.clone()))
            .collect::<HashMap<_, _>>();

        let requested_paths = input
            .attachments
            .unwrap_or_default()
            .into_iter()
            .filter_map(|item| item.storage_path.or(item.path))
            .map(|path| Self::normalize_storage_path(&path))
            .collect::<Vec<_>>();
        eprintln!(
            "[ATTACHMENT_READ] requested attachment paths count={} paths={:?}",
            requested_paths.len(),
            requested_paths
        );

        let mut selected: Vec<ParsedAttachmentMarker> = if requested_paths.is_empty() {
            markers.into_iter().take(max_attachments).collect()
        } else {
            let requested_set = requested_paths.into_iter().collect::<HashSet<_>>();
            by_path
                .into_iter()
                .filter(|(path, _)| requested_set.contains(path))
                .map(|(_, marker)| marker)
                .take(max_attachments)
                .collect()
        };
        eprintln!(
            "[ATTACHMENT_READ] selected attachments count={} paths={:?}",
            selected.len(),
            selected
                .iter()
                .map(|marker| Self::normalize_storage_path(&marker.storage_path))
                .collect::<Vec<_>>()
        );

        if selected.is_empty() {
            eprintln!("[ATTACHMENT_READ] selected set is empty after requested-path filtering");
            return serde_json::json!({
                "status": "failed",
                "summary": "Requested attachments are not available in the current message markers.",
                "readCount": 0,
                "results": [],
                "error": {
                    "code": "attachment_not_allowed",
                    "message": "Only attachments present in the current message can be read."
                }
            });
        }

        selected.sort_by(|a, b| a.file_name.cmp(&b.file_name));
        let mut results = Vec::with_capacity(selected.len());
        let mut succeeded = 0usize;

        for marker in selected {
            eprintln!(
                "[ATTACHMENT_READ] reading attachment path='{}' type='{}'",
                marker.storage_path, marker.file_type
            );
            let item = match Self::read_single_attachment(&marker, access_token, max_file_bytes, max_chars)
                .await
            {
                Ok(item) => {
                    succeeded += 1;
                    eprintln!(
                        "[ATTACHMENT_READ] read succeeded path='{}' parser={}",
                        item.storage_path,
                        item.metadata
                            .get("parser")
                            .and_then(|value| value.as_str())
                            .unwrap_or("unknown")
                    );
                    item
                }
                Err(error) => {
                    eprintln!(
                        "[ATTACHMENT_READ] read failed path='{}' error={}",
                        marker.storage_path, error
                    );
                    let missing_object = Self::is_missing_object_error(&error);
                    let summary = if missing_object {
                        format!(
                            "Could not read {} because the uploaded object is missing. Re-upload and attach it again.",
                            marker.file_name
                        )
                    } else {
                        format!("Could not read {}.", marker.file_name)
                    };
                    AttachmentReadItem {
                        storage_path: marker.storage_path.clone(),
                        file_name: marker.file_name.clone(),
                        file_type: marker.file_type.clone(),
                        status: "failed".to_string(),
                        summary,
                        content_excerpt: None,
                        truncated: false,
                        metadata: serde_json::json!({
                            "errorCode": if missing_object { "storage_object_not_found" } else { "read_failed" },
                            "parseDiagnostics": {
                                "attemptedParser": marker.file_type,
                                "quality": "failed"
                            }
                        }),
                        error: Some(error),
                    }
                }
            };
            results.push(item);
        }

        let status = if succeeded > 0 { "succeeded" } else { "failed" };
        eprintln!(
            "[ATTACHMENT_READ] execute completed status={} read_count={} total={}",
            status,
            succeeded,
            results.len()
        );
        serde_json::json!({
            "status": status,
            "summary": format!("Read {} of {} attachment(s).", succeeded, results.len()),
            "readCount": succeeded,
            "results": results,
        })
    }

    fn normalize_storage_path(path: &str) -> String {
        path.trim()
            .trim_start_matches('/')
            .trim_start_matches("user-files/")
            .to_string()
    }

    async fn read_single_attachment(
        marker: &ParsedAttachmentMarker,
        access_token: &str,
        max_file_bytes: usize,
        max_chars: usize,
    ) -> Result<AttachmentReadItem, String> {
        let storage_path = Self::normalize_storage_path(&marker.storage_path);
        let bytes = Self::download_storage_object(&storage_path, access_token, max_file_bytes).await?;
        let byte_len = bytes.len();
        let file_type = marker.file_type.to_ascii_lowercase();

        let (summary, content_excerpt, truncated, parser) = match file_type.as_str() {
            "txt" | "csv" => {
                let text = String::from_utf8_lossy(&bytes).to_string();
                let (excerpt, truncated) = Self::truncate_text(&text, max_chars);
                (
                    format!("Extracted text from {} ({} bytes).", marker.file_name, byte_len),
                    Some(excerpt),
                    truncated,
                    "utf8".to_string(),
                )
            }
            "pdf" => {
                let parsed = tokio::task::spawn_blocking({
                    let bytes_for_task = bytes.clone();
                    move || pdf_extract::extract_text_from_mem(&bytes_for_task)
                })
                .await
                .map_err(|e| format!("PDF parse task failed: {e}"))?
                .map_err(|e| format!("PDF parse failed: {e}"))?;
                let (excerpt, truncated) = Self::truncate_text(&parsed, max_chars);
                (
                    format!("Extracted text from PDF {}.", marker.file_name),
                    Some(excerpt),
                    truncated,
                    "pdf_extract".to_string(),
                )
            }
            "doc" => {
                let parsed = Self::extract_doc_text(&bytes)?;
                let (excerpt, truncated) = Self::truncate_text(&parsed, max_chars);
                (
                    format!("Extracted text from document {}.", marker.file_name),
                    Some(excerpt),
                    truncated,
                    "doc_xml".to_string(),
                )
            }
            "png" | "jpg" | "jpeg" | "gif" | "webp" => {
                let summary = Self::summarize_image_bytes(&bytes).await?;
                (
                    format!("Generated image summary for {}.", marker.file_name),
                    Some(summary),
                    false,
                    "vision_summary".to_string(),
                )
            }
            _ => {
                return Err(format!(
                    "Unsupported attachment type '{}'.",
                    marker.file_type
                ));
            }
        };

        Ok(AttachmentReadItem {
            storage_path,
            file_name: marker.file_name.clone(),
            file_type: marker.file_type.clone(),
            status: "succeeded".to_string(),
            summary,
            content_excerpt,
            truncated,
            metadata: serde_json::json!({
                "sizeBytes": byte_len,
                "parser": parser,
                "parseDiagnostics": {
                    "attemptedParser": parser,
                    "quality": if truncated { "partial" } else { "full" },
                    "truncated": truncated
                }
            }),
            error: None,
        })
    }

    async fn download_storage_object(
        storage_path: &str,
        access_token: &str,
        max_file_bytes: usize,
    ) -> Result<Vec<u8>, String> {
        let supabase_url = std::env::var("SUPABASE_URL")
            .map_err(|_| "SUPABASE_URL environment variable not set".to_string())?;
        let url = format!(
            "{}/storage/v1/object/{}/{}",
            supabase_url.trim_end_matches('/'),
            USER_FILES_BUCKET,
            storage_path
        );
        eprintln!(
            "[ATTACHMENT_READ] downloading storage object path='{}'",
            storage_path
        );

        let http = HttpClient::new();
        let response = http
            .get(&url)
            .header("Authorization", format!("Bearer {}", access_token))
            .send()
            .await
            .map_err(|e| format!("Storage download request failed: {e}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let message = response.text().await.unwrap_or_default();
            let compact_message = message.replace('\n', " ");
            eprintln!(
                "[ATTACHMENT_READ] storage download failed path='{}' status={} body='{}'",
                storage_path,
                status,
                compact_message.chars().take(220).collect::<String>()
            );
            if Self::is_storage_object_missing(status, &message) {
                return Err(format!(
                    "storage_object_not_found:Storage object missing for '{}'. Attach a current file reference and retry.",
                    storage_path
                ));
            }
            return Err(format!("Storage download failed ({status}): {message}"));
        }
        eprintln!(
            "[ATTACHMENT_READ] storage download success path='{}' content_length={:?}",
            storage_path,
            response.content_length()
        );

        if let Some(length) = response.content_length() {
            if length > max_file_bytes as u64 {
                return Err(format!(
                    "Attachment exceeds size limit ({} bytes > {}).",
                    length, max_file_bytes
                ));
            }
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Failed reading storage response body: {e}"))?;

        if bytes.len() > max_file_bytes {
            return Err(format!(
                "Attachment exceeds size limit ({} bytes > {}).",
                bytes.len(),
                max_file_bytes
            ));
        }

        Ok(bytes.to_vec())
    }

    fn truncate_text(text: &str, max_chars: usize) -> (String, bool) {
        if text.chars().count() <= max_chars {
            return (text.trim().to_string(), false);
        }
        let excerpt = text.chars().take(max_chars).collect::<String>();
        (excerpt.trim().to_string(), true)
    }

    fn extract_doc_text(bytes: &[u8]) -> Result<String, String> {
        if !bytes.starts_with(b"PK") {
            return Err(
                "Legacy binary .doc parsing is not supported in this release. Provide DOCX/PDF/TXT/CSV.".to_string(),
            );
        }

        let cursor = Cursor::new(bytes.to_vec());
        let mut archive = ZipArchive::new(cursor).map_err(|e| format!("DOC zip open failed: {e}"))?;
        let mut file = archive
            .by_name("word/document.xml")
            .map_err(|e| format!("DOC XML payload missing: {e}"))?;
        let mut xml = String::new();
        file.read_to_string(&mut xml)
            .map_err(|e| format!("DOC XML read failed: {e}"))?;

        let stripped = Self::strip_xml_tags(&xml);
        if stripped.trim().is_empty() {
            return Err("Document contains no readable text payload.".to_string());
        }
        Ok(stripped)
    }

    fn strip_xml_tags(xml: &str) -> String {
        let mut output = String::with_capacity(xml.len());
        let mut in_tag = false;
        for ch in xml.chars() {
            match ch {
                '<' => {
                    in_tag = true;
                    output.push(' ');
                }
                '>' => {
                    in_tag = false;
                    output.push(' ');
                }
                _ if !in_tag => output.push(ch),
                _ => {}
            }
        }
        output
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&amp;", "&")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    }

    async fn summarize_image_bytes(bytes: &[u8]) -> Result<String, String> {
        if bytes.len() > MAX_PROVIDER_IMAGE_BYTES {
            return Err(format!(
                "Image exceeds provider size limit ({} bytes > {}).",
                bytes.len(),
                MAX_PROVIDER_IMAGE_BYTES
            ));
        }
        let base64_data = general_purpose::STANDARD.encode(bytes);
        let image_url = format!("data:image/png;base64,{}", base64_data);

        let user_message = ChatCompletionRequestUserMessage {
            content: ChatCompletionRequestUserMessageContent::Array(vec![
                ChatCompletionRequestUserMessageContentPart::Text(
                    ChatCompletionRequestMessageContentPartText {
                        text: "Summarize this image for chat context in 3-6 concise bullet points.".to_string(),
                    },
                ),
                ChatCompletionRequestUserMessageContentPart::ImageUrl(
                    ChatCompletionRequestMessageContentPartImage {
                        image_url: ImageUrl {
                            url: image_url,
                            detail: Some(ImageDetail::Low),
                        },
                    },
                ),
            ]),
            name: None,
        };

        let request = CreateChatCompletionRequestArgs::default()
            .model("gpt-4o")
            .messages(vec![ChatCompletionRequestMessage::User(user_message)])
            .max_tokens(400u32)
            .temperature(0.2f32)
            .build()
            .map_err(|e| format!("Failed to build image summary request: {e}"))?;

        let openai_client = OpenAIClient::new();
        let response = openai_client
            .chat()
            .create(request)
            .await
            .map_err(|e| format!("Vision summary request failed: {e}"))?;

        let content = response
            .choices
            .first()
            .and_then(|choice| choice.message.content.clone())
            .unwrap_or_default()
            .trim()
            .to_string();

        if content.is_empty() {
            return Err("Vision summary returned empty content.".to_string());
        }

        Ok(content)
    }
}

#[cfg(test)]
mod tests {
    use super::AttachmentReadService;

    #[test]
    fn extract_file_markers_parses_multiple_entries() {
        let content = "[File:path:user-1/a.txt|name:a.txt|type:txt]\nhello\n[File:path:user-1/b.pdf|name:b.pdf|type:pdf]";
        let markers = AttachmentReadService::extract_file_markers(content);
        assert_eq!(markers.len(), 2);
        assert_eq!(markers[0].storage_path, "user-1/a.txt");
        assert_eq!(markers[1].file_type, "pdf");
    }

    #[test]
    fn extract_file_markers_parses_screenshot_entries() {
        let content =
            "[Screenshot:path:user-files/user-1/shot-1234.jpg]\nSummarize this screenshot please.";
        let markers = AttachmentReadService::extract_file_markers(content);
        assert_eq!(markers.len(), 1);
        assert_eq!(markers[0].storage_path, "user-files/user-1/shot-1234.jpg");
        assert_eq!(markers[0].file_name, "shot-1234.jpg");
        assert_eq!(markers[0].file_type, "jpg");
    }

    #[test]
    fn strip_xml_tags_removes_basic_tags() {
        let output = AttachmentReadService::strip_xml_tags("<w:p>Hello <w:r>World</w:r></w:p>");
        assert_eq!(output, "Hello World");
    }

    #[test]
    fn detects_storage_not_found_payloads() {
        assert!(AttachmentReadService::is_storage_object_missing(
            reqwest::StatusCode::BAD_REQUEST,
            r#"{"statusCode":"404","error":"not_found","message":"Object not found"}"#
        ));
        assert!(AttachmentReadService::is_storage_object_missing(
            reqwest::StatusCode::NOT_FOUND,
            "Object not found"
        ));
        assert!(!AttachmentReadService::is_storage_object_missing(
            reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            "Object not found"
        ));
    }

    #[tokio::test]
    async fn summarize_image_bytes_rejects_oversized_image_before_provider_call() {
        let oversized = vec![0u8; 5 * 1024 * 1024 + 1];
        let result = AttachmentReadService::summarize_image_bytes(&oversized).await;
        assert!(result.is_err());
        assert!(result
            .err()
            .unwrap_or_default()
            .contains("Image exceeds provider size limit"));
    }
}
