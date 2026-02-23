import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { InstanceRegistry } from "../client/registry.ts";
import { joinQueries } from "../utils/query.ts";
import {
  resolveUserIdentifier,
  resolveGroupIdentifier,
  type ResolvableClient,
} from "../utils/resolve.ts";

export function registerUserTools(server: McpServer, registry: InstanceRegistry): void {

  server.registerTool(
    "sn_list_users",
    {
      description: "List users from ServiceNow with optional filters.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        query: z.string().optional().describe("Encoded query"),
        active: z.boolean().optional().describe("Filter by active status"),
        department: z.string().optional().describe("Filter by department name"),
        role: z.string().optional().describe("Filter by role name"),
        name: z.string().optional().describe("Search by name (LIKE match on first_name or last_name)"),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      },
    },
    async ({ instance, query, active, department, role, name, limit, offset }) => {
      const client = registry.resolve(instance);
      const parts: string[] = [];
      if (query) parts.push(query);
      if (active !== undefined) parts.push(`active=${active}`);
      if (department) parts.push(`department.name=${department}`);
      if (role) parts.push(`roles=${role}`);
      if (name) parts.push(`first_nameLIKE${name}^ORlast_nameLIKE${name}`);

      const result = await client.queryTable("sys_user", {
        sysparm_query: joinQueries(...parts, "ORDERBYlast_name"),
        sysparm_fields: "sys_id,user_name,first_name,last_name,email,department,title,manager,active,roles",
        sysparm_limit: limit,
        sysparm_offset: offset,
        sysparm_display_value: "true",
        sysparm_exclude_reference_link: "true",
      });

      return { content: [{ type: "text" as const, text: JSON.stringify({ count: result.records.length, pagination: result.pagination, users: result.records }, null, 2) }] };
    }
  );

  server.registerTool(
    "sn_get_user",
    {
      description: "Get a specific user by sys_id, user_name, or email.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        sys_id: z.string().optional().describe("User sys_id"),
        user_name: z.string().optional().describe("Username"),
        email: z.string().optional().describe("Email address"),
      },
    },
    async ({ instance, sys_id, user_name, email }) => {
      const client = registry.resolve(instance);
      if (sys_id) {
        const record = await client.getRecord("sys_user", sys_id, { sysparm_display_value: "true", sysparm_exclude_reference_link: "true" });
        return { content: [{ type: "text" as const, text: JSON.stringify(record, null, 2) }] };
      }

      const q = user_name ? `user_name=${user_name}` : email ? `email=${email}` : "";
      if (!q) return { content: [{ type: "text" as const, text: "Provide sys_id, user_name, or email" }] };

      const result = await client.queryTable("sys_user", { sysparm_query: q, sysparm_limit: 1, sysparm_display_value: "true", sysparm_exclude_reference_link: "true" });
      const user = result.records[0] ?? null;
      return { content: [{ type: "text" as const, text: JSON.stringify(user, null, 2) }] };
    }
  );

  server.registerTool(
    "sn_create_user",
    {
      description: "Create a new user in ServiceNow.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        user_name: z.string().describe("Unique username"),
        first_name: z.string().describe("First name"),
        last_name: z.string().describe("Last name"),
        email: z.string().optional().describe("Email address"),
        department: z.string().optional().describe("Department sys_id"),
        title: z.string().optional().describe("Job title"),
        manager: z.string().optional().describe("Manager sys_id"),
        active: z.boolean().default(true),
      },
    },
    async (params) => {
      const client = registry.resolve(params.instance);
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && k !== "instance") data[k] = v;
      }
      const record = await client.createRecord("sys_user", data);
      return { content: [{ type: "text" as const, text: JSON.stringify({ created: true, sys_id: record["sys_id"], user_name: record["user_name"], record }, null, 2) }] };
    }
  );

  server.registerTool(
    "sn_update_user",
    {
      description: "Update an existing user in ServiceNow.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        sys_id: z.string().describe("User sys_id"),
        data: z.record(z.string(), z.unknown()).describe("Fields to update"),
      },
    },
    async ({ instance, sys_id, data }) => {
      const client = registry.resolve(instance);
      const record = await client.updateRecord("sys_user", sys_id, data);
      return { content: [{ type: "text" as const, text: JSON.stringify({ updated: true, sys_id: record["sys_id"], record }, null, 2) }] };
    }
  );

  // ── Groups ──────────────────────────────────────────────

  server.registerTool(
    "sn_list_groups",
    {
      description: "List groups from ServiceNow with optional filters.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        query: z.string().optional().describe("Encoded query"),
        name: z.string().optional().describe("Filter by group name (LIKE match)"),
        type: z.string().optional().describe("Filter by group type"),
        active: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      },
    },
    async ({ instance, query, name, type, active, limit, offset }) => {
      const client = registry.resolve(instance);
      const parts: string[] = [];
      if (query) parts.push(query);
      if (name) parts.push(`nameLIKE${name}`);
      if (type) parts.push(`type=${type}`);
      if (active !== undefined) parts.push(`active=${active}`);

      const result = await client.queryTable("sys_user_group", {
        sysparm_query: joinQueries(...parts, "ORDERBYname"),
        sysparm_fields: "sys_id,name,description,manager,parent,type,active,email",
        sysparm_limit: limit,
        sysparm_offset: offset,
        sysparm_display_value: "true",
        sysparm_exclude_reference_link: "true",
      });

      return { content: [{ type: "text" as const, text: JSON.stringify({ count: result.records.length, pagination: result.pagination, groups: result.records }, null, 2) }] };
    }
  );

  server.registerTool(
    "sn_create_group",
    {
      description: "Create a new group in ServiceNow.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        name: z.string().describe("Group name"),
        description: z.string().optional(),
        manager: z.string().optional().describe("Manager sys_id"),
        parent: z.string().optional().describe("Parent group sys_id"),
        type: z.string().optional(),
        email: z.string().optional(),
      },
    },
    async (params) => {
      const client = registry.resolve(params.instance);
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && k !== "instance") data[k] = v;
      }
      const record = await client.createRecord("sys_user_group", data);
      return { content: [{ type: "text" as const, text: JSON.stringify({ created: true, sys_id: record["sys_id"], name: record["name"], record }, null, 2) }] };
    }
  );

  server.registerTool(
    "sn_update_group",
    {
      description: "Update an existing group in ServiceNow.",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        sys_id: z.string().describe("Group sys_id"),
        data: z.record(z.string(), z.unknown()).describe("Fields to update"),
      },
    },
    async ({ instance, sys_id, data }) => {
      const client = registry.resolve(instance);
      const record = await client.updateRecord("sys_user_group", sys_id, data);
      return { content: [{ type: "text" as const, text: JSON.stringify({ updated: true, sys_id: record["sys_id"], record }, null, 2) }] };
    }
  );

  server.registerTool(
    "sn_add_group_members",
    {
      description: "Add one or more users to a group in ServiceNow. Accepts human-readable names for both group and users (auto-resolved to sys_ids).",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        group_sys_id: z.string().describe("Group sys_id or group name (auto-resolved)"),
        user_sys_ids: z.array(z.string()).describe("Array of user sys_ids, user_names, emails, or full names (auto-resolved)"),
      },
    },
    async ({ instance, group_sys_id, user_sys_ids }) => {
      const client = registry.resolve(instance);
      const rc = client as unknown as ResolvableClient;

      // Resolve group identifier
      const resolvedGroup = await resolveGroupIdentifier(rc, group_sys_id);

      // Resolve all user identifiers in parallel
      const resolvedUsers = await Promise.all(
        user_sys_ids.map((uid) => resolveUserIdentifier(rc, uid))
      );

      const results = [];
      for (const resolvedUser of resolvedUsers) {
        const record = await client.createRecord("sys_user_grmember", {
          group: resolvedGroup.sys_id,
          user: resolvedUser.sys_id,
        });
        results.push({ user: resolvedUser.sys_id, display: resolvedUser.display ?? resolvedUser.original, sys_id: record["sys_id"] });
      }
      return { content: [{ type: "text" as const, text: JSON.stringify({ added: results.length, group: resolvedGroup.display ?? resolvedGroup.original, members: results }, null, 2) }] };
    }
  );

  server.registerTool(
    "sn_remove_group_members",
    {
      description: "Remove one or more users from a group in ServiceNow. Accepts human-readable names for both group and users (auto-resolved to sys_ids).",
      inputSchema: {
        instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
        group_sys_id: z.string().describe("Group sys_id or group name (auto-resolved)"),
        user_sys_ids: z.array(z.string()).describe("Array of user sys_ids, user_names, emails, or full names (auto-resolved)"),
      },
    },
    async ({ instance, group_sys_id, user_sys_ids }) => {
      const client = registry.resolve(instance);
      const rc = client as unknown as ResolvableClient;

      // Resolve group identifier
      const resolvedGroup = await resolveGroupIdentifier(rc, group_sys_id);

      // Resolve all user identifiers in parallel
      const resolvedUsers = await Promise.all(
        user_sys_ids.map((uid) => resolveUserIdentifier(rc, uid))
      );

      const removed = [];
      for (const resolvedUser of resolvedUsers) {
        const result = await client.queryTable("sys_user_grmember", {
          sysparm_query: `group=${resolvedGroup.sys_id}^user=${resolvedUser.sys_id}`,
          sysparm_fields: "sys_id",
          sysparm_limit: 1,
        });
        const membership = result.records[0];
        if (membership && typeof membership["sys_id"] === "string") {
          await client.deleteRecord("sys_user_grmember", membership["sys_id"]);
          removed.push({ sys_id: resolvedUser.sys_id, display: resolvedUser.display ?? resolvedUser.original });
        }
      }
      return { content: [{ type: "text" as const, text: JSON.stringify({ removed: removed.length, group: resolvedGroup.display ?? resolvedGroup.original, users: removed }, null, 2) }] };
    }
  );
}
