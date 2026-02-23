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

export function registerChangeTools(server: McpServer, registry: InstanceRegistry): void {

  server.registerTool(
    "sn_list_change_requests",
    {
      description: "List change requests from ServiceNow with optional filters.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        query: z.string().optional().describe("Encoded query"),
        type: z.enum(["normal", "standard", "emergency"]).optional().describe("Change type"),
        state: z.string().optional().describe("State value"),
        risk: z.string().optional().describe("Risk level"),
        assignment_group: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      },
    },
    async ({ instance, query, type, state, risk, assignment_group, limit, offset }) => {
      const client = registry.resolve(instance);
      const parts: string[] = [];
      if (query) parts.push(query);
      if (type) parts.push(`type=${type}`);
      if (state) parts.push(`state=${state}`);
      if (risk) parts.push(`risk=${risk}`);
      if (assignment_group) parts.push(`assignment_group.name=${assignment_group}`);

      const result = await client.queryTable("change_request", {
        sysparm_query: joinQueries(...parts, "ORDERBYDESCsys_created_on"),
        sysparm_fields: "number,short_description,type,state,risk,impact,priority,assignment_group,assigned_to,start_date,end_date,sys_id",
        sysparm_limit: limit, sysparm_offset: offset,
        sysparm_display_value: "true", sysparm_exclude_reference_link: "true",
      });
      return { content: [{ type: "text" as const, text: JSON.stringify({ count: result.records.length, pagination: result.pagination, changes: result.records }, null, 2) }] };
    }
  );

  server.registerTool(
    "sn_get_change_request",
    {
      description: "Get detailed information about a specific change request.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        sys_id: z.string().optional().describe("Change request sys_id"),
        number: z.string().optional().describe("Change request number (e.g. CHG0000001)"),
      },
    },
    async ({ instance, sys_id, number }) => {
      const client = registry.resolve(instance);
      if (sys_id) {
        const record = await client.getRecord("change_request", sys_id, { sysparm_display_value: "all", sysparm_exclude_reference_link: "true" });
        return { content: [{ type: "text" as const, text: JSON.stringify(record, null, 2) }] };
      }
      if (number) {
        const result = await client.queryTable("change_request", { sysparm_query: `number=${number}`, sysparm_limit: 1, sysparm_display_value: "all", sysparm_exclude_reference_link: "true" });
        return { content: [{ type: "text" as const, text: JSON.stringify(result.records[0] ?? null, null, 2) }] };
      }
      return { content: [{ type: "text" as const, text: "Provide sys_id or number" }] };
    }
  );

  server.registerTool(
    "sn_create_change_request",
    {
      description: "Create a new change request in ServiceNow. Accepts human-readable names for assigned_to (user name, user_name, or email) and assignment_group (group name). These are auto-resolved to sys_ids.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        short_description: z.string().describe("Brief description"),
        description: z.string().optional(),
        type: z.enum(["normal", "standard", "emergency"]).default("normal"),
        risk: z.enum(["1", "2", "3", "4"]).optional().describe("1=Very High, 2=High, 3=Moderate, 4=Low"),
        impact: z.enum(["1", "2", "3"]).optional().describe("1=High, 2=Medium, 3=Low"),
        assignment_group: z.string().optional().describe("Assignment group sys_id or group name (auto-resolved)"),
        assigned_to: z.string().optional().describe("Assigned user sys_id, user_name, email, or full name (auto-resolved)"),
        start_date: z.string().optional().describe("Planned start date (YYYY-MM-DD HH:MM:SS)"),
        end_date: z.string().optional().describe("Planned end date"),
        justification: z.string().optional(),
        implementation_plan: z.string().optional(),
        backout_plan: z.string().optional(),
        test_plan: z.string().optional(),
      },
    },
    async (params) => {
      const client = registry.resolve(params.instance);
      const rc = client as unknown as ResolvableClient;

      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && k !== "instance" && k !== "assigned_to" && k !== "assignment_group") data[k] = v;
      }

      // Resolve human-readable identifiers to sys_ids
      const [assignedTo, assignmentGroup] = await Promise.all([
        resolveOptionalUser(rc, params.assigned_to),
        resolveOptionalGroup(rc, params.assignment_group),
      ]);
      if (assignedTo) data["assigned_to"] = assignedTo;
      if (assignmentGroup) data["assignment_group"] = assignmentGroup;

      const record = await client.createRecord("change_request", data);
      return { content: [{ type: "text" as const, text: JSON.stringify({ created: true, number: record["number"], sys_id: record["sys_id"], record }, null, 2) }] };
    }
  );

  server.registerTool(
    "sn_update_change_request",
    {
      description: "Update an existing change request. Accepts CHG number (e.g. 'CHG0010001') or sys_id. User/group fields in data accept human-readable names (auto-resolved).",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        sys_id: z.string().describe("Change request sys_id or number (e.g. 'CHG0010001' — auto-resolved)"),
        data: z.record(z.string(), z.unknown()).describe("Fields to update. User fields (assigned_to, requested_by) accept names/user_names. Group fields (assignment_group) accept group names."),
      },
    },
    async ({ instance, sys_id, data }) => {
      const client = registry.resolve(instance);
      const rc = client as unknown as ResolvableClient;

      // Resolve change identifier
      const resolved = await resolveRecordIdentifier(rc, sys_id, "change_request");

      // Resolve user/group fields in data if present
      const resolvedData = { ...data };
      if (typeof resolvedData["assigned_to"] === "string") {
        resolvedData["assigned_to"] = await resolveOptionalUser(rc, resolvedData["assigned_to"] as string);
      }
      if (typeof resolvedData["requested_by"] === "string") {
        resolvedData["requested_by"] = await resolveOptionalUser(rc, resolvedData["requested_by"] as string);
      }
      if (typeof resolvedData["assignment_group"] === "string") {
        resolvedData["assignment_group"] = await resolveOptionalGroup(rc, resolvedData["assignment_group"] as string);
      }

      const record = await client.updateRecord("change_request", resolved.sys_id, resolvedData);
      return { content: [{ type: "text" as const, text: JSON.stringify({ updated: true, number: record["number"], record }, null, 2) }] };
    }
  );

  server.registerTool(
    "sn_add_change_task",
    {
      description: "Add a task to a change request. Accepts CHG number or sys_id for the parent. User/group fields accept human-readable names (auto-resolved).",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        change_request_sys_id: z.string().describe("Parent change request sys_id or number (e.g. 'CHG0010001' — auto-resolved)"),
        short_description: z.string().describe("Task description"),
        assignment_group: z.string().optional().describe("Assignment group sys_id or group name (auto-resolved)"),
        assigned_to: z.string().optional().describe("Assigned user sys_id, user_name, email, or full name (auto-resolved)"),
        planned_start_date: z.string().optional(),
        planned_end_date: z.string().optional(),
      },
    },
    async ({ instance, change_request_sys_id, short_description, assignment_group, assigned_to, planned_start_date, planned_end_date }) => {
      const client = registry.resolve(instance);
      const rc = client as unknown as ResolvableClient;

      // Resolve change request identifier
      const resolvedChange = await resolveRecordIdentifier(rc, change_request_sys_id, "change_request");

      const data: Record<string, unknown> = { change_request: resolvedChange.sys_id, short_description };
      if (planned_start_date) data["planned_start_date"] = planned_start_date;
      if (planned_end_date) data["planned_end_date"] = planned_end_date;

      // Resolve user/group identifiers
      const [resolvedAssignee, resolvedGroup] = await Promise.all([
        resolveOptionalUser(rc, assigned_to),
        resolveOptionalGroup(rc, assignment_group),
      ]);
      if (resolvedAssignee) data["assigned_to"] = resolvedAssignee;
      if (resolvedGroup) data["assignment_group"] = resolvedGroup;

      const record = await client.createRecord("change_task", data);
      return { content: [{ type: "text" as const, text: JSON.stringify({ created: true, number: record["number"], sys_id: record["sys_id"] }, null, 2) }] };
    }
  );

  server.registerTool(
    "sn_submit_change_for_approval",
    {
      description: "Submit a change request for approval by advancing its state. Accepts CHG number or sys_id.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        sys_id: z.string().describe("Change request sys_id or number (e.g. 'CHG0010001' — auto-resolved)"),
      },
    },
    async ({ instance, sys_id }) => {
      const client = registry.resolve(instance);
      const rc = client as unknown as ResolvableClient;
      const resolved = await resolveRecordIdentifier(rc, sys_id, "change_request");
      const record = await client.updateRecord("change_request", resolved.sys_id, { state: "-4" }); // -4 = Authorize
      return { content: [{ type: "text" as const, text: JSON.stringify({ submitted: true, number: record["number"], state: record["state"] }, null, 2) }] };
    }
  );

  server.registerTool(
    "sn_approve_change",
    {
      description: "Approve a change request (update the approval record). Accepts CHG number or sys_id.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        sys_id: z.string().describe("Change request sys_id or number (e.g. 'CHG0010001' — auto-resolved)"),
        comments: z.string().optional().describe("Approval comments"),
      },
    },
    async ({ instance, sys_id, comments }) => {
      const client = registry.resolve(instance);
      const rc = client as unknown as ResolvableClient;
      const resolved = await resolveRecordIdentifier(rc, sys_id, "change_request");

      const approvals = await client.queryTable("sysapproval_approver", {
        sysparm_query: `sysapproval=${resolved.sys_id}^state=requested`,
        sysparm_limit: 1, sysparm_fields: "sys_id",
      });
      const approval = approvals.records[0];
      if (!approval || typeof approval["sys_id"] !== "string") {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "No pending approval found for this change request" }, null, 2) }] };
      }
      const data: Record<string, unknown> = { state: "approved" };
      if (comments) data["comments"] = comments;
      await client.updateRecord("sysapproval_approver", approval["sys_id"], data);
      return { content: [{ type: "text" as const, text: JSON.stringify({ approved: true, change_sys_id: resolved.sys_id }, null, 2) }] };
    }
  );

  server.registerTool(
    "sn_reject_change",
    {
      description: "Reject a change request. Accepts CHG number or sys_id.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        sys_id: z.string().describe("Change request sys_id or number (e.g. 'CHG0010001' — auto-resolved)"),
        comments: z.string().optional().describe("Rejection reason"),
      },
    },
    async ({ instance, sys_id, comments }) => {
      const client = registry.resolve(instance);
      const rc = client as unknown as ResolvableClient;
      const resolved = await resolveRecordIdentifier(rc, sys_id, "change_request");

      const approvals = await client.queryTable("sysapproval_approver", {
        sysparm_query: `sysapproval=${resolved.sys_id}^state=requested`,
        sysparm_limit: 1, sysparm_fields: "sys_id",
      });
      const approval = approvals.records[0];
      if (!approval || typeof approval["sys_id"] !== "string") {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "No pending approval found" }, null, 2) }] };
      }
      const data: Record<string, unknown> = { state: "rejected" };
      if (comments) data["comments"] = comments;
      await client.updateRecord("sysapproval_approver", approval["sys_id"], data);
      return { content: [{ type: "text" as const, text: JSON.stringify({ rejected: true, change_sys_id: resolved.sys_id }, null, 2) }] };
    }
  );

  server.registerTool(
    "sn_add_change_comment",
    {
      description: "Add a customer-visible comment to a change request. Accepts CHG number or sys_id.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        sys_id: z.string().describe("Change request sys_id or number (e.g. 'CHG0010001' — auto-resolved)"),
        comment: z.string(),
      },
    },
    async ({ instance, sys_id, comment }) => {
      const client = registry.resolve(instance);
      const rc = client as unknown as ResolvableClient;
      const resolved = await resolveRecordIdentifier(rc, sys_id, "change_request");
      const record = await client.updateRecord("change_request", resolved.sys_id, { comments: comment });
      return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, number: record["number"] }, null, 2) }] };
    }
  );

  server.registerTool(
    "sn_add_change_work_notes",
    {
      description: "Add internal work notes to a change request. Accepts CHG number or sys_id.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        sys_id: z.string().describe("Change request sys_id or number (e.g. 'CHG0010001' — auto-resolved)"),
        work_notes: z.string(),
      },
    },
    async ({ instance, sys_id, work_notes }) => {
      const client = registry.resolve(instance);
      const rc = client as unknown as ResolvableClient;
      const resolved = await resolveRecordIdentifier(rc, sys_id, "change_request");
      const record = await client.updateRecord("change_request", resolved.sys_id, { work_notes });
      return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, number: record["number"] }, null, 2) }] };
    }
  );
}
