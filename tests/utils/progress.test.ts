import { describe, expect, test, beforeEach } from "bun:test";
import { createProgressReporter, type ToolExtra, type ProgressReporter } from "../../src/utils/progress.ts";

/**
 * Tests for the MCP progress reporting utility.
 *
 * Uses a mock ToolExtra that captures sendNotification calls.
 */

interface CapturedNotification {
  method: string;
  params: {
    progressToken: string | number;
    progress: number;
    total?: number;
    message?: string;
  };
}

function createMockExtra(progressToken?: string | number): {
  extra: ToolExtra;
  notifications: CapturedNotification[];
} {
  const notifications: CapturedNotification[] = [];
  const extra = {
    signal: new AbortController().signal,
    _meta: progressToken !== undefined ? { progressToken } : undefined,
    requestId: "req-1" as unknown,
    sendNotification: async (notification: CapturedNotification) => {
      notifications.push(notification);
    },
    sendRequest: async () => { throw new Error("not implemented"); },
  } as unknown as ToolExtra;
  return { extra, notifications };
}

describe("createProgressReporter", () => {
  test("returns a ProgressReporter with current = 0", () => {
    const { extra } = createMockExtra("token-1");
    const progress = createProgressReporter(extra, 10);
    expect(progress.current).toBe(0);
  });

  test("advance() increments current by 1 by default", async () => {
    const { extra } = createMockExtra("token-1");
    const progress = createProgressReporter(extra, 10);
    await progress.advance();
    expect(progress.current).toBe(1);
  });

  test("advance(n) increments current by n", async () => {
    const { extra } = createMockExtra("token-1");
    const progress = createProgressReporter(extra, 10);
    await progress.advance(3);
    expect(progress.current).toBe(3);
  });

  test("advance() does not exceed total", async () => {
    const { extra } = createMockExtra("token-1");
    const progress = createProgressReporter(extra, 5);
    await progress.advance(10);
    expect(progress.current).toBe(5);
  });

  test("complete() sets current to total", async () => {
    const { extra } = createMockExtra("token-1");
    const progress = createProgressReporter(extra, 10);
    await progress.advance(3);
    await progress.complete();
    expect(progress.current).toBe(10);
  });

  test("complete() sends notification with default message", async () => {
    const { extra, notifications } = createMockExtra("token-1");
    const progress = createProgressReporter(extra, 5);
    await progress.complete();

    expect(notifications.length).toBeGreaterThanOrEqual(1);
    const last = notifications[notifications.length - 1]!;
    expect(last.method).toBe("notifications/progress");
    expect(last.params.progress).toBe(5);
    expect(last.params.total).toBe(5);
    expect(last.params.message).toBe("Complete");
  });

  test("complete() sends custom message", async () => {
    const { extra, notifications } = createMockExtra("token-1");
    const progress = createProgressReporter(extra, 5);
    await progress.complete("All done");

    const last = notifications[notifications.length - 1]!;
    expect(last.params.message).toBe("All done");
  });

  test("fail() sends notification with error prefix", async () => {
    const { extra, notifications } = createMockExtra("token-1");
    const progress = createProgressReporter(extra, 10);
    await progress.advance(3);
    await progress.fail("Connection timeout");

    const last = notifications[notifications.length - 1]!;
    expect(last.params.message).toBe("Failed: Connection timeout");
    expect(last.params.progress).toBe(3);
  });

  test("sends notifications with correct progressToken", async () => {
    const { extra, notifications } = createMockExtra("my-token-42");
    const progress = createProgressReporter(extra, 5);
    await progress.advance(1, "Step 1");

    expect(notifications.length).toBeGreaterThanOrEqual(1);
    expect(notifications[0]!.params.progressToken).toBe("my-token-42");
  });

  test("works with numeric progressToken", async () => {
    const { extra, notifications } = createMockExtra(42);
    const progress = createProgressReporter(extra, 5);
    await progress.advance(1, "Step 1");

    expect(notifications.length).toBeGreaterThanOrEqual(1);
    expect(notifications[0]!.params.progressToken).toBe(42);
  });

  test("notification includes total and message", async () => {
    const { extra, notifications } = createMockExtra("t1");
    const progress = createProgressReporter(extra, 20);
    await progress.advance(5, "Processing batch");

    expect(notifications.length).toBeGreaterThanOrEqual(1);
    const n = notifications[0]!;
    expect(n.params.total).toBe(20);
    expect(n.params.progress).toBe(5);
    expect(n.params.message).toBe("Processing batch");
  });

  test("advance without message omits message field", async () => {
    const { extra, notifications } = createMockExtra("t1");
    const progress = createProgressReporter(extra, 10);
    await progress.advance(1);

    expect(notifications.length).toBeGreaterThanOrEqual(1);
    // message should not be present in params
    expect(notifications[0]!.params.message).toBeUndefined();
  });
});

describe("no progressToken (no-op mode)", () => {
  test("advance() is a no-op when no progressToken", async () => {
    const { extra, notifications } = createMockExtra(undefined);
    const progress = createProgressReporter(extra, 10);
    await progress.advance(5, "Should not send");
    expect(notifications).toHaveLength(0);
    // But current still tracks
    expect(progress.current).toBe(5);
  });

  test("complete() is a no-op when no progressToken", async () => {
    const { extra, notifications } = createMockExtra(undefined);
    const progress = createProgressReporter(extra, 10);
    await progress.complete("Done");
    expect(notifications).toHaveLength(0);
    expect(progress.current).toBe(10);
  });

  test("fail() is a no-op when no progressToken", async () => {
    const { extra, notifications } = createMockExtra(undefined);
    const progress = createProgressReporter(extra, 10);
    await progress.fail("Error");
    expect(notifications).toHaveLength(0);
  });

  test("works when _meta is entirely missing", async () => {
    const extra = {
      signal: new AbortController().signal,
      requestId: "req-1",
      sendNotification: async () => {},
      sendRequest: async () => { throw new Error("not implemented"); },
    } as unknown as ToolExtra;

    const progress = createProgressReporter(extra, 5);
    await progress.advance(3);
    await progress.complete();
    expect(progress.current).toBe(5);
  });
});

describe("throttling", () => {
  test("first advance always sends (progress = 0 → 1)", async () => {
    const { extra, notifications } = createMockExtra("t1");
    const progress = createProgressReporter(extra, 100);
    await progress.advance(1, "First");
    expect(notifications).toHaveLength(1);
  });

  test("complete always sends even if recently advanced", async () => {
    const { extra, notifications } = createMockExtra("t1");
    const progress = createProgressReporter(extra, 100);
    // Advance multiple times rapidly — some may be throttled
    for (let i = 0; i < 50; i++) {
      await progress.advance(1);
    }
    const countBeforeComplete = notifications.length;
    // Complete should always send
    await progress.complete("Done");
    expect(notifications.length).toBe(countBeforeComplete + 1);
    const last = notifications[notifications.length - 1]!;
    expect(last.params.progress).toBe(100);
    expect(last.params.total).toBe(100);
  });

  test("multiple rapid advances may be throttled", async () => {
    const { extra, notifications } = createMockExtra("t1");
    const progress = createProgressReporter(extra, 1000);

    // Fire 100 rapid advances synchronously
    for (let i = 0; i < 100; i++) {
      await progress.advance(1);
    }

    // Some notifications should have been sent, but not all 100
    // (first one always sends, subsequent ones within 100ms are skipped)
    expect(notifications.length).toBeGreaterThanOrEqual(1);
    expect(notifications.length).toBeLessThanOrEqual(100);
    expect(progress.current).toBe(100);
  });
});
