// ════════════════════════════════════════════════════════════════════════════
// LESSON 4 — Prompts
// (maps to Skilljar: "Defining prompts")
//
// Run: npm run client:prompts
//
// Prompts are the third MCP primitive, and the easiest to mix up with tools.
// The distinction is WHO decides to invoke it:
//   • Tool   → the MODEL decides, mid-conversation, based on the user's ask.
//   • Prompt → the USER (or the host app on their behalf, e.g. a "/" slash
//              command menu) explicitly picks it BEFORE the model runs.
//              The server hands back a ready-made list of chat messages —
//              often with instructions baked in — that the client then
//              feeds into the LLM as-is, or as a starting point.
//
// Our server registers one prompt, `work_update_prompt` (src/server.ts),
// which builds the exact "make this standup update sound professional"
// instruction that get_work_update also uses internally — except here it's
// exposed as a reusable template any MCP client can fetch and inspect.
// ════════════════════════════════════════════════════════════════════════════

import { connectToServer } from "./shared.js";

const client = await connectToServer();

// prompts/list — like tools/list, but for prompts. Each entry advertises its
// name, description, and the arguments it accepts (`arguments`, an array of
// { name, description, required }) so a client can render a form/menu.
const { prompts } = await client.listPrompts();
console.log("── Available prompts ────────────────────────");
for (const p of prompts) {
  console.log(`\n• ${p.name} — ${p.description}`);
  for (const arg of p.arguments ?? []) {
    console.log(`    - ${arg.name}${arg.required ? " (required)" : ""}: ${arg.description}`);
  }
}

// prompts/get — fill in the arguments and get back real chat messages.
// Note the shape: `{ messages: [{ role, content }] }` — this is intentionally
// close to an LLM chat-completion request body, because the whole point of a
// prompt is "hand this straight to the model."
const { messages } = await client.getPrompt({
  name: "work_update_prompt",
  arguments: {
    today_work: "fixed the login bug\nreviewed a PR",
    next_day_plan: "start the new client feature",
    blockers: "waiting on API keys",
  },
});

console.log("\n── Resulting prompt messages ────────────────");
for (const m of messages) {
  console.log(`[${m.role}]`);
  console.log(m.content.type === "text" ? m.content.text : m.content);
}

await client.close();
