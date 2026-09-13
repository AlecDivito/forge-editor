use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};

const MAX_BODY: usize = 1024 * 1024;

pub async fn write_message<W: AsyncWrite + Unpin>(
    writer: &mut W,
    value: &Value,
) -> anyhow::Result<()> {
    let body = serde_json::to_vec(value)?;
    if body.len() > MAX_BODY {
        anyhow::bail!("DAP message exceeds limit");
    }
    writer
        .write_all(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes())
        .await?;
    writer.write_all(&body).await?;
    writer.flush().await?;
    Ok(())
}

pub struct Reader<R> {
    inner: BufReader<R>,
}
impl<R: AsyncRead + Unpin> Reader<R> {
    pub fn new(inner: R) -> Self {
        Self {
            inner: BufReader::new(inner),
        }
    }
    pub async fn next(&mut self) -> anyhow::Result<Option<Value>> {
        let mut len = None;
        loop {
            let mut line = String::new();
            let n = self.inner.read_line(&mut line).await?;
            if n == 0 {
                return Ok(None);
            }
            let line = line.trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                break;
            }
            if let Some(v) = line.strip_prefix("Content-Length:") {
                len = Some(v.trim().parse::<usize>()?);
            }
        }
        let len = len.ok_or_else(|| anyhow::anyhow!("missing DAP Content-Length"))?;
        if len > MAX_BODY {
            anyhow::bail!("DAP message exceeds limit")
        }
        let mut body = vec![0; len];
        self.inner.read_exact(&mut body).await?;
        Ok(Some(serde_json::from_slice(&body)?))
    }
}

pub fn request(seq: u64, command: &str, arguments: Value) -> Value {
    json!({"seq":seq,"type":"request","command":command,"arguments":arguments})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn reads_coalesced_frames() {
        let mut bytes = vec![];
        write_message(&mut bytes, &json!({"a":1})).await.unwrap();
        write_message(&mut bytes, &json!({"b":2})).await.unwrap();
        let mut reader = Reader::new(bytes.as_slice());
        assert_eq!(reader.next().await.unwrap().unwrap()["a"], 1);
        assert_eq!(reader.next().await.unwrap().unwrap()["b"], 2);
    }
}
