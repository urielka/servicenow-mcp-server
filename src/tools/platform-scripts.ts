import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { InstanceRegistry } from "../client/registry.ts";
import { joinQueries } from "../utils/query.ts";

/**
 * Platform Script Types — CRUD for all major ServiceNow scripting records.
 *
 * Covers:
 *  - Business Rules    (sys_script)
 *  - Client Scripts     (sys_script_client)
 *  - UI Policies        (sys_ui_policy)
 *  - UI Actions         (sys_ui_action)
 *  - UI Scripts         (sys_ui_script)
 *
 * Each type gets: list, get, create, update, delete = 25 tools total.
 */

// ── Helper: register a standard CRUD quintet for a script table ──

interface ScriptTypeConfig {
  /** Human-readable name (e.g. "business rule") */
  label: string;
  /** ServiceNow table name */
  table: string;
  /** Tool name prefix (e.g. "sn_business_rule" → sn_list_business_rules) */
  prefix: string;
  /** Fields to return in list view */
  listFields: string;
  /** Extra Zod schema fields for the list tool's filters */
  listFilters: Record<string, z.ZodTypeAny>;
  /** Build encoded query parts from the filter values */
  buildListQuery: (filters: Record<string, unknown>) => string[];
  /** Zod schema for the create tool's required/optional fields */
  createSchema: Record<string, z.ZodTypeAny>;
}

function registerScriptTypeCrud(
  server: McpServer,
  registry: InstanceRegistry,
  cfg: ScriptTypeConfig,
): void {
  const { label, table, prefix, listFields, listFilters, buildListQuery, createSchema } = cfg;

  // ── List ──
  server.registerTool(`sn_list_${prefix}s`, {
    description: `List ${label}s from ServiceNow (${table}).`,
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      query: z.string().optional().describe("Raw encoded query to append."),
      ...listFilters,
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    },
  }, async (params: Record<string, unknown>) => {
    const client = registry.resolve(params.instance as string | undefined);
    const filterParts = buildListQuery(params);
    if (params.query) filterParts.unshift(params.query as string);
    const q = joinQueries(...filterParts, "ORDERBYname");
    const result = await client.queryTable(table, {
      sysparm_query: q,
      sysparm_fields: listFields,
      sysparm_limit: params.limit as number,
      sysparm_offset: params.offset as number,
      sysparm_display_value: "true",
      sysparm_exclude_reference_link: "true",
    });
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ count: result.records.length, pagination: result.pagination, [`${prefix}s`]: result.records }, null, 2),
      }],
    };
  });

  // ── Get ──
  server.registerTool(`sn_get_${prefix}`, {
    description: `Get a ${label} by sys_id (includes full script body).`,
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      sys_id: z.string().describe(`${label} sys_id`),
    },
  }, async ({ instance, sys_id }) => {
    const client = registry.resolve(instance);
    const record = await client.getRecord(table, sys_id, {
      sysparm_display_value: "false",
      sysparm_exclude_reference_link: "true",
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(record, null, 2) }] };
  });

  // ── Create ──
  server.registerTool(`sn_create_${prefix}`, {
    description: `Create a new ${label} in ServiceNow (${table}).`,
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      ...createSchema,
    },
  }, async (params: Record<string, unknown>) => {
    const client = registry.resolve(params.instance as string | undefined);
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && k !== "instance") data[k] = v;
    }
    const record = await client.createRecord(table, data);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ created: true, sys_id: record["sys_id"], name: record["name"], record }, null, 2),
      }],
    };
  });

  // ── Update ──
  server.registerTool(`sn_update_${prefix}`, {
    description: `Update an existing ${label} (${table}).`,
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      sys_id: z.string().describe(`${label} sys_id`),
      data: z.record(z.string(), z.unknown()).describe("Fields to update (e.g. { script: '...' })."),
    },
  }, async ({ instance, sys_id, data }) => {
    const client = registry.resolve(instance);
    const record = await client.updateRecord(table, sys_id, data);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ updated: true, name: record["name"], record }, null, 2),
      }],
    };
  });

  // ── Delete ──
  server.registerTool(`sn_delete_${prefix}`, {
    description: `Delete a ${label} (${table}).`,
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      sys_id: z.string().describe(`${label} sys_id`),
    },
  }, async ({ instance, sys_id }) => {
    const client = registry.resolve(instance);
    await client.deleteRecord(table, sys_id);
    return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: true, sys_id }, null, 2) }] };
  });
}

