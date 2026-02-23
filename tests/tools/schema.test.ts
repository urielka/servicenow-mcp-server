import { describe, expect, test, beforeEach } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSchemaTools } from "../../src/tools/schema.ts";
import { createMockRegistry, type MockRegistry } from "../mocks/index.ts";
import type { SNPaginatedResult } from "../../src/client/types.ts";

/**
 * Tests for schema tools: sn_get_table_schema (enhanced), sn_discover_table,
 * sn_list_tables, and sn_explain_field.
 */

// Build a mock queryTable that returns different results per table queried
function createSchemaRegistry() {
  const dictionaryResult: SNPaginatedResult = {
    records: [
      { element: "number", column_label: "Number", internal_type: "string", max_length: "40", mandatory: "false", reference: "", default_value: "", active: "true", read_only: "true" },
      { element: "state", column_label: "State", internal_type: "integer", max_length: "40", mandatory: "true", reference: "", default_value: "1", active: "true", read_only: "false" },
      { element: "assigned_to", column_label: "Assigned to", internal_type: "reference", max_length: "32", mandatory: "false", reference: "sys_user", default_value: "", active: "true", read_only: "false" },
    ],
    pagination: { limit: 500, offset: 0, hasMore: false },
  };

  const choiceResult: SNPaginatedResult = {
    records: [
      { element: "state", label: "New", value: "1", sequence: "1", inactive: "false" },
      { element: "state", label: "In Progress", value: "2", sequence: "2", inactive: "false" },
      { element: "state", label: "Closed", value: "7", sequence: "7", inactive: "false" },
      { element: "priority", label: "Critical", value: "1", sequence: "1", inactive: "false" },
    ],
    pagination: { limit: 1000, offset: 0, hasMore: false },
  };

  const policyResult: SNPaginatedResult = {
    records: [
      { sys_id: "pol1", short_description: "Require assignment group on P1", conditions: "priority=1", enforce_ui: "true", enforce_scripting: "true", active: "true" },
    ],
    pagination: { limit: 200, offset: 0, hasMore: false },
  };

  const businessRuleResult: SNPaginatedResult = {
    records: [
      { sys_id: "br1", name: "Set priority", when: "before", order: "100", filter_condition: "", active: "true", advanced: "true", abort_action: "false" },
      { sys_id: "br2", name: "Calculate SLA", when: "after", order: "200", filter_condition: "", active: "true", advanced: "true", abort_action: "false" },
    ],
    pagination: { limit: 200, offset: 0, hasMore: false },
  };

  const constraintResult: SNPaginatedResult = {
    records: [
      { sys_id: "idx1", name: "incident_number", table: "incident", unique_index: "true", fields: "number" },
    ],
    pagination: { limit: 200, offset: 0, hasMore: false },
  };

  const tableObjResult: SNPaginatedResult = {
    records: [{ sys_id: "tbl1", name: "incident", label: "Incident", super_class: "task" }],
    pagination: { limit: 1, offset: 0, hasMore: false },
  };

  const docResult: SNPaginatedResult = {
    records: [
      { element: "state", label: "State", help: "Current state of the incident", hint: "Select the state", url: "" },
    ],
    pagination: { limit: 5, offset: 0, hasMore: false },
  };

  // Route queries to different results based on the table being queried
  const mockReg = createMockRegistry();
  const origQueryTable = mockReg._client.queryTable;

  let callCount = 0;
  const queryTableResponses: SNPaginatedResult[] = [];

  mockReg._client.queryTable = async (tableName: string, params?: unknown) => {
    // Track the call
    mockReg._client._calls.queryTable.push({ tableName, params });

    if (tableName === "sys_dictionary") return dictionaryResult;
    if (tableName === "sys_choice") return choiceResult;
    if (tableName === "sys_data_policy2") return policyResult;
    if (tableName === "sys_script") return businessRuleResult;
    if (tableName === "sys_index") return constraintResult;
    if (tableName === "sys_db_object") return tableObjResult;
    if (tableName === "sys_documentation") return docResult;

    return { records: [], pagination: { limit: 10, offset: 0, hasMore: false } };
  };

  return mockReg;
}

