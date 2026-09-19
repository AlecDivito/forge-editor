use serde::Serialize;
use tokio::io::{AsyncWrite, AsyncWriteExt};

const MAX_BODY: usize = 1024 * 1024;

/// Writes Content-Length framed DAP messages.
pub(crate) struct DapWriter<W> {
    inner: W,
}

impl<W: AsyncWrite + Unpin> DapWriter<W> {
    pub(crate) fn new(inner: W) -> Self {
        Self { inner }
    }

    pub(crate) async fn write<T: Serialize>(&mut self, value: &T) -> anyhow::Result<()> {
        let body = serde_json::to_vec(value)?;
        if body.len() > MAX_BODY {
            anyhow::bail!("DAP message exceeds limit");
        }
        self.inner
            .write_all(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes())
            .await?;
        self.inner.write_all(&body).await?;
        self.inner.flush().await?;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn bytes(&self) -> &[u8]
    where
        W: AsRef<[u8]>,
    {
        self.inner.as_ref()
    }

    #[cfg(test)]
    pub(crate) fn into_inner(self) -> W {
        self.inner
    }
}
