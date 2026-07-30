import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { config } from "dotenv";
import Groq from "groq-sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../.env") });

// ─── Data file paths ────────────────────────────────────────────────────────
const DATA_DIR = process.env.HOME + "/Documents/mcp-data";
const TASKS_FILE = join(DATA_DIR, "tasks.json");
const NOTES_FILE = join(DATA_DIR, "notes.json");
const STANDUPS_FILE = join(DATA_DIR, "standups.json");
const LEARNING_FILE = join(DATA_DIR, "learning.json");
const COMPLETED_FEATURES_FILE = join(DATA_DIR, "completed-features.json");

// ─── Helper: load / save JSON safely ────────────────────────────────────────
function loadJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function saveJson(path: string, data: unknown): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

// ─── Helper: detect current repo/project name from cwd ─────────────────────
function detectProjectName(): string {
  try {
    const topLevel = execSync("git rev-parse --show-toplevel", {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return basename(topLevel);
  } catch {
    return basename(process.cwd());
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface Task {
  id: number;
  text: string;
  done: boolean;
  createdAt: string;
}
interface Note {
  id: number;
  title: string;
  body: string;
  createdAt: string;
}
interface LearningEntry {
  id: number;
  date: string;
  topic: string;
  resource: string;
  duration: number;
  notes: string;
  createdAt: string;
}
interface Standup {
  id: number;
  date: string;
  todayWork: string[];
  nextDayPlan: string[];
  blockers: string;
  createdAt: string;
}
interface CompletedFeature {
  id: number;
  date: string;
  summary: string;
  project?: string;
  createdAt: string;
}

// ─── Groq client ─────────────────────────────────────────────────────────────
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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
  },
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

    const filtered = tasks.filter((t) => {
      if (filter === "pending") return !t.done;
      if (filter === "done") return t.done;
      return true;
    });

    if (filtered.length === 0) {
      return {
        content: [{ type: "text", text: `No ${filter} tasks found.` }],
      };
    }

    const lines = filtered.map((t) => {
      const status = t.done ? "☑" : "☐";
      const date = new Date(t.createdAt).toLocaleDateString("en-IN");
      return `${status} [${t.id}] ${t.text} — added ${date}`;
    });

    return {
      content: [
        {
          type: "text",
          text: `Your ${filter} tasks:\n\n${lines.join("\n")}`,
        },
      ],
    };
  },
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
    const task = tasks.find((t) => t.id === id);

    if (!task) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `No task found with ID ${id}. Use list_tasks to see valid IDs.`,
      );
    }

    if (task.done) {
      return {
        content: [
          { type: "text", text: `Task "${task.text}" is already done!` },
        ],
      };
    }

    task.done = true;
    saveJson(TASKS_FILE, tasks);

    return {
      content: [{ type: "text", text: `🎉 Completed: "${task.text}"` }],
    };
  },
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
  },
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
      (n) =>
        n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q),
    );

    if (matches.length === 0) {
      return {
        content: [{ type: "text", text: `No notes found matching "${query}"` }],
      };
    }

    const results = matches.map((n) => {
      const date = new Date(n.createdAt).toLocaleDateString("en-IN");
      return `📄 ${n.title} (${date})\n   ${n.body.substring(0, 100)}...`;
    });

    return {
      content: [
        {
          type: "text",
          text: `Found ${matches.length} note(s) for "${query}":\n\n${results.join("\n\n")}`,
        },
      ],
    };
  },
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
        cityInput = cityInput
          .replace(
            /^(?:what(?:'|\u2019)?s|what is|tell me the weather in|weather in)[:\s-]*/i,
            "",
          )
          .trim();
      }
      // Remove leading 'the' (e.g. 'the rajkot')
      cityInput = cityInput.replace(/^the\s+/i, "").trim();
      // Strip surrounding quotes, whitespace and common trailing punctuation
      cityInput = cityInput.replace(/^[\s'"`]+|[\s'"`?.!,:;]+$/g, "").trim();

      // Step 1: geocode the city
      const geoResp = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityInput)}&count=1`,
      );
      const geo = (await geoResp.json()) as {
        results?: Array<{
          latitude: number;
          longitude: number;
          name: string;
          country: string;
        }>;
      };

      if (!geo.results?.[0]) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `City "${cityInput}" not found.`,
        );
      }

      const { latitude: lat, longitude: lon, name, country } = geo.results[0];

      // Step 2: get weather
      const wxResp = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,windspeed_10m,weathercode`,
      );
      const wx = (await wxResp.json()) as {
        current: {
          temperature_2m: number;
          relative_humidity_2m: number;
          windspeed_10m: number;
          weathercode: number;
        };
      };

      const {
        temperature_2m: temp,
        relative_humidity_2m: humidity,
        windspeed_10m: wind,
      } = wx.current;

      return {
        content: [
          {
            type: "text",
            text: `🌤 Weather in ${name}, ${country}:\n  Temperature: ${temp}°C\n  Humidity: ${humidity}%\n  Wind: ${wind} km/h`,
          },
        ],
      };
    } catch (err) {
      if (err instanceof McpError) throw err;
      throw new McpError(
        ErrorCode.InternalError,
        `Weather fetch failed: ${err}`,
      );
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// TOOL 7 — Save work update
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "save_work_update",
  "Save your daily work update: what you completed today and your plan for the next day",
  {
    today_work: z
      .array(z.string().min(1))
      .min(1)
      .describe("List of tasks you completed today"),
    next_day_plan: z
      .array(z.string().min(1))
      .min(1)
      .describe("List of tasks you plan to do tomorrow"),
    blockers: z
      .string()
      .default("None")
      .describe("Any blockers or impediments (default: None)"),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
      .optional()
      .describe("Date for this work update in YYYY-MM-DD format (default: today)"),
  },
  async ({ today_work, next_day_plan, blockers, date: inputDate }) => {
    const standups = loadJson<Standup[]>(STANDUPS_FILE, []);
    const date = inputDate ?? new Date().toISOString().slice(0, 10);

    const existing = standups.findIndex((s) => s.date === date);
    const entry: Standup = {
      id: existing !== -1 ? standups[existing].id : Date.now(),
      date,
      todayWork: today_work,
      nextDayPlan: next_day_plan,
      blockers,
      createdAt: new Date().toISOString(),
    };

    if (existing !== -1) {
      standups[existing] = entry;
    } else {
      standups.push(entry);
    }

    saveJson(STANDUPS_FILE, standups);
    return {
      content: [{ type: "text", text: `✅ Work update saved for ${date}. Use get_work_update to see the formatted message.` }],
    };
  },
);

