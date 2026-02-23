import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { InstanceRegistry } from "../client/registry.ts";
import { getTableMetadata } from "../utils/table-metadata.ts";

/**
 * Generic Table API tools — CRUD on any ServiceNow table.
 */
export function registerTableTools(server: McpServer, registry: InstanceRegistry): void {

  // ── sn_query_table ────────────────────────────────────
  server.registerTool(
    "sn_query_table",
    {
      description: "Query records from any ServiceNow table. Supports encoded queries, field selection, pagination, and display values. If fields are not specified and the table has cached metadata, common fields are used automatically.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        table: z.string().describe("Table name (e.g. 'incident', 'sys_user', 'change_request')"),
        query: z.string().optional().describe("Encoded query string (e.g. 'active=true^priority<=2')"),
        fields: z.string().optional().describe("Comma-separated field names to return. If omitted and table has cached metadata, common fields are used."),
        limit: z.number().int().min(1).max(1000).default(10).describe("Max records to return (1-1000, default 10)"),
        offset: z.number().int().min(0).default(0).describe("Starting record index for pagination"),
        display_value: z.enum(["true", "false", "all"]).default("false").describe("Return display values: 'true' (display only), 'false' (raw only), 'all' (both)"),
      },
    },
    async ({ instance, table, query, fields, limit, offset, display_value }) => {
      const client = registry.resolve(instance);

      // Use cached common_fields as default if caller didn't specify fields
      let effectiveFields = fields;
      const meta = getTableMetadata(table);
      if (!effectiveFields && meta && meta.common_fields.length > 0) {
        effectiveFields = ["sys_id", ...meta.common_fields].join(",");
      }

      const result = await client.queryTable(table, {
        sysparm_query: query,
        sysparm_fields: effectiveFields,
        sysparm_limit: limit,
        sysparm_offset: offset,
        sysparm_display_value: display_value,
        sysparm_exclude_reference_link: "true",
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                table,
                count: result.records.length,
                pagination: result.pagination,
                ...(meta ? { table_label: meta.label, display_field: meta.display_field } : {}),
                records: result.records,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ── sn_get_record ─────────────────────────────────────
  server.registerTool(
    "sn_get_record",
    {
      description: "Get a single record by sys_id from any ServiceNow table.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        table: z.string().describe("Table name"),
        sys_id: z.string().describe("The sys_id (32-char GUID) of the record"),
        fields: z.string().optional().describe("Comma-separated field names to return"),
        display_value: z.enum(["true", "false", "all"]).default("false").describe("Return display values"),
      },
    },
    async ({ instance, table, sys_id, fields, display_value }) => {
      const client = registry.resolve(instance);
      const record = await client.getRecord(table, sys_id, {
        sysparm_fields: fields,
        sysparm_display_value: display_value,
        sysparm_exclude_reference_link: "true",
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(record, null, 2) }],
      };
    }
  );

  // ── sn_create_record ──────────────────────────────────
  server.registerTool(
    "sn_create_record",
    {
      description: "Create a new record on any ServiceNow table. Pass field values as key-value pairs in the 'data' object.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        table: z.string().describe("Table name"),
        data: z.record(z.string(), z.unknown()).describe("Field values for the new record (e.g. { short_description: 'Test', priority: '1' })"),
      },
    },
    async ({ instance, table, data }) => {
      const client = registry.resolve(instance);
      const record = await client.createRecord(table, data);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { created: true, sys_id: record["sys_id"], record },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ── sn_update_record ──────────────────────────────────
  server.registerTool(
    "sn_update_record",
    {
      description: "Update an existing record on any ServiceNow table. Only the fields provided in 'data' will be changed.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        table: z.string().describe("Table name"),
        sys_id: z.string().describe("The sys_id of the record to update"),
        data: z.record(z.string(), z.unknown()).describe("Field values to update"),
      },
    },
    async ({ instance, table, sys_id, data }) => {
      const client = registry.resolve(instance);
      const record = await client.updateRecord(table, sys_id, data);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { updated: true, sys_id: record["sys_id"], record },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ── sn_delete_record ──────────────────────────────────
  server.registerTool(
    "sn_delete_record",
    {
      description: "Delete a record by sys_id from any ServiceNow table. This is permanent and cannot be undone.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        table: z.string().describe("Table name"),
        sys_id: z.string().describe("The sys_id of the record to delete"),
      },
    },
    async ({ instance, table, sys_id }) => {
      const client = registry.resolve(instance);
      await client.deleteRecord(table, sys_id);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ deleted: true, table, sys_id }, null, 2),
          },
        ],
      };
    }
  );
}
