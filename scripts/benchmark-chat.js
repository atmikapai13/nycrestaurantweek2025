#!/usr/bin/env node
/**
 * Chat benchmark: sends a fixed set of prompts to the chat endpoint several times
 * each, the same way the frontend does (AI SDK UI messages + context), and reports
 * speed and consistency. Run before and after an architecture change to compare.
 *
 *   npm run api:dev                                  # in another terminal
 *   node scripts/benchmark-chat.js --label before    # 3 runs per prompt
 *   node scripts/benchmark-chat.js --label after --runs 5 --only midpoint,transit
 *
 * Options: --label <name>  --runs <n>  --delay <ms between requests>
 *          --only <comma-separated prompt ids>  --url <chat endpoint>
 *          --cache on   (default off: server caches are bypassed so every run
 *                        measures uncached latency and real model determinism)
 *
 * Writes benchmarks/results/<label>-<timestamp>.md (human-readable report) and
 * .json (raw data), and prints the summary table.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// "Near me" prompts use this as the browser geolocation (Union Square).
const USER_LOCATION = { latitude: 40.7359, longitude: -73.9911 };

const PROMPTS = [
  { id: "name", label: "Restaurant by name", text: "Carbone" },
  { id: "cuisine", label: "Cuisine + award", text: "Michelin-starred Italian restaurants" },
  { id: "vibe", label: "Vibe", text: "cozy romantic spots for a date night" },
  { id: "dietary", label: "Dietary", text: "vegan-friendly restaurants" },
  { id: "location-vibe", label: "Location + vibe", text: "cozy spots within a 15 minute walk of Times Square" },
  { id: "near-me", label: "Near me", text: "lively places within a 10 minute walk of me" },
  {
    id: "midpoint",
    label: "Midpoint (2 isochrones)",
    text: "I'm in Murray Hill and my friend is in Chelsea. Japanese restaurants within a 15 minute walk of both of us",
  },
  { id: "transit", label: "Transit isochrone", text: "cheap eats within 15 minutes by transit from Union Square" },
];

function parseArgs(argv) {
  const args = { label: "run", runs: 3, delay: 3000, only: null, url: "http://localhost:3001/chat", cache: "off" };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, "");
    const value = argv[i + 1];
    if (key === "runs" || key === "delay") args[key] = Number(value);
    else if (key === "only") args.only = value.split(",");
    else args[key] = value;
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => {
  const v = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};
const sec = (ms) => (ms == null ? "–" : `${(ms / 1000).toFixed(1)}s`);
const num = (n) => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));

/** Send one prompt and consume the UI message stream (SSE), timing it client-side. */
async function runOnce(url, prompt, cache) {
  const body = {
    id: `bench-${Date.now()}`,
    trigger: "submit-message",
    messages: [{ id: `msg-${Date.now()}`, role: "user", parts: [{ type: "text", text: prompt.text }] }],
    context: { filterPool: [], userLocation: USER_LOCATION },
  };

  const t0 = performance.now();
  const elapsed = () => Math.round(performance.now() - t0);
  const run = {
    firstByteMs: null,
    cardsMs: null,
    totalMs: null,
    toolSequence: [],
    toolInputs: [],
    shown: [],
    text: "",
    serverMetrics: null,
    intent: null,
    error: null,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-nyceats-metrics": "1", "x-nyceats-cache": cache },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      run.error = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
      run.totalMs = elapsed();
      return run;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (run.firstByteMs === null) run.firstByteMs = elapsed();
      buffer += decoder.decode(value, { stream: true });

      let sep;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const data = event.replace(/^data: /, "").trim();
        if (!data || data === "[DONE]") continue;
        let chunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue; // non-JSON line (e.g. legacy data-stream format)
        }
        handleChunk(chunk, run, elapsed);
      }
    }
  } catch (err) {
    run.error = String(err?.message ?? err);
  }
  run.totalMs = elapsed();
  return run;
}

function handleChunk(chunk, run, elapsed) {
  switch (chunk.type) {
    case "tool-input-available":
      run.toolSequence.push(chunk.toolName);
      run.toolInputs.push({ tool: chunk.toolName, input: JSON.stringify(chunk.input ?? {}).slice(0, 200) });
      break;
    case "tool-output-available": {
      const restaurants = chunk.output?.restaurants;
      // Only displayRestaurants output has full card objects with a summary field.
      if (Array.isArray(restaurants) && restaurants.length && "summary" in restaurants[0]) {
        run.shown = restaurants.map((r) => r.slug);
        if (run.cardsMs === null) run.cardsMs = elapsed();
      }
      break;
    }
    case "data-intent":
      run.intent = chunk.data;
      break;
    case "text-delta":
      run.text += chunk.delta ?? "";
      break;
    case "finish":
    case "message-metadata":
      if (chunk.messageMetadata?.metrics) run.serverMetrics = chunk.messageMetadata.metrics;
      break;
    case "error":
      run.error = chunk.errorText ?? "stream error";
      break;
  }
}

