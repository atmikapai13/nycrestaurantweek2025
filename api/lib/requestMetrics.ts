/**
 * Per-request latency + token metrics for the chat endpoint.
 *
 * Records setup phases, each LLM call (duration + token usage incl. Gemini
 * "thinking" tokens), every tool/API call, and the restaurants finally
 * displayed. Logged as a readable block per request, and returned to the client
 * as message metadata when the request carries the METRICS_HEADER (used by
 * scripts/benchmark-chat.js).
 */
import type { LanguageModelUsage } from "ai";

export const METRICS_HEADER = "x-nyceats-metrics";

interface ToolMetric {
  tool: string;
  startMs: number;
  endMs: number;
  ok: boolean;
  input: string;
}

interface StepMetric {
  step: number;
  ms: number;
  modelMs: number;
  toolMs: number;
  finishReason: string;
  tools: string[];
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
}

const round = (n: number) => Math.round(n);

export class RequestMetrics {
  readonly id = Math.random().toString(36).slice(2, 8);
  private readonly start = performance.now();
  private readonly phases: Record<string, number> = {};
  private readonly tools: ToolMetric[] = [];
  private readonly steps: StepMetric[] = [];
  private firstChunkMs: number | null = null;
  private firstTextMs: number | null = null;
  private displayed: string[] = [];

  now(): number {
    return performance.now() - this.start;
  }

  /** Time an async setup phase (e.g. MCP context, message conversion). */
  async phase<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const t0 = this.now();
    try {
      return await fn();
    } finally {
      this.phases[name] = round(this.now() - t0);
    }
  }

  recordChunk(type: string): void {
    if (this.firstChunkMs === null) this.firstChunkMs = round(this.now());
    if (type === "text-delta" && this.firstTextMs === null) this.firstTextMs = round(this.now());
  }

  /** Record one LLM call that started at `startMs` (from now()) and just finished. */
  recordLlmCall(name: string, startMs: number, usage?: LanguageModelUsage, cached = false): void {
    if (this.phases.setupTotal === undefined) this.phases.setupTotal = round(startMs);
    const ms = this.now() - startMs;
    this.steps.push({
      step: this.steps.length + 1,
      ms: round(ms),
      modelMs: cached ? 0 : round(ms),
      toolMs: 0,
      finishReason: cached ? "cached" : "done",
      tools: [name],
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      reasoningTokens: usage?.outputTokenDetails?.reasoningTokens,
    });
  }

  toolStarted(name: string, input: unknown): number {
    this.tools.push({ tool: name, startMs: this.now(), endMs: -1, ok: false, input: JSON.stringify(input ?? {}).slice(0, 300) });
    return this.tools.length - 1;
  }

  toolFinished(index: number, ok: boolean): void {
    this.tools[index].endMs = this.now();
    this.tools[index].ok = ok;
  }

  setDisplayed(slugs: string[]): void {
    this.displayed = slugs;
  }

  /** Wall-clock time covered by tool calls (parallel calls counted once). */
  private toolWallMs(): number {
    const spans = this.tools
      .filter((t) => t.endMs >= 0)
      .map((t) => [t.startMs, t.endMs] as const)
      .sort((x, y) => x[0] - y[0]);
    let total = 0;
    let [curStart, curEnd] = spans[0] ?? [0, 0];
    for (const [start, end] of spans.slice(1)) {
      if (start > curEnd) {
        total += curEnd - curStart;
        [curStart, curEnd] = [start, end];
      } else {
        curEnd = Math.max(curEnd, end);
      }
    }
    return total + (curEnd - curStart);
  }

  summary() {
    const sum = (key: "inputTokens" | "outputTokens" | "reasoningTokens") =>
      this.steps.reduce((acc, s) => acc + (s[key] ?? 0), 0);
    return {
      id: this.id,
      totalMs: round(this.now()),
      firstChunkMs: this.firstChunkMs,
      firstTextMs: this.firstTextMs,
      phases: this.phases,
      stepCount: this.steps.length,
      modelMs: this.steps.reduce((acc, s) => acc + s.modelMs, 0),
      toolMs: round(this.toolWallMs()),
      tokens: { input: sum("inputTokens"), output: sum("outputTokens"), reasoning: sum("reasoningTokens") },
      steps: this.steps,
      tools: this.tools.map((t) => ({
        tool: t.tool,
        ms: t.endMs < 0 ? null : round(t.endMs - t.startMs),
        ok: t.ok,
        input: t.input,
      })),
      displayed: this.displayed,
    };
  }

  /** Human-readable block, one per request, for the API server console. */
  log(): void {
    const s = this.summary();
    const sec = (ms: number | null | undefined) => (ms == null ? "  –  " : `${(ms / 1000).toFixed(1)}s`);
    const num = (n: number | undefined) => (n ?? 0).toLocaleString("en-US");
    const lines = [
      `⏱️  Request ${s.id} — ${sec(s.totalMs)} total`,
      `    Setup         ${sec(s.phases.setupTotal)}`,
      `    First output  ${sec(s.firstChunkMs)}  (first text ${sec(s.firstTextMs)})`,
      `    LLM calls     ${s.stepCount} · model ${sec(s.modelMs)} · tools/APIs ${sec(s.toolMs)}`,
      `    Tokens        ${num(s.tokens.input)} in · ${num(s.tokens.output)} out · ${num(s.tokens.reasoning)} thinking`,
    ];
    for (const step of s.steps) {
      lines.push(
        `    LLM ${step.step}  ${step.tools.join(", ").padEnd(14)} ${sec(step.ms).padStart(6)}${step.finishReason === "cached" ? " (cached)" : ""}  ` +
          `${num(step.inputTokens).padStart(7)} in / ${num(step.outputTokens).padStart(5)} out / ${num(step.reasoningTokens).padStart(5)} thinking`
      );
    }
    for (const t of s.tools) {
      lines.push(`    Tool  ${t.tool.padEnd(28)} ${sec(t.ms).padStart(6)}  ${t.ok ? "ok" : "❌ error"}  ${t.input.slice(0, 80)}`);
    }
    lines.push(`    Shown         ${s.displayed.length ? s.displayed.join(", ") : "(no cards)"}`);
    console.log(lines.join("\n"));
  }
}
