use super::{reader::DapReader, writer::DapWriter};
use crate::debug::{
    DisconnectArguments, EmptyArguments, Event, InitializeArguments, LaunchArguments, Request,
    Response,
};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use tokio::io::{AsyncRead, AsyncWrite};

/// Typed DAP connection. It owns framing, request IDs, response matching, and
/// buffers events received while a request is awaiting its response.
pub(crate) struct DapClient<R, W> {
    reader: DapReader<R>,
    writer: DapWriter<W>,
    next_sequence: u64,
    pending_events: VecDeque<Event>,
    pending_responses: HashMap<u64, Response>,
}

impl<R, W> DapClient<R, W>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    pub(crate) fn new(reader: R, writer: W) -> Self {
        Self {
            reader: DapReader::new(reader),
            writer: DapWriter::new(writer),
            next_sequence: 1,
            pending_events: VecDeque::new(),
            pending_responses: HashMap::new(),
        }
    }

    pub(crate) async fn initialize(
        &mut self,
        arguments: InitializeArguments,
    ) -> anyhow::Result<()> {
        self.request("initialize", arguments).await
    }

    /// Sends launch and configurationDone before awaiting either response.
    ///
    /// This preserves the valid adapter behavior where launch does not respond
    /// until it has received configurationDone.
    pub(crate) async fn launch_and_configure(
        &mut self,
        arguments: LaunchArguments,
    ) -> anyhow::Result<()> {
        let launch = self.send_request("launch", arguments).await?;
        let configuration_done = self
            .send_request("configurationDone", EmptyArguments {})
            .await?;
        self.wait_for_response(launch).await?;
        self.wait_for_response(configuration_done).await
    }

    pub(crate) async fn disconnect(&mut self, terminate_debuggee: bool) -> anyhow::Result<()> {
        self.request("disconnect", DisconnectArguments { terminate_debuggee })
            .await
    }

    pub(crate) async fn next_event(&mut self) -> anyhow::Result<Option<Event>> {
        if let Some(event) = self.pending_events.pop_front() {
            return Ok(Some(event));
        }
        loop {
            let Some(message) = self.reader.next().await? else {
                return Ok(None);
            };
            if message["type"] == "event" {
                return Ok(Some(Event::from_message(message)));
            }
        }
    }

    async fn request<A: Serialize>(
        &mut self,
        command: &'static str,
        arguments: A,
    ) -> anyhow::Result<()> {
        let sequence = self.send_request(command, arguments).await?;
        self.wait_for_response(sequence).await
    }

    async fn send_request<A: Serialize>(
        &mut self,
        command: &'static str,
        arguments: A,
    ) -> anyhow::Result<u64> {
        let sequence = self.next_sequence;
        self.next_sequence += 1;
        self.writer
            .write(&Request {
                seq: sequence,
                kind: "request",
                command,
                arguments,
            })
            .await?;
        Ok(sequence)
    }

    async fn wait_for_response(&mut self, sequence: u64) -> anyhow::Result<()> {
        if let Some(response) = self.pending_responses.remove(&sequence) {
            return response_result(response, sequence);
        }
        loop {
            let message = self
                .reader
                .next()
                .await?
                .ok_or_else(|| anyhow::anyhow!("debug adapter closed the DAP connection"))?;
            if message["type"] == "event" {
                self.pending_events.push_back(Event::from_message(message));
                continue;
            }
            let response: Response = match serde_json::from_value::<Response>(message) {
                Ok(response) if response.kind == "response" => response,
                _ => continue,
            };
            if response.request_seq != sequence {
                self.pending_responses
                    .insert(response.request_seq, response);
                continue;
            }
            return response_result(response, sequence);
        }
    }
}

fn response_result(response: Response, sequence: u64) -> anyhow::Result<()> {
    if response.success {
        return Ok(());
    }
    anyhow::bail!(
        "debug adapter rejected request {sequence}: {}",
        response.message.unwrap_or_else(|| "unknown error".into())
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::debug::ResolvedConfiguration;
    use serde_json::Value;

    fn frame(value: Value) -> Vec<u8> {
        let body = serde_json::to_vec(&value).unwrap();
        format!("Content-Length: {}\r\n\r\n", body.len())
            .bytes()
            .chain(body)
            .collect()
    }

    #[tokio::test]
    async fn matches_responses_and_buffers_events() {
        let mut input = frame(serde_json::json!({
            "seq": 1, "type": "event", "event": "output",
            "body": { "category": "console", "output": "ready\\n" }
        }));
        input.extend(frame(serde_json::json!({
            "seq": 2, "type": "response", "request_seq": 1, "success": true
        })));
        let mut client = DapClient::new(input.as_slice(), Vec::new());

        client
            .initialize(InitializeArguments::forge("lldb"))
            .await
            .unwrap();

        assert!(
            matches!(client.next_event().await.unwrap(), Some(Event::Output { output, .. }) if output == "ready\\n")
        );
        let sent: Value = serde_json::from_slice(
            client
                .writer
                .bytes()
                .split(|byte| *byte == b'\n')
                .last()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(sent["command"], "initialize");
        assert_eq!(sent["arguments"]["adapterID"], "lldb");
    }

    #[tokio::test]
    async fn sends_configuration_done_before_waiting_for_launch() {
        let mut input = frame(serde_json::json!({
            "seq": 1, "type": "response", "request_seq": 1, "success": true
        }));
        input.extend(frame(serde_json::json!({
            "seq": 2, "type": "response", "request_seq": 2, "success": true
        })));
        let mut client = DapClient::new(input.as_slice(), Vec::new());

        client
            .launch_and_configure(LaunchArguments::from(&ResolvedConfiguration {
                id: "test".into(),
                name: "test".into(),
                adapter_type: "test".into(),
                program: "main".into(),
                cwd: ".".into(),
                args: vec![],
                env: Default::default(),
                stop_on_entry: false,
            }))
            .await
            .unwrap();

        let sent = String::from_utf8(client.writer.into_inner()).unwrap();
        assert!(sent.contains("\"command\":\"launch\""));
        assert!(sent.contains("\"command\":\"configurationDone\""));
    }
}