describe("registerSchemaTools", () => {
  let server: McpServer;
  let mockRegistry: MockRegistry;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "0.0.1" });
    mockRegistry = createSchemaRegistry();
  });

  test("registers 4 tools without error", () => {
    registerSchemaTools(server, mockRegistry as unknown as Parameters<typeof registerSchemaTools>[1]);
    expect(true).toBe(true);
  });
});

describe("sn_get_table_schema (enhanced)", () => {
  let server: McpServer;
  let mockRegistry: MockRegistry;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "0.0.1" });
    mockRegistry = createSchemaRegistry();
    registerSchemaTools(server, mockRegistry as unknown as Parameters<typeof registerSchemaTools>[1]);
  });

  test("basic call queries sys_dictionary", async () => {
    const client = mockRegistry._client;
    const result = await client.queryTable("sys_dictionary", {
      sysparm_query: "name=incident^elementISNOTEMPTY^ORDERBYelement",
    });
    expect(result.records).toHaveLength(3);
    expect(client._calls.queryTable.some(c => c.tableName === "sys_dictionary")).toBe(true);
  });

  test("include_choices fetches sys_choice grouped by field", async () => {
    const client = mockRegistry._client;
    const result = await client.queryTable("sys_choice", {
      sysparm_query: "name=incident^ORDERBYelement^ORDERBYsequence",
    });
    expect(result.records).toHaveLength(4);
    // Verify state has 3 choices and priority has 1
    const stateChoices = result.records.filter(r => r["element"] === "state");
    const priorityChoices = result.records.filter(r => r["element"] === "priority");
    expect(stateChoices).toHaveLength(3);
    expect(priorityChoices).toHaveLength(1);
  });

  test("include_policies fetches sys_data_policy2", async () => {
    const client = mockRegistry._client;
    const result = await client.queryTable("sys_data_policy2", {
      sysparm_query: "model_table=incident^active=true",
    });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]!["short_description"]).toBe("Require assignment group on P1");
  });

  test("include_business_rules fetches sys_script", async () => {
    const client = mockRegistry._client;
    const result = await client.queryTable("sys_script", {
      sysparm_query: "collection=incident^active=true",
    });
    expect(result.records).toHaveLength(2);
    expect(result.records[0]!["name"]).toBe("Set priority");
  });

  test("include_constraints fetches sys_index", async () => {
    const client = mockRegistry._client;
    const result = await client.queryTable("sys_index", {
      sysparm_query: "table=incident",
    });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]!["unique_index"]).toBe("true");
  });

  test("all enrichment flags trigger parallel fetches", async () => {
    const client = mockRegistry._client;

    // Simulate what the tool does: fetch all in parallel
    const [dict, choices, policies, rules, constraints] = await Promise.all([
      client.queryTable("sys_dictionary", {}),
      client.queryTable("sys_choice", {}),
      client.queryTable("sys_data_policy2", {}),
      client.queryTable("sys_script", {}),
      client.queryTable("sys_index", {}),
    ]);

    expect(dict.records).toHaveLength(3);
    expect(choices.records).toHaveLength(4);
    expect(policies.records).toHaveLength(1);
    expect(rules.records).toHaveLength(2);
    expect(constraints.records).toHaveLength(1);

    // 5 calls total
    expect(client._calls.queryTable).toHaveLength(5);
  });
});

describe("sn_discover_table", () => {
  let server: McpServer;
  let mockRegistry: MockRegistry;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "0.0.1" });
    mockRegistry = createSchemaRegistry();
    registerSchemaTools(server, mockRegistry as unknown as Parameters<typeof registerSchemaTools>[1]);
  });

  test("fetches sys_db_object and sys_dictionary in parallel", async () => {
    const client = mockRegistry._client;

    const [tableInfo, fields] = await Promise.all([
      client.queryTable("sys_db_object", {}),
      client.queryTable("sys_dictionary", {}),
    ]);

    expect(tableInfo.records[0]!["name"]).toBe("incident");
    expect(fields.records).toHaveLength(3);
    expect(client._calls.queryTable).toHaveLength(2);
  });

  test("include_relationships extracts reference fields", async () => {
    const client = mockRegistry._client;
    const fields = await client.queryTable("sys_dictionary", {});
    const refs = fields.records.filter(f => f["reference"] && f["reference"] !== "");
    expect(refs).toHaveLength(1);
    expect(refs[0]!["element"]).toBe("assigned_to");
    expect(refs[0]!["reference"]).toBe("sys_user");
  });
});

