import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { InstanceRegistry } from "../client/registry.ts";
import { logger } from "../utils/logger.ts";
import { createProgressReporter, type ToolExtra } from "../utils/progress.ts";

/**
 * Script Sync / Local Development tools.
 *
 * Enables a local-first development workflow:
 *  1. Download a script record from ServiceNow to a local file
 *  2. Edit in your local IDE with syntax highlighting, linting, IntelliSense
 *  3. Push the file back to ServiceNow
 *  4. Optionally watch for changes and auto-sync on save
 *
 * Supports multiple script types, each with their own field mapping:
 *  - sys_script_include  → script
 *  - sys_script          → script
 *  - sys_script_client   → script
 *  - sys_ui_script       → script
 *  - sys_ui_action       → script (or client_script)
 *  - sys_ui_page         → html, client_script, processing_script
 *  - sp_widget           → template, css, client_script, server_script, link
 *  - sys_ws_operation     → operation_script
 *
 * 3 tools: sync_to_local, sync_to_servicenow, watch_and_sync.
 */

/** Map of table → primary script field(s) */
const SCRIPT_FIELD_MAP: Record<string, string[]> = {
  sys_script_include: ["script"],
  sys_script: ["script"],
  sys_script_client: ["script"],
  sys_ui_script: ["script"],
  sys_ui_action: ["script", "client_script"],
  sys_ui_policy: ["script_true", "script_false"],
  sys_ui_page: ["html", "client_script", "processing_script"],
  sp_widget: ["template", "css", "client_script", "server_script", "link"],
  sys_ws_operation: ["operation_script"],
};

/** Determine file extension for a given field */
function fieldExtension(field: string): string {
  if (field === "template" || field === "html") return ".html";
  if (field === "css") return ".scss";
  return ".js";
}

