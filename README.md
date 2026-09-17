# Forge Editor

For forging your next project inside of a browser.

## 🚨 WARNING 🚨

This project is currently just my thoughts and playing around with ideas. Honestly it doesn't work right now because i don't have the time to polish it. Here is commit `fef7146` with files already created to show a demo of what i've worked on.


https://github.com/user-attachments/assets/38e25954-e881-4454-a3ec-4417a906170b


## Overview

Here's the pitch, what if we had a editor in the browser that anyone could visit and just start programming. The "editor" would run on the server and use a LSP-like protocol to communicate between the client and the server using websockets. The secret sauce to the idea would be that the editor is actually a large micro-service that is calling LSP's through network calls. By deploying an editor in this way, we can distribute it across multiple machines.

![image](https://github.com/user-attachments/assets/5d7cad1e-4e1f-4b4e-ba69-6fbf4e4b2719)

A rough sketch of some of my thoughts is below.

![image](https://github.com/user-attachments/assets/451f2339-a7ae-4aca-a22e-3e49bd282d48)

## Development

You need to setup redis. If you don't want to start a docker container, just run
the following in your terminal.

```bash
brew install redis
redis-server
```

You'll also need an S3 server with the following variables defined in `.env` file

```
S3_BUCKET="forge-editor"
AWS_ACCESS_KEY_ID=""
AWS_SECRET_ACCESS_KEY=""
# Create this folder
ROOT_PROJECT_DIRECTORY="./.workspace-cache"
```

### Installing language servers

You'll also need to install language servers so that you can effectively.

> [!WARNING]
> Only javascript has been tested a lot.

```bash
# Install gopls... lol idk how to do this.
# Installing markdown LSP
brew install marksman
# Installing Rust LSP
rustup component install rust-analyzer
# Install language servers for the Web
npm i -g typescript-language-server vscode-json-languageserver npm install vscode-markdown-languageservice vscode-html-languageserver-bin vscode-css-languageservice typescript
```

## Setup

Configure the Rust server with one or more project workspaces. Paths in the
JSON manifest are relative to `FORGE_WORKSPACES_ROOT`; physical roots are never
sent to the browser. Copy `.env.example` and adjust it for your machine:

```dotenv
PORT=8080
FORGE_ENVIRONMENT_ID=local
FORGE_ENVIRONMENT_NAME="Local projects"
FORGE_WORKSPACES_ROOT=/workspaces
FORGE_WORKSPACES_JSON='[{"id":"forge-editor","name":"Forge Editor","path":"forge-editor"}]'
FORGE_DEFAULT_WORKSPACE=forge-editor
```

Multiple workspaces require `FORGE_DEFAULT_WORKSPACE`. Configuration is read
once at startup. `BASE_DIRECTORY` remains available temporarily and creates a
single workspace named `default`.

Install the packages

```bash
npm i
```

Patch for web socket support (next.js doesn't support this out of the box)

```bash
npx next-ws-cli@latest patch
```

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```
# Debugging (phase 1)

Forge supports launch-only debugging through a server-owned adapter strategy.
Add `.vscode/launch.json` to a configured workspace:

```jsonc
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug app",
      "type": "forge-rust",
      "request": "launch",
      "program": "${workspaceFolder}/target/debug/app",
      "cwd": "${workspaceFolder}",
      "args": [],
      "env": {},
      "console": "internalConsole"
    }
  ]
}
```

The program and working directory must already exist and resolve inside the
workspace. JSON comments and trailing commas are accepted. Integrated terminal,
attach, command/config/environment substitutions, and arbitrary adapter commands
are intentionally rejected in phase 1.

### Debug adapter system dependencies

Debug adapters run on the Forge server, so these are server dependencies rather
than browser dependencies. Install the adapters for the languages the server is
expected to debug:

| `launch.json` type | Languages | Required server program | Transport |
| --- | --- | --- | --- |
| `forge-rust` | Rust and other native binaries | `lldb-dap` | stdio |
| `forge-go` | Go | `dlv` (Delve) | loopback TCP |
| `forge-node` | JavaScript and TypeScript | `node` and the VS Code `js-debug` `dapDebugServer.js` bundle | loopback TCP |
| `forge-python` | Python | `python3` with the `debugpy` module | stdio |

Typical development-machine installations are:

```bash
# Rust/native debugging (macOS)
brew install llvm

# Go debugging; make sure the resulting dlv binary is copied or linked into
# /usr/local/bin or another PATH directory available to the Forge service.
go install github.com/go-delve/delve/cmd/dlv@latest

# Python debugging. Use the same python3 installation visible to Forge.
python3 -m pip install debugpy
```

For JavaScript and TypeScript, build or install Microsoft's `vscode-js-debug`
adapter on the server and point Forge at its debug-server entry point:

```dotenv
FORGE_JS_DEBUG_SCRIPT=/opt/forge/js-debug/src/dapDebugServer.js
```

The configured file must be readable by the Forge service account. Forge starts
it as `node "$FORGE_JS_DEBUG_SCRIPT" <ephemeral-port>` and keeps the port bound
to loopback. The browser cannot select an adapter executable or network address.

Production images should pin adapter versions in their package/image manifest
instead of using floating installers such as `@latest`. A missing executable,
Python module, or JavaScript adapter bundle produces a sanitized failed-session
message without exposing the server path.
