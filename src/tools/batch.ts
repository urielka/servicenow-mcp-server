import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { InstanceRegistry } from "../client/registry.ts";
import { createProgressReporter, type ToolExtra } from "../utils/progress.ts";

export function registerBatchTools(server: McpServer, registry: InstanceRegistry): void {

  server.registerTool(
    "sn_batch_create",
    {
      description: "Create multiple records in parallel across one or more tables. Each operation specifies a table and field data. Supports progress reporting.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        operations: z.array(z.object({
          table: z.string().describe("Table name"),
          data: z.record(z.string(), z.unknown()).describe("Field values"),
        })).describe("Array of create operations"),
      },
    },
    async ({ instance, operations }, extra: ToolExtra) => {
      const client = registry.resolve(instance);
      const progress = createProgressReporter(extra, operations.length);

      const results = await Promise.allSettled(
        operations.map(async (op) => {
          const record = await client.createRecord(op.table, op.data);
          await progress.advance(1, `Created record in ${op.table}`);
          return { table: op.table, sys_id: record["sys_id"], success: true };
        })
      );

      const summary = results.map((r, i) => {
        if (r.status === "fulfilled") return r.value;
        return { table: operations[i]!.table, success: false, error: (r.reason as Error).message };
      });

      const succeeded = summary.filter((s) => s.success).length;
      await progress.complete(`Created ${succeeded}/${operations.length} records`);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ total: operations.length, succeeded, failed: operations.length - succeeded, results: summary }, null, 2),
        }],
      };
    }
  );

  server.registerTool(
    "sn_batch_update",
    {
      description: "Update multiple records in parallel across one or more tables. Supports progress reporting.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        updates: z.array(z.object({
          table: z.string().describe("Table name"),
          sys_id: z.string().describe("Record sys_id"),
          data: z.record(z.string(), z.unknown()).describe("Fields to update"),
        })).describe("Array of update operations"),
      },
    },
    async ({ instance, updates }, extra: ToolExtra) => {
      const client = registry.resolve(instance);
      const progress = createProgressReporter(extra, updates.length);

      const results = await Promise.allSettled(
        updates.map(async (op) => {
          const record = await client.updateRecord(op.table, op.sys_id, op.data);
          await progress.advance(1, `Updated ${op.table}/${op.sys_id}`);
          return { table: op.table, sys_id: op.sys_id, success: true, number: record["number"] };
        })
      );

      const summary = results.map((r, i) => {
        if (r.status === "fulfilled") return r.value;
        return { table: updates[i]!.table, sys_id: updates[i]!.sys_id, success: false, error: (r.reason as Error).message };
      });

      const succeeded = summary.filter((s) => s.success).length;
      await progress.complete(`Updated ${succeeded}/${updates.length} records`);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ total: updates.length, succeeded, failed: updates.length - succeeded, results: summary }, null, 2),
        }],
      };
    }
  );
}
