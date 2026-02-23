import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { InstanceRegistry } from "../client/registry.ts";
import type { ServiceNowClient } from "../client/index.ts";
import type { SNRecord } from "../client/types.ts";
import { getTableMetadata, isKnownTable, knownTableCount } from "../utils/table-metadata.ts";

/**
 * Fetch choice values for all fields on a table.
 * Returns a map of field_name → choice records.
 */
async function fetchChoices(client: ServiceNowClient, table: string): Promise<Record<string, SNRecord[]>> {
  const result = await client.queryTable("sys_choice", {
    sysparm_query: `name=${table}^ORDERBYelement^ORDERBYsequence`,
    sysparm_fields: "element,label,value,sequence,inactive",
    sysparm_limit: 1000,
    sysparm_display_value: "true",
    sysparm_exclude_reference_link: "true",
  });
  const grouped: Record<string, SNRecord[]> = {};
  for (const rec of result.records) {
    const field = typeof rec["element"] === "string" ? rec["element"] : "";
    if (!field) continue;
    if (!grouped[field]) grouped[field] = [];
    grouped[field]!.push(rec);
  }
  return grouped;
}

/**
 * Fetch data policies (sys_data_policy2) affecting a table.
 */
async function fetchPolicies(client: ServiceNowClient, table: string): Promise<SNRecord[]> {
  const result = await client.queryTable("sys_data_policy2", {
    sysparm_query: `model_table=${table}^active=true^ORDERBYshort_description`,
    sysparm_fields: "sys_id,short_description,conditions,enforce_ui,enforce_scripting,active",
    sysparm_limit: 200,
    sysparm_display_value: "true",
    sysparm_exclude_reference_link: "true",
  });
  return result.records;
}

/**
 * Fetch active business rules on a table.
 */
async function fetchBusinessRules(client: ServiceNowClient, table: string): Promise<SNRecord[]> {
  const result = await client.queryTable("sys_script", {
    sysparm_query: `collection=${table}^active=true^ORDERBYorder`,
    sysparm_fields: "sys_id,name,when,order,filter_condition,active,advanced,abort_action",
    sysparm_limit: 200,
    sysparm_display_value: "true",
    sysparm_exclude_reference_link: "true",
  });
  return result.records;
}

/**
 * Fetch unique constraints (sys_index) on a table.
 */
async function fetchConstraints(client: ServiceNowClient, table: string): Promise<SNRecord[]> {
  const result = await client.queryTable("sys_index", {
    sysparm_query: `table=${table}^ORDERBYname`,
    sysparm_fields: "sys_id,name,table,unique_index,fields",
    sysparm_limit: 200,
    sysparm_display_value: "true",
    sysparm_exclude_reference_link: "true",
  });
  return result.records;
}