/** Consistency across runs of one prompt: same ordered result list every time? */
function consistency(runs) {
  const ok = runs.filter((r) => !r.error);
  const resultKeys = new Set(ok.map((r) => r.shown.join(",")));
  const toolKeys = new Set(ok.map((r) => r.toolSequence.join(" → ")));
  const sets = ok.map((r) => new Set(r.shown));
  let overlapSum = 0;
  let pairs = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const inter = [...sets[i]].filter((x) => sets[j].has(x)).length;
      const union = new Set([...sets[i], ...sets[j]]).size;
      overlapSum += union ? inter / union : 1;
      pairs++;
    }
  }
  return {
    runs: ok.length,
    identical: ok.length > 1 && resultKeys.size === 1,
    distinctResults: resultKeys.size,
    distinctToolPaths: toolKeys.size,
    avgOverlap: pairs ? overlapSum / pairs : null,
  };
}

function summarize(prompt, runs) {
  const ok = runs.filter((r) => !r.error);
  const m = (f) => median(ok.map(f));
  return {
    prompt,
    errors: runs.length - ok.length,
    totalMs: m((r) => r.totalMs),
    cardsMs: m((r) => r.cardsMs),
    steps: m((r) => r.serverMetrics?.stepCount),
    modelMs: m((r) => r.serverMetrics?.modelMs),
    toolMs: m((r) => r.serverMetrics?.toolMs),
    setupMs: m((r) => r.serverMetrics?.phases?.setupTotal),
    tokensIn: m((r) => r.serverMetrics?.tokens?.input),
    tokensOut: m((r) => r.serverMetrics?.tokens?.output),
    tokensThinking: m((r) => r.serverMetrics?.tokens?.reasoning),
    consistency: consistency(runs),
    runs,
  };
}

function consistencyLabel(c) {
  if (c.distinctResults === 0) return "–";
  if (c.runs < 2) return "– (1 run)";
  if (c.identical) return "✅ identical";
  const overlap = c.avgOverlap == null ? "" : `, ${Math.round(c.avgOverlap * 100)}% overlap`;
  return `❌ ${c.distinctResults} different${overlap}`;
}

/** Intent without empty fields, for readable reports. */
function compactIntent(intent) {
  return Object.fromEntries(
    Object.entries(intent).filter(([, v]) => !(v === null || v === false || (Array.isArray(v) && !v.length) || v === "unspecified"))
  );
}