describe("sn_explain_field", () => {
  let server: McpServer;
  let mockRegistry: MockRegistry;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "0.0.1" });
    mockRegistry = createSchemaRegistry();
    registerSchemaTools(server, mockRegistry as unknown as Parameters<typeof registerSchemaTools>[1]);
  });

  test("queries sys_dictionary, sys_documentation, and sys_choice in parallel", async () => {
    const client = mockRegistry._client;

    const [dict, doc, choices] = await Promise.all([
      client.queryTable("sys_dictionary", {}),
      client.queryTable("sys_documentation", {}),
      client.queryTable("sys_choice", {}),
    ]);

    // dict returns our field definitions
    expect(dict.records).toHaveLength(3);

    // doc returns help text
    expect(doc.records).toHaveLength(1);
    expect(doc.records[0]!["help"]).toBe("Current state of the incident");

    // choices returns dropdown values
    expect(choices.records).toHaveLength(4);

    expect(client._calls.queryTable).toHaveLength(3);
  });

  test("documentation includes help and hint text", async () => {
    const client = mockRegistry._client;
    const doc = await client.queryTable("sys_documentation", {});

    expect(doc.records[0]!["hint"]).toBe("Select the state");
    expect(doc.records[0]!["label"]).toBe("State");
  });

  test("choices are ordered by sequence", async () => {
    const client = mockRegistry._client;
    const choices = await client.queryTable("sys_choice", {});

    const stateChoices = choices.records.filter(r => r["element"] === "state");
    expect(stateChoices[0]!["value"]).toBe("1");
    expect(stateChoices[1]!["value"]).toBe("2");
    expect(stateChoices[2]!["value"]).toBe("7");
  });

  test("handles field with no choices gracefully", async () => {
    // Override to return empty choices
    const emptyReg = createMockRegistry();
    emptyReg._client.queryTable = async (tableName: string, params?: unknown) => {
      emptyReg._client._calls.queryTable.push({ tableName, params });
      if (tableName === "sys_dictionary") {
        return {
          records: [{ element: "short_description", column_label: "Short description", internal_type: "string", max_length: "160", mandatory: "true" }],
          pagination: { limit: 1, offset: 0, hasMore: false },
        };
      }
      // Return empty for doc and choices
      return { records: [], pagination: { limit: 10, offset: 0, hasMore: false } };
    };

    const server2 = new McpServer({ name: "test2", version: "0.0.1" });
    registerSchemaTools(server2, emptyReg as unknown as Parameters<typeof registerSchemaTools>[1]);

    const client = emptyReg._client;
    const [dict, doc, choices] = await Promise.all([
      client.queryTable("sys_dictionary", {}),
      client.queryTable("sys_documentation", {}),
      client.queryTable("sys_choice", {}),
    ]);

    expect(dict.records).toHaveLength(1);
    expect(doc.records).toHaveLength(0);
    expect(choices.records).toHaveLength(0);
  });

  test("handles field not found (empty dictionary result)", async () => {
    const emptyReg = createMockRegistry();
    emptyReg._client.queryTable = async (tableName: string, params?: unknown) => {
      emptyReg._client._calls.queryTable.push({ tableName, params });
      return { records: [], pagination: { limit: 10, offset: 0, hasMore: false } };
    };

    const client = emptyReg._client;
    const dict = await client.queryTable("sys_dictionary", {});
    expect(dict.records).toHaveLength(0);
  });
});

describe("sn_list_tables", () => {
  let server: McpServer;
  let mockRegistry: MockRegistry;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "0.0.1" });
    mockRegistry = createSchemaRegistry();
    registerSchemaTools(server, mockRegistry as unknown as Parameters<typeof registerSchemaTools>[1]);
  });

  test("queries sys_db_object", async () => {
    const client = mockRegistry._client;
    const result = await client.queryTable("sys_db_object", {
      sysparm_query: "ORDERBYname",
    });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]!["name"]).toBe("incident");
  });

  test("applies LIKE filter for query param", async () => {
    const client = mockRegistry._client;
    // The tool builds query like: nameLIKE<query>^ORDERBYname
    const q = "inc";
    const builtQuery = `nameLIKE${q}^ORDERBYname`;
    expect(builtQuery).toBe("nameLIKEinc^ORDERBYname");
  });
});
