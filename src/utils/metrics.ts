/** Collects in-memory request metrics for the running process. */

export interface CostConfig {
  /** Cost per input token per model. */
  inputCostPer1k: Map<string, number>;
  /** Cost per output token per model. */
  outputCostPer1k: Map<string, number>;
  /** Default cost per 1k input tokens when no model-specific rate is configured. */
  defaultInputCostPer1k: number;
  /** Default cost per 1k output tokens when no model-specific rate is configured. */
  defaultOutputCostPer1k: number;
}

interface RequestMetric {
  model: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  streaming: boolean;
  error: boolean;
  estimatedCost: number;
  timestamp: number;
}

export class MetricsCollector {
  private totalRequests = 0;
  private totalErrors = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private totalEstimatedCost = 0;
  private totalStreamingRequests = 0;
  private activeStreams = 0;
  private latencies: number[] = [];
  private readonly startTime = Date.now();
  private recentRequests: RequestMetric[] = [];
  private readonly costConfig: CostConfig;
  private readonly maxRecentRequests = 100;

  constructor(costConfig?: Partial<CostConfig>) {
    this.costConfig = {
      inputCostPer1k: costConfig?.inputCostPer1k ?? new Map(),
      outputCostPer1k: costConfig?.outputCostPer1k ?? new Map(),
      defaultInputCostPer1k: costConfig?.defaultInputCostPer1k ?? 0.003,
      defaultOutputCostPer1k: costConfig?.defaultOutputCostPer1k ?? 0.015,
    };
  }

  /** Records one completed request. */
  recordRequest(opts: {
    model: string;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    streaming: boolean;
    error: boolean;
  }): { estimatedCost: number } {
    this.totalRequests++;
    if (opts.error) this.totalErrors++;
    if (opts.streaming) this.totalStreamingRequests++;

    this.totalInputTokens += opts.inputTokens;
    this.totalOutputTokens += opts.outputTokens;
    this.latencies.push(opts.durationMs);

    if (this.latencies.length > 1000) {
      this.latencies = this.latencies.slice(-1000);
    }

    const estimatedCost = this.estimateCost(
      opts.model,
      opts.inputTokens,
      opts.outputTokens
    );
    this.totalEstimatedCost += estimatedCost;

    const metric: RequestMetric = {
      ...opts,
      estimatedCost,
      timestamp: Date.now(),
    };

    this.recentRequests.push(metric);
    if (this.recentRequests.length > this.maxRecentRequests) {
      this.recentRequests = this.recentRequests.slice(-this.maxRecentRequests);
    }

    return { estimatedCost };
  }

  streamStarted(): void {
    this.activeStreams++;
  }

  streamEnded(): void {
    this.activeStreams = Math.max(0, this.activeStreams - 1);
  }

  /** Returns a snapshot suitable for the `/metrics` endpoint. */
  getMetrics(): Record<string, unknown> {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
    const avg =
      sorted.length > 0
        ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length)
        : 0;

    return {
      uptime_seconds: Math.round((Date.now() - this.startTime) / 1000),
      requests: {
        total: this.totalRequests,
        errors: this.totalErrors,
        streaming: this.totalStreamingRequests,
        active_streams: this.activeStreams,
        error_rate:
          this.totalRequests > 0
            ? +(this.totalErrors / this.totalRequests).toFixed(4)
            : 0,
      },
      latency_ms: {
        avg,
        p50: Math.round(p50),
        p95: Math.round(p95),
        p99: Math.round(p99),
      },
      tokens: {
        total_input: this.totalInputTokens,
        total_output: this.totalOutputTokens,
        total: this.totalInputTokens + this.totalOutputTokens,
      },
      cost: {
        estimated_total_usd: +this.totalEstimatedCost.toFixed(6),
      },
    };
  }

  private estimateCost(
    model: string,
    inputTokens: number,
    outputTokens: number
  ): number {
    const inputRate =
      this.costConfig.inputCostPer1k.get(model) ??
      this.costConfig.defaultInputCostPer1k;
    const outputRate =
      this.costConfig.outputCostPer1k.get(model) ??
      this.costConfig.defaultOutputCostPer1k;

    return (inputTokens / 1000) * inputRate + (outputTokens / 1000) * outputRate;
  }
}
