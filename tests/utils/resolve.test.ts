import { describe, expect, test } from "bun:test";
import {
  resolveRecordIdentifier,
  resolveUserIdentifier,
  resolveGroupIdentifier,
  resolveOptionalUser,
  resolveOptionalGroup,
  resolveOptionalRecord,
  type ResolvableClient,
} from "../../src/utils/resolve.ts";
import type { SNPaginatedResult } from "../../src/client/types.ts";

// ── Mock client factory ─────────────────────────────────

interface QueryCall {
  tableName: string;
  params: Record<string, unknown> | undefined;
}

function createResolveClient(
  handler: (tableName: string, params?: Record<string, unknown>) => SNPaginatedResult
): ResolvableClient & { _calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  return {
    queryTable: async (tableName: string, params?: Record<string, unknown>) => {
      calls.push({ tableName, params });
      return handler(tableName, params);
    },
    _calls: calls,
  };
}

const EMPTY_RESULT: SNPaginatedResult = {
  records: [],
  pagination: { limit: 10, offset: 0, hasMore: false },
};

const USER_SYS_ID = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
const GROUP_SYS_ID = "f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6";
const INCIDENT_SYS_ID = "11223344556677889900aabbccddeeff";

// ── resolveRecordIdentifier ─────────────────────────────

describe("resolveRecordIdentifier", () => {
  test("passes through 32-char hex sys_id", async () => {
    const client = createResolveClient(() => EMPTY_RESULT);
    const result = await resolveRecordIdentifier(client, INCIDENT_SYS_ID);
    expect(result.sys_id).toBe(INCIDENT_SYS_ID);
    expect(result.method).toBe("passthrough");
    expect(client._calls).toHaveLength(0); // no API call
  });

  test("resolves INC number to sys_id", async () => {
    const client = createResolveClient((tableName) => {
      if (tableName === "incident") {
        return {
          records: [{ sys_id: INCIDENT_SYS_ID, number: "INC0010045" }],
          pagination: { limit: 1, offset: 0, hasMore: false },
        };
      }
      return EMPTY_RESULT;
    });

    const result = await resolveRecordIdentifier(client, "INC0010045");
    expect(result.sys_id).toBe(INCIDENT_SYS_ID);
    expect(result.method).toBe("number");
    expect(result.display).toBe("INC0010045");
    expect(client._calls).toHaveLength(1);
    expect(client._calls[0]!.tableName).toBe("incident");
  });

  test("resolves CHG number to sys_id", async () => {
    const chgSysId = "aabbccddeeff00112233445566778899";
    const client = createResolveClient((tableName) => {
      if (tableName === "change_request") {
        return {
          records: [{ sys_id: chgSysId, number: "CHG0010001" }],
          pagination: { limit: 1, offset: 0, hasMore: false },
        };
      }
      return EMPTY_RESULT;
    });

    const result = await resolveRecordIdentifier(client, "CHG0010001");
    expect(result.sys_id).toBe(chgSysId);
    expect(result.method).toBe("number");
  });

  test("resolves PRB number to sys_id", async () => {
    const prbSysId = "00112233445566778899aabbccddeeff";
    const client = createResolveClient((tableName) => {
      if (tableName === "problem") {
        return {
          records: [{ sys_id: prbSysId, number: "PRB0010001" }],
          pagination: { limit: 1, offset: 0, hasMore: false },
        };
      }
      return EMPTY_RESULT;
    });

    const result = await resolveRecordIdentifier(client, "PRB0010001");
    expect(result.sys_id).toBe(prbSysId);
  });

  test("resolves RITM number to sys_id", async () => {
    const ritmSysId = "aabb00112233445566778899ccddeeff";
    const client = createResolveClient((tableName) => {
      if (tableName === "sc_req_item") {
        return {
          records: [{ sys_id: ritmSysId, number: "RITM0010001" }],
          pagination: { limit: 1, offset: 0, hasMore: false },
        };
      }
      return EMPTY_RESULT;
    });

    const result = await resolveRecordIdentifier(client, "RITM0010001");
    expect(result.sys_id).toBe(ritmSysId);
  });

  test("resolves KB number to sys_id", async () => {
    const kbSysId = "ccdd00112233445566778899aabbeeff";
    const client = createResolveClient((tableName) => {
      if (tableName === "kb_knowledge") {
        return {
          records: [{ sys_id: kbSysId, number: "KB0010001" }],
          pagination: { limit: 1, offset: 0, hasMore: false },
        };
      }
      return EMPTY_RESULT;
    });

    const result = await resolveRecordIdentifier(client, "KB0010001");
    expect(result.sys_id).toBe(kbSysId);
  });

  test("case-insensitive INC matching", async () => {
    const client = createResolveClient((tableName) => {
      if (tableName === "incident") {
        return {
          records: [{ sys_id: INCIDENT_SYS_ID, number: "INC0010045" }],
          pagination: { limit: 1, offset: 0, hasMore: false },
        };
      }
      return EMPTY_RESULT;
    });

    const result = await resolveRecordIdentifier(client, "inc0010045");
    expect(result.sys_id).toBe(INCIDENT_SYS_ID);
  });

  test("throws if INC number not found in table", async () => {
    const client = createResolveClient(() => EMPTY_RESULT);
    await expect(resolveRecordIdentifier(client, "INC9999999")).rejects.toThrow(
      /Record not found.*INC9999999.*incident/
    );
  });

  test("uses tableHint for unrecognized number format", async () => {
    const client = createResolveClient((tableName) => {
      if (tableName === "custom_table") {
        return {
          records: [{ sys_id: INCIDENT_SYS_ID, number: "CUST001" }],
          pagination: { limit: 1, offset: 0, hasMore: false },
        };
      }
      return EMPTY_RESULT;
    });

    const result = await resolveRecordIdentifier(client, "CUST001", "custom_table");
    expect(result.sys_id).toBe(INCIDENT_SYS_ID);
    expect(result.method).toBe("number");
  });

  test("throws for unrecognized prefix without tableHint", async () => {
    const client = createResolveClient(() => EMPTY_RESULT);
    await expect(resolveRecordIdentifier(client, "UNKNOWN001")).rejects.toThrow(
      /Cannot resolve.*not a sys_id/
    );
  });

  test("throws for tableHint when number not found", async () => {
    const client = createResolveClient(() => EMPTY_RESULT);
    await expect(resolveRecordIdentifier(client, "CUST999", "custom_table")).rejects.toThrow(
      /Record not found.*custom_table.*CUST999/
    );
  });

  test("trims whitespace", async () => {
    const client = createResolveClient(() => EMPTY_RESULT);
    const result = await resolveRecordIdentifier(client, `  ${INCIDENT_SYS_ID}  `);
    expect(result.sys_id).toBe(INCIDENT_SYS_ID);
    expect(result.method).toBe("passthrough");
  });
});

