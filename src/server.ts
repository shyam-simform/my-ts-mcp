import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

// ─── Data file paths ────────────────────────────────────────────────────────
const DATA_DIR = process.env.HOME + "/Documents/mcp-data";
const TASKS_FILE = join(DATA_DIR, "tasks.json");
const NOTES_FILE = join(DATA_DIR, "notes.json");

// ─── Helper: load / save JSON safely ────────────────────────────────────────
function loadJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function saveJson(path: string, data: unknown): void {
  import("fs").then(fs => fs.mkdirSync(DATA_DIR, { recursive: true }));
  writeFileSync(path, JSON.stringify(data, null, 2));
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface Task { id: number; text: string; done: boolean; createdAt: string; }
interface Note { id: number; title: string; body: string; createdAt: string; }

// ─── Server setup ────────────────────────────────────────────────────────────
const server = new McpServer({
  name: "daily-assistant",
  version: "1.0.0",
});

// ════════════════════════════════════════════════════════════════════════════
// TOOL 1 — Add a task
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "add_task",
  "Add a new task to your personal to-do list",
  {
    text: z.string().min(1).max(200).describe("The task to add"),
  },
  async ({ text }) => {
    const tasks = loadJson<Task[]>(TASKS_FILE, []);
    const newTask: Task = {
      id: Date.now(),
      text,
      done: false,
      createdAt: new Date().toISOString(),
    };
    tasks.push(newTask);
    saveJson(TASKS_FILE, tasks);

    return {
      content: [{ type: "text", text: `✅ Added task: "${text}"` }],
    };
  }
);

// ════════════════════════════════════════════════════════════════════════════
// TOOL 2 — List tasks
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "list_tasks",
  "Show all your current tasks — pending and completed",
  {
    filter: z
      .enum(["all", "pending", "done"])
      .default("pending")
      .describe("Which tasks to show"),
  },
  async ({ filter }) => {
    const tasks = loadJson<Task[]>(TASKS_FILE, []);

    const filtered = tasks.filter(t => {
      if (filter === "pending") return !t.done;
      if (filter === "done") return t.done;
      return true;
    });

    if (filtered.length === 0) {
      return {
        content: [{ type: "text", text: `No ${filter} tasks found.` }],
      };
    }

    const lines = filtered.map(t => {
      const status = t.done ? "☑" : "☐";
      const date = new Date(t.createdAt).toLocaleDateString("en-IN");
      return `${status} [${t.id}] ${t.text} — added ${date}`;
    });

    return {
      content: [{
        type: "text",
        text: `Your ${filter} tasks:\n\n${lines.join("\n")}`,
      }],
    };
  }
);

// ════════════════════════════════════════════════════════════════════════════
// TOOL 3 — Complete a task
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "complete_task",
  "Mark a task as done using its ID",
  {
    id: z.number().int().positive().describe("Task ID from the list"),
  },
  async ({ id }) => {
    const tasks = loadJson<Task[]>(TASKS_FILE, []);
    const task = tasks.find(t => t.id === id);

    if (!task) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `No task found with ID ${id}. Use list_tasks to see valid IDs.`
      );
    }

    if (task.done) {
      return {
        content: [{ type: "text", text: `Task "${task.text}" is already done!` }],
      };
    }

    task.done = true;
    saveJson(TASKS_FILE, tasks);

    return {
      content: [{ type: "text", text: `🎉 Completed: "${task.text}"` }],
    };
  }
);

// ════════════════════════════════════════════════════════════════════════════
// TOOL 4 — Save a note
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "save_note",
  "Save a personal note with a title and body text",
  {
    title: z.string().min(1).max(100).describe("Short title for the note"),
    body: z.string().min(1).describe("Full content of the note"),
  },
  async ({ title, body }) => {
    const notes = loadJson<Note[]>(NOTES_FILE, []);
    const note: Note = {
      id: Date.now(),
      title,
      body,
      createdAt: new Date().toISOString(),
    };
    notes.push(note);
    saveJson(NOTES_FILE, notes);

    return {
      content: [{ type: "text", text: `📝 Note saved: "${title}"` }],
    };
  }
);

