import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { InstanceRegistry } from "../client/registry.ts";
import { joinQueries } from "../utils/query.ts";

export function registerChangesetTools(server: McpServer, registry: InstanceRegistry): void {

  server.registerTool("sn_list_update_sets", {
    description: "List update sets from ServiceNow.",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      query: z.string().optional(), state: z.string().optional().describe("in progress, complete, ignore, etc."),
      limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).default(0),
    },
  }, async ({ instance, query, state, limit, offset }) => {
    const client = registry.resolve(instance);
    const parts: string[] = [];
    if (query) parts.push(query);
    if (state) parts.push(`state=${state}`);
    const result = await client.queryTable("sys_update_set", {
      sysparm_query: joinQueries(...parts, "ORDERBYDESCsys_created_on"),
      sysparm_fields: "sys_id,name,description,state,application,release_date,installed_from,sys_created_by,sys_created_on",
      sysparm_limit: limit, sysparm_offset: offset, sysparm_display_value: "true", sysparm_exclude_reference_link: "true",
    });
    return { content: [{ type: "text" as const, text: JSON.stringify({ count: result.records.length, pagination: result.pagination, update_sets: result.records }, null, 2) }] };
  });

  server.registerTool("sn_get_update_set", {
    description: "Get update set details with records grouped by component type. Returns a structured breakdown showing what types of records (Business Rule, UI Policy, etc.) are in the set, with counts and actions (INSERT/UPDATE/DELETE).",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      sys_id: z.string(),
    },
  }, async ({ instance, sys_id }) => {
    const client = registry.resolve(instance);
    const [updateSet, records] = await Promise.all([
      client.getRecord("sys_update_set", sys_id, { sysparm_display_value: "all", sysparm_exclude_reference_link: "true" }),
      client.queryTable("sys_update_xml", {
        sysparm_query: `update_set=${sys_id}^ORDERBYtype^ORDERBYname`, sysparm_limit: 500,
        sysparm_fields: "sys_id,name,type,target_name,action", sysparm_display_value: "true", sysparm_exclude_reference_link: "true",
      }),
    ]);

    // Group records by type for structured breakdown
    const byType: Record<string, Array<Record<string, unknown>>> = {};
    const typeCounts: Record<string, number> = {};
    for (const rec of records.records) {
      const recType = typeof rec["type"] === "string" && rec["type"].length > 0 ? rec["type"] : "Unknown";
      if (!byType[recType]) {
        byType[recType] = [];
        typeCounts[recType] = 0;
      }
      byType[recType]!.push({
        sys_id: rec["sys_id"],
        name: rec["name"],
        target_name: rec["target_name"],
        action: rec["action"],
      });
      typeCounts[recType] = (typeCounts[recType] ?? 0) + 1;
    }

    return { content: [{ type: "text" as const, text: JSON.stringify({
      update_set: updateSet,
      summary: {
        total_records: records.records.length,
        types: Object.keys(byType).length,
        by_type: typeCounts,
      },
      components: byType,
    }, null, 2) }] };
  });

  server.registerTool("sn_create_update_set", {
    description: "Create a new update set.",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      name: z.string(), description: z.string().optional(), application: z.string().optional().describe("Application sys_id"),
    },
  }, async (params) => {
    const client = registry.resolve(params.instance);
    const data: Record<string, unknown> = { state: "in progress" };
    for (const [k, v] of Object.entries(params)) { if (v !== undefined && k !== "instance") data[k] = v; }
    const record = await client.createRecord("sys_update_set", data);
    return { content: [{ type: "text" as const, text: JSON.stringify({ created: true, sys_id: record["sys_id"], record }, null, 2) }] };
  });

  server.registerTool("sn_update_update_set", {
    description: "Update an existing update set.",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      sys_id: z.string(), data: z.record(z.string(), z.unknown()),
    },
  }, async ({ instance, sys_id, data }) => {
    const client = registry.resolve(instance);
    const record = await client.updateRecord("sys_update_set", sys_id, data);
    return { content: [{ type: "text" as const, text: JSON.stringify({ updated: true, record }, null, 2) }] };
  });

  server.registerTool("sn_set_current_update_set", {
    description: "Set an update set as the current/active one.",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      sys_id: z.string().describe("Update set sys_id to make current"),
    },
  }, async ({ instance, sys_id }) => {
    const client = registry.resolve(instance);
    const record = await client.updateRecord("sys_update_set", sys_id, { state: "in progress" });
    return { content: [{ type: "text" as const, text: JSON.stringify({ set_current: true, sys_id, name: record["name"] }, null, 2) }] };
  });

  server.registerTool("sn_commit_update_set", {
    description: "Commit (complete) an update set.",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      sys_id: z.string(),
    },
  }, async ({ instance, sys_id }) => {
    const client = registry.resolve(instance);
    const record = await client.updateRecord("sys_update_set", sys_id, { state: "complete" });
    return { content: [{ type: "text" as const, text: JSON.stringify({ committed: true, sys_id, state: "complete", name: record["name"] }, null, 2) }] };
  });

  server.registerTool("sn_add_to_update_set", {
    description: "Add a record/file reference to an update set (creates sys_update_xml entry).",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      update_set: z.string().describe("Update set sys_id"),
      name: z.string().describe("Name/identifier of the record being added"),
      type: z.string().optional().describe("Record type"),
      target_name: z.string().optional(),
      payload: z.string().optional().describe("XML payload of the record"),
    },
  }, async (params) => {
    const client = registry.resolve(params.instance);
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params)) { if (v !== undefined && k !== "instance") data[k] = v; }
    const record = await client.createRecord("sys_update_xml", data);
    return { content: [{ type: "text" as const, text: JSON.stringify({ added: true, sys_id: record["sys_id"], record }, null, 2) }] };
  });

  // ── Phase P: Update Set Move & Clone ──────────────────

  server.registerTool("sn_move_to_update_set", {
    description: "Move sys_update_xml records to a different update set. Specify records by sys_ids, source update set, or time range. Useful for fixing records in the wrong update set.",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      target_update_set: z.string().describe("Destination update set sys_id"),
      sys_ids: z.array(z.string()).optional().describe("Specific sys_update_xml record sys_ids to move"),
      source_update_set: z.string().optional().describe("Move ALL records from this update set sys_id"),
      since: z.string().optional().describe("Move records created on or after this datetime (YYYY-MM-DD HH:MM:SS)"),
      until: z.string().optional().describe("Move records created on or before this datetime (YYYY-MM-DD HH:MM:SS)"),
    },
  }, async ({ instance, target_update_set, sys_ids, source_update_set, since, until }) => {
    const client = registry.resolve(instance);

    // Build query to find records to move
    let query: string;
    if (sys_ids && sys_ids.length > 0) {
      query = sys_ids.map((id) => `sys_id=${id}`).join("^OR");
    } else if (source_update_set) {
      const parts = [`update_set=${source_update_set}`];
      if (since) parts.push(`sys_created_on>=${since}`);
      if (until) parts.push(`sys_created_on<=${until}`);
      query = joinQueries(...parts);
    } else if (since || until) {
      const parts: string[] = [];
      if (since) parts.push(`sys_created_on>=${since}`);
      if (until) parts.push(`sys_created_on<=${until}`);
      query = joinQueries(...parts);
    } else {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Provide sys_ids, source_update_set, or a time range (since/until)" }, null, 2) }] };
    }

    // Fetch records to move
    const toMove = await client.queryTable("sys_update_xml", {
      sysparm_query: query,
      sysparm_fields: "sys_id,name,type,action",
      sysparm_limit: 1000,
      sysparm_display_value: "true",
      sysparm_exclude_reference_link: "true",
    });

    if (toMove.records.length === 0) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ moved: 0, message: "No records matched the criteria" }, null, 2) }] };
    }

    // Move each record by updating update_set field
    const results: { moved: number; failed: number; records: Array<Record<string, unknown>>; errors: Array<Record<string, unknown>> } = {
      moved: 0, failed: 0, records: [], errors: [],
    };

    for (const rec of toMove.records) {
      const recSysId = rec["sys_id"];
      if (typeof recSysId !== "string") continue;
      try {
        await client.updateRecord("sys_update_xml", recSysId, { update_set: target_update_set });
        results.moved++;
        results.records.push({ sys_id: recSysId, name: rec["name"], type: rec["type"], status: "moved" });
      } catch (err) {
        results.failed++;
        results.errors.push({ sys_id: recSysId, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { content: [{ type: "text" as const, text: JSON.stringify({
      moved: results.moved,
      failed: results.failed,
      total: toMove.records.length,
      target_update_set,
      records: results.records,
      ...(results.errors.length > 0 ? { errors: results.errors } : {}),
    }, null, 2) }] };
  });

  server.registerTool("sn_clone_update_set", {
    description: "Clone an update set — creates a new update set and copies all sys_update_xml records from the source. Useful for creating backups or branching work.",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      source_update_set: z.string().describe("Source update set sys_id to clone from"),
      name: z.string().describe("Name for the new (cloned) update set"),
      description: z.string().optional().describe("Description for the new update set (defaults to 'Clone of: <source name>')"),
    },
  }, async ({ instance, source_update_set, name, description }) => {
    const client = registry.resolve(instance);

    // Fetch source update set details
    const source = await client.getRecord("sys_update_set", source_update_set, {
      sysparm_fields: "sys_id,name,description,application",
      sysparm_exclude_reference_link: "true",
    });

    const sourceName = typeof source["name"] === "string" ? source["name"] : "Unknown";
    const sourceApp = source["application"];

    // Create new update set
    const newSetData: Record<string, unknown> = {
      name,
      description: description ?? `Clone of: ${sourceName}`,
      state: "in progress",
    };
    if (sourceApp) newSetData["application"] = sourceApp;

    const newSet = await client.createRecord("sys_update_set", newSetData);
    const newSetSysId = newSet["sys_id"];
    if (typeof newSetSysId !== "string") {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Failed to create new update set" }, null, 2) }] };
    }

    // Fetch all records from source update set
    const sourceRecords = await client.queryTable("sys_update_xml", {
      sysparm_query: `update_set=${source_update_set}`,
      sysparm_fields: "name,type,target_name,payload,category,action",
      sysparm_limit: 2000,
    });

    // Clone each record into the new update set
    let cloned = 0;
    let failed = 0;
    for (const rec of sourceRecords.records) {
      try {
        const cloneData: Record<string, unknown> = { update_set: newSetSysId };
        for (const field of ["name", "type", "target_name", "payload", "category", "action"]) {
          if (rec[field] !== undefined && rec[field] !== null) cloneData[field] = rec[field];
        }
        await client.createRecord("sys_update_xml", cloneData);
        cloned++;
      } catch {
        failed++;
      }
    }

    return { content: [{ type: "text" as const, text: JSON.stringify({
      cloned: true,
      new_update_set: { sys_id: newSetSysId, name },
      source: { sys_id: source_update_set, name: sourceName },
      records_cloned: cloned,
      records_failed: failed,
      total_source_records: sourceRecords.records.length,
    }, null, 2) }] };
  });
}
