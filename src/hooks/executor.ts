import type {
  AggregatedHookResult,
  HookEvent,
  HookPayload,
  HookResult
} from "./events.js";

export type HookHandler = (
  payload: HookPayload,
  event: HookEvent
) => HookResult | void | Promise<HookResult | void>;

export interface HookExecutor {
  execute(
    event: HookEvent,
    payload: HookPayload
  ): AggregatedHookResult | Promise<AggregatedHookResult>;
}

export function createAggregatedHookResult(
  results: readonly HookResult[] = []
): AggregatedHookResult {
  const blockingResult = results.find((result) => result.blocked === true);

  return {
    results: [...results],
    blocked: blockingResult !== undefined,
    reason: blockingResult?.reason ?? blockingResult?.output ?? ""
  };
}

export class InMemoryHookExecutor implements HookExecutor {
  private readonly handlers = new Map<HookEvent, HookHandler[]>();

  public register(event: HookEvent, handler: HookHandler): void {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
  }

  public async execute(
    event: HookEvent,
    payload: HookPayload
  ): Promise<AggregatedHookResult> {
    const results: HookResult[] = [];

    for (const handler of this.handlers.get(event) ?? []) {
      try {
        const result = await handler(payload, event);
        results.push(
          result ?? {
            hookType: "in_memory",
            success: true
          }
        );
      } catch (error) {
        results.push({
          hookType: "in_memory",
          success: false,
          output: getErrorMessage(error)
        });
      }
    }

    return createAggregatedHookResult(results);
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
