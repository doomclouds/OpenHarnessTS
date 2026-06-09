import {
  executeRegisteredTool,
  ToolRegistry,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolResult
} from "./tools/index.js";
import type { HarnessRuntimeOptions } from "./types.js";

export class HarnessRuntime {
  private readonly registry = new ToolRegistry();

  public constructor(options: HarnessRuntimeOptions = {}) {
    for (const tool of options.tools ?? []) {
      this.registerTool(tool);
    }
  }

  public registerTool(tool: ToolDefinition): void {
    this.registry.register(tool);
  }

  public listTools(): readonly ToolDefinition[] {
    return this.registry.listTools();
  }

  public getTool(name: string): ToolDefinition | undefined {
    return this.registry.getTool(name);
  }

  public executeTool(
    name: string,
    input: unknown,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    return executeRegisteredTool(
      this.registry,
      {
        toolUseId: `runtime_${name}`,
        toolName: name,
        input
      },
      context
    );
  }
}
