/**
 * Per-request latency + token metrics for the chat endpoint.
 *
 * Records setup phases, each LLM step (wall time split into model vs. tool time,
 * token usage incl. Gemini "thinking" tokens), every tool execution, and the
 * restaurants finally displayed. Logged as one summary line per request, and
 * returned to the client as message metadata when the request carries the
 * METRICS_HEADER (used by scripts/benchmark-chat.js).
 */
import type { ToolSet } from "ai";

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

interface StepLike {
  finishReason: string;
  toolCalls?: Array<{ toolName?: string } | undefined>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    outputTokenDetails?: { reasoningTokens?: number };
  };
}

const round = (n: number) => Math.round(n);

export class RequestMetrics {
  readonly id = Math.random().toString(36).slice(2, 8);
  private readonly start = performance.now();
  private lastStepEnd: number | null = null;
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

  /** Call right before streamText so step 1's duration excludes setup. */
  markModelStart(): void {
    this.lastStepEnd = this.now();
    this.phases.setupTotal = round(this.lastStepEnd);
  }

  recordChunk(type: string): void {
    if (this.firstChunkMs === null) this.firstChunkMs = round(this.now());
    if (type === "text-delta" && this.firstTextMs === null) this.firstTextMs = round(this.now());
  }

  recordStep(step: StepLike): void {
    const end = this.now();
    const begin = this.lastStepEnd ?? 0;
    this.lastStepEnd = end;

    // Tools in this step ran between the previous step boundary and now. Use their
    // wall-clock span (not the sum) so parallel tool calls aren't double counted.
    const stepTools = this.tools.filter((t) => t.startMs >= begin && t.endMs <= end);
    const toolMs = stepTools.length
      ? Math.max(...stepTools.map((t) => t.endMs)) - Math.min(...stepTools.map((t) => t.startMs))
      : 0;

    this.steps.push({
      step: this.steps.length + 1,
      ms: round(end - begin),
      modelMs: round(end - begin - toolMs),
      toolMs: round(toolMs),
      finishReason: step.finishReason,
      tools: (step.toolCalls ?? []).map((t) => t?.toolName ?? "unknown"),
      inputTokens: step.usage?.inputTokens,
      outputTokens: step.usage?.outputTokens,
      reasoningTokens: step.usage?.outputTokenDetails?.reasoningTokens,
    });
  }

  /** Wrap every tool's execute() to record its duration, input, and displayed results. */
  wrapTools<T extends ToolSet>(tools: T): T {
    const wrapped: ToolSet = {};
    for (const [name, tool] of Object.entries(tools)) {
      const execute = (tool as any).execute;
      if (typeof execute !== "function") {
        wrapped[name] = tool;
        continue;
      }
      wrapped[name] = {
        ...tool,
        execute: async (...args: unknown[]) => {
          const startMs = this.now();
          let ok = false;
          try {
            const result = await execute(...args);
            ok = !(result as any)?.isError && !(result as any)?.error;
            if (name === "displayRestaurants") {
              this.displayed = ((result as any)?.restaurants ?? []).map((r: any) => r.slug);
            }
            return result;
          } finally {
            this.tools.push({
              tool: name,
              startMs,
              endMs: this.now(),
              ok,
              input: JSON.stringify(args[0] ?? {}).slice(0, 300),
            });
          }
        },
      } as any;
    }
    return wrapped as T;
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
      toolMs: this.steps.reduce((acc, s) => acc + s.toolMs, 0),
      tokens: { input: sum("inputTokens"), output: sum("outputTokens"), reasoning: sum("reasoningTokens") },
      steps: this.steps,
      tools: this.tools.map((t) => ({
        tool: t.tool,
        ms: round(t.endMs - t.startMs),
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
      `    Setup         ${sec(s.phases.setupTotal)}  (MCP context ${sec(s.phases.mcpContext)}, message conversion ${sec(s.phases.convertMessages)})`,
      `    First output  ${sec(s.firstChunkMs)}  (first text ${sec(s.firstTextMs)})`,
      `    LLM steps     ${s.stepCount} steps · model ${sec(s.modelMs)} · tools ${sec(s.toolMs)}`,
      `    Tokens        ${num(s.tokens.input)} in · ${num(s.tokens.output)} out · ${num(s.tokens.reasoning)} thinking`,
    ];
    for (const step of s.steps) {
      const action = step.tools.length ? `→ ${step.tools.join(", ")}` : `→ (${step.finishReason})`;
      lines.push(
        `    Step ${step.step}  ${sec(step.ms).padStart(6)}  model ${sec(step.modelMs).padStart(6)} + tools ${sec(step.toolMs).padStart(6)}  ` +
          `${action.padEnd(36)} ${num(step.inputTokens).padStart(7)} in / ${num(step.outputTokens).padStart(5)} out / ${num(step.reasoningTokens).padStart(5)} thinking`
      );
    }
    for (const t of s.tools) {
      lines.push(`    Tool  ${t.tool.padEnd(28)} ${sec(t.ms).padStart(6)}  ${t.ok ? "ok" : "❌ error"}`);
    }
    lines.push(`    Shown         ${s.displayed.length ? s.displayed.join(", ") : "(no cards)"}`);
    console.log(lines.join("\n"));
  }
}