export function registerScriptSyncTools(server: McpServer, registry: InstanceRegistry): void {

  server.registerTool("sn_sync_script_to_local", {
    description: [
      "Download a script record from ServiceNow to a local file.",
      "Supports multiple script types: script includes, business rules, client scripts,",
      "UI scripts, UI actions, UI pages, widgets, scripted REST resources.",
      "For multi-field records (widgets, UI pages), creates one file per field in a subdirectory.",
      "Use this as the first step in a local development workflow.",
    ].join(" "),
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      table: z.string().describe("Source table (e.g. 'sys_script_include', 'sp_widget', 'sys_ui_page')"),
      sys_id: z.string().describe("Record sys_id to download"),
      output_dir: z.string().default("scripts").describe("Local directory to save to. Default: 'scripts'"),
      field: z.string().optional().describe("Specific field to download (e.g. 'script', 'server_script'). If omitted, downloads all script fields for the record type."),
    },
  }, async ({ instance, table, sys_id, output_dir, field }, extra: ToolExtra) => {
    const client = registry.resolve(instance);

    // Fetch the record
    const record = await client.getRecord(table, sys_id, {
      sysparm_display_value: "false",
      sysparm_exclude_reference_link: "true",
    });

    const recordName = (record["name"] ?? record["short_description"] ?? record["id"] ?? sys_id) as string;
    const safeName = recordName.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
    const fields = field ? [field] : (SCRIPT_FIELD_MAP[table] ?? ["script"]);

    // Steps: write files + write manifest = fields.length + 1
    const progress = createProgressReporter(extra, fields.length + 1);

    const { mkdirSync, existsSync } = await import("node:fs");
    if (!existsSync(output_dir)) {
      mkdirSync(output_dir, { recursive: true });
    }

    const written: Array<{ field: string; path: string; size: number }> = [];

    if (fields.length === 1) {
      // Single field → single file
      const f = fields[0]!;
      const content = (record[f] ?? "") as string;
      const ext = fieldExtension(f);
      const filePath = `${output_dir}/${safeName}${ext}`;
      await Bun.write(filePath, content);
      written.push({ field: f, path: filePath, size: content.length });
      await progress.advance(1, `Wrote ${f}`);
    } else {
      // Multiple fields → subdirectory with one file per field
      const subDir = `${output_dir}/${safeName}`;
      if (!existsSync(subDir)) {
        mkdirSync(subDir, { recursive: true });
      }
      for (const f of fields) {
        const content = (record[f] ?? "") as string;
        const ext = fieldExtension(f);
        const filePath = `${subDir}/${f}${ext}`;
        await Bun.write(filePath, content);
        written.push({ field: f, path: filePath, size: content.length });
        await progress.advance(1, `Wrote ${f}`);
      }
    }

    // Write manifest entry for reverse sync
    const manifestPath = `${output_dir}/.sn-sync.json`;
    let manifest: Record<string, unknown> = {};
    try {
      const existing = await Bun.file(manifestPath).text();
      manifest = JSON.parse(existing) as Record<string, unknown>;
    } catch {
      // No existing manifest
    }

    const entryKey = `${table}:${sys_id}`;
    manifest[entryKey] = {
      table,
      sys_id,
      name: recordName,
      fields: written.map((w) => ({ field: w.field, path: w.path })),
      synced_at: new Date().toISOString(),
      instance: instance ?? "default",
    };

    await Bun.write(manifestPath, JSON.stringify(manifest, null, 2));
    await progress.complete(`Synced ${written.length} file(s)`);

    logger.info(`Synced ${recordName} (${table}) to ${written.length} local file(s)`);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          synced: true,
          record_name: recordName,
          table,
          sys_id,
          files: written,
          manifest: manifestPath,
          note: "Edit the local file(s), then use sn_sync_local_to_script to push changes back to ServiceNow.",
        }, null, 2),
      }],
    };
  });

  server.registerTool("sn_sync_local_to_script", {
    description: [
      "Upload a local file back to a ServiceNow script record.",
      "Reads the local file and updates the corresponding field on the SN record.",
      "Can auto-detect the target from the .sn-sync.json manifest, or specify table/sys_id/field manually.",
    ].join(" "),
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      local_path: z.string().describe("Path to the local file to upload"),
      table: z.string().optional().describe("Target table. Can be omitted if the file is tracked in .sn-sync.json manifest."),
      sys_id: z.string().optional().describe("Target record sys_id. Can be omitted if tracked in manifest."),
      field: z.string().optional().describe("Target field to update (e.g. 'script', 'server_script'). Can be omitted if tracked in manifest."),
    },
  }, async ({ instance, local_path, table, sys_id, field }) => {
    const client = registry.resolve(instance);

    // Try to resolve from manifest if table/sys_id/field not provided
    let resolvedTable = table;
    let resolvedSysId = sys_id;
    let resolvedField = field;

    if (!resolvedTable || !resolvedSysId || !resolvedField) {
      // Walk up from the file to find .sn-sync.json
      const { dirname } = await import("node:path");
      const dirs = [dirname(local_path), dirname(dirname(local_path))];
      for (const dir of dirs) {
        const manifestPath = `${dir}/.sn-sync.json`;
        try {
          const manifestText = await Bun.file(manifestPath).text();
          const manifest = JSON.parse(manifestText) as Record<string, Record<string, unknown>>;
          // Search manifest entries for a matching file path
          for (const entry of Object.values(manifest)) {
            const files = entry["fields"] as Array<{ field: string; path: string }> | undefined;
            if (files) {
              const match = files.find((f) => f.path === local_path);
              if (match) {
                resolvedTable = resolvedTable ?? (entry["table"] as string);
                resolvedSysId = resolvedSysId ?? (entry["sys_id"] as string);
                resolvedField = resolvedField ?? match.field;
                break;
              }
            }
          }
          if (resolvedTable && resolvedSysId && resolvedField) break;
        } catch {
          // No manifest found in this dir
        }
      }
    }

    if (!resolvedTable || !resolvedSysId || !resolvedField) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            error: "Could not determine target table/sys_id/field. Provide them explicitly or ensure the file is tracked in .sn-sync.json.",
          }, null, 2),
        }],
      };
    }

    // Read the local file
    const content = await Bun.file(local_path).text();

    // Update the record
    const record = await client.updateRecord(resolvedTable, resolvedSysId, {
      [resolvedField]: content,
    });

    logger.info(`Synced ${local_path} → ${resolvedTable}/${resolvedSysId}.${resolvedField} (${content.length} chars)`);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          synced: true,
          local_path,
          table: resolvedTable,
          sys_id: resolvedSysId,
          field: resolvedField,
          chars_uploaded: content.length,
          record_name: record["name"] ?? record["short_description"] ?? resolvedSysId,
        }, null, 2),
      }],
    };
  });

  server.registerTool("sn_watch_and_sync", {
    description: [
      "Watch a local file for changes and automatically sync to ServiceNow on save.",
      "Uses file system polling (2-second interval) to detect modifications.",
      "The file must be tracked in .sn-sync.json manifest (use sn_sync_script_to_local first).",
      "Returns immediately after starting the watcher — it runs in the background.",
      "The watcher stops when the MCP server process exits.",
    ].join(" "),
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      local_path: z.string().describe("Path to the local file to watch"),
      table: z.string().optional().describe("Target table (optional if tracked in manifest)"),
      sys_id: z.string().optional().describe("Target record sys_id (optional if tracked in manifest)"),
      field: z.string().optional().describe("Target field (optional if tracked in manifest)"),
      poll_interval_ms: z.number().int().min(500).max(30000).default(2000).describe("Polling interval in milliseconds. Default: 2000."),
    },
  }, async ({ instance, local_path, table, sys_id, field, poll_interval_ms }) => {
    const client = registry.resolve(instance);

    // Resolve target from manifest if needed
    let resolvedTable = table;
    let resolvedSysId = sys_id;
    let resolvedField = field;

    if (!resolvedTable || !resolvedSysId || !resolvedField) {
      const { dirname } = await import("node:path");
      const dirs = [dirname(local_path), dirname(dirname(local_path))];
      for (const dir of dirs) {
        const manifestPath = `${dir}/.sn-sync.json`;
        try {
          const manifestText = await Bun.file(manifestPath).text();
          const manifest = JSON.parse(manifestText) as Record<string, Record<string, unknown>>;
          for (const entry of Object.values(manifest)) {
            const files = entry["fields"] as Array<{ field: string; path: string }> | undefined;
            if (files) {
              const match = files.find((f) => f.path === local_path);
              if (match) {
                resolvedTable = resolvedTable ?? (entry["table"] as string);
                resolvedSysId = resolvedSysId ?? (entry["sys_id"] as string);
                resolvedField = resolvedField ?? match.field;
                break;
              }
            }
          }
          if (resolvedTable && resolvedSysId && resolvedField) break;
        } catch {
          // No manifest
        }
      }
    }

    if (!resolvedTable || !resolvedSysId || !resolvedField) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            error: "Could not determine target. Use sn_sync_script_to_local first to create a manifest entry, or provide table/sys_id/field explicitly.",
          }, null, 2),
        }],
      };
    }

    // Get initial modification time
    const { statSync } = await import("node:fs");
    let lastMtime: number;
    try {
      lastMtime = statSync(local_path).mtimeMs;
    } catch {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ error: `File not found: ${local_path}` }, null, 2),
        }],
      };
    }

    // Start background polling
    let syncCount = 0;
    const intervalId = setInterval(async () => {
      try {
        const currentMtime = statSync(local_path).mtimeMs;
        if (currentMtime > lastMtime) {
          lastMtime = currentMtime;
          const content = await Bun.file(local_path).text();
          await client.updateRecord(resolvedTable!, resolvedSysId!, {
            [resolvedField!]: content,
          });
          syncCount++;
          logger.info(`[watch] Auto-synced ${local_path} → ${resolvedTable}/${resolvedSysId}.${resolvedField} (sync #${syncCount})`);
        }
      } catch (err) {
        logger.error(`[watch] Sync error for ${local_path}: ${err}`);
        // Don't stop the watcher on transient errors
      }
    }, poll_interval_ms);

    // Clean up on process exit
    const cleanup = () => clearInterval(intervalId);
    process.on("exit", cleanup);
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    logger.info(`[watch] Started watching ${local_path} (poll every ${poll_interval_ms}ms) → ${resolvedTable}/${resolvedSysId}.${resolvedField}`);

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          watching: true,
          local_path,
          table: resolvedTable,
          sys_id: resolvedSysId,
          field: resolvedField,
          poll_interval_ms,
          note: "Watcher is running in the background. Changes to the file will be automatically synced to ServiceNow. The watcher stops when the MCP server process exits.",
        }, null, 2),
      }],
    };
  });
}
