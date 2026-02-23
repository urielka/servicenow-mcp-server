import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { InstanceRegistry } from "../client/registry.ts";
import { joinQueries } from "../utils/query.ts";
import {
  resolveOptionalUser,
  resolveOptionalGroup,
  resolveRecordIdentifier,
  type ResolvableClient,
} from "../utils/resolve.ts";

export function registerIncidentTools(server: McpServer, registry: InstanceRegistry): void {

  server.registerTool(
    "sn_list_incidents",
    {
      description: "List incidents from ServiceNow with optional filters. Returns number, description, state, priority, assignment info.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        query: z.string().optional().describe("Encoded query (e.g. 'active=true^priority=1')"),
        state: z.string().optional().describe("Filter by state: 1=New, 2=In Progress, 3=On Hold, 6=Resolved, 7=Closed"),
        priority: z.string().optional().describe("Filter by priority: 1=Critical, 2=High, 3=Moderate, 4=Low, 5=Planning"),
        assignment_group: z.string().optional().describe("Filter by assignment group name or sys_id"),
        assigned_to: z.string().optional().describe("Filter by assigned user name or sys_id"),
        category: z.string().optional().describe("Filter by category"),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      },
    },
    async ({ instance, query, state, priority, assignment_group, assigned_to, category, limit, offset }) => {
      const client = registry.resolve(instance);
      const parts: string[] = [];
      if (query) parts.push(query);
      if (state) parts.push(`state=${state}`);
      if (priority) parts.push(`priority=${priority}`);
      if (assignment_group) parts.push(`assignment_group.name=${assignment_group}`);
      if (assigned_to) parts.push(`assigned_to.user_name=${assigned_to}`);
      if (category) parts.push(`category=${category}`);

      const encodedQuery = joinQueries(...parts, "ORDERBYDESCsys_created_on");

      const result = await client.queryTable("incident", {
        sysparm_query: encodedQuery,
        sysparm_fields: "number,short_description,state,priority,urgency,impact,category,subcategory,assigned_to,assignment_group,caller_id,opened_at,sys_id",
        sysparm_limit: limit,
        sysparm_offset: offset,
        sysparm_display_value: "true",
        sysparm_exclude_reference_link: "true",
      });

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ count: result.records.length, pagination: result.pagination, incidents: result.records }, null, 2) }],
      };
    }
  );

  server.registerTool(
    "sn_create_incident",
    {
      description: "Create a new incident in ServiceNow. Accepts human-readable names for assigned_to, caller_id (user name, user_name, or email) and assignment_group (group name). These are auto-resolved to sys_ids.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        short_description: z.string().describe("Brief description of the incident"),
        description: z.string().optional().describe("Detailed description"),
        urgency: z.enum(["1", "2", "3"]).optional().describe("1=High, 2=Medium, 3=Low"),
        impact: z.enum(["1", "2", "3"]).optional().describe("1=High, 2=Medium, 3=Low"),
        category: z.string().optional(),
        subcategory: z.string().optional(),
        assignment_group: z.string().optional().describe("Assignment group sys_id or group name (auto-resolved)"),
        assigned_to: z.string().optional().describe("Assigned user sys_id, user_name, email, or full name (auto-resolved)"),
        caller_id: z.string().optional().describe("Caller sys_id, user_name, email, or full name (auto-resolved)"),
        contact_type: z.string().optional().describe("How the incident was reported (e.g. phone, email, self-service)"),
      },
    },
    async (params) => {
      const client = registry.resolve(params.instance);
      const rc = client as unknown as ResolvableClient;

      const data: Record<string, unknown> = { short_description: params.short_description };
      if (params.description) data["description"] = params.description;
      if (params.urgency) data["urgency"] = params.urgency;
      if (params.impact) data["impact"] = params.impact;
      if (params.category) data["category"] = params.category;
      if (params.subcategory) data["subcategory"] = params.subcategory;
      if (params.contact_type) data["contact_type"] = params.contact_type;

      // Resolve human-readable identifiers to sys_ids
      const [assignedTo, callerId, assignmentGroup] = await Promise.all([
        resolveOptionalUser(rc, params.assigned_to),
        resolveOptionalUser(rc, params.caller_id),
        resolveOptionalGroup(rc, params.assignment_group),
      ]);
      if (assignedTo) data["assigned_to"] = assignedTo;
      if (callerId) data["caller_id"] = callerId;
      if (assignmentGroup) data["assignment_group"] = assignmentGroup;

      const record = await client.createRecord("incident", data);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ created: true, number: record["number"], sys_id: record["sys_id"], record }, null, 2) }],
      };
    }
  );

  server.registerTool(
    "sn_update_incident",
    {
      description: "Update an existing incident in ServiceNow. The incident can be specified by sys_id or number (e.g. 'INC0010045'). Fields like assigned_to, caller_id accept human-readable names (auto-resolved).",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        sys_id: z.string().describe("Incident sys_id or number (e.g. 'INC0010045' — auto-resolved)"),
        data: z.record(z.string(), z.unknown()).describe("Fields to update. User fields (assigned_to, caller_id) accept names/user_names. Group fields (assignment_group) accept group names."),
      },
    },
    async ({ instance, sys_id, data }) => {
      const client = registry.resolve(instance);
      const rc = client as unknown as ResolvableClient;

      // Resolve incident identifier (sys_id or INC number)
      const resolved = await resolveRecordIdentifier(rc, sys_id, "incident");

      // Resolve user/group fields in data if present
      const resolvedData = { ...data };
      if (typeof resolvedData["assigned_to"] === "string") {
        resolvedData["assigned_to"] = await resolveOptionalUser(rc, resolvedData["assigned_to"] as string);
      }
      if (typeof resolvedData["caller_id"] === "string") {
        resolvedData["caller_id"] = await resolveOptionalUser(rc, resolvedData["caller_id"] as string);
      }
      if (typeof resolvedData["assignment_group"] === "string") {
        resolvedData["assignment_group"] = await resolveOptionalGroup(rc, resolvedData["assignment_group"] as string);
      }

      const record = await client.updateRecord("incident", resolved.sys_id, resolvedData);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ updated: true, number: record["number"], sys_id: record["sys_id"], record }, null, 2) }],
      };
    }
  );

  server.registerTool(
    "sn_add_incident_comment",
    {
      description: "Add a customer-visible comment to an incident. Accepts incident number (e.g. 'INC0010045') or sys_id.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        sys_id: z.string().describe("Incident sys_id or number (e.g. 'INC0010045' — auto-resolved)"),
        comment: z.string().describe("Comment text (visible to customers)"),
      },
    },
    async ({ instance, sys_id, comment }) => {
      const client = registry.resolve(instance);
      const rc = client as unknown as ResolvableClient;
      const resolved = await resolveRecordIdentifier(rc, sys_id, "incident");
      const record = await client.updateRecord("incident", resolved.sys_id, { comments: comment });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: true, number: record["number"], comment_added: true }, null, 2) }],
      };
    }
  );

  server.registerTool(
    "sn_add_incident_work_notes",
    {
      description: "Add internal work notes to an incident (not visible to customers). Accepts incident number (e.g. 'INC0010045') or sys_id.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        sys_id: z.string().describe("Incident sys_id or number (e.g. 'INC0010045' — auto-resolved)"),
        work_notes: z.string().describe("Work notes text (internal only)"),
      },
    },
    async ({ instance, sys_id, work_notes }) => {
      const client = registry.resolve(instance);
      const rc = client as unknown as ResolvableClient;
      const resolved = await resolveRecordIdentifier(rc, sys_id, "incident");
      const record = await client.updateRecord("incident", resolved.sys_id, { work_notes });
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ success: true, number: record["number"], work_notes_added: true }, null, 2) }],
      };
    }
  );

  server.registerTool(
    "sn_resolve_incident",
    {
      description: "Resolve an incident in ServiceNow (set state to Resolved). Accepts incident number (e.g. 'INC0010045') or sys_id.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        sys_id: z.string().describe("Incident sys_id or number (e.g. 'INC0010045' — auto-resolved)"),
        resolution_code: z.string().optional().describe("Resolution code (e.g. 'Solved (Permanently)', 'Solved (Work Around)')"),
        resolution_notes: z.string().optional().describe("Resolution notes explaining the fix"),
        close_code: z.string().optional().describe("Close code"),
      },
    },
    async ({ instance, sys_id, resolution_code, resolution_notes, close_code }) => {
      const client = registry.resolve(instance);
      const rc = client as unknown as ResolvableClient;
      const resolved = await resolveRecordIdentifier(rc, sys_id, "incident");

      const data: Record<string, unknown> = { state: "6" }; // 6 = Resolved
      if (resolution_code) data["close_code"] = resolution_code;
      if (resolution_notes) data["close_notes"] = resolution_notes;
      if (close_code) data["close_code"] = close_code;

      const record = await client.updateRecord("incident", resolved.sys_id, data);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ resolved: true, number: record["number"], state: "Resolved" }, null, 2) }],
      };
    }
  );

  server.registerTool(
    "sn_close_incident",
    {
      description: "Close an incident in ServiceNow (set state to Closed). Accepts incident number (e.g. 'INC0010045') or sys_id.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        sys_id: z.string().describe("Incident sys_id or number (e.g. 'INC0010045' — auto-resolved)"),
        close_code: z.string().optional().describe("Close code (e.g. 'Solved (Permanently)')"),
        close_notes: z.string().optional().describe("Close notes"),
      },
    },
    async ({ instance, sys_id, close_code, close_notes }) => {
      const client = registry.resolve(instance);
      const rc = client as unknown as ResolvableClient;
      const resolved = await resolveRecordIdentifier(rc, sys_id, "incident");

      const data: Record<string, unknown> = { state: "7" }; // 7 = Closed
      if (close_code) data["close_code"] = close_code;
      if (close_notes) data["close_notes"] = close_notes;

      const record = await client.updateRecord("incident", resolved.sys_id, data);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ closed: true, number: record["number"], state: "Closed" }, null, 2) }],
      };
    }
  );
}
