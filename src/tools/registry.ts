import type { JsonSchema, ToolApiSchema, ToolDefinition } from "./definition.js";

const DEFAULT_INPUT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {}
};

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  public register(tool: ToolDefinition): void {
    const name = tool.name.trim();

    if (name.length === 0) {
      throw new Error("Tool name cannot be empty.");
    }

    if (this.tools.has(name)) {
      throw new Error(`Tool '${name}' is already registered.`);
    }

    this.tools.set(name, { ...tool, name });
  }

  public getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name.trim());
  }

  public hasTool(name: string): boolean {
    return this.getTool(name) !== undefined;
  }

  public listTools(): readonly ToolDefinition[] {
    return [...this.tools.values()];
  }

  public toApiSchema(): readonly ToolApiSchema[] {
    return this.listTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema ?? DEFAULT_INPUT_SCHEMA
    }));
  }
}
