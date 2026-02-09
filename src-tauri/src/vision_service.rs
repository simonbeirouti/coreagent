use async_openai::{
    types::chat::{CreateChatCompletionRequestArgs, ChatCompletionRequestMessage, ChatCompletionRequestUserMessage, ChatCompletionRequestUserMessageContent, ChatCompletionRequestUserMessageContentPart, ChatCompletionRequestMessageContentPartText, ChatCompletionRequestMessageContentPartImage, ImageUrl, ImageDetail},
    Client as OpenAIClient,
    config::OpenAIConfig,
};
use base64::{Engine as _, engine::general_purpose};
use image::{ImageFormat, DynamicImage};
use reqwest::Client as HttpClient;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::ai_client::AiClient;

#[derive(Serialize)]
pub struct ScreenshotResult {
    pub image_base64: String,
    pub width: u32,
    pub height: u32,
    pub storage_path: String,
}

#[derive(Deserialize)]
pub struct VisionAnalysisRequest {
    pub image_base64: String,
    pub prompt: Option<String>,
}

pub struct VisionService {
    openai_client: Arc<OpenAIClient<OpenAIConfig>>,
    http_client: HttpClient,
}

impl VisionService {
    pub fn new(_ai_client: &AiClient) -> Self {
        // Extract OpenAI client from AiClient - this might need adjustment
        let openai_client = Arc::new(OpenAIClient::new());
        let http_client = HttpClient::new();

        Self {
            openai_client,
            http_client,
        }
    }

    /// Capture screenshot (desktop only)
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    pub async fn capture_screenshot(&self) -> Result<ScreenshotResult, String> {
        // Use xcap to capture screenshot
        let screens = xcap::Monitor::all()
            .map_err(|e| format!("Failed to get monitors: {}", e))?;

        if screens.is_empty() {
            return Err("No monitors found".to_string());
        }

        // Capture the primary screen (first monitor)
        let screen = &screens[0];
        let image = screen.capture_image()
            .map_err(|e| format!("Failed to capture screenshot: {}", e))?;

        // Convert to RGB format for processing
        let dynamic_image = DynamicImage::ImageRgba8(image.clone());

        // Encode as PNG
        let mut png_bytes = Vec::new();
        dynamic_image.write_to(&mut std::io::Cursor::new(&mut png_bytes), ImageFormat::Png)
            .map_err(|e| format!("Failed to encode PNG: {}", e))?;

        // Convert to base64
        let base64_string = general_purpose::STANDARD.encode(&png_bytes);

        Ok(ScreenshotResult {
            image_base64: base64_string,
            width: image.width(),
            height: image.height(),
            storage_path: format!("screenshots/{}.png", uuid::Uuid::new_v4()),
        })
    }

    /// Capture screenshot (mobile platforms - not available)
    #[cfg(any(target_os = "ios", target_os = "android"))]
    pub async fn capture_screenshot(&self) -> Result<ScreenshotResult, String> {
        Err("Screenshot capture not available on mobile platforms".to_string())
    }

    /// Analyze image using GPT-4o Vision
    pub async fn analyze_image(
        &self,
        image_data: Vec<u8>,
        prompt: Option<String>,
    ) -> Result<String, String> {
        // Convert image to base64 URL format for OpenAI
        let base64_data = general_purpose::STANDARD.encode(&image_data);
        let image_url = format!("data:image/png;base64,{}", base64_data);

        // Create vision request
        let user_message = ChatCompletionRequestUserMessage {
            content: ChatCompletionRequestUserMessageContent::Array(vec![
                ChatCompletionRequestUserMessageContentPart::Text(
                    ChatCompletionRequestMessageContentPartText {
                        text: prompt.unwrap_or_else(|| "What's in this image? Describe it in detail.".to_string()),
                    }
                ),
                ChatCompletionRequestUserMessageContentPart::ImageUrl(
                    ChatCompletionRequestMessageContentPartImage {
                        image_url: ImageUrl {
                            url: image_url,
                            detail: Some(ImageDetail::Low), // Use low detail for faster processing
                        }
                    }
                ),
            ]),
            name: None,
        };

        let request = CreateChatCompletionRequestArgs::default()
            .model("gpt-4o")
            .messages(vec![
                ChatCompletionRequestMessage::User(user_message)
            ])
            .max_tokens(500u32)
            .temperature(0.7f32)
            .build()
            .map_err(|e| format!("Failed to build vision request: {}", e))?;

        // Call OpenAI Vision API
        let response = self.openai_client.chat().create(request).await
            .map_err(|e| format!("Vision API error: {}", e))?;

        if let Some(choice) = response.choices.first() {
            if let Some(ref content) = choice.message.content {
                return Ok(content.clone());
            }
        }

        Err("No response content from Vision API".to_string())
    }

    /// Analyze image from base64 string
    pub async fn analyze_image_base64(
        &self,
        image_base64: &str,
        prompt: Option<String>,
    ) -> Result<String, String> {
        // Decode base64 to bytes
        let image_data = general_purpose::STANDARD.decode(image_base64)
            .map_err(|e| format!("Invalid base64 image data: {}", e))?;

        self.analyze_image(image_data, prompt).await
    }

    /// Upload image to Supabase Storage
    pub async fn upload_to_storage(
        &self,
        image_data: Vec<u8>,
        bucket: &str,
        path: &str,
        supabase_url: &str,
        access_token: &str,
    ) -> Result<String, String> {
        let upload_url = format!("{}/storage/v1/object/{}/{}", supabase_url, bucket, path);

        let response = self.http_client
            .post(&upload_url)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Content-Type", "image/png")
            .body(image_data)
            .send()
            .await
            .map_err(|e| format!("Upload request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Upload failed with status {}: {}", status, error_text));
        }

        Ok(path.to_string())
    }
}