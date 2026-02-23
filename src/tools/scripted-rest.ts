import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { InstanceRegistry } from "../client/registry.ts";
import { joinQueries } from "../utils/query.ts";

/**
 * Scripted REST API Management tools.
 *
 * Covers:
 *  - API Definitions  (sys_ws_definition) — the top-level API container
 *  - Resources/Ops    (sys_ws_operation)  — individual HTTP endpoints within an API
 *
 * 7 tools total.
 */
export function registerScriptedRestTools(server: McpServer, registry: InstanceRegistry): void {

  // ─── List Scripted REST APIs ───────────────────────────

  server.registerTool("sn_list_scripted_rest_apis", {
    description: "List Scripted REST API definitions from ServiceNow (sys_ws_definition).",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      query: z.string().optional().describe("Raw encoded query to append."),
      name: z.string().optional().describe("Filter by name (LIKE match)"),
      namespace: z.string().optional().describe("Filter by namespace"),
      active: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    },
  }, async ({ instance, query, name, namespace, active, limit, offset }) => {
    const client = registry.resolve(instance);
    const parts: string[] = [];
    if (query) parts.push(query);
    if (name) parts.push(`nameLIKE${name}`);
    if (namespace) parts.push(`namespace=${namespace}`);
    if (active !== undefined) parts.push(`active=${active}`);
    const q = joinQueries(...parts, "ORDERBYname");
    const result = await client.queryTable("sys_ws_definition", {
      sysparm_query: q,
      sysparm_fields: "sys_id,name,namespace,short_description,base_uri,active,protection_policy,sys_scope,sys_updated_on",
      sysparm_limit: limit,
      sysparm_offset: offset,
      sysparm_display_value: "true",
      sysparm_exclude_reference_link: "true",
    });
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ count: result.records.length, pagination: result.pagination, apis: result.records }, null, 2),
      }],
    };
  });

  // ─── Get Scripted REST API (with operations) ───────────

  server.registerTool("sn_get_scripted_rest_api", {
    description: "Get a Scripted REST API definition and all its resource operations (sys_ws_operation) in parallel.",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      sys_id: z.string().describe("sys_ws_definition sys_id"),
    },
  }, async ({ instance, sys_id }) => {
    const client = registry.resolve(instance);
    const [api, operations] = await Promise.all([
      client.getRecord("sys_ws_definition", sys_id, {
        sysparm_display_value: "all",
        sysparm_exclude_reference_link: "true",
      }),
      client.queryTable("sys_ws_operation", {
        sysparm_query: `web_service_definition=${sys_id}^ORDERBYrelative_path`,
        sysparm_fields: "sys_id,name,http_method,relative_path,operation_script,short_description,active,produces,consumes,requires_authentication,enforce_acl",
        sysparm_limit: 200,
        sysparm_display_value: "true",
        sysparm_exclude_reference_link: "true",
      }),
    ]);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ api, operations: operations.records }, null, 2),
      }],
    };
  });

  // ─── Create Scripted REST API ──────────────────────────

  server.registerTool("sn_create_scripted_rest_api", {
    description: "Create a new Scripted REST API definition (sys_ws_definition).",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      name: z.string().describe("API name"),
      namespace: z.string().optional().describe("API namespace (used in the URL path, e.g. 'x_myapp')"),
      short_description: z.string().optional().describe("Brief description of the API"),
      base_uri: z.string().optional().describe("Base URI path (auto-generated from namespace if omitted)"),
      active: z.boolean().default(true),
      protection_policy: z.enum(["none", "read", "protected"]).optional().describe("Protection policy for the API definition"),
    },
  }, async (params) => {
    const client = registry.resolve(params.instance);
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && k !== "instance") data[k] = v;
    }
    const record = await client.createRecord("sys_ws_definition", data);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ created: true, sys_id: record["sys_id"], name: record["name"], record }, null, 2),
      }],
    };
  });

  // ─── Update Scripted REST API ──────────────────────────

  server.registerTool("sn_update_scripted_rest_api", {
    description: "Update an existing Scripted REST API definition (sys_ws_definition).",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      sys_id: z.string().describe("sys_ws_definition sys_id"),
      data: z.record(z.string(), z.unknown()).describe("Fields to update."),
    },
  }, async ({ instance, sys_id, data }) => {
    const client = registry.resolve(instance);
    const record = await client.updateRecord("sys_ws_definition", sys_id, data);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ updated: true, name: record["name"], record }, null, 2),
      }],
    };
  });

  // ─── Create REST Resource (operation) ──────────────────

  server.registerTool("sn_create_rest_resource", {
    description: [
      "Create a new resource/operation (sys_ws_operation) under a Scripted REST API.",
      "This defines an individual HTTP endpoint with its method, path, and script handler.",
    ].join(" "),
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      web_service_definition: z.string().describe("sys_ws_definition sys_id — the parent API this resource belongs to"),
      name: z.string().describe("Resource/operation name"),
      http_method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).describe("HTTP method"),
      relative_path: z.string().describe("Relative URL path (e.g. '/items/{id}'). Supports path parameters in {braces}."),
      operation_script: z.string().describe([
        "Server-side JavaScript handling the request.",
        "Available objects: request (RESTAPIRequest), response (RESTAPIResponse).",
        "Access path params: request.pathParams, query params: request.queryParams,",
        "body: request.body.data, headers: request.getHeader().",
        "Return data: response.setBody(obj), response.setStatus(200).",
      ].join(" ")),
      short_description: z.string().optional().describe("Brief description of this endpoint"),
      active: z.boolean().default(true),
      produces: z.string().optional().describe("Response content type. Default: 'application/json'"),
      consumes: z.string().optional().describe("Request content type. Default: 'application/json'"),
      requires_authentication: z.boolean().default(true).describe("Whether the endpoint requires authentication"),
      enforce_acl: z.string().optional().describe("ACL enforcement setting"),
    },
  }, async (params) => {
    const client = registry.resolve(params.instance);
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && k !== "instance") data[k] = v;
    }
    const record = await client.createRecord("sys_ws_operation", data);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          created: true,
          sys_id: record["sys_id"],
          name: record["name"],
          http_method: record["http_method"],
          relative_path: record["relative_path"],
          record,
        }, null, 2),
      }],
    };
  });

  // ─── Update REST Resource ──────────────────────────────

  server.registerTool("sn_update_rest_resource", {
    description: "Update an existing Scripted REST resource/operation (sys_ws_operation).",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      sys_id: z.string().describe("sys_ws_operation sys_id"),
      data: z.record(z.string(), z.unknown()).describe("Fields to update (e.g. { operation_script: '...' })."),
    },
  }, async ({ instance, sys_id, data }) => {
    const client = registry.resolve(instance);
    const record = await client.updateRecord("sys_ws_operation", sys_id, data);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ updated: true, name: record["name"], record }, null, 2),
      }],
    };
  });

  // ─── Delete REST Resource ──────────────────────────────

  server.registerTool("sn_delete_rest_resource", {
    description: "Delete a Scripted REST resource/operation (sys_ws_operation).",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      sys_id: z.string().describe("sys_ws_operation sys_id"),
    },
  }, async ({ instance, sys_id }) => {
    const client = registry.resolve(instance);
    await client.deleteRecord("sys_ws_operation", sys_id);
    return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: true, sys_id }, null, 2) }] };
  });
}