function toMarkdown(args, results, startedAt) {
  const lines = [];
  lines.push(`# Chat benchmark: ${args.label}`);
  lines.push("");
  lines.push(`Run ${startedAt.toISOString()} · ${args.runs} runs per prompt · server caches ${args.cache} · endpoint \`${args.url}\``);
  lines.push("");
  lines.push("Times are medians across runs. **Cards** = when restaurant cards arrived; **Total** = stream fully finished.");
  lines.push("**Same results?** compares the ordered list of restaurants shown across runs of the same prompt.");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Prompt | Total | Cards | LLM steps | Model time | Tool time | Tokens in / out / thinking | Same results? | Tool paths | Errors |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const s of results) {
    lines.push(
      `| ${s.prompt.label} | ${sec(s.totalMs)} | ${sec(s.cardsMs)} | ${s.steps ?? "–"} | ${sec(s.modelMs)} | ${sec(s.toolMs)} | ` +
        `${num(s.tokensIn)} / ${num(s.tokensOut)} / ${num(s.tokensThinking)} | ${consistencyLabel(s.consistency)} | ` +
        `${s.consistency.distinctToolPaths || "–"} | ${s.errors || ""} |`
    );
  }

  const all = results.flatMap((s) => s.runs.filter((r) => r.serverMetrics));
  if (all.length) {
    const total = all.reduce((a, r) => a + r.serverMetrics.totalMs, 0);
    const model = all.reduce((a, r) => a + r.serverMetrics.modelMs, 0);
    const tools = all.reduce((a, r) => a + r.serverMetrics.toolMs, 0);
    const setup = all.reduce((a, r) => a + (r.serverMetrics.phases?.setupTotal ?? 0), 0);
    const pct = (x) => `${Math.round((x / total) * 100)}%`;
    const identical = results.filter((s) => s.consistency.identical).length;
    lines.push("");
    lines.push("## Where the time goes (all runs)");
    lines.push("");
    lines.push(`- **LLM (Gemini) time:** ${pct(model)} of server time`);
    lines.push(`- **Tool/API time** (geocode, isochrones, search): ${pct(tools)}`);
    lines.push(`- **Setup** (before the first LLM call): ${pct(setup)}`);
    lines.push(`- **Prompts with identical results every run:** ${identical} of ${results.length}`);
    const coldMs = Math.max(...all.map((r) => r.serverMetrics.phases?.mcpContext ?? 0));
    if (coldMs > 1000) {
      lines.push(
        `- **Cold start:** one request spent ${sec(coldMs)} connecting to MCP (first request on a fresh server). ` +
          `It's included in the medians above; on Vercel every new instance pays this.`
      );
    }
  }

  lines.push("");
  lines.push("## Per-prompt detail");
  for (const s of results) {
    lines.push("");
    lines.push(`### ${s.prompt.label}`);
    lines.push("");
    lines.push(`> ${s.prompt.text}`);
    lines.push("");
    lines.push("| Run | Total | Cards | Steps | Tool path | Restaurants shown |");
    lines.push("|---|---|---|---|---|---|");
    s.runs.forEach((r, i) => {
      if (r.error) {
        lines.push(`| ${i + 1} | ${sec(r.totalMs)} | – | – | ❌ ${r.error.replace(/\|/g, "/").slice(0, 120)} | |`);
        return;
      }
      lines.push(
        `| ${i + 1} | ${sec(r.totalMs)} | ${sec(r.cardsMs)} | ${r.serverMetrics?.stepCount ?? "–"} | ` +
          `${r.toolSequence.join(" → ") || "(none)"} | ${r.shown.join(", ") || "(no cards)"} |`
      );
    });

    // Show what the model actually searched for, since varying inputs explain varying results.
    const inputs = s.runs.flatMap((r, i) =>
      r.toolInputs
        .filter((t) => t.tool === "semantic_search_restaurants" || t.tool === "execute_sql")
        .map((t) => `- Run ${i + 1} \`${t.tool}\`: \`${t.input.replace(/`/g, "'")}\``)
    );
    if (inputs.length) {
      lines.push("");
      lines.push("Search inputs the model chose:");
      lines.push("");
      lines.push(...inputs);
    }

    // New pipeline: the parsed intent is the only thing the LLM decides.
    const intents = s.runs
      .map((r, i) => (r.intent ? `- Run ${i + 1}: \`${JSON.stringify(compactIntent(r.intent))}\`` : null))
      .filter(Boolean);
    if (intents.length) {
      const distinct = new Set(s.runs.filter((r) => r.intent).map((r) => JSON.stringify(r.intent))).size;
      lines.push("");
      lines.push(`Parsed intent (${distinct === 1 ? "identical every run" : `${distinct} different versions`}):`);
      lines.push("");
      lines.push(...intents);
    }
  }
  return lines.join("\n") + "\n";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prompts = args.only ? PROMPTS.filter((p) => args.only.includes(p.id)) : PROMPTS;
  const startedAt = new Date();
  const results = [];

  console.log(`Benchmark "${args.label}": ${prompts.length} prompts × ${args.runs} runs → ${args.url}\n`);
  for (const prompt of prompts) {
    const runs = [];
    for (let i = 0; i < args.runs; i++) {
      process.stdout.write(`  ${prompt.label.padEnd(26)} run ${i + 1}/${args.runs} … `);
      const run = await runOnce(args.url, prompt, args.cache);
      runs.push(run);
      console.log(
        run.error ? `❌ ${run.error.slice(0, 80)}` : `${sec(run.totalMs)}  ${run.shown.join(", ") || "(no cards)"}`
      );
      await sleep(args.delay);
    }
    results.push(summarize(prompt, runs));
  }

  const outDir = path.join(__dirname, "..", "benchmarks", "results");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base = path.join(outDir, `${args.label}-${stamp}`);
  const markdown = toMarkdown(args, results, startedAt);
  fs.writeFileSync(`${base}.md`, markdown);
  fs.writeFileSync(`${base}.json`, JSON.stringify({ args, startedAt, results }, null, 2));

  console.log("\n" + markdown.split("## Per-prompt detail")[0]);
  console.log(`Report: ${path.relative(process.cwd(), base)}.md\nRaw data: ${path.relative(process.cwd(), base)}.json`);
}

main();
