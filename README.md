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