// ════════════════════════════════════════════════════════════════════════════
// TOOL 8 — Get work update (AI-enhanced)
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "get_work_update",
  "Get your AI-enhanced work update for today (or a specific date) — ready to copy-paste",
  {
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Date in YYYY-MM-DD format (default: today)"),
  },
  async ({ date }) => {
    const target = date ?? new Date().toISOString().slice(0, 10);
    const standups = loadJson<Standup[]>(STANDUPS_FILE, []);
    const entry = standups.find((s) => s.date === target);

    if (!entry) {
      return {
        content: [{ type: "text", text: `No work update found for ${target}. Use save_work_update to create one.` }],
      };
    }

    const todayWorkList = entry.todayWork.map((t: string) => `• ${t}`).join("\n");
    const nextDayPlanList = entry.nextDayPlan.map((t: string) => `• ${t}`).join("\n");

    const completedFeatures = loadJson<CompletedFeature[]>(COMPLETED_FEATURES_FILE, []).filter(
      (f) => f.date === target,
    );
    const completedFeaturesList = completedFeatures
      .map((f) => `• ${f.project ? `[${f.project}] ` : ""}${f.summary}`)
      .join("\n");
    const completedFeaturesSection = completedFeatures.length
      ? `\n\n🎯 *Completed Features:*\n[rewritten bullets here]`
      : "";
    const completedFeaturesRaw = completedFeatures.length
      ? `\n\nCompleted Features:\n${completedFeaturesList}`
      : "";

    const prompt = `You are a work update formatter. Your job is to rewrite each bullet point to be more action-oriented and professional, then output the result in EXACTLY this format — no extra text, no introduction, no commentary, nothing else:

📋 *Daily Work Update — ${entry.date}*

✅ *Today's Work:*
[rewritten bullets here]

🚀 *Next Day Plan:*
[rewritten bullets here]

🚧 *Blockers:* [rewritten blocker text]${completedFeaturesSection}

💪 [one short motivational closing line]

Rules:
- Output ONLY the formatted work update. No preamble like "Here is your update:" or "Sure!".
- Keep the exact section headers and emojis as shown above.
- Only include the Completed Features section if completed features raw data is provided below.
- Each section must contain ONLY items from its own raw data list below — never move, copy, or duplicate an item into a different section. Today's Work must have exactly the same number of bullets as the raw "Today's Work" list, Next Day Plan exactly the same number as the raw "Next Day Plan" list, and Completed Features (if present) exactly the same number as the raw "Completed Features" list. Do not invent new bullets in any section.
- Use simple, plain English — avoid fancy words like "delved", "leveraged", "spearheaded", "synergized", "garnered", "elucidated". Write like a normal person talking to a colleague.
- Each bullet must start with a simple action verb (e.g. "Learned", "Fixed", "Built", "Reviewed", "Added", "Tested").
- NEVER change the meaning or nature of the task — if the input says "learning", keep it as learning (e.g. "Learned about X"), never replace it with "researched" or any other activity.
- Blockers section stays on one line.

Raw data to rewrite:
Today's Work:
${todayWorkList}

Next Day Plan:
${nextDayPlanList}

Blockers: ${entry.blockers}${completedFeaturesRaw}`;

    const aiResponse = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
      temperature: 0.3,
    });
    const fallback = `📋 *Daily Work Update — ${entry.date}*\n\n✅ *Today's Work:*\n${todayWorkList}\n\n🚀 *Next Day Plan:*\n${nextDayPlanList}\n\n🚧 *Blockers:* ${entry.blockers}${completedFeatures.length ? `\n\n🎯 *Completed Features:*\n${completedFeaturesList}` : ""}`;
    const enhanced = aiResponse.choices[0]?.message?.content?.trim() || fallback;

    return {
      content: [{ type: "text", text: enhanced }],
    };
  },
);

