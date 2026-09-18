use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, BufReader};

const MAX_BODY: usize = 1024 * 1024;

/// Reads Content-Length framed DAP messages.
pub(crate) struct DapReader<R> {
    inner: BufReader<R>,
}

impl<R: AsyncRead + Unpin> DapReader<R> {
    pub(crate) fn new(inner: R) -> Self {
        Self {
            inner: BufReader::new(inner),
        }
    }

    pub(crate) async fn next(&mut self) -> anyhow::Result<Option<Value>> {
        let mut length = None;
        loop {
            let mut line = String::new();
            let bytes = self.inner.read_line(&mut line).await?;
            if bytes == 0 {
                return Ok(None);
            }
            let line = line.trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                break;
            }
            if let Some(value) = line.strip_prefix("Content-Length:") {
                length = Some(value.trim().parse::<usize>()?);
            }
        }
        let length = length.ok_or_else(|| anyhow::anyhow!("missing DAP Content-Length"))?;
        if length > MAX_BODY {
            anyhow::bail!("DAP message exceeds limit");
        }
        let mut body = vec![0; length];
        self.inner.read_exact(&mut body).await?;
        Ok(Some(serde_json::from_slice(&body)?))
    }
}
