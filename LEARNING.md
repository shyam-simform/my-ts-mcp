# Learning MCP in TypeScript — course map

This project is the hands-on companion to Anthropic's *Introduction to Model
Context Protocol* course (taught in Python at
https://anthropic.skilljar.com/introduction-to-model-context-protocol). Every
lesson below has a matching, runnable, heavily-commented file in this repo.

## The three MCP primitives, in one paragraph each

- **Tools** — actions the *model* decides to invoke mid-conversation, based on
  a name/description/JSON-Schema you register. The client sends `tools/call`;
  the server runs your handler and returns a `CallToolResult`. Analogy:
  a function the LLM can call.
- **Resources** — data the *host application* (not the model) chooses to read
  and inject as context, via `resources/list` + `resources/read`. Analogy: a
  file the app hands the model, rather than a function the model calls.
- **Prompts** — reusable message templates the *user* explicitly selects
  (e.g. a slash command), via `prompts/list` + `prompts/get`. The server
  returns ready-made chat messages the client feeds straight to the LLM.

Underneath all three, MCP is just JSON-RPC 2.0 over a transport (this project
uses **stdio**: the client spawns the server as a subprocess and talks over
its stdin/stdout). The client and server first exchange an `initialize`
request/response — this is **capability negotiation**: the server only
advertises `tools`/`resources`/`prompts` if it actually registered any, and a
well-behaved client only calls the matching methods.

## Course → code map

| Skilljar module/lesson | Where to look |
|---|---|
| Introducing MCP | `src/client/shared.ts` — read the comment block, it walks through transport → handshake → capabilities |
| MCP Clients | `src/client/01-connect.ts` — `npm run client:connect` |
| Hands-on with MCP Servers → Project setup, Defining tools, Inspector | `src/server.ts` (already existed), `npm run dev` (Inspector) |
| Connecting with MCP Clients → Implementing a client | `src/client/01-connect.ts`, `src/client/02-call-tool.ts` |
| Connecting with MCP Clients → Defining resources | `src/server.ts`, the `server.resource("tasks", ...)` block near the bottom |
| Connecting with MCP Clients → Accessing resources | `src/client/03-resources.ts` — `npm run client:resources` |
| Connecting with MCP Clients → Defining prompts | `src/server.ts`, the `server.registerPrompt("work_update_prompt", ...)` block |
| Connecting with MCP Clients → Prompts in the client | `src/client/04-prompts.ts` (`npm run client:prompts`) and the `/prompt` command in `src/client/05-chatbot.ts` |
| Capstone (not a Skilljar lesson, but ties it all together) | `src/client/05-chatbot.ts` — `npm run client:chat`, a full agent loop: Groq LLM + MCP tools + MCP prompts |

## Running things

```bash
npm run dev               # MCP Inspector — poke at the server with a GUI
npm run client:connect    # Lesson 1: handshake, capabilities, tool list
npm run client:tools      # Lesson 2: call tools directly, see raw results
npm run client:resources  # Lesson 3: list + read a resource
npm run client:prompts    # Lesson 4: list + fetch a prompt template
npm run client:chat       # Capstone: interactive chatbot using all three
```

Each `client:*` script spawns its own copy of the server as a subprocess
(see `src/client/shared.ts`) — you don't need to run the server separately.

## Suggested exercises

1. **Add a second prompt.** Try a `learning_summary_prompt` mirroring
   `get_learning_summary`'s formatting instructions, then fetch it from
   `04-prompts.ts`.
2. **Add a resource for notes.** Register a `notes` resource next to the
   existing `tasks` one in `src/server.ts`, backed by `NOTES_FILE`, then read
   it from `03-resources.ts`.
3. **Break capability negotiation on purpose.** Comment out the
   `server.resource(...)` block, restart, and run `client.listResources()` —
   notice `client.getServerCapabilities()` no longer has a `resources` key at
   all, which is how a real client knows not to bother asking.
4. **Watch the agent loop reason.** In `05-chatbot.ts`, ask something that
   needs two tool calls in a row (e.g. "add a task to buy milk, then show me
   all my pending tasks") and watch the `→ calling MCP tool ...` lines to see
   the model chain calls.