// ════════════════════════════════════════════════════════════════════════════
// TOOL 9 — List recent work updates (AI-enhanced)
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "list_work_updates",
  "List your recent work updates with an AI-generated summary of each day",
  {
    limit: z
      .number()
      .int()
      .min(1)
      .max(30)
      .default(7)
      .describe("Number of recent work updates to show (default: 7)"),
  },
  async ({ limit }) => {
    const standups = loadJson<Standup[]>(STANDUPS_FILE, []);

    if (standups.length === 0) {
      return {
        content: [{ type: "text", text: "No work updates saved yet. Use save_work_update to create your first one." }],
      };
    }

    const recent = [...standups]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit);

    const rawSummary = recent
      .map((s) => `Date: ${s.date}\nToday's Work: ${s.todayWork.join("; ")}\nNext Day Plan: ${s.nextDayPlan.join("; ")}\nBlockers: ${s.blockers}`)
      .join("\n\n");

    const prompt = `You are a work log summarizer. Given a list of daily work updates, output a clean summary in EXACTLY this format — no extra text, no introduction, nothing else:

📊 *Work Updates Summary (Last ${recent.length} Days)*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[For each entry, output:]
📅 *[date]*
  ✅ Today's Work: [one concise sentence summarizing today's completed work]
  🚀 Next Day Plan: [one concise sentence summarizing the next day's plan]
  🚧 Blockers: [blocker text]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 *Overall:* [one sentence insight about the work pattern across all days]

Rules:
- Output ONLY the summary. No preamble like "Here is your summary:" or "Sure!".
- Keep exact headers and emojis as shown.
- Each date entry must follow the exact structure above.

Raw data:
${rawSummary}`;

    const aiResponse = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
      temperature: 0.3,
    });

    const fallback = recent
      .map((s) => {
        const workSummary = s.todayWork.slice(0, 2).join(", ");
        const more = s.todayWork.length > 2 ? ` +${s.todayWork.length - 2} more` : "";
        return `📅 ${s.date} — ${workSummary}${more}`;
      })
      .join("\n");

    const enhanced = aiResponse.choices[0]?.message?.content?.trim() || `Last ${recent.length} work update(s):\n\n${fallback}`;

    return {
      content: [{ type: "text", text: enhanced }],
    };
  },
);

