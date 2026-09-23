use std::{path::PathBuf, sync::Arc, time::Duration};

use anyhow::{Context, Result, bail};
use aws_credential_types::{Credentials, provider::SharedCredentialsProvider};
use aws_sdk_s3::{Client, config::{BehaviorVersion, Builder, Region}, presigning::PresigningConfig};
use uuid::Uuid;

use crate::config::S3AttachmentConfig;

const UPLOAD_TTL: Duration = Duration::from_secs(15 * 60);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PreparedAttachment {
    pub attachment_id: String,
    pub object_key: String,
    pub upload_url: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AttachmentMetadata {
    pub attachment_id: String,
    pub object_key: String,
    pub filename: String,
    pub media_type: String,
    pub byte_size: u64,
    pub sha256: Option<String>,
}

/// S3-compatible object storage plus a disposable local read cache. The
/// session JSONL log remains the source of truth for attachment metadata.
#[derive(Clone, Debug)]
pub struct AttachmentStore {
    client: Option<Client>,
    bucket: Option<String>,
    cache_dir: PathBuf,
    max_attachment_bytes: u64,
    max_cache_bytes: u64,
}

impl AttachmentStore {
    pub fn new(config: Option<S3AttachmentConfig>, cache_dir: PathBuf, max_attachment_bytes: u64, max_cache_bytes: u64) -> Result<Arc<Self>> {
        std::fs::create_dir_all(&cache_dir)?;
        let (client, bucket) = match config {
            Some(config) => {
                let credentials = Credentials::new(
                    config.access_key_id,
                    config.secret_access_key,
                    None,
                    None,
                    "forge-config",
                );
                let sdk_config = Builder::new()
                    // Required by AWS SDK v1. MinIO speaks the S3 protocol;
                    // this selects client behavior, not an AWS-only backend.
                    .behavior_version(BehaviorVersion::latest())
                    .region(Region::new(config.region))
                    .credentials_provider(SharedCredentialsProvider::new(credentials))
                    .endpoint_url(config.endpoint)
                    .force_path_style(true)
                    .build();
                (Some(Client::from_conf(sdk_config)), Some(config.bucket))
            }
            None => (None, None),
        };
        Ok(Arc::new(Self { client, bucket, cache_dir, max_attachment_bytes, max_cache_bytes }))
    }

    pub fn is_configured(&self) -> bool {
        self.client.is_some()
    }

    pub async fn prepare(&self, session_id: &str, filename: String, media_type: String, byte_size: u64, sha256: Option<String>) -> Result<(AttachmentMetadata, PreparedAttachment)> {
        validate_metadata(&filename, &media_type, byte_size, self.max_attachment_bytes, sha256.as_deref())?;
        let (client, bucket) = self.client_and_bucket()?;
        let attachment_id = Uuid::new_v4().to_string();
        let object_key = format!("sessions/{session_id}/attachments/{attachment_id}");
        let metadata = AttachmentMetadata { attachment_id: attachment_id.clone(), object_key: object_key.clone(), filename, media_type: media_type.clone(), byte_size, sha256 };
        let request = client
            .put_object()
            .bucket(bucket)
            .key(&object_key)
            .content_type(media_type)
            .content_length(i64::try_from(byte_size).context("attachment is too large")?);
        let signed = request
            .presigned(
                PresigningConfig::expires_in(UPLOAD_TTL)
                    .context("could not configure attachment upload")?,
            )
            .await
            .context("could not prepare attachment upload")?;
        Ok((metadata, PreparedAttachment { attachment_id, object_key, upload_url: signed.uri().to_string() }))
    }

    pub async fn verify_uploaded(&self, attachment: &AttachmentMetadata) -> Result<Option<String>> {
        let (client, bucket) = self.client_and_bucket()?;
        let object = client
            .head_object()
            .bucket(bucket)
            .key(&attachment.object_key)
            .send()
            .await
            .context("uploaded attachment is unavailable")?;
        if object.content_length.unwrap_or_default() != i64::try_from(attachment.byte_size).unwrap_or(i64::MAX) {
            bail!("uploaded attachment size does not match the prepared metadata");
        }
        if object.content_type.as_deref() != Some(attachment.media_type.as_str()) {
            bail!("uploaded attachment media type does not match the prepared metadata");
        }
        Ok(object.e_tag)
    }

    pub async fn abandon(&self, object_key: &str) -> Result<()> {
        let (client, bucket) = self.client_and_bucket()?;
        client.delete_object().bucket(bucket).key(object_key).send().await
            .context("could not delete abandoned attachment")?;
        Ok(())
    }

    pub async fn download_url(&self, attachment: &AttachmentMetadata) -> Result<String> {
        let (client, bucket) = self.client_and_bucket()?;
        client
            .get_object()
            .bucket(bucket)
            .key(&attachment.object_key)
            .presigned(
                PresigningConfig::expires_in(UPLOAD_TTL)
                    .context("could not configure attachment download")?,
            )
            .await
            .map(|request| request.uri().to_string())
            .context("could not prepare attachment download")
    }

    pub async fn cached_data_url(&self, attachment: &AttachmentMetadata) -> Result<String> {
        let cache_path = self.cache_dir.join(&attachment.attachment_id);
        let bytes = match tokio::fs::read(&cache_path).await {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let (client, bucket) = self.client_and_bucket()?;
                let object = client.get_object().bucket(bucket).key(&attachment.object_key).send().await
                    .context("could not download attachment")?;
                let bytes = object.body.collect().await
                    .context("could not read attachment")?
                    .into_bytes();
                tokio::fs::write(&cache_path, &bytes).await
                    .context("could not cache attachment")?;
                self.trim_cache().await?;
                bytes.to_vec()
            }
            Err(error) => return Err(error).context("could not read attachment cache"),
        };
        use base64::{Engine as _, engine::general_purpose::STANDARD};
        Ok(format!("data:{};base64,{}", attachment.media_type, STANDARD.encode(bytes)))
    }

    fn client_and_bucket(&self) -> Result<(&Client, &str)> {
        match (&self.client, &self.bucket) {
            (Some(client), Some(bucket)) => Ok((client, bucket)),
            _ => bail!("image attachment storage is not configured"),
        }
    }

    /// Keeps the disposable model-input cache bounded. Durable attachment
    /// metadata always remains in the session log, so evicted bytes can be
    /// fetched from object storage again on demand.
    async fn trim_cache(&self) -> Result<()> {
        let mut directory = tokio::fs::read_dir(&self.cache_dir).await
            .context("could not inspect attachment cache")?;
        let mut entries = Vec::new();
        let mut total = 0_u64;
        while let Some(entry) = directory.next_entry().await.context("could not read attachment cache")? {
            let metadata = entry.metadata().await.context("could not inspect attachment cache entry")?;
            if !metadata.is_file() {
                continue;
            }
            let size = metadata.len();
            total = total.saturating_add(size);
            entries.push((entry.path(), size, metadata.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH)));
        }
        entries.sort_by_key(|(_, _, modified)| *modified);
        for (path, size, _) in entries {
            if total <= self.max_cache_bytes {
                break;
            }
            tokio::fs::remove_file(&path).await
                .with_context(|| format!("could not evict attachment cache entry {}", path.display()))?;
            total = total.saturating_sub(size);
        }
        Ok(())
    }
}

