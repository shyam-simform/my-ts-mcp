// ════════════════════════════════════════════════════════════════════════════
// LESSON 1 — Connecting & capability negotiation
// (maps to Skilljar: "Introducing MCP" + "MCP Clients")
//
// Run: npm run client:connect
//
// This is the smallest possible MCP client: connect, inspect what the server
// told us about itself, and list the tools it exposes. Nothing here calls a
// tool or reads data yet — this lesson is purely about the HANDSHAKE.
// ════════════════════════════════════════════════════════════════════════════

import { connectToServer } from "./shared.js";

const client = await connectToServer();

// getServerVersion()/getServerCapabilities() reflect exactly what the server
// returned in its `initialize` response — no guessing, no extra requests.
console.log("── Server identity ──────────────────────────");
console.log(client.getServerVersion());

console.log("\n── Negotiated capabilities ──────────────────");
// Our server (src/server.ts) registers tools, one resource, and (after this
// lesson's work) a prompt — so all three keys should be present here. If a
// server never called server.resource(...), the `resources` key would be
// missing entirely, and calling listResources() against it would fail.
console.log(client.getServerCapabilities());

// tools/list — ask the server to describe every tool it has registered.
// Each tool comes back with a JSON Schema (`inputSchema`) describing the
// arguments it accepts. This is exactly the schema an LLM tool-calling API
// (OpenAI, Groq, Anthropic) needs to decide when and how to call it — see
// 05-chatbot.ts for that in action.
const { tools } = await client.listTools();
console.log(`\n── ${tools.length} tools available ──────────────────`);
for (const tool of tools) {
  console.log(`\n• ${tool.name}`);
  console.log(`  ${tool.description}`);
}

await client.close();