// ════════════════════════════════════════════════════════════════════════════
// TOOL 10 — Send work update to Microsoft Teams
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "send_to_teams",
  "Send today's work update to your Microsoft Teams channel via webhook",
  {
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Date in YYYY-MM-DD format (default: today)"),
  },
  async ({ date }) => {
    const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
    if (!webhookUrl || webhookUrl === "your-teams-webhook-url-here") {
      throw new McpError(
        ErrorCode.InvalidParams,
        "TEAMS_WEBHOOK_URL is not set in your .env file. Add it to start sending to Teams.",
      );
    }

    const target = date ?? new Date().toISOString().slice(0, 10);
    const standups = loadJson<Standup[]>(STANDUPS_FILE, []);
    const entry = standups.find((s) => s.date === target);

    if (!entry) {
      return {
        content: [{ type: "text", text: `No work update found for ${target}. Use save_work_update first.` }],
      };
    }

    const todayWorkList = entry.todayWork.map((t) => `• ${t}`).join("\n");
    const nextDayPlanList = entry.nextDayPlan.map((t) => `• ${t}`).join("\n");

    const prompt = `You are a work update formatter for Microsoft Teams. Rewrite the bullets to be clear and professional, then output in EXACTLY this format — no extra text, no introduction:

📋 **Daily Work Update — ${entry.date}**

✅ **Today's Work:**
[rewritten bullets]

🚀 **Next Day Plan:**
[rewritten bullets]

🚧 **Blockers:** [blocker text]

💪 [one short motivational closing line]

Rules:
- Use simple plain English. No fancy words.
- Keep the exact headers and emojis.
- NEVER change the nature of the task (learning stays learning).
- Each bullet starts with a simple action verb.
- Blockers stays on one line.

Raw data:
Today's Work:
${todayWorkList}

Next Day Plan:
${nextDayPlanList}

Blockers: ${entry.blockers}`;

    const aiResponse = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
      temperature: 0.3,
    });

    const message =
      aiResponse.choices[0]?.message?.content?.trim() ||
      `📋 **Daily Work Update — ${entry.date}**\n\n✅ **Today's Work:**\n${todayWorkList}\n\n🚀 **Next Day Plan:**\n${nextDayPlanList}\n\n🚧 **Blockers:** ${entry.blockers}`;

    // Make.com webhook — sends plain JSON, Make.com posts it to Teams
    const teamsPayload = {
      message,
      date: entry.date,
    };

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(teamsPayload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to send to Teams: ${response.status} ${response.statusText} — ${body}`,
      );
    }

    return {
      content: [{ type: "text", text: `✅ Work update for ${entry.date} sent to your Teams channel successfully!` }],
    };
  },
);

// ════════════════════════════════════════════════════════════════════════════
// TOOL 11 — Log a learning session
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "log_learning",
  "Log a learning session with topic, resource, duration and notes",
  {
    topic: z.string().min(1).describe("What you are learning (e.g. MCP, TypeScript, React)"),
    resource: z.string().min(1).describe("Resource used (e.g. YouTube, Docs, Book, Course, Article)"),
    duration: z.number().int().min(1).describe("Time spent in minutes"),
    notes: z.string().min(1).describe("What you learned or key takeaways"),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
      .optional()
      .describe("Date in YYYY-MM-DD format (default: today)"),
  },
  async ({ topic, resource, duration, notes, date: inputDate }) => {
    const entries = loadJson<LearningEntry[]>(LEARNING_FILE, []);
    const date = inputDate ?? new Date().toISOString().slice(0, 10);
    const entry: LearningEntry = {
      id: Date.now(),
      date,
      topic,
      resource,
      duration,
      notes,
      createdAt: new Date().toISOString(),
    };
    entries.push(entry);
    saveJson(LEARNING_FILE, entries);
    return {
      content: [{ type: "text", text: `✅ Logged ${duration} min of learning on "${topic}" from ${resource}.` }],
    };
  },
);

// ════════════════════════════════════════════════════════════════════════════
// TOOL 11 — Get learning summary (AI-enhanced)
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "get_learning_summary",
  "Get an AI-enhanced summary of your learning sessions for today or a specific date",
  {
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Date in YYYY-MM-DD format (default: today)"),
  },
  async ({ date }) => {
    const target = date ?? new Date().toISOString().slice(0, 10);
    const entries = loadJson<LearningEntry[]>(LEARNING_FILE, []);
    const dayEntries = entries.filter((e) => e.date === target);

    if (dayEntries.length === 0) {
      return {
        content: [{ type: "text", text: `No learning sessions found for ${target}. Use log_learning to add one.` }],
      };
    }

    const totalMins = dayEntries.reduce((sum, e) => sum + e.duration, 0);
    const rawData = dayEntries
      .map((e) => `Topic: ${e.topic}\nResource: ${e.resource}\nDuration: ${e.duration} min\nNotes: ${e.notes}`)
      .join("\n\n");

    const prompt = `You are a learning journal formatter. Format the learning sessions below in EXACTLY this format — no extra text, no introduction, nothing else:

📚 *Learning Summary — ${target}*
⏱ *Total Time:* ${totalMins} min

[For each session:]
🎯 *[topic]*
  📖 Resource: [resource]
  ⏱ Duration: [duration] min
  💡 Key Takeaway: [rewrite notes as one clear, simple sentence in plain English]

─────────────────────────────
🧠 *What You Learned Today:* [2-3 sentence AI summary of all sessions combined, in simple plain English]
💪 *Keep it up!* [one short encouraging line]

Rules:
- Output ONLY the formatted summary. No preamble.
- Use simple, plain English. Avoid fancy words.
- Keep the exact headers and emojis.
- "Key Takeaway" must be one clear sentence a beginner can understand.

Raw data:
${rawData}`;

    const aiResponse = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
      temperature: 0.3,
    });

    const fallback = `📚 *Learning Summary — ${target}*\n⏱ *Total Time:* ${totalMins} min\n\n` +
      dayEntries.map((e) => `🎯 *${e.topic}*\n  📖 ${e.resource} — ${e.duration} min\n  💡 ${e.notes}`).join("\n\n");

    const enhanced = aiResponse.choices[0]?.message?.content?.trim() || fallback;
    return {
      content: [{ type: "text", text: enhanced }],
    };
  },
);

// ════════════════════════════════════════════════════════════════════════════
// TOOL 12 — List all learning topics (AI-enhanced)
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "list_learning_topics",
  "List all topics you have learned with total time spent and an AI-generated progress insight",
  {
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe("Number of recent topics to show (default: 10)"),
  },
  async ({ limit }) => {
    const entries = loadJson<LearningEntry[]>(LEARNING_FILE, []);

    if (entries.length === 0) {
      return {
        content: [{ type: "text", text: "No learning sessions logged yet. Use log_learning to start tracking." }],
      };
    }

    const topicMap = new Map<string, { totalMins: number; sessions: number; lastDate: string }>();
    for (const e of entries) {
      const existing = topicMap.get(e.topic);
      if (existing) {
        existing.totalMins += e.duration;
        existing.sessions += 1;
        if (e.date > existing.lastDate) existing.lastDate = e.date;
      } else {
        topicMap.set(e.topic, { totalMins: e.duration, sessions: 1, lastDate: e.date });
      }
    }

    const topics = [...topicMap.entries()]
      .sort((a, b) => b[1].lastDate.localeCompare(a[1].lastDate))
      .slice(0, limit);

    const rawData = topics
      .map(([topic, s]) => `Topic: ${topic} | Total: ${s.totalMins} min | Sessions: ${s.sessions} | Last studied: ${s.lastDate}`)
      .join("\n");

    const prompt = `You are a learning progress formatter. Format the topic list in EXACTLY this format — no extra text, no introduction, nothing else:

📊 *Your Learning Topics*
─────────────────────────────
[For each topic:]
📌 *[topic]*
  ⏱ Total Time: [X] min  |  🔁 Sessions: [N]  |  📅 Last Studied: [date]
  📈 Progress: [one short plain English sentence about this topic's progress]

─────────────────────────────
🧠 *Overall Insight:* [one plain English sentence about the overall learning pattern]

Rules:
- Output ONLY the formatted list. No preamble.
- Use simple, plain English.
- Keep exact headers and emojis.

Raw data:
${rawData}`;

    const aiResponse = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
      temperature: 0.3,
    });

    const fallback = `📊 *Your Learning Topics*\n\n` +
      topics.map(([topic, s]) => `📌 *${topic}* — ${s.totalMins} min across ${s.sessions} session(s), last on ${s.lastDate}`).join("\n");

    const enhanced = aiResponse.choices[0]?.message?.content?.trim() || fallback;
    return {
      content: [{ type: "text", text: enhanced }],
    };
  },
);

// ════════════════════════════════════════════════════════════════════════════
// TOOL 13 — Search learning notes
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "search_learning",
  "Search your learning notes by topic or keyword",
  {
    query: z.string().min(1).describe("Keyword or topic to search for"),
  },
  async ({ query }) => {
    const entries = loadJson<LearningEntry[]>(LEARNING_FILE, []);
    const q = query.toLowerCase();
    const matches = entries.filter(
      (e) =>
        e.topic.toLowerCase().includes(q) ||
        e.notes.toLowerCase().includes(q) ||
        e.resource.toLowerCase().includes(q),
    );

    if (matches.length === 0) {
      return {
        content: [{ type: "text", text: `No learning sessions found matching "${query}".` }],
      };
    }

    const lines = matches
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((e) => `📅 ${e.date} | 🎯 ${e.topic} | 📖 ${e.resource} | ⏱ ${e.duration} min\n   💡 ${e.notes}`);

    return {
      content: [{ type: "text", text: `Found ${matches.length} session(s) for "${query}":\n\n${lines.join("\n\n")}` }],
    };
  },
);

// ════════════════════════════════════════════════════════════════════════════
// TOOL 14 — Log a completed feature/task
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "log_completed_feature",
  "Log a one-line summary of a feature or task you just finished, so it shows up in your end-of-day work update",
  {
    summary: z.string().min(1).describe("One-line summary of what was completed"),
    project: z.string().min(1).optional().describe("Project/repo name this feature belongs to — auto-detected from the current repo if omitted"),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format")
      .optional()
      .describe("Date in YYYY-MM-DD format (default: today)"),
  },
  async ({ summary, project, date: inputDate }) => {
    const entries = loadJson<CompletedFeature[]>(COMPLETED_FEATURES_FILE, []);
    const date = inputDate ?? new Date().toISOString().slice(0, 10);
    const entry: CompletedFeature = {
      id: Date.now(),
      date,
      summary,
      project: project ?? detectProjectName(),
      createdAt: new Date().toISOString(),
    };
    entries.push(entry);
    saveJson(COMPLETED_FEATURES_FILE, entries);
    return {
      content: [{ type: "text", text: `✅ Logged completed feature: "${summary}" (${entry.project})` }],
    };
  },
);

// ════════════════════════════════════════════════════════════════════════════
// TOOL 15 — List completed features for a day
// ════════════════════════════════════════════════════════════════════════════
server.tool(
  "list_completed_features",
  "List the features/tasks you've logged as completed for today or a specific date",
  {
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Date in YYYY-MM-DD format (default: today)"),
  },
  async ({ date }) => {
    const target = date ?? new Date().toISOString().slice(0, 10);
    const entries = loadJson<CompletedFeature[]>(COMPLETED_FEATURES_FILE, []);
    const dayEntries = entries.filter((e) => e.date === target);

    if (dayEntries.length === 0) {
      return {
        content: [{ type: "text", text: `No completed features logged for ${target}.` }],
      };
    }

    const lines = dayEntries.map((e) => `🎯 ${e.project ? `[${e.project}] ` : ""}${e.summary}`);
    return {
      content: [{ type: "text", text: `Completed features for ${target}:\n\n${lines.join("\n")}` }],
    };
  },
);

// ════════════════════════════════════════════════════════════════════════════
// RESOURCE — All tasks
// ════════════════════════════════════════════════════════════════════════════
server.resource(
  "tasks",
  `file://${TASKS_FILE}`,
  {
    description: "All saved tasks — returns the full list in one response.",
    title: "All Tasks",
  },
  async (uri) => {
    const tasks = loadJson<Task[]>(TASKS_FILE, []);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(tasks, null, 2),
        },
      ],
    };
  },
);

