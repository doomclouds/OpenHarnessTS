import type { JsonSchema, ToolApiSchema, ToolDefinition } from "./definition.js";

const DEFAULT_INPUT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {}
};

function cloneJsonSchema(schema: JsonSchema): JsonSchema {
  return structuredClone(schema) as JsonSchema;
}

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

    const registeredTool =
      tool.inputSchema === undefined
        ? { ...tool, name }
        : { ...tool, name, inputSchema: cloneJsonSchema(tool.inputSchema) };

    this.tools.set(name, registeredTool);
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
      input_schema: cloneJsonSchema(tool.inputSchema ?? DEFAULT_INPUT_SCHEMA)
    }));
  }
}
