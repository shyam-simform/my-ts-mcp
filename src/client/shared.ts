// ════════════════════════════════════════════════════════════════════════════
// SHARED CLIENT PLUMBING
//
// Every MCP conversation starts the same way, no matter which primitive
// (tools/resources/prompts) you end up using:
//
//   1. A TRANSPORT is opened between client and server. MCP doesn't care how
//      bytes move — stdio (spawn a subprocess, talk over stdin/stdout),
//      Streamable HTTP, or others. This project uses stdio because our
//      server (src/server.ts) is a local subprocess, exactly like the one
//      already configured in .vscode/mcp.json for VS Code's built-in client.
//
//   2. The client sends an `initialize` JSON-RPC request declaring who it is
//      and what it supports (its "capabilities"). The server replies with
//      its own name/version and capabilities (does it have tools? resources?
//      prompts?). This is CAPABILITY NEGOTIATION — the client should only
//      attempt e.g. `prompts/list` if the server actually advertised the
//      `prompts` capability.
//
//   3. Once connected, the client can send requests: `tools/list`,
//      `tools/call`, `resources/list`, `resources/read`, `prompts/list`,
//      `prompts/get`, etc. Every one of the `NN-*.ts` files in this folder
//      calls `connectToServer()` below and then exercises one of those.
// ════════════════════════════════════════════════════════════════════════════

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = join(__dirname, "../server.ts");

export async function connectToServer(): Promise<Client> {
  // The transport spawns `npx tsx src/server.ts` as a child process and pipes
  // JSON-RPC messages over its stdin/stdout. This is identical to how the
  // Inspector (npm run dev) and VS Code launch our server — we're just doing
  // it ourselves in code instead of letting a GUI tool do it for us.
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", SERVER_ENTRY],
  });

  // The Client's first argument is OUR identity (shown to the server, mostly
  // useful for logging/debugging on the server side). The second argument's
  // `capabilities` object is what we, the client, support — for example
  // `sampling: {}` would tell the server "you may ask me to run an LLM
  // completion on your behalf." We don't support that yet, so it's empty.
  const client = new Client(
    { name: "learning-mcp-client", version: "1.0.0" },
    { capabilities: {} },
  );

  // client.connect() performs the transport handshake AND the MCP
  // `initialize` request/response in one call.
  await client.connect(transport);

  return client;
}
