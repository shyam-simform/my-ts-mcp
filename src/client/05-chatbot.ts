// ════════════════════════════════════════════════════════════════════════════
// LESSON 5 (capstone) — An interactive chatbot client
// (maps to Skilljar: "Implementing a client" + "Prompts in the client")
//
// Run: npm run client:chat
//
// This is the payoff of lessons 1-4, wired together into one real loop:
//
//   MCP server  <--stdio-->  THIS CLIENT  <--HTTP-->  Groq LLM
//
// MCP itself never talks to an LLM — it's just the protocol for tools,
// resources, and prompts. The LLM call is entirely our client's job. The
// "agent loop" is:
//   1. User types a message.
//   2. We send it to Groq along with the MCP tool list, converted into
//      Groq's function-calling schema (they're both just JSON Schema under
//      the hood, so the conversion is mostly a rename).
//   3. If Groq's response contains tool_calls, WE (the client) execute them
//      via client.callTool(...) — Groq never touches the MCP server
//      directly — and feed the results back to Groq as `tool` messages.
//   4. Repeat until Groq responds with plain text instead of a tool call.
//
// A `/prompt <name> <jsonArgs>` slash command demonstrates "prompts in the
// client": instead of the model deciding to call something, the USER
// explicitly asks for a prompt template, and we seed the conversation with
// the messages the server hands back.
// ════════════════════════════════════════════════════════════════════════════

import Groq from "groq-sdk";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "groq-sdk/resources/chat/completions";
import readline from "node:readline/promises";
import { connectToServer } from "./shared.js";

const client = await connectToServer();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
// Llama models on Groq emit tool calls as raw text in a "<function=name>{...}</function>"
// format, and llama-3.3-70b-versatile frequently malforms it (e.g. drops the closing
// ">" after the function name), which surfaces as a tool_use_failed 400 from the API.
// gpt-oss uses OpenAI's native structured tool-calling instead of that text format,
// so it doesn't have this failure mode.
const MODEL = "openai/gpt-oss-20b";

// ── Step 2 setup: convert MCP tools -> Groq's tool-calling format ──────────
// An MCP tool is { name, description, inputSchema } where inputSchema is
// plain JSON Schema. Groq (and OpenAI, Anthropic, etc.) all want that same
// JSON Schema, just nested one level deeper under `function.parameters`.
const { tools: mcpTools } = await client.listTools();
const groqTools: ChatCompletionTool[] = mcpTools.map((t) => {
  // Clone and remove $schema field which confuses some LLM APIs
  const parameters = JSON.parse(JSON.stringify(t.inputSchema));
  delete parameters.$schema;

  return {
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters,
    },
  };
});

const messages: ChatCompletionMessageParam[] = [
  {
    role: "system",
    content: "You are a helpful assistant with access to tools via MCP. Use tools when requested.",
  },
];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log("MCP chatbot ready. Type a message, or /prompt work_update_prompt to try a prompt template. Ctrl+C to quit.\n");

let closed = false;
rl.on("close", () => {
  closed = true;
});

while (!closed) {
  const userInput = await rl.question("you> ").catch(() => "");
  if (closed) break;
  if (!userInput.trim()) continue;

  // ── "Prompts in the client" ────────────────────────────────────────────
  // A slash command is a common host-app pattern for surfacing MCP prompts:
  // the user picks the prompt by name, we call prompts/get, and splice the
  // returned messages straight into the conversation — no LLM round trip
  // needed just to fetch the template.
  if (userInput.startsWith("/prompt ")) {
    const [name, ...rest] = userInput.slice("/prompt ".length).trim().split(" ");
    let args: Record<string, string> = {};
    if (rest.length) {
      try {
        args = JSON.parse(rest.join(" "));
      } catch {
        console.log(`Couldn't parse arguments as JSON, ignoring: ${rest.join(" ")}`);
      }
    }
    const { messages: promptMessages } = await client.getPrompt({ name, arguments: args });
    for (const m of promptMessages) {
      if (m.content.type === "text") {
        messages.push({ role: m.role as "user" | "assistant", content: m.content.text });
        console.log(`[loaded ${m.role} message from prompt "${name}"]`);
      }
    }
    continue;
  }

  // ── Direct tool shortcut: weather ───────────────────────────────────────
  // Weather is a pure API lookup — there's no reformatting, summarizing, or
  // reasoning step where an LLM adds value. Routing it through Groq only
  // exists to let the MODEL decide when to call get_weather, but that
  // decision is trivial to make ourselves with a regex, and it sidesteps
  // Groq's flaky tool-calling entirely. Groq stays reserved for the tasks
  // it's actually good at: rewriting/summarizing work updates and learning
  // logs (see save_work_update / get_work_update / get_learning_summary).
  const weatherMatch = userInput.match(/weather.*?\bin\b\s+(?:the\s+)?([a-zA-Z\s]+?)[?.!]*$/i);
  if (weatherMatch) {
    const city = weatherMatch[1].trim();
    console.log(`  → calling MCP tool get_weather({"city":"${city}"}) [direct, no LLM]`);
    const result = await client.callTool({ name: "get_weather", arguments: { city } });
    const content = result.content as Array<{ type: string; text?: string }>;
    const text = content.map((c) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n");
    console.log(`assistant> ${text}\n`);
    continue;
  }

  messages.push({ role: "user", content: userInput });

  // ── The agent loop ──────────────────────────────────────────────────────
  // Keep going as long as Groq keeps asking for tool calls; stop as soon as
  // it answers with plain text.
  while (true) {
    let response;
    try {
      response = await groq.chat.completions.create({
        model: MODEL,
        messages,
        tools: groqTools,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("tool_use_failed")) {
        console.log("  ⚠ Tool call failed. Try rephrasing or restart the session.");
        break;
      }
      throw error;
    }

    const choice = response.choices[0]?.message;
    if (!choice) break;
    messages.push(choice as ChatCompletionMessageParam);

    if (!choice.tool_calls?.length) {
      console.log(`assistant> ${choice.content}\n`);
      break;
    }

    // Step 3: execute every requested tool call via the real MCP server,
    // then report each result back as a `tool` role message so the model
    // can use it to form its final answer.
    for (const call of choice.tool_calls) {
      const args = JSON.parse(call.function.arguments || "{}");
      console.log(`  → calling MCP tool ${call.function.name}(${JSON.stringify(args)})`);

      const result = await client.callTool({ name: call.function.name, arguments: args });
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content
        .map((c) => (c.type === "text" ? c.text : JSON.stringify(c)))
        .join("\n");

      messages.push({ role: "tool", tool_call_id: call.id, content: text });
    }
  }
}

await client.close();
