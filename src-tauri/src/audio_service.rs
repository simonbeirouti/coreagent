use async_openai::{
    types::audio::{CreateTranscriptionRequestArgs, CreateSpeechRequestArgs, SpeechModel, Voice, AudioInput},
    Client as OpenAIClient,
    config::OpenAIConfig,
};
use base64::{Engine as _, engine::general_purpose};
use reqwest::Client as HttpClient;
use serde::Serialize;
use std::sync::Arc;
use tauri::AppHandle;

use crate::ai_client::AiClient;

#[derive(Serialize)]
pub struct RecordingResult {
    pub audio_base64: String,
    pub duration_ms: i32,
    pub storage_path: String,
}

#[derive(Serialize, Clone)]
pub struct TranscriptionResult {
    pub text: String,
    pub storage_path: Option<String>,
    pub duration_ms: Option<i32>,
}

#[derive(Serialize)]
pub struct AudioUploadResult {
    pub storage_path: String,
    pub file_size_bytes: usize,
}

pub struct AudioService {
    openai_client: Arc<OpenAIClient<OpenAIConfig>>,
    http_client: HttpClient,
}

impl AudioService {
    pub fn new(_ai_client: &AiClient) -> Self {
        // Extract OpenAI client from AiClient - this might need adjustment based on AiClient implementation
        let openai_client = Arc::new(OpenAIClient::new());
        let http_client = HttpClient::new();

        Self { openai_client, http_client }
    }

    /// Start microphone recording
    pub async fn start_recording(&self, _app: &AppHandle) -> Result<(), String> {
        // Use tauri-plugin-mic-recorder to start recording
        // This would typically call a JavaScript function or plugin command
        // For now, we'll assume the plugin handles this via frontend
        Ok(())
    }

    /// Stop microphone recording and get audio data
    pub async fn stop_recording(
        &self,
        _app: &AppHandle,
        _agent_id: &str,
    ) -> Result<RecordingResult, String> {
        // This would typically get audio data from the mic recorder plugin
        // For now, return a placeholder - actual implementation would depend on plugin API

        // Placeholder implementation - in real usage, this would get actual audio data
        Err("Audio recording not yet implemented - requires frontend plugin integration".to_string())
    }

    /// Transcribe audio using OpenAI Whisper API
    pub async fn transcribe(
        &self,
        audio_data: Vec<u8>,
        _language: Option<String>,
    ) -> Result<String, String> {
        // Create transcription request using audio bytes
        let audio_input = AudioInput::from_vec_u8(
            format!("audio_{}.wav", uuid::Uuid::new_v4()),
            audio_data,
        );
        let request = CreateTranscriptionRequestArgs::default()
            .file(audio_input)
            .model("whisper-1")
            .build()
            .map_err(|e| format!("Failed to build transcription request: {}", e))?;

        // Call OpenAI API
        let response = self.openai_client.audio().transcription().create(request).await
            .map_err(|e| format!("Whisper API error: {}", e))?;

        Ok(response.text)
    }

    /// Generate speech using OpenAI TTS API
    pub async fn text_to_speech(
        &self,
        text: &str,
        voice: Option<String>,
    ) -> Result<Vec<u8>, String> {
        let voice_enum = match voice.as_deref() {
            Some("alloy") => Voice::Alloy,
            Some("echo") => Voice::Echo,
            Some("fable") => Voice::Fable,
            Some("onyx") => Voice::Onyx,
            Some("nova") => Voice::Nova,
            Some("shimmer") => Voice::Shimmer,
            _ => Voice::Alloy, // Default
        };

        let request = CreateSpeechRequestArgs::default()
            .input(text.to_string())
            .model(SpeechModel::Tts1)
            .voice(voice_enum)
            .build()
            .map_err(|e| format!("Failed to build speech request: {}", e))?;

        let response = self.openai_client.audio().speech().create(request).await
            .map_err(|e| format!("TTS API error: {}", e))?;

        // The response contains audio bytes directly
        Ok(response.bytes.to_vec())
    }

    /// Transcribe audio from base64 string
    pub async fn transcribe_base64(
        &self,
        audio_base64: &str,
        language: Option<String>,
    ) -> Result<String, String> {
        // Decode base64 to bytes
        let audio_data = general_purpose::STANDARD.decode(audio_base64)
            .map_err(|e| format!("Invalid base64 audio data: {}", e))?;

        self.transcribe(audio_data, language).await
    }

    /// Generate speech and return as base64
    pub async fn text_to_speech_base64(
        &self,
        text: &str,
        voice: Option<String>,
    ) -> Result<String, String> {
        let audio_bytes = self.text_to_speech(text, voice).await?;
        Ok(general_purpose::STANDARD.encode(&audio_bytes))
    }

    /// Upload audio to Supabase Storage
    pub async fn upload_to_storage(
        &self,
        audio_data: &[u8],
        bucket: &str,
        path: &str,
        supabase_url: &str,
        access_token: &str,
    ) -> Result<AudioUploadResult, String> {
        let upload_url = format!("{}/storage/v1/object/{}/{}", supabase_url, bucket, path);

        let response = self.http_client
            .post(&upload_url)
            .header("Authorization", format!("Bearer {}", access_token))
            .header("Content-Type", "audio/wav")
            .body(audio_data.to_vec())
            .send()
            .await
            .map_err(|e| format!("Audio upload request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("Audio upload failed with status {}: {}", status, error_text));
        }

        Ok(AudioUploadResult {
            storage_path: format!("{}/{}", bucket, path),
            file_size_bytes: audio_data.len(),
        })
    }

    /// Transcribe audio and optionally save to storage
    /// Returns transcription text along with storage path if saved
    pub async fn transcribe_and_save(
        &self,
        audio_data: Vec<u8>,
        language: Option<String>,
        save_audio: bool,
        user_id: &str,
        supabase_url: &str,
        access_token: &str,
    ) -> Result<TranscriptionResult, String> {
        // Estimate duration from WAV file size (rough estimate: 16kHz, 16-bit mono = 32000 bytes/sec)
        // For more accurate duration, we could parse the WAV header
        let estimated_duration_ms = ((audio_data.len() as f64 / 32000.0) * 1000.0) as i32;

        // Perform transcription
        let text = self.transcribe(audio_data.clone(), language).await?;

        // Optionally save to storage
        let storage_path = if save_audio {
            let filename = format!("{}/{}.wav", user_id, uuid::Uuid::new_v4());
            let upload_result = self.upload_to_storage(
                &audio_data,
                "audio",
                &filename,
                supabase_url,
                access_token,
            ).await?;
            Some(upload_result.storage_path)
        } else {
            None
        };

        Ok(TranscriptionResult {
            text,
            storage_path,
            duration_ms: Some(estimated_duration_ms),
        })
    }

    /// Upload audio from base64 and return storage path
    pub async fn upload_audio_base64(
        &self,
        audio_base64: &str,
        user_id: &str,
        supabase_url: &str,
        access_token: &str,
    ) -> Result<AudioUploadResult, String> {
        // Decode base64 to bytes
        let audio_data = general_purpose::STANDARD.decode(audio_base64)
            .map_err(|e| format!("Invalid base64 audio data: {}", e))?;

        let filename = format!("{}/{}.wav", user_id, uuid::Uuid::new_v4());
        self.upload_to_storage(&audio_data, "audio", &filename, supabase_url, access_token).await
    }
}