// ── resolveUserIdentifier ───────────────────────────────

describe("resolveUserIdentifier", () => {
  test("passes through 32-char hex sys_id", async () => {
    const client = createResolveClient(() => EMPTY_RESULT);
    const result = await resolveUserIdentifier(client, USER_SYS_ID);
    expect(result.sys_id).toBe(USER_SYS_ID);
    expect(result.method).toBe("passthrough");
    expect(client._calls).toHaveLength(0);
  });

  test("resolves by user_name", async () => {
    const client = createResolveClient((_table, params) => {
      const query = (params as Record<string, string>)?.["sysparm_query"] ?? "";
      if (query.includes("user_name=admin")) {
        return {
          records: [{ sys_id: USER_SYS_ID, user_name: "admin", name: "System Administrator" }],
          pagination: { limit: 1, offset: 0, hasMore: false },
        };
      }
      return EMPTY_RESULT;
    });

    const result = await resolveUserIdentifier(client, "admin");
    expect(result.sys_id).toBe(USER_SYS_ID);
    expect(result.method).toBe("user_name");
    expect(result.display).toBe("System Administrator");
  });

  test("resolves by email", async () => {
    const client = createResolveClient((_table, params) => {
      const query = (params as Record<string, string>)?.["sysparm_query"] ?? "";
      if (query.includes("email=admin@example.com")) {
        return {
          records: [{ sys_id: USER_SYS_ID, user_name: "admin", name: "System Administrator", email: "admin@example.com" }],
          pagination: { limit: 1, offset: 0, hasMore: false },
        };
      }
      return EMPTY_RESULT;
    });

    const result = await resolveUserIdentifier(client, "admin@example.com");
    expect(result.sys_id).toBe(USER_SYS_ID);
    expect(result.method).toBe("email");
  });

  test("resolves by fuzzy name match (single result)", async () => {
    let callCount = 0;
    const client = createResolveClient((_table, params) => {
      callCount++;
      const query = (params as Record<string, string>)?.["sysparm_query"] ?? "";
      // First call: user_name match → empty
      // Second call (email skipped since no @): name LIKE match
      if (query.includes("nameLIKE")) {
        return {
          records: [{ sys_id: USER_SYS_ID, user_name: "banglin", name: "Beth Anglin" }],
          pagination: { limit: 5, offset: 0, hasMore: false },
        };
      }
      return EMPTY_RESULT;
    });

    const result = await resolveUserIdentifier(client, "Beth Anglin");
    expect(result.sys_id).toBe(USER_SYS_ID);
    expect(result.method).toBe("like");
    expect(result.display).toBe("Beth Anglin");
  });

  test("throws on ambiguous name match (multiple results)", async () => {
    const client = createResolveClient((_table, params) => {
      const query = (params as Record<string, string>)?.["sysparm_query"] ?? "";
      if (query.includes("nameLIKE")) {
        return {
          records: [
            { sys_id: "aaaabbbbccccddddeeeeffff00001111", user_name: "jsmith1", name: "John Smith" },
            { sys_id: "aaaabbbbccccddddeeeeffff00002222", user_name: "jsmith2", name: "Jane Smith" },
          ],
          pagination: { limit: 5, offset: 0, hasMore: false },
        };
      }
      return EMPTY_RESULT;
    });

    await expect(resolveUserIdentifier(client, "Smith")).rejects.toThrow(
      /Ambiguous user.*Smith.*matched 2 users/
    );
  });

  test("throws when user not found at all", async () => {
    const client = createResolveClient(() => EMPTY_RESULT);
    await expect(resolveUserIdentifier(client, "nonexistent")).rejects.toThrow(
      /User not found.*nonexistent/
    );
  });

  test("tries user_name before email", async () => {
    // A user whose user_name happens to contain @
    const client = createResolveClient((_table, params) => {
      const query = (params as Record<string, string>)?.["sysparm_query"] ?? "";
      if (query.includes("user_name=user@company.com")) {
        return {
          records: [{ sys_id: USER_SYS_ID, user_name: "user@company.com", name: "User" }],
          pagination: { limit: 1, offset: 0, hasMore: false },
        };
      }
      return EMPTY_RESULT;
    });

    const result = await resolveUserIdentifier(client, "user@company.com");
    expect(result.method).toBe("user_name");
  });
});

