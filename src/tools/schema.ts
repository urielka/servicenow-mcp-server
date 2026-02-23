import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { InstanceRegistry } from "../client/registry.ts";
import { getTableMetadata, isKnownTable, knownTableCount } from "../utils/table-metadata.ts";

export function registerSchemaTools(server: McpServer, registry: InstanceRegistry): void {

  server.registerTool("sn_get_table_schema", {
    description: "Get the schema (field definitions) for a ServiceNow table. Returns field names, types, labels, max lengths, mandatory flags, and reference targets. If the table is in the static metadata cache, also returns display_field, key_field, required_fields, and common_fields.",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      table: z.string().describe("Table name (e.g. 'incident', 'sys_user')"),
    },
  }, async ({ instance, table }) => {
    const client = registry.resolve(instance);
    const result = await client.queryTable("sys_dictionary", {
      sysparm_query: `name=${table}^elementISNOTEMPTY^ORDERBYelement`,
      sysparm_fields: "element,column_label,internal_type,max_length,mandatory,reference,default_value,active,read_only",
      sysparm_limit: 500, sysparm_display_value: "true", sysparm_exclude_reference_link: "true",
    });

    const response: Record<string, unknown> = { table, field_count: result.records.length, fields: result.records };

    // Include cached metadata if available
    const cached = getTableMetadata(table);
    if (cached) {
      response["cached_metadata"] = cached;
    }

    return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
  });

  server.registerTool("sn_discover_table", {
    description: "Full discovery of a table: fields, parent hierarchy, and relationships.",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      table: z.string().describe("Table name"),
      include_relationships: z.boolean().default(false).describe("Also fetch foreign key relationships"),
    },
  }, async ({ instance, table, include_relationships }) => {
    const client = registry.resolve(instance);
    const [tableInfo, fields] = await Promise.all([
      client.queryTable("sys_db_object", {
        sysparm_query: `name=${table}`, sysparm_limit: 1,
        sysparm_fields: "sys_id,name,label,super_class,sys_class_name,access",
        sysparm_display_value: "true", sysparm_exclude_reference_link: "true",
      }),
      client.queryTable("sys_dictionary", {
        sysparm_query: `name=${table}^elementISNOTEMPTY^ORDERBYelement`,
        sysparm_fields: "element,column_label,internal_type,max_length,mandatory,reference,default_value,active",
        sysparm_limit: 500, sysparm_display_value: "true", sysparm_exclude_reference_link: "true",
      }),
    ]);

    const response: Record<string, unknown> = {
      table: tableInfo.records[0] ?? { name: table },
      field_count: fields.records.length,
      fields: fields.records,
    };

    if (include_relationships) {
      const refs = fields.records.filter((f) => f["reference"] && f["reference"] !== "");
      response["reference_fields"] = refs.map((f) => ({
        field: f["element"],
        references_table: f["reference"],
      }));
    }

    // Include cached metadata if available
    const cached = getTableMetadata(table);
    if (cached) {
      response["cached_metadata"] = cached;
    }

    return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
  });

  server.registerTool("sn_list_tables", {
    description: "List available tables in ServiceNow (from sys_db_object). Tables with cached metadata are annotated with has_cached_metadata=true.",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      query: z.string().optional().describe("Filter by name (LIKE match)"),
      limit: z.number().int().min(1).max(500).default(100),
    },
  }, async ({ instance, query, limit }) => {
    const client = registry.resolve(instance);
    const q = query ? `nameLIKE${query}^ORDERBYname` : "ORDERBYname";
    const result = await client.queryTable("sys_db_object", {
      sysparm_query: q, sysparm_fields: "sys_id,name,label,super_class",
      sysparm_limit: limit, sysparm_display_value: "true", sysparm_exclude_reference_link: "true",
    });

    // Annotate tables that have cached metadata
    const tables = result.records.map((rec) => {
      const name = typeof rec["name"] === "string" ? rec["name"] : "";
      return { ...rec, has_cached_metadata: isKnownTable(name) };
    });

    return { content: [{ type: "text" as const, text: JSON.stringify({ count: result.records.length, cached_table_count: knownTableCount(), tables }, null, 2) }] };
  });
}
