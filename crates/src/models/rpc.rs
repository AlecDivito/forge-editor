use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
};



#[derive(Debug, Clone, serde::Deserialize)]
pub struct JsonRpcError {
    pub code: i64,
    pub message: String,
}
impl std::fmt::Display for JsonRpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "LSP error {}: {}", self.code, self.message)
    }
}
impl std::error::Error for JsonRpcError {}

pub enum JsonRpcMessage {
    Response { id: i64, result: Result<serde_json::Value, JsonRpcError> },
    Notification { method: String, params: serde_json::Value },
    Request { id: i64, method: String },
}

impl JsonRpcMessage {
    /// Deliberately not `serde(untagged)` — with id/result/error all
    /// optional-shaped, untagged matching can silently pick the wrong
    /// variant. Checking presence of id/method by hand is unambiguous.
    fn parse(bytes: &[u8]) -> Option<Self> {
        let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
        let id = value.get("id").and_then(|v| v.as_i64());
        let method = value.get("method").and_then(|v| v.as_str()).map(str::to_string);

        match (id, method) {
            (None, Some(method)) => Some(Self::Notification {
                method,
                params: value.get("params").cloned().unwrap_or_default(),
            }),
            (Some(id), Some(method)) => Some(Self::Request { id, method }),
            (Some(id), None) => {
                let result = if let Some(err) = value.get("error") {
                    Err(serde_json::from_value(err.clone()).ok()?)
                } else {
                    Ok(value.get("result").cloned().unwrap_or(serde_json::Value::Null))
                };
                Some(Self::Response { id, result })
            }
            (None, None) => None,
        }
    }
}

pub struct LspFramedReader<R> {
    reader: BufReader<R>,
}

impl<R: tokio::io::AsyncRead + Unpin> LspFramedReader<R> {
    pub fn new(inner: R) -> Self {
        Self { reader: BufReader::new(inner) }
    }

    pub async fn next_message(&mut self) -> Option<JsonRpcMessage> {
        let mut content_length: Option<usize> = None;
        loop {
            let mut line = String::new();
            let n = self.reader.read_line(&mut line).await.ok()?;
            if n == 0 {
                return None; // EOF — process exited
            }
            let trimmed = line.trim_end();
            if trimmed.is_empty() {
                break; // blank line ends the header block
            }
            if let Some(v) = trimmed.strip_prefix("Content-Length:") {
                content_length = v.trim().parse().ok();
            }
        }
        let len = content_length?;
        let mut buf = vec![0u8; len];
        self.reader.read_exact(&mut buf).await.ok()?;
        JsonRpcMessage::parse(&buf)
    }
}