// ── resolveGroupIdentifier ──────────────────────────────

describe("resolveGroupIdentifier", () => {
  test("passes through 32-char hex sys_id", async () => {
    const client = createResolveClient(() => EMPTY_RESULT);
    const result = await resolveGroupIdentifier(client, GROUP_SYS_ID);
    expect(result.sys_id).toBe(GROUP_SYS_ID);
    expect(result.method).toBe("passthrough");
    expect(client._calls).toHaveLength(0);
  });

  test("resolves by exact group name", async () => {
    const client = createResolveClient((_table, params) => {
      const query = (params as Record<string, string>)?.["sysparm_query"] ?? "";
      if (query === "name=Service Desk") {
        return {
          records: [{ sys_id: GROUP_SYS_ID, name: "Service Desk" }],
          pagination: { limit: 1, offset: 0, hasMore: false },
        };
      }
      return EMPTY_RESULT;
    });

    const result = await resolveGroupIdentifier(client, "Service Desk");
    expect(result.sys_id).toBe(GROUP_SYS_ID);
    expect(result.method).toBe("name");
    expect(result.display).toBe("Service Desk");
  });

  test("falls back to fuzzy match if exact fails", async () => {
    const client = createResolveClient((_table, params) => {
      const query = (params as Record<string, string>)?.["sysparm_query"] ?? "";
      if (query === "name=Svc Desk") {
        return EMPTY_RESULT; // Exact fails
      }
      if (query.includes("nameLIKESvc Desk")) {
        return {
          records: [{ sys_id: GROUP_SYS_ID, name: "Service Desk (Svc Desk)" }],
          pagination: { limit: 5, offset: 0, hasMore: false },
        };
      }
      return EMPTY_RESULT;
    });

    const result = await resolveGroupIdentifier(client, "Svc Desk");
    expect(result.sys_id).toBe(GROUP_SYS_ID);
    expect(result.method).toBe("like");
  });

  test("throws on ambiguous group match", async () => {
    const client = createResolveClient((_table, params) => {
      const query = (params as Record<string, string>)?.["sysparm_query"] ?? "";
      if (query.startsWith("name=")) {
        return EMPTY_RESULT; // Exact fails
      }
      if (query.includes("nameLIKE")) {
        return {
          records: [
            { sys_id: "aaaa11112222333344445555aaaa1111", name: "Network Operations" },
            { sys_id: "aaaa11112222333344445555bbbb2222", name: "Network Security" },
          ],
          pagination: { limit: 5, offset: 0, hasMore: false },
        };
      }
      return EMPTY_RESULT;
    });

    await expect(resolveGroupIdentifier(client, "Network")).rejects.toThrow(
      /Ambiguous group.*Network.*matched 2 groups/
    );
  });

  test("throws when group not found", async () => {
    const client = createResolveClient(() => EMPTY_RESULT);
    await expect(resolveGroupIdentifier(client, "Nonexistent Group")).rejects.toThrow(
      /Group not found.*Nonexistent Group/
    );
  });
});