export function registerSchemaTools(server: McpServer, registry: InstanceRegistry): void {

  server.registerTool("sn_get_table_schema", {
    description: "Get the schema (field definitions) for a ServiceNow table. Returns field names, types, labels, max lengths, mandatory flags, and reference targets. Optional flags enrich the response with choice values, data policies, business rules, and index constraints.",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      table: z.string().describe("Table name (e.g. 'incident', 'sys_user')"),
      include_choices: z.boolean().default(false).describe("Include choice/dropdown values for all fields (from sys_choice)"),
      include_policies: z.boolean().default(false).describe("Include active data policies (from sys_data_policy2)"),
      include_business_rules: z.boolean().default(false).describe("Include active business rules (from sys_script)"),
      include_constraints: z.boolean().default(false).describe("Include index/unique constraints (from sys_index)"),
    },
  }, async ({ instance, table, include_choices, include_policies, include_business_rules, include_constraints }) => {
    const client = registry.resolve(instance);

    // Build parallel fetch list: always fetch fields, optionally enrich
    const fetches: Promise<unknown>[] = [
      client.queryTable("sys_dictionary", {
        sysparm_query: `name=${table}^elementISNOTEMPTY^ORDERBYelement`,
        sysparm_fields: "element,column_label,internal_type,max_length,mandatory,reference,default_value,active,read_only",
        sysparm_limit: 500, sysparm_display_value: "true", sysparm_exclude_reference_link: "true",
      }),
    ];

    if (include_choices) fetches.push(fetchChoices(client, table));
    if (include_policies) fetches.push(fetchPolicies(client, table));
    if (include_business_rules) fetches.push(fetchBusinessRules(client, table));
    if (include_constraints) fetches.push(fetchConstraints(client, table));

    const results = await Promise.all(fetches);

    let idx = 0;
    const fieldsResult = results[idx++] as Awaited<ReturnType<typeof client.queryTable>>;
    const response: Record<string, unknown> = { table, field_count: fieldsResult.records.length, fields: fieldsResult.records };

    if (include_choices) {
      response["choices"] = results[idx++] as Record<string, SNRecord[]>;
    }
    if (include_policies) {
      const policies = results[idx++] as SNRecord[];
      response["data_policies"] = policies;
    }
    if (include_business_rules) {
      const rules = results[idx++] as SNRecord[];
      response["business_rules"] = rules;
    }
    if (include_constraints) {
      const constraints = results[idx++] as SNRecord[];
      response["constraints"] = constraints;
    }

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

  // ── sn_explain_field ─────────────────────────────────────

  server.registerTool("sn_explain_field", {
    description: "Get comprehensive information about a single field on a ServiceNow table. Queries sys_dictionary (definition), sys_documentation (help text), and sys_choice (dropdown values) in parallel. Returns type, label, max length, mandatory/read-only flags, reference target, default value, help text, and all choice values.",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      table: z.string().describe("Table name (e.g. 'incident')"),
      field: z.string().describe("Field element name (e.g. 'state', 'priority', 'assigned_to')"),
    },
  }, async ({ instance, table, field }) => {
    const client = registry.resolve(instance);

    // Fetch definition, documentation, and choices in parallel
    const [dictResult, docResult, choiceResult] = await Promise.all([
      client.queryTable("sys_dictionary", {
        sysparm_query: `name=${table}^element=${field}`,
        sysparm_fields: "element,column_label,internal_type,max_length,mandatory,reference,default_value,active,read_only,calculation,dependent,dependent_on_field,display",
        sysparm_limit: 1,
        sysparm_display_value: "true",
        sysparm_exclude_reference_link: "true",
      }),
      client.queryTable("sys_documentation", {
        sysparm_query: `name=${table}^element=${field}`,
        sysparm_fields: "element,label,help,hint,url",
        sysparm_limit: 5,
        sysparm_display_value: "true",
        sysparm_exclude_reference_link: "true",
      }),
      client.queryTable("sys_choice", {
        sysparm_query: `name=${table}^element=${field}^ORDERBYsequence`,
        sysparm_fields: "label,value,sequence,inactive",
        sysparm_limit: 200,
        sysparm_display_value: "true",
        sysparm_exclude_reference_link: "true",
      }),
    ]);

    const definition = dictResult.records[0] ?? null;
    const documentation = docResult.records.length > 0 ? docResult.records : null;
    const choices = choiceResult.records.length > 0 ? choiceResult.records : null;

    const response: Record<string, unknown> = {
      table,
      field,
      definition,
      documentation,
      choices,
      choice_count: choiceResult.records.length,
    };

    // Include cached metadata hint if the table is known
    const cached = getTableMetadata(table);
    if (cached) {
      const isRequired = cached.required_fields?.includes(field) ?? false;
      const isCommon = cached.common_fields?.includes(field) ?? false;
      const isDisplay = cached.display_field === field;
      response["cached_hints"] = { is_required: isRequired, is_common_field: isCommon, is_display_field: isDisplay };
    }

    return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
  });
}
