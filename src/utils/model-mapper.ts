/**
 * Model name mapper.
 *
 * Maps Anthropic/Claude model names to OpenAI-compatible model names
 * for the backend provider. Unmapped models pass through as-is.
 */

export class ModelMapper {
  private readonly map: Map<string, string>;

  constructor(map: Map<string, string> = new Map()) {
    this.map = map;
  }

  /**
   * Map a client-facing model name to a provider model name.
   * Returns the original name if no mapping exists.
   */
  resolve(clientModel: string): { providerModel: string; mapped: boolean } {
    const providerModel = this.map.get(clientModel);
    if (providerModel) {
      return { providerModel, mapped: true };
    }
    return { providerModel: clientModel, mapped: false };
  }

  /**
   * Get the full mapping table (for logging/metrics).
   */
  getMappings(): Record<string, string> {
    return Object.fromEntries(this.map);
  }

  /**
   * Check if any mappings are configured.
   */
  get hasMappings(): boolean {
    return this.map.size > 0;
  }
}

/**
 * Parse model map from env string format: "claude-3-sonnet:gpt-4o,claude-3-opus:gpt-4-turbo"
 */
export function parseModelMap(envValue?: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!envValue) return map;

  for (const pair of envValue.split(",")) {
    const [from, to] = pair.split(":").map((s) => s.trim());
    if (from && to) {
      map.set(from, to);
    }
  }

  return map;
}