// ── Optional convenience resolvers ──────────────────────

describe("resolveOptionalUser", () => {
  test("returns undefined for undefined input", async () => {
    const client = createResolveClient(() => EMPTY_RESULT);
    const result = await resolveOptionalUser(client, undefined);
    expect(result).toBeUndefined();
  });

  test("returns undefined for empty string", async () => {
    const client = createResolveClient(() => EMPTY_RESULT);
    const result = await resolveOptionalUser(client, "");
    expect(result).toBeUndefined();
  });

  test("returns undefined for whitespace-only string", async () => {
    const client = createResolveClient(() => EMPTY_RESULT);
    const result = await resolveOptionalUser(client, "   ");
    expect(result).toBeUndefined();
  });

  test("returns sys_id for valid input", async () => {
    const client = createResolveClient(() => EMPTY_RESULT);
    const result = await resolveOptionalUser(client, USER_SYS_ID);
    expect(result).toBe(USER_SYS_ID);
  });
});

describe("resolveOptionalGroup", () => {
  test("returns undefined for undefined input", async () => {
    const client = createResolveClient(() => EMPTY_RESULT);
    const result = await resolveOptionalGroup(client, undefined);
    expect(result).toBeUndefined();
  });

  test("returns sys_id for valid sys_id input", async () => {
    const client = createResolveClient(() => EMPTY_RESULT);
    const result = await resolveOptionalGroup(client, GROUP_SYS_ID);
    expect(result).toBe(GROUP_SYS_ID);
  });
});

describe("resolveOptionalRecord", () => {
  test("returns undefined for undefined input", async () => {
    const client = createResolveClient(() => EMPTY_RESULT);
    const result = await resolveOptionalRecord(client, undefined);
    expect(result).toBeUndefined();
  });

  test("returns sys_id for valid sys_id input", async () => {
    const client = createResolveClient(() => EMPTY_RESULT);
    const result = await resolveOptionalRecord(client, INCIDENT_SYS_ID);
    expect(result).toBe(INCIDENT_SYS_ID);
  });

  test("resolves INC number with tableHint", async () => {
    const client = createResolveClient((tableName) => {
      if (tableName === "incident") {
        return {
          records: [{ sys_id: INCIDENT_SYS_ID, number: "INC0010045" }],
          pagination: { limit: 1, offset: 0, hasMore: false },
        };
      }
      return EMPTY_RESULT;
    });

    const result = await resolveOptionalRecord(client, "INC0010045", "incident");
    expect(result).toBe(INCIDENT_SYS_ID);
  });
});