// ── Main registration ────────────────────────────────────────────

export function registerPlatformScriptTools(server: McpServer, registry: InstanceRegistry): void {

  // ─── Business Rules (sys_script) ───────────────────────
  registerScriptTypeCrud(server, registry, {
    label: "business rule",
    table: "sys_script",
    prefix: "sn_business_rule",
    listFields: "sys_id,name,collection,when,order,active,description,sys_scope,sys_updated_on",
    listFilters: {
      name: z.string().optional().describe("Filter by name (LIKE match)"),
      table: z.string().optional().describe("Filter by table name (collection field)"),
      when: z.enum(["before", "after", "async", "display"]).optional().describe("Filter by trigger timing"),
      active: z.boolean().optional(),
    },
    buildListQuery: (f) => {
      const parts: string[] = [];
      if (f.name) parts.push(`nameLIKE${f.name}`);
      if (f.table) parts.push(`collection=${f.table}`);
      if (f.when) parts.push(`when=${f.when}`);
      if (f.active !== undefined) parts.push(`active=${f.active}`);
      return parts;
    },
    createSchema: {
      name: z.string().describe("Business rule name"),
      collection: z.string().describe("Table this rule applies to (e.g. 'incident')"),
      when: z.enum(["before", "after", "async", "display"]).describe("When to trigger"),
      script: z.string().describe("Server-side JavaScript executed by this rule"),
      order: z.number().int().optional().describe("Execution order (lower = earlier). Default: 100."),
      filter_condition: z.string().optional().describe("Encoded query condition for when the rule fires"),
      condition: z.string().optional().describe("Script condition (evaluated before script runs)"),
      active: z.boolean().default(true),
      description: z.string().optional(),
      insert: z.boolean().optional().describe("Run on insert"),
      update: z.boolean().optional().describe("Run on update"),
      delete: z.boolean().optional().describe("Run on delete"),
      query: z.boolean().optional().describe("Run on query"),
    },
  });

  // ─── Client Scripts (sys_script_client) ────────────────
  registerScriptTypeCrud(server, registry, {
    label: "client script",
    table: "sys_script_client",
    prefix: "sn_client_script",
    listFields: "sys_id,name,table,type,field_name,active,description,sys_scope,sys_updated_on",
    listFilters: {
      name: z.string().optional().describe("Filter by name (LIKE match)"),
      table: z.string().optional().describe("Filter by table"),
      type: z.enum(["onChange", "onLoad", "onSubmit", "onCellEdit"]).optional().describe("Filter by script type"),
      active: z.boolean().optional(),
    },
    buildListQuery: (f) => {
      const parts: string[] = [];
      if (f.name) parts.push(`nameLIKE${f.name}`);
      if (f.table) parts.push(`table=${f.table}`);
      if (f.type) parts.push(`type=${f.type}`);
      if (f.active !== undefined) parts.push(`active=${f.active}`);
      return parts;
    },
    createSchema: {
      name: z.string().describe("Client script name"),
      table: z.string().describe("Table this script applies to"),
      type: z.enum(["onChange", "onLoad", "onSubmit", "onCellEdit"]).describe("Script type"),
      script: z.string().describe("Client-side JavaScript"),
      field_name: z.string().optional().describe("Field name (required for onChange type)"),
      active: z.boolean().default(true),
      description: z.string().optional(),
      ui_type: z.enum(["0", "1", "10"]).optional().describe("UI type: 0=Desktop, 1=Mobile/Service Portal, 10=All"),
      messages: z.string().optional().describe("Comma-separated message keys to load (for getMessage())"),
    },
  });

  // ─── UI Policies (sys_ui_policy) ───────────────────────
  registerScriptTypeCrud(server, registry, {
    label: "ui policy",
    table: "sys_ui_policy",
    prefix: "sn_ui_policy",
    listFields: "sys_id,short_description,table,conditions,on_load,reverse_if_false,active,order,sys_scope,sys_updated_on",
    listFilters: {
      name: z.string().optional().describe("Filter by short_description (LIKE match)"),
      table: z.string().optional().describe("Filter by table"),
      active: z.boolean().optional(),
    },
    buildListQuery: (f) => {
      const parts: string[] = [];
      if (f.name) parts.push(`short_descriptionLIKE${f.name}`);
      if (f.table) parts.push(`table=${f.table}`);
      if (f.active !== undefined) parts.push(`active=${f.active}`);
      return parts;
    },
    createSchema: {
      short_description: z.string().describe("UI policy description/name"),
      table: z.string().describe("Table this policy applies to"),
      conditions: z.string().optional().describe("Encoded query condition for when the policy applies"),
      script_true: z.string().optional().describe("Script to execute when condition is true (onCondition)"),
      script_false: z.string().optional().describe("Script to execute when condition is false (reverse)"),
      on_load: z.boolean().default(true).describe("Apply on form load"),
      reverse_if_false: z.boolean().default(true).describe("Reverse actions when condition becomes false"),
      active: z.boolean().default(true),
      order: z.number().int().optional().describe("Execution order"),
      inherit: z.boolean().optional().describe("Apply to extended tables"),
      global: z.boolean().optional().describe("Apply regardless of view"),
    },
  });

  // ─── UI Actions (sys_ui_action) ────────────────────────
  registerScriptTypeCrud(server, registry, {
    label: "ui action",
    table: "sys_ui_action",
    prefix: "sn_ui_action",
    listFields: "sys_id,name,table,active,form_button,form_link,list_button,list_link,order,sys_scope,sys_updated_on",
    listFilters: {
      name: z.string().optional().describe("Filter by name (LIKE match)"),
      table: z.string().optional().describe("Filter by table"),
      active: z.boolean().optional(),
    },
    buildListQuery: (f) => {
      const parts: string[] = [];
      if (f.name) parts.push(`nameLIKE${f.name}`);
      if (f.table) parts.push(`table=${f.table}`);
      if (f.active !== undefined) parts.push(`active=${f.active}`);
      return parts;
    },
    createSchema: {
      name: z.string().describe("UI action name"),
      table: z.string().describe("Table this action applies to"),
      script: z.string().optional().describe("Server-side script (for server-side actions)"),
      client_script: z.string().optional().describe("Client-side script (onClick handler)"),
      condition: z.string().optional().describe("Server-side condition script (must return true)"),
      active: z.boolean().default(true),
      form_button: z.boolean().optional().describe("Show as form button"),
      form_link: z.boolean().optional().describe("Show as form context menu link"),
      form_context_menu: z.boolean().optional().describe("Show in form context menu"),
      list_button: z.boolean().optional().describe("Show as list button"),
      list_link: z.boolean().optional().describe("Show as list context menu link"),
      list_context_menu: z.boolean().optional().describe("Show in list context menu"),
      order: z.number().int().optional().describe("Display order"),
      hint: z.string().optional().describe("Tooltip text"),
      comments: z.string().optional().describe("Description/comments"),
      client: z.boolean().optional().describe("Run client-side script instead of server-side"),
    },
  });

  // ─── UI Scripts (sys_ui_script) ────────────────────────
  registerScriptTypeCrud(server, registry, {
    label: "ui script",
    table: "sys_ui_script",
    prefix: "sn_ui_script",
    listFields: "sys_id,name,active,description,global,sys_scope,sys_updated_on",
    listFilters: {
      name: z.string().optional().describe("Filter by name (LIKE match)"),
      active: z.boolean().optional(),
    },
    buildListQuery: (f) => {
      const parts: string[] = [];
      if (f.name) parts.push(`nameLIKE${f.name}`);
      if (f.active !== undefined) parts.push(`active=${f.active}`);
      return parts;
    },
    createSchema: {
      name: z.string().describe("UI script name"),
      script: z.string().describe("Client-side JavaScript (loaded as a global include)"),
      active: z.boolean().default(true),
      description: z.string().optional(),
      global: z.boolean().default(false).describe("Whether to include on every page (global UI script)"),
    },
  });
}
