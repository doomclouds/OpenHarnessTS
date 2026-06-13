import { ToolRegistry } from "../registry.js";
import { createGlobTool } from "./glob.js";
import { createGrepTool } from "./grep.js";
import { createReadFileTool } from "./read-file.js";

export function registerDefaultProjectTools(registry: ToolRegistry): void {
  registry.register(createReadFileTool());
  registry.register(createGlobTool());
  registry.register(createGrepTool());
}

export function createDefaultProjectToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registerDefaultProjectTools(registry);
  return registry;
}
