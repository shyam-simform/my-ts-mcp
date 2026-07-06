// ════════════════════════════════════════════════════════════════════════════
// LESSON 2 — Calling a tool
// (maps to Skilljar: "Hands-on with MCP Servers" — defining tools, client side)
//
// Run: npm run client:tools
//
// Tools are the MODEL-INVOKED primitive: in a real chatbot, the LLM decides
// which tool to call and with what arguments, based on the tool's name,
// description, and inputSchema (see 01-connect.ts). Here we skip the LLM and
// call tools directly so you can see the raw request/response shape MCP uses
// underneath — this is exactly what 05-chatbot.ts will do on the model's
// behalf.
// ════════════════════════════════════════════════════════════════════════════

import { connectToServer } from "./shared.js";

const client = await connectToServer();

// tools/call takes a tool name + an arguments object matching its
// inputSchema. The server validates those arguments (with zod, in our case)
// before running the tool's handler.
const addResult = await client.callTool({
  name: "add_task",
  arguments: { text: "Practice the MCP client lessons" },
});

// Every tool result is a CallToolResult: `{ content: [...], isError?: bool }`.
// `content` is an array of content BLOCKS (text, image, embedded resource...)
// — never a bare string — because a single tool call can return multiple
// pieces of mixed content. Our server's tools only ever return one text
// block, but the shape always allows for more.
console.log("── add_task result ──────────────────────────");
console.log(addResult.content);

const listResult = await client.callTool({
  name: "list_tasks",
  arguments: { filter: "pending" },
});

console.log("\n── list_tasks result ────────────────────────");
console.log(listResult.content);

// Tools can also fail on purpose (see McpError usage in src/server.ts, e.g.
// complete_task with a bad id). Try it:
const errorResult = await client.callTool({
  name: "complete_task",
  arguments: { id: 999999999 },
});
console.log("\n── complete_task with a bad id ──────────────");
console.log("isError:", errorResult.isError);
console.log(errorResult.content);

await client.close();
