import type {
  HarnessRuntimeOptions,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult
} from "./types.js";

export class HarnessRuntime {
  private readonly tools = new Map<string, ToolDefinition>();

  public constructor(options: HarnessRuntimeOptions = {}) {
    for (const tool of options.tools ?? []) {
      this.registerTool(tool);
    }
  }

  public registerTool(tool: ToolDefinition): void {
    const name = tool.name.trim();

    if (name.length === 0) {
      throw new Error("Tool name cannot be empty.");
    }

    if (this.tools.has(name)) {
      throw new Error(`Tool '${name}' is already registered.`);
    }

    this.tools.set(name, { ...tool, name });
  }

  public listTools(): readonly ToolDefinition[] {
    return [...this.tools.values()];
  }

  public getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  public async executeTool<TOutput = unknown>(
    name: string,
    input: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult<TOutput>> {
    const tool = this.getTool(name);

    if (!tool) {
      return {
        ok: false,
        error: `Tool '${name}' is not registered.`
      };
    }

    try {
      return (await tool.execute(input, context)) as ToolResult<TOutput>;
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