// ════════════════════════════════════════════════════════════════════════════
// TOOL 5 — Search notes
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "search_notes",
  "Search your saved notes by keyword",
  {
    query: z.string().min(1).describe("Keyword or phrase to search for"),
  },
  async ({ query }) => {
    const notes = loadJson<Note[]>(NOTES_FILE, []);
    const q = query.toLowerCase();

    const matches = notes.filter(
      n => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)
    );

    if (matches.length === 0) {
      return {
        content: [{ type: "text", text: `No notes found matching "${query}"` }],
      };
    }

    const results = matches.map(n => {
      const date = new Date(n.createdAt).toLocaleDateString("en-IN");
      return `📄 ${n.title} (${date})\n   ${n.body.substring(0, 100)}...`;
    });

    return {
      content: [{
        type: "text",
        text: `Found ${matches.length} note(s) for "${query}":\n\n${results.join("\n\n")}`,
      }],
    };
  }
);

// ════════════════════════════════════════════════════════════════════════════
// TOOL 6 — Get weather (free API, no key needed)
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "get_weather",
  "Get current weather for any city — no API key needed",
  {
    city: z.string().describe("City name e.g. Ahmedabad, Mumbai, Delhi"),
  },
  async ({ city }) => {
    try {
      // Normalize and extract a sensible city name from the input.
      // The tool may receive a full question like "What is the weather in the rajkot?\n"
      let cityInput = String(city ?? "");
      // Replace newlines with spaces and collapse whitespace
      cityInput = cityInput.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
      // Prefer last occurrence of ' in ' or ' at ' to capture city names
      const low = cityInput.toLowerCase();
      const idxIn = low.lastIndexOf(" in ");
      const idxAt = low.lastIndexOf(" at ");
      if (idxIn !== -1 || idxAt !== -1) {
        const idx = Math.max(idxIn, idxAt);
        cityInput = cityInput.slice(idx + 4).trim();
      } else {
        // Fallback: remove common leading phrasing
        cityInput = cityInput.replace(/^(?:what(?:'|\u2019)?s|what is|tell me the weather in|weather in)[:\s-]*/i, "").trim();
      }
      // Remove leading 'the' (e.g. 'the rajkot')
      cityInput = cityInput.replace(/^the\s+/i, "").trim();
      // Strip surrounding quotes, whitespace and common trailing punctuation
      cityInput = cityInput.replace(/^[\s'"`]+|[\s'"`?.!,:;]+$/g, "").trim();

      // Step 1: geocode the city
      const geoResp = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityInput)}&count=1`
      );
      const geo = await geoResp.json() as { results?: Array<{ latitude: number; longitude: number; name: string; country: string }> };

      if (!geo.results?.[0]) {
        throw new McpError(ErrorCode.InvalidParams, `City "${cityInput}" not found.`);
      }

      const { latitude: lat, longitude: lon, name, country } = geo.results[0];

      // Step 2: get weather
      const wxResp = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,windspeed_10m,weathercode`
      );
      const wx = await wxResp.json() as {
        current: { temperature_2m: number; relative_humidity_2m: number; windspeed_10m: number; weathercode: number };
      };

      const { temperature_2m: temp, relative_humidity_2m: humidity, windspeed_10m: wind } = wx.current;

      return {
        content: [{
          type: "text",
          text: `🌤 Weather in ${name}, ${country}:\n  Temperature: ${temp}°C\n  Humidity: ${humidity}%\n  Wind: ${wind} km/h`,
        }],
      };
    } catch (err) {
      if (err instanceof McpError) throw err;
      throw new McpError(ErrorCode.InternalError, `Weather fetch failed: ${err}`);
    }
  }
);

// ─── Start the server ────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);