// ════════════════════════════════════════════════════════════════════════════
// PROMPT — Work update formatter
//
// MCP has three primitives: tools (model-invoked actions), resources
// (host-readable data), and prompts (reusable, user/host-triggered message
// templates). This is the third one. Unlike a tool, a prompt is never called
// automatically by the model mid-conversation — a *user* (or a client acting
// on their behalf) explicitly selects it, arguments get filled in, and the
// result is a ready-made list of chat messages that gets dropped straight
// into the conversation. Here we turn the same "make this standup update
// sound professional" instruction that get_work_update hardcodes into a
// reusable template any MCP client can fetch via prompts/list + prompts/get.
// ════════════════════════════════════════════════════════════════════════════
server.registerPrompt(
  "work_update_prompt",
  {
    title: "Format a work update",
    description:
      "Turn raw standup bullets into a professional, Teams-ready work update message",
    argsSchema: {
      today_work: z.string().describe("Today's work, one item per line"),
      next_day_plan: z.string().describe("Tomorrow's plan, one item per line"),
      blockers: z.string().default("None").describe("Any blockers"),
    },
  },
  ({ today_work, next_day_plan, blockers }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `You are a work update formatter. Rewrite each bullet to be action-oriented and professional, using simple plain English. Keep the meaning of each item exactly the same (e.g. "learning" stays learning). Output EXACTLY this format, nothing else:

📋 *Daily Work Update*

✅ *Today's Work:*
[rewritten bullets]

🚀 *Next Day Plan:*
[rewritten bullets]

🚧 *Blockers:* [rewritten blocker text]

Raw data:
Today's Work:
${today_work}

Next Day Plan:
${next_day_plan}

Blockers: ${blockers}`,
        },
      },
    ],
  }),
);

// ─── Start the server ────────────────────────────────────────────────────────
// (server resources are registered before connecting)
const transport = new StdioServerTransport();
await server.connect(transport);
