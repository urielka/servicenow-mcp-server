import { describe, expect, test } from "bun:test";
import {
  getTableMetadata,
  getDisplayField,
  getKeyField,
  getRequiredFields,
  getCommonFields,
  isKnownTable,
  listKnownTables,
  knownTableCount,
} from "../../src/utils/table-metadata.ts";

describe("table-metadata", () => {
  test("knownTableCount returns >= 100", () => {
    expect(knownTableCount()).toBeGreaterThanOrEqual(100);
  });

  test("listKnownTables returns array of strings", () => {
    const tables = listKnownTables();
    expect(Array.isArray(tables)).toBe(true);
    expect(tables.length).toBeGreaterThanOrEqual(100);
    expect(tables).toContain("incident");
    expect(tables).toContain("sys_user");
    expect(tables).toContain("change_request");
  });

  test("isKnownTable returns true for known tables", () => {
    expect(isKnownTable("incident")).toBe(true);
    expect(isKnownTable("sys_user")).toBe(true);
    expect(isKnownTable("change_request")).toBe(true);
    expect(isKnownTable("problem")).toBe(true);
    expect(isKnownTable("kb_knowledge")).toBe(true);
    expect(isKnownTable("cmdb_ci")).toBe(true);
  });

  test("isKnownTable returns false for unknown tables", () => {
    expect(isKnownTable("x_custom_nonexistent")).toBe(false);
    expect(isKnownTable("")).toBe(false);
    expect(isKnownTable("_metadata")).toBe(false);
  });
});

describe("getTableMetadata", () => {
  test("returns full definition for incident", () => {
    const meta = getTableMetadata("incident");
    expect(meta).toBeDefined();
    expect(meta!.label).toBe("Incident");
    expect(meta!.key_field).toBe("number");
    expect(meta!.display_field).toBe("short_description");
    expect(meta!.required_fields).toContain("short_description");
    expect(meta!.common_fields).toContain("state");
    expect(meta!.common_fields).toContain("priority");
    expect(meta!.common_fields).toContain("assigned_to");
  });

  test("returns full definition for sys_user", () => {
    const meta = getTableMetadata("sys_user");
    expect(meta).toBeDefined();
    expect(meta!.label).toBe("User");
    expect(meta!.key_field).toBe("user_name");
    expect(meta!.display_field).toBe("name");
    expect(meta!.required_fields).toContain("user_name");
  });

  test("returns full definition for sys_script", () => {
    const meta = getTableMetadata("sys_script");
    expect(meta).toBeDefined();
    expect(meta!.label).toBe("Business Rule");
    expect(meta!.display_field).toBe("name");
    expect(meta!.common_fields).toContain("script");
  });

  test("returns undefined for unknown table", () => {
    expect(getTableMetadata("x_custom_nonexistent")).toBeUndefined();
  });

  test("does not return _metadata key", () => {
    expect(getTableMetadata("_metadata" as string)).toBeUndefined();
  });
});

describe("getDisplayField", () => {
  test("returns display_field for known tables", () => {
    expect(getDisplayField("incident")).toBe("short_description");
    expect(getDisplayField("sys_user")).toBe("name");
    expect(getDisplayField("sys_user_group")).toBe("name");
    expect(getDisplayField("sc_cat_item")).toBe("name");
    expect(getDisplayField("kb_knowledge")).toBe("short_description");
  });

  test("returns 'name' as fallback for unknown tables", () => {
    expect(getDisplayField("x_custom_table")).toBe("name");
  });
});

describe("getKeyField", () => {
  test("returns key_field for known tables", () => {
    expect(getKeyField("incident")).toBe("number");
    expect(getKeyField("sys_user")).toBe("user_name");
    expect(getKeyField("cmdb_ci")).toBe("name");
  });

  test("returns 'sys_id' as fallback for unknown tables", () => {
    expect(getKeyField("x_custom_table")).toBe("sys_id");
  });
});

describe("getRequiredFields", () => {
  test("returns required fields for known tables", () => {
    expect(getRequiredFields("incident")).toEqual(["short_description"]);
    expect(getRequiredFields("sys_user")).toEqual(["user_name"]);
    expect(getRequiredFields("sys_user_grmember")).toEqual(["group", "user"]);
  });

  test("returns empty array for unknown tables", () => {
    expect(getRequiredFields("x_custom_table")).toEqual([]);
  });
});

describe("getCommonFields", () => {
  test("returns common fields for known tables", () => {
    const fields = getCommonFields("incident");
    expect(fields.length).toBeGreaterThan(5);
    expect(fields).toContain("number");
    expect(fields).toContain("short_description");
  });

  test("returns empty array for unknown tables", () => {
    expect(getCommonFields("x_custom_table")).toEqual([]);
  });
});
