import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { InstanceRegistry } from "../client/registry.ts";
import { logger } from "../utils/logger.ts";

export function registerWorkflowTools(server: McpServer, registry: InstanceRegistry): void {

  server.registerTool("sn_list_workflows", {
    description: "List workflows from ServiceNow.",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      query: z.string().optional(), active: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).default(20), offset: z.number().int().min(0).default(0),
    },
  }, async ({ instance, query, active, limit, offset }) => {
    const client = registry.resolve(instance);
    const parts: string[] = [];
    if (query) parts.push(query);
    if (active !== undefined) parts.push(`active=${active}`);
    const q = parts.length ? parts.join("^") + "^ORDERBYname" : "ORDERBYname";
    const result = await client.queryTable("wf_workflow", {
      sysparm_query: q, sysparm_fields: "sys_id,name,description,table,active,sys_updated_on",
      sysparm_limit: limit, sysparm_offset: offset, sysparm_display_value: "true", sysparm_exclude_reference_link: "true",
    });
    return { content: [{ type: "text" as const, text: JSON.stringify({ count: result.records.length, pagination: result.pagination, workflows: result.records }, null, 2) }] };
  });

  server.registerTool("sn_get_workflow", {
    description: "Get workflow details including activities.",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      sys_id: z.string().describe("Workflow sys_id"),
    },
  }, async ({ instance, sys_id }) => {
    const client = registry.resolve(instance);
    const [workflow, activities] = await Promise.all([
      client.getRecord("wf_workflow", sys_id, { sysparm_display_value: "all", sysparm_exclude_reference_link: "true" }),
      client.queryTable("wf_activity", {
        sysparm_query: `workflow_version.workflow=${sys_id}^ORDERBYx`, sysparm_limit: 200,
        sysparm_fields: "sys_id,name,activity_definition,x,y,out_of_date", sysparm_display_value: "true", sysparm_exclude_reference_link: "true",
      }),
    ]);
    return { content: [{ type: "text" as const, text: JSON.stringify({ workflow, activities: activities.records }, null, 2) }] };
  });

  server.registerTool("sn_create_workflow", {
    description: "Create a new workflow.",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      name: z.string(), table: z.string().describe("Table the workflow applies to"), description: z.string().optional(),
    },
  }, async (params) => {
    const client = registry.resolve(params.instance);
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params)) { if (v !== undefined && k !== "instance") data[k] = v; }
    const record = await client.createRecord("wf_workflow", data);
    return { content: [{ type: "text" as const, text: JSON.stringify({ created: true, sys_id: record["sys_id"], record }, null, 2) }] };
  });

  server.registerTool("sn_update_workflow", {
    description: "Update an existing workflow.",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      sys_id: z.string(), data: z.record(z.string(), z.unknown()),
    },
  }, async ({ instance, sys_id, data }) => {
    const client = registry.resolve(instance);
    const record = await client.updateRecord("wf_workflow", sys_id, data);
    return { content: [{ type: "text" as const, text: JSON.stringify({ updated: true, record }, null, 2) }] };
  });

  server.registerTool("sn_delete_workflow", {
    description: "Delete a workflow.",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      sys_id: z.string().describe("Workflow sys_id"),
    },
  }, async ({ instance, sys_id }) => {
    const client = registry.resolve(instance);
    await client.deleteRecord("wf_workflow", sys_id);
    return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: true, sys_id }, null, 2) }] };
  });

  // ── Enhanced Workflow Orchestration ─────────────────────

  const ActivitySchema = z.object({
    name: z.string().describe("Activity name"),
    activity_definition: z.string().optional().describe("Activity definition sys_id (determines the type of activity)"),
    x: z.number().optional().describe("X coordinate in workflow canvas"),
    y: z.number().optional().describe("Y coordinate in workflow canvas"),
    vars: z.record(z.string(), z.unknown()).optional().describe("Activity input variables (stored in wf_activity.input)"),
    script: z.string().optional().describe("Activity script (for Run Script activities, stored in input)"),
  });

  const TransitionSchema = z.object({
    from: z.union([z.string(), z.number()]).describe("Source activity — name (string) or index (number) in the activities array"),
    to: z.union([z.string(), z.number()]).describe("Target activity — name (string) or index (number) in the activities array"),
    condition: z.string().optional().describe("Transition condition script (creates a wf_condition record)"),
    label: z.string().optional().describe("Transition label"),
  });

  server.registerTool("sn_create_workflow_full", {
    description: [
      "Create a complete workflow end-to-end in a single call.",
      "Orchestrates: wf_workflow → wf_workflow_version → wf_activity[] → wf_transition[] → optional publish.",
      "Activities can be referenced by name or array index in transition definitions.",
      "This is the recommended way to create workflows — avoids multiple round-trips.",
    ].join(" "),
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      name: z.string().describe("Workflow name"),
      table: z.string().describe("Table the workflow applies to (e.g. 'incident', 'change_request')"),
      description: z.string().optional(),
      condition: z.string().optional().describe("Encoded query condition for when the workflow triggers"),
      activities: z.array(ActivitySchema).describe("Array of activities to create in this workflow"),
      transitions: z.array(TransitionSchema).optional().describe("Array of transitions between activities. Activities referenced by name or index."),
      publish: z.boolean().default(false).describe("Whether to publish the workflow after creation. If true, the first activity is set as the start activity."),
    },
  }, async ({ instance, name, table, description, condition, activities, transitions, publish }) => {
    const client = registry.resolve(instance);
    const results: Record<string, unknown> = {};

    // Step 1: Create the base workflow
    logger.info(`Creating workflow: ${name}`);
    const workflow = await client.createRecord("wf_workflow", {
      name,
      table,
      description: description ?? "",
    });
    const workflowSysId = workflow["sys_id"] as string;
    results["workflow"] = { sys_id: workflowSysId, name };

    // Step 2: Create workflow version
    logger.info(`Creating workflow version for: ${name}`);
    const version = await client.createRecord("wf_workflow_version", {
      workflow: workflowSysId,
      name,
      table,
      condition: condition ?? "",
      active: "true",
      published: "false",
    });
    const versionSysId = version["sys_id"] as string;
    results["version"] = { sys_id: versionSysId };

    // Step 3: Create activities
    const activityMap: Map<string, string> = new Map(); // name → sys_id
    const activityList: Array<{ name: string; sys_id: string }> = [];

    for (const [i, act] of activities.entries()) {
      logger.info(`Creating activity ${i + 1}/${activities.length}: ${act.name}`);

      const actData: Record<string, unknown> = {
        workflow_version: versionSysId,
        name: act.name,
        x: act.x ?? (150 + i * 200),
        y: act.y ?? 200,
      };

      if (act.activity_definition) actData["activity_definition"] = act.activity_definition;

      // Script/vars go into the 'input' field as a serialized object or directly
      if (act.script) {
        actData["input"] = act.script;
      } else if (act.vars) {
        actData["input"] = JSON.stringify(act.vars);
      }

      const actRecord = await client.createRecord("wf_activity", actData);
      const actSysId = actRecord["sys_id"] as string;
      activityMap.set(act.name, actSysId);
      activityList.push({ name: act.name, sys_id: actSysId });
    }
    results["activities"] = activityList;

    // Step 4: Create transitions
    const transitionResults: Array<Record<string, unknown>> = [];

    if (transitions && transitions.length > 0) {
      for (const [i, t] of transitions.entries()) {
        logger.info(`Creating transition ${i + 1}/${transitions.length}`);

        // Resolve from/to — can be string (name) or number (index)
        const resolveActivity = (ref: string | number): string | undefined => {
          if (typeof ref === "number") return activityList[ref]?.sys_id;
          return activityMap.get(ref);
        };

        const fromSysId = resolveActivity(t.from);
        const toSysId = resolveActivity(t.to);

        if (!fromSysId || !toSysId) {
          transitionResults.push({
            error: `Could not resolve activity reference: from=${t.from}, to=${t.to}`,
            from_resolved: fromSysId,
            to_resolved: toSysId,
          });
          continue;
        }

        // Optionally create a wf_condition
        let conditionSysId: string | undefined;
        if (t.condition) {
          const condRecord = await client.createRecord("wf_condition", {
            name: t.label ?? `Condition: ${t.from} → ${t.to}`,
            condition: t.condition,
          });
          conditionSysId = condRecord["sys_id"] as string;
        }

        const transData: Record<string, unknown> = {
          from: fromSysId,
          to: toSysId,
        };
        if (conditionSysId) transData["condition"] = conditionSysId;

        const transRecord = await client.createRecord("wf_transition", transData);
        transitionResults.push({
          sys_id: transRecord["sys_id"] as string,
          from: t.from,
          to: t.to,
          condition: conditionSysId ?? null,
        });
      }
    }
    results["transitions"] = transitionResults;

    // Step 5: Optionally publish
    if (publish && activityList.length > 0) {
      logger.info(`Publishing workflow: ${name}`);
      const firstActivity = activityList[0];
      if (firstActivity) {
        await client.updateRecord("wf_workflow_version", versionSysId, {
          start: firstActivity.sys_id,
          published: "true",
        });
      }
      results["published"] = true;
    } else {
      results["published"] = false;
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ created: true, ...results }, null, 2),
      }],
    };
  });

  // ── Individual Activity Creation ───────────────────────

  server.registerTool("sn_create_workflow_activity", {
    description: "Add a single activity to an existing workflow version (wf_activity).",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      workflow_version: z.string().describe("wf_workflow_version sys_id"),
      name: z.string().describe("Activity name"),
      activity_definition: z.string().optional().describe("Activity definition sys_id"),
      x: z.number().optional().describe("X coordinate on the workflow canvas"),
      y: z.number().optional().describe("Y coordinate on the workflow canvas"),
      input: z.string().optional().describe("Activity input — script content or serialized variables"),
    },
  }, async (params) => {
    const client = registry.resolve(params.instance);
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && k !== "instance") data[k] = v;
    }
    const record = await client.createRecord("wf_activity", data);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ created: true, sys_id: record["sys_id"], name: record["name"], record }, null, 2),
      }],
    };
  });

  // ── Individual Transition Creation ─────────────────────

  server.registerTool("sn_create_workflow_transition", {
    description: "Create a transition between two workflow activities (wf_transition), optionally with a condition (wf_condition).",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      from: z.string().describe("Source activity sys_id"),
      to: z.string().describe("Target activity sys_id"),
      condition_script: z.string().optional().describe("If provided, creates a wf_condition record and links it to this transition."),
      condition_name: z.string().optional().describe("Name for the condition record"),
    },
  }, async ({ instance, from, to, condition_script, condition_name }) => {
    const client = registry.resolve(instance);

    let conditionSysId: string | undefined;
    if (condition_script) {
      const condRecord = await client.createRecord("wf_condition", {
        name: condition_name ?? "Transition Condition",
        condition: condition_script,
      });
      conditionSysId = condRecord["sys_id"] as string;
    }

    const transData: Record<string, unknown> = { from, to };
    if (conditionSysId) transData["condition"] = conditionSysId;

    const record = await client.createRecord("wf_transition", transData);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          created: true,
          sys_id: record["sys_id"],
          from,
          to,
          condition: conditionSysId ?? null,
          record,
        }, null, 2),
      }],
    };
  });

  // ── Publish Workflow ───────────────────────────────────

  server.registerTool("sn_publish_workflow", {
    description: "Publish a workflow version by setting the start activity and marking it as published.",
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      version_sys_id: z.string().describe("wf_workflow_version sys_id to publish"),
      start_activity: z.string().describe("sys_id of the first activity (entry point) of the workflow"),
    },
  }, async ({ instance, version_sys_id, start_activity }) => {
    const client = registry.resolve(instance);
    const record = await client.updateRecord("wf_workflow_version", version_sys_id, {
      start: start_activity,
      published: "true",
    });
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          published: true,
          version_sys_id,
          start_activity,
          record,
        }, null, 2),
      }],
    };
  });
}
