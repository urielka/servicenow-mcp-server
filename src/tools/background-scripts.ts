import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { InstanceRegistry } from "../client/registry.ts";
import { logger } from "../utils/logger.ts";

/**
 * Background Script Execution tools.
 *
 * Uses the `sys_trigger` table to execute arbitrary server-side JavaScript.
 * This is the same mechanism used by Happy-Technologies-LLC/mcp-servicenow-nodejs.
 *
 * How it works:
 * 1. Create a `sys_trigger` record with trigger_type=0 (run once), state=0 (ready),
 *    next_action = now + 1 second.
 * 2. The SN scheduler picks it up and executes the `script` field as server-side JS.
 * 3. If autoDelete is true, the script is wrapped in try/finally to self-delete the trigger.
 * 4. Fallback: if trigger creation fails, create a local .js file for manual execution.
 */
export function registerBackgroundScriptTools(server: McpServer, registry: InstanceRegistry): void {

  server.registerTool("sn_execute_background_script", {
    description: [
      "Execute a server-side JavaScript snippet on the ServiceNow instance via the sys_trigger mechanism.",
      "Creates a one-shot scheduled trigger that fires in ~1 second, executes the script, and auto-deletes itself.",
      "The script runs with full GlideRecord / server-side API access (gs, GlideRecord, GlideAggregate, etc.).",
      "Use this for bulk data operations, cache flushing, setting values that REST API can't set, or any server-side task.",
      "Falls back to creating a local fix script file if the trigger cannot be created.",
    ].join(" "),
    inputSchema: {
      instance: z.string().optional().describe("Target ServiceNow instance name (from config). Uses default instance if omitted."),
      script: z.string().describe("Server-side JavaScript to execute. Has full access to GlideRecord, gs, GlideSystem, etc."),
      description: z.string().optional().describe("Human-readable description of what this script does (used as trigger name)."),
      auto_delete: z.boolean().default(true).describe("Whether the trigger should self-delete after execution. Default: true."),
    },
  }, async ({ instance, script, description, auto_delete }) => {
    const client = registry.resolve(instance);
    const triggerName = `MCP Background Script: ${description ?? "Ad-hoc execution"}`;

    // Calculate next_action = now + 1 second in UTC
    const now = new Date();
    now.setSeconds(now.getSeconds() + 1);
    const nextAction = now.toISOString().replace("T", " ").replace("Z", "");

    // Wrap script for auto-delete if requested
    let finalScript = script;
    if (auto_delete) {
      finalScript = [
        "// Auto-delete wrapper — trigger cleans up after execution",
        "var _triggerSysId = current.sys_id.toString();",
        "try {",
        script,
        "} finally {",
        "  var _cleanupGR = new GlideRecord('sys_trigger');",
        "  if (_cleanupGR.get(_triggerSysId)) {",
        "    _cleanupGR.deleteRecord();",
        "  }",
        "}",
      ].join("\n");
    }

    try {
      const triggerRecord = await client.createRecord("sys_trigger", {
        name: triggerName,
        trigger_type: "0",     // Run once
        state: "0",            // Ready
        next_action: nextAction,
        script: finalScript,
      });

      const sysId = triggerRecord["sys_id"] as string;
      logger.info(`Created sys_trigger ${sysId} — scheduled for ${nextAction}`);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            method: "sys_trigger",
            trigger_sys_id: sysId,
            trigger_name: triggerName,
            scheduled_for: nextAction,
            auto_delete,
            note: "Script will execute in ~1 second. The trigger runs as the system user with full server-side API access.",
          }, null, 2),
        }],
      };
    } catch (err) {
      // Fallback: create a local fix script
      logger.warn(`sys_trigger creation failed, falling back to local fix script: ${err}`);

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `fix-script-${timestamp}.js`;
      const filePath = `scripts/${filename}`;

      const fileContent = [
        `// Fix Script: ${description ?? "Background script"}`,
        `// Generated: ${new Date().toISOString()}`,
        `// Execute manually in ServiceNow: System Definition → Fix Scripts, or Scripts - Background`,
        "",
        script,
      ].join("\n");

      try {
        await Bun.write(filePath, fileContent);
      } catch {
        // scripts/ directory might not exist
        const { mkdirSync } = await import("node:fs");
        mkdirSync("scripts", { recursive: true });
        await Bun.write(filePath, fileContent);
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: false,
            method: "local_fix_script",
            error: `sys_trigger creation failed: ${err instanceof Error ? err.message : String(err)}`,
            local_file: filePath,
            note: "Script saved locally. Copy-paste into ServiceNow → Scripts - Background to execute.",
          }, null, 2),
        }],
      };
    }
  });

  server.registerTool("sn_create_fix_script", {
    description: [
      "Create a local JavaScript fix script file for manual execution in ServiceNow's Scripts-Background UI.",
      "Useful for scripts that need to be reviewed before execution, or as a backup when automated execution isn't possible.",
      "Files are saved to the local scripts/ directory with a timestamp.",
    ].join(" "),
    inputSchema: {
      script: z.string().describe("Server-side JavaScript code to save."),
      description: z.string().optional().describe("Description of the script's purpose."),
      filename: z.string().optional().describe("Custom filename (without path). Defaults to timestamped name."),
    },
  }, async ({ script, description, filename }) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = filename ?? `fix-script-${timestamp}.js`;
    const filePath = `scripts/${name}`;

    const fileContent = [
      `// Fix Script: ${description ?? "Untitled"}`,
      `// Generated: ${new Date().toISOString()}`,
      `// Execute in ServiceNow: System Definition → Fix Scripts, or Scripts - Background`,
      "",
      script,
    ].join("\n");

    try {
      await Bun.write(filePath, fileContent);
    } catch {
      const { mkdirSync } = await import("node:fs");
      mkdirSync("scripts", { recursive: true });
      await Bun.write(filePath, fileContent);
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          created: true,
          file: filePath,
          description: description ?? "Untitled",
          note: "Copy-paste this script into ServiceNow → Scripts - Background to execute.",
        }, null, 2),
      }],
    };
  });
}
