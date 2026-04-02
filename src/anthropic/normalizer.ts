/** Converts Anthropic message requests into the internal provider contract. */

import type Anthropic from "@anthropic-ai/sdk";
import type {
  NormalizedMessage,
  NormalizedRequest,
  NormalizedTool,
  NormalizedToolCall,
} from "../types/internal.js";

type AnthropicRequestBody = Anthropic.MessageCreateParams;
type ContentBlockParam = Anthropic.ContentBlockParam;

export class AnthropicRequestNormalizer {
  /** Normalizes one request body for provider execution. */
  normalize(body: AnthropicRequestBody): NormalizedRequest {
    const messages: NormalizedMessage[] = [];

    if (body.system) {
      const systemText = this.flattenSystem(body.system);
      if (systemText) {
        messages.push({ role: "system", content: systemText });
      }
    }

    for (const msg of body.messages) {
      const converted = this.convertMessage(msg);
      messages.push(...converted);
    }

    const request: NormalizedRequest = {
      model: body.model,
      messages,
      stream: body.stream ?? false,
      maxTokens: body.max_tokens,
    };

    if (body.tools && body.tools.length > 0) {
      request.tools = body.tools
        .filter((tool): tool is Anthropic.Tool => "input_schema" in tool)
        .map((tool) => this.convertTool(tool));
    }

    if (body.tool_choice) {
      request.toolChoice = this.convertToolChoice(body.tool_choice);
    }

    if (body.top_p !== undefined) request.topP = body.top_p;
    if (body.temperature !== undefined) request.temperature = body.temperature;
    if (body.stop_sequences && body.stop_sequences.length > 0) {
      request.stop = body.stop_sequences;
    }

    const thinking = (body as Record<string, unknown>).thinking as
      | { type: string; budget_tokens?: number }
      | undefined;
    if (thinking && thinking.type === "enabled") {
      request.reasoningEffort = "high";
    }

    return request;
  }

  private flattenSystem(system: string | Anthropic.TextBlockParam[]): string {
    if (typeof system === "string") {
      return system;
    }

    return (system as Array<{ type: string; text?: string }>)
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text!)
      .join("\n");
  }

  private convertMessage(msg: Anthropic.MessageParam): NormalizedMessage[] {
    const results: NormalizedMessage[] = [];

    if (msg.role === "user") {
      this.convertUserMessage(msg, results);
    } else if (msg.role === "assistant") {
      this.convertAssistantMessage(msg, results);
    }

    return results;
  }

  private convertUserMessage(
    msg: Anthropic.MessageParam,
    out: NormalizedMessage[]
  ): void {
    if (typeof msg.content === "string") {
      out.push({ role: "user", content: msg.content });
      return;
    }

    const blocks = msg.content as ContentBlockParam[];
    const textParts: string[] = [];

    for (const block of blocks) {
      const current = block as Record<string, unknown>;

      switch (current.type) {
        case "text":
          textParts.push(current.text as string);
          break;

        case "tool_result":
          out.push({
            role: "tool",
            toolCallId: current.tool_use_id as string,
            content: this.extractToolResultContent(current),
          });
          break;

        case "image":
          // The adapter is text-only today, so unsupported blocks are preserved
          // as explicit placeholders instead of being dropped silently.
          textParts.push("[Image content not supported in this adapter]");
          break;

        case "document": {
          const title = current.title;
          textParts.push(
            title
              ? `[Document: ${title}]`
              : "[Document content not supported in this adapter]"
          );
          break;
        }

        default:
          break;
      }
    }

    if (textParts.length > 0) {
      out.push({ role: "user", content: textParts.join("\n") });
    }
  }

  private convertAssistantMessage(
    msg: Anthropic.MessageParam,
    out: NormalizedMessage[]
  ): void {
    if (typeof msg.content === "string") {
      out.push({ role: "assistant", content: msg.content, toolCalls: undefined });
      return;
    }

    const blocks = msg.content as ContentBlockParam[];
    const textParts: string[] = [];
    const toolCalls: NormalizedToolCall[] = [];

    for (const block of blocks) {
      const current = block as Record<string, unknown>;

      switch (current.type) {
        case "text":
          textParts.push(current.text as string);
          break;

        case "tool_use":
          toolCalls.push({
            id: current.id as string,
            name: current.name as string,
            arguments:
              typeof current.input === "string"
                ? current.input
                : JSON.stringify(current.input),
          });
          break;

        case "thinking":
          break;

        default:
          break;
      }
    }

    const assistantMsg: NormalizedMessage = {
      role: "assistant",
      content: textParts.length > 0 ? textParts.join("\n") : null,
    };

    if (toolCalls.length > 0) {
      (assistantMsg as { toolCalls?: NormalizedToolCall[] }).toolCalls = toolCalls;
    }

    out.push(assistantMsg);
  }

  private convertTool(tool: Anthropic.Tool): NormalizedTool {
    return {
      name: tool.name,
      description: tool.description ?? undefined,
      inputSchema: (tool.input_schema as Record<string, unknown>) ?? {},
    };
  }

  private convertToolChoice(
    choice: Anthropic.MessageCreateParams["tool_choice"]
  ): "auto" | "required" | "none" {
    if (!choice) return "auto";

    const type = (choice as Record<string, unknown>).type as string;
    switch (type) {
      case "auto":
        return "auto";
      case "none":
        return "none";
      case "any":
      case "tool":
        return "required";
      default:
        return "auto";
    }
  }

  private extractToolResultContent(block: Record<string, unknown>): string {
    const content = block.content;
    if (typeof content === "string") return content;
    if (!content) return "";

    if (Array.isArray(content)) {
      return (content as Array<Record<string, unknown>>)
        .filter((entry) => entry.type === "text" && entry.text)
        .map((entry) => entry.text as string)
        .join("\n");
    }

    return String(content);
  }
}
