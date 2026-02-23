/**
 * Progress reporting utility for MCP tool handlers.
 *
 * Wraps MCP `notifications/progress` with:
 * - Adaptive throttling (skip notifications < MIN_INTERVAL_MS apart)
 * - Optional total for deterministic progress bars
 * - Simple advance/complete/fail API
 *
 * Usage:
 *   const progress = createProgressReporter(extra, total);
 *   for (const item of items) {
 *     await doWork(item);
 *     await progress.advance(1, `Processing ${item.name}`);
 *   }
 *   await progress.complete("All done");
 */

import type { ServerRequest, ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";

/** The extra parameter type that tool handlers receive. */
export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

/** Minimum interval between progress notifications (ms). */
const MIN_INTERVAL_MS = 100;

export interface ProgressReporter {
  /** Advance progress by `n` (default 1). Optionally include a status message. */
  advance(n?: number, message?: string): Promise<void>;

  /** Mark the operation as complete. Sends a final notification with progress = total. */
  complete(message?: string): Promise<void>;

  /** Mark the operation as failed. Sends a final notification with the error message. */
  fail(message: string): Promise<void>;

  /** Current progress value. */
  readonly current: number;
}

/**
 * Creates a progress reporter that sends MCP progress notifications.
 *
 * If the client did not provide a `progressToken` in the request metadata,
 * all operations are no-ops (safe to call unconditionally).
 *
 * @param extra - The `extra` parameter from the tool handler
 * @param total - Total number of work units (for percentage display)
 */
export function createProgressReporter(extra: ToolExtra, total: number): ProgressReporter {
  const progressToken = extra._meta?.progressToken;
  let current = 0;
  let lastSentAt = 0;

  async function send(progress: number, message?: string, force = false): Promise<void> {
    if (progressToken === undefined) return;

    const now = Date.now();
    // Throttle: skip if too soon, unless forced (complete/fail) or at boundaries (0 or total)
    if (!force && progress > 0 && progress < total && now - lastSentAt < MIN_INTERVAL_MS) {
      return;
    }

    lastSentAt = now;
    await extra.sendNotification({
      method: "notifications/progress",
      params: {
        progressToken,
        progress,
        total,
        ...(message !== undefined ? { message } : {}),
      },
    });
  }

  return {
    get current() {
      return current;
    },

    async advance(n = 1, message?: string): Promise<void> {
      current = Math.min(current + n, total);
      await send(current, message);
    },

    async complete(message?: string): Promise<void> {
      current = total;
      await send(total, message ?? "Complete", true);
    },

    async fail(message: string): Promise<void> {
      await send(current, `Failed: ${message}`, true);
    },
  };
}