fn validate_metadata(filename: &str, media_type: &str, byte_size: u64, max_attachment_bytes: u64, sha256: Option<&str>) -> Result<()> {
    if filename.trim().is_empty() || filename.len() > 255 || filename.chars().any(char::is_control) {
        bail!("attachment filename is invalid");
    }
    if !matches!(media_type, "image/png" | "image/jpeg" | "image/webp" | "image/gif") {
        bail!("only PNG, JPEG, WebP, and GIF attachments are supported");
    }
    if byte_size == 0 || byte_size > max_attachment_bytes {
        bail!("attachment must be between 1 byte and {max_attachment_bytes} bytes");
    }
    if let Some(sha256) = sha256 {
        if sha256.len() != 64 || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            bail!("attachment SHA-256 is invalid");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_metadata;

    #[test]
    fn accepts_supported_image_metadata() {
        assert!(validate_metadata("diagram.png", "image/png", 42, 20 * 1024 * 1024, None).is_ok());
        assert!(validate_metadata(
            "diagram.webp",
            "image/webp",
            42,
            20 * 1024 * 1024,
            Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        ).is_ok());
    }

    #[test]
    fn rejects_unsafe_or_unsupported_image_metadata() {
        assert!(validate_metadata("", "image/png", 1, 10, None).is_err());
        assert!(validate_metadata("bad\nname.png", "image/png", 1, 10, None).is_err());
        assert!(validate_metadata("document.pdf", "application/pdf", 1, 10, None).is_err());
        assert!(validate_metadata("empty.png", "image/png", 0, 10, None).is_err());
        assert!(validate_metadata("large.png", "image/png", 11, 10, None).is_err());
        assert!(validate_metadata("image.png", "image/png", 1, 10, Some("not-a-hash")).is_err());
    }

}
