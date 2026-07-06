// ════════════════════════════════════════════════════════════════════════════
// LESSON 3 — Resources
// (maps to Skilljar: "Defining resources" + "Accessing resources")
//
// Run: npm run client:resources
//
// Resources are the HOST-READABLE primitive: data the client/host chooses to
// pull in as context, rather than an action the model decides to invoke.
// Concretely: a tool is like a function call the model makes ("add_task");
// a resource is like a file the application decides to hand the model
// ("here's the full task list, for context"). The model itself never
// triggers resources/read — your application code does, usually to stuff
// the result into the conversation before asking the LLM anything.
// ════════════════════════════════════════════════════════════════════════════

import { connectToServer } from "./shared.js";

const client = await connectToServer();

// resources/list — every resource the server has registered, with its URI,
// a human title, and a description. Our server registers exactly one, in
// src/server.ts, backed by the same tasks.json file the add_task/list_tasks
// tools read and write.
const { resources } = await client.listResources();
console.log("── Available resources ──────────────────────");
for (const r of resources) {
  console.log(`\n• ${r.name} (${r.uri})`);
  console.log(`  ${r.description}`);
}

// resources/read — fetch the actual contents by URI. Note this is a raw
// read, not filtered or summarized: the server just returns whatever
// tasks.json currently holds, as a single text/json content block.
const taskResourceUri = resources[0]?.uri;
if (taskResourceUri) {
  const { contents } = await client.readResource({ uri: taskResourceUri });
  console.log("\n── Contents of the tasks resource ───────────");
  for (const c of contents) {
    console.log("text" in c ? c.text : `[binary blob, ${c.mimeType ?? "unknown type"}]`);
  }
}

await client.close();
