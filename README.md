# ⚙️ ServiceNow MCP Server

A comprehensive [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for ServiceNow, built with **Bun** and **TypeScript**. Exposes **176 tools** across 28 ServiceNow domains, 7 read-only resources, and 10 role-based tool packages. Supports **multi-instance** configurations with per-call instance targeting.

## ✨ Features

- **176 MCP tools** spanning ITSM, platform development, service catalog, CMDB, knowledge, agile, and more
- **Multi-instance support** — configure dev/test/prod with per-instance auth; target any instance per call
- **7 MCP resources** — read-only `servicenow://` URIs for incidents, users, knowledge, tables, schema
- **10 tool packages** — role-based subsets (service desk, platform developer, portal developer, integration developer, etc.)
- **Smart resolution** — tools accept human-readable names ("Beth Anglin"), record numbers ("INC0010045"), or sys_ids
- **Two transports** — stdio (Claude Desktop / Claude Code) and Streamable HTTP (web integrations)
- **Basic & OAuth 2.0 auth** with automatic token refresh, configured per instance
- **Progress reporting** — long-running operations (batch, clone, move) report progress to MCP clients
- **Background script execution** — run server-side JavaScript via `sys_trigger`
- **Full platform development** — business rules, client scripts, UI policies, UI actions, UI scripts, script includes, scripted REST APIs, widgets, UI pages, workflows, Flow Designer
- **Script sync / local dev** — download scripts to local files, edit in your IDE, auto-sync on save
- **Application scope management** — switch scoped app context programmatically
- **Static table metadata** — 100 pre-cached table definitions for fast schema lookups
- **Zero runtime deps** beyond `@modelcontextprotocol/sdk` and `zod` — Bun provides native fetch, test runner, TypeScript
- **Single JSON config file** — no env vars, one source of truth

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.0+
- A ServiceNow instance with REST API access

### Install & Configure

```bash
git clone git@github.com:seemsindie/servicenow-mcp-server.git
cd servicenow-mcp-server
bun install

# Create your config file
cp config/servicenow-config.example.json config/servicenow-config.json
# Edit with your instance details and credentials
```

### Run (stdio transport)

```bash
bun run start
# or with explicit config path:
bun run start -- --config /path/to/config.json
```

### Run (HTTP transport)

```bash
bun run start:http
# or:
bun run start:http -- --config /path/to/config.json

# Server starts at http://127.0.0.1:3000
# Health check: GET /health
# MCP endpoint: /mcp
```

## 🔧 Configuration

All configuration lives in a single JSON file. The server searches for it in order:

1. `config/servicenow-config.json` (relative to cwd)
2. `servicenow-config.json` (relative to cwd)

Or specify an explicit path with `--config`:

```bash
bun run src/index.ts --config /etc/servicenow/config.json
```

### Config File Format

```json
{
  "instances": [
    {
      "name": "dev",
      "url": "https://dev-instance.service-now.com",
      "auth": {
        "type": "basic",
        "username": "admin",
        "password": "dev-password"
      },
      "default": true,
      "description": "Development instance"
    },
    {
      "name": "prod",
      "url": "https://prod-instance.service-now.com",
      "auth": {
        "type": "oauth",
        "clientId": "your-client-id",
        "clientSecret": "your-client-secret",
        "username": "admin",
        "password": "prod-password"
      },
      "description": "Production instance"
    }
  ],
  "toolPackage": "full",
  "debug": false,
  "http": {
    "port": 3000,
    "host": "127.0.0.1"
  }
}
```

### Config Reference

| Field | Required | Default | Description |
|---|---|---|---|
| `instances` | Yes | — | Array of ServiceNow instance configs |
| `instances[].name` | Yes | — | Unique identifier (used in `instance` parameter) |
| `instances[].url` | Yes | — | ServiceNow instance URL |
| `instances[].auth` | Yes | — | Auth config (`basic` or `oauth`) |
| `instances[].default` | No | `false` | Mark as default (at most one) |
| `instances[].description` | No | — | Human-readable description |
| `toolPackage` | No | `"full"` | Tool package filter (see below) |
| `debug` | No | `false` | Enable debug logging |
| `http.port` | No | `3000` | HTTP transport port |
| `http.host` | No | `"127.0.0.1"` | HTTP transport bind address |

### Auth Types

**Basic auth:**
```json
{ "type": "basic", "username": "admin", "password": "secret" }
```

**OAuth 2.0:**
```json
{
  "type": "oauth",
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret",
  "username": "admin",
  "password": "secret"
}
```

Each instance independently specifies its own auth type and credentials.

## 🌐 Using Multiple Instances

Every tool accepts an optional `instance` parameter. When omitted, the default instance is used.

```
# Query incidents on the default instance
sn_query_table(table: "incident", query: "active=true")

# Query incidents on a specific instance
sn_query_table(table: "incident", query: "active=true", instance: "prod")

# List all configured instances
sn_list_instances()

# Get info about a specific instance
sn_instance_info(instance: "dev")
```

MCP resources (`servicenow://` URIs) always use the default instance.

## 🖥️ Claude Desktop Integration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "servicenow": {
      "command": "bun",
      "args": ["run", "/path/to/servicenow-mcp-server/src/index.ts"]
    }
  }
}
```

Place your `config/servicenow-config.json` in the project directory. Or use `--config` to point elsewhere:

```json
{
  "mcpServers": {
    "servicenow": {
      "command": "bun",
      "args": [
        "run", "/path/to/servicenow-mcp-server/src/index.ts",
        "--config", "/path/to/servicenow-config.json"
      ]
    }
  }
}
```

## 📦 Tool Packages

Limit exposed tools by role. Set `toolPackage` in your config file:

| Package | Modules | Use Case |
|---|---|---|
| `full` | All 27 modules (176 tools) + instance tools | Full access (default) |
| `service_desk` | tables, incidents, users, knowledge, search, problems, requests | Service desk agents |
| `change_coordinator` | tables, changes, users, search | Change management |
| `catalog_builder` | tables, catalog, search | Catalog administration |
| `knowledge_author` | tables, knowledge, search | KB content creation |
| `platform_developer` | tables, scripts, platform_scripts, workflows, flows, changesets, schema, search, background_scripts, scripted_rest, widgets, ui_pages, app_scope, script_sync | Platform development |
| `system_admin` | tables, users, schema, search, batch, app_scope, changesets, aggregation, import_sets, attachments | System administration |
| `agile` | tables, agile, users, search | Agile teams |
| `integration_developer` | tables, scripts, platform_scripts, scripted_rest, schema, search, batch, background_scripts, aggregation, import_sets, attachments | Integration & API development |
| `portal_developer` | tables, widgets, ui_pages, catalog, scripts, platform_scripts, search, schema, script_sync | Service Portal development |

Instance management tools (`sn_list_instances`, `sn_instance_info`) are always available regardless of package.

## 🛠️ Tools Reference

### Instance Management (2 tools) — always available
`sn_list_instances`, `sn_instance_info`

### Generic Table API (5 tools)
`sn_query_table`, `sn_get_record`, `sn_create_record`, `sn_update_record`, `sn_delete_record`

### 🎫 Incidents (7 tools)
`sn_list_incidents`, `sn_create_incident`, `sn_update_incident`, `sn_add_incident_comment`, `sn_add_incident_work_notes`, `sn_resolve_incident`, `sn_close_incident`

Supports smart resolution — `assigned_to`, `caller_id`, and `assignment_group` accept names, emails, or sys_ids. Record identifiers accept INC numbers or sys_ids.

### 👥 Users & Groups (9 tools)
`sn_list_users`, `sn_get_user`, `sn_create_user`, `sn_update_user`, `sn_list_groups`, `sn_create_group`, `sn_update_group`, `sn_add_group_members`, `sn_remove_group_members`

Group member tools accept user names, emails, or sys_ids and group names or sys_ids.

### 🔄 Change Management (10 tools)
`sn_list_change_requests`, `sn_get_change_request`, `sn_create_change_request`, `sn_update_change_request`, `sn_add_change_task`, `sn_submit_change_for_approval`, `sn_approve_change`, `sn_reject_change`, `sn_add_change_comment`, `sn_add_change_work_notes`

Supports smart resolution — accepts CHG numbers or sys_ids, resolves user/group fields by name.

### 🐛 Problem Management (7 tools)
`sn_list_problems`, `sn_get_problem`, `sn_create_problem`, `sn_update_problem`, `sn_add_problem_comment`, `sn_add_problem_work_notes`, `sn_close_problem`

### 📋 Service Requests / RITM (6 tools)
`sn_list_requests`, `sn_get_request`, `sn_list_request_items`, `sn_get_request_item`, `sn_update_request_item`, `sn_submit_catalog_request`

### 🛒 Service Catalog (13 tools)
`sn_list_catalogs`, `sn_list_catalog_items`, `sn_get_catalog_item`, `sn_update_catalog_item`, `sn_list_catalog_categories`, `sn_create_catalog_category`, `sn_update_catalog_category`, `sn_move_catalog_items`, `sn_create_catalog_variable`, `sn_list_catalog_variables`, `sn_update_catalog_variable`, `sn_get_catalog_recommendations`, `sn_validate_catalog_item`

**`sn_validate_catalog_item`** checks for common issues: missing descriptions, no variables, inactive items, missing category, mandatory variables without defaults, duplicate variable names, and missing price.

### 📚 Knowledge Base (8 tools)
`sn_list_knowledge_bases`, `sn_create_knowledge_base`, `sn_create_kb_category`, `sn_list_articles`, `sn_get_article`, `sn_create_article`, `sn_update_article`, `sn_publish_article`

### 🔀 Workflows (9 tools)
`sn_list_workflows`, `sn_get_workflow`, `sn_create_workflow`, `sn_update_workflow`, `sn_delete_workflow`, `sn_create_workflow_full`, `sn_create_workflow_activity`, `sn_create_workflow_transition`, `sn_publish_workflow`

**`sn_create_workflow_full`** is the recommended way to create workflows — orchestrates the full lifecycle in one call: creates the base workflow, version, activities, transitions (with optional conditions), and optionally publishes. Activities are referenced by name or array index in transition definitions.

### 📝 Script Includes (5 tools)
`sn_list_script_includes`, `sn_get_script_include`, `sn_create_script_include`, `sn_update_script_include`, `sn_delete_script_include`

### ▶️ Background Script Execution (2 tools)
`sn_execute_background_script`, `sn_create_fix_script`

**`sn_execute_background_script`** runs server-side JavaScript on the instance via the `sys_trigger` mechanism — creates a one-shot scheduled trigger that fires in ~1 second, executes with full GlideRecord/GlideSystem access, and auto-deletes.

### 🧩 Platform Script Types (25 tools)

Full CRUD (list, get, create, update, delete) for five script types:

| Type | Table | Tools |
|---|---|---|
| Business Rules | `sys_script` | `sn_list_business_rules`, `sn_get_business_rule`, `sn_create_business_rule`, `sn_update_business_rule`, `sn_delete_business_rule` |
| Client Scripts | `sys_script_client` | `sn_list_client_scripts`, `sn_get_client_script`, `sn_create_client_script`, `sn_update_client_script`, `sn_delete_client_script` |
| UI Policies | `sys_ui_policy` | `sn_list_ui_policys`, `sn_get_ui_policy`, `sn_create_ui_policy`, `sn_update_ui_policy`, `sn_delete_ui_policy` |
| UI Actions | `sys_ui_action` | `sn_list_ui_actions`, `sn_get_ui_action`, `sn_create_ui_action`, `sn_update_ui_action`, `sn_delete_ui_action` |
| UI Scripts | `sys_ui_script` | `sn_list_ui_scripts`, `sn_get_ui_script`, `sn_create_ui_script`, `sn_update_ui_script`, `sn_delete_ui_script` |

### 🔌 Scripted REST APIs (7 tools)
`sn_list_scripted_rest_apis`, `sn_get_scripted_rest_api`, `sn_create_scripted_rest_api`, `sn_update_scripted_rest_api`, `sn_create_rest_resource`, `sn_update_rest_resource`, `sn_delete_rest_resource`

**`sn_get_scripted_rest_api`** fetches the API definition and all its resource operations in parallel. **`sn_create_rest_resource`** creates an endpoint with HTTP method, path (supports `{param}` syntax), and a script handler.

### 🖼️ Service Portal Widgets (5 tools)
`sn_list_widgets`, `sn_get_widget`, `sn_create_widget`, `sn_update_widget`, `sn_delete_widget`

**`sn_get_widget`** returns all script components: HTML template, CSS/SCSS, client script (Angular controller), server script, link function, demo data, and option schema.

### 📄 UI Pages (5 tools)
`sn_list_ui_pages`, `sn_get_ui_page`, `sn_create_ui_page`, `sn_update_ui_page`, `sn_delete_ui_page`

Each UI page has three script components: `html` (Jelly/HTML body), `client_script`, and `processing_script` (server-side).

### 🌊 Flow Designer (6 tools)
`sn_list_flows`, `sn_get_flow`, `sn_create_flow`, `sn_list_flow_variables`, `sn_create_flow_variable`, `sn_list_flow_stages`

**`sn_get_flow`** fetches the flow definition plus all logic blocks and variables in parallel.

### 📦 Update Sets (9 tools)
`sn_list_update_sets`, `sn_get_update_set`, `sn_create_update_set`, `sn_update_update_set`, `sn_set_current_update_set`, `sn_commit_update_set`, `sn_add_to_update_set`, `sn_move_to_update_set`, `sn_clone_update_set`

**`sn_move_to_update_set`** moves records between update sets by sys_ids, source set, or time range with progress reporting. **`sn_clone_update_set`** duplicates a set with all its `sys_update_xml` records.

### 🏃 Agile (12 tools)
`sn_list_stories`, `sn_create_story`, `sn_update_story`, `sn_list_epics`, `sn_create_epic`, `sn_update_epic`, `sn_list_scrum_tasks`, `sn_create_scrum_task`, `sn_update_scrum_task`, `sn_list_projects`, `sn_create_project`, `sn_update_project`

### 🖧 CMDB (5 tools)
`sn_list_ci`, `sn_get_ci`, `sn_create_ci`, `sn_list_ci_relationships`, `sn_create_ci_relationship`

### 🔍 Schema Discovery (4 tools)
`sn_get_table_schema`, `sn_discover_table`, `sn_list_tables`, `sn_explain_field`

**`sn_explain_field`** provides detailed metadata about a specific field including type, reference target, max length, choices, and default value. Schema tools leverage a static cache of 100 pre-loaded table definitions for instant lookups.

### 🔎 Natural Language Search (1 tool)
`sn_natural_language_search` — translates plain English to ServiceNow encoded queries (16 pattern matchers)

### 🎯 Application Scope (2 tools)
`sn_get_current_application`, `sn_set_application_scope`

Switch the active application scope before creating records in a scoped app. Accepts either a `sys_id` or a scope string (e.g. `x_myapp_module`).

### 💻 Script Sync / Local Dev (3 tools)
`sn_sync_script_to_local`, `sn_sync_local_to_script`, `sn_watch_and_sync`

Local development workflow:
1. **`sn_sync_script_to_local`** — download any script record to local file(s). Multi-field records (widgets, UI pages) create one file per component in a subdirectory. Creates a `.sn-sync.json` manifest.
2. Edit in your IDE with full syntax highlighting, linting, IntelliSense.
3. **`sn_sync_local_to_script`** — push the local file back to ServiceNow. Auto-detects the target from the manifest.
4. **`sn_watch_and_sync`** — watch a file for changes and auto-sync on save (2s polling). Runs in background.

### ⚡ Batch Operations (3 tools)
`sn_batch_create`, `sn_batch_update`, `sn_batch_delete` — parallel record creation, updates, and deletion across tables with progress reporting

### 📎 Attachments (3 tools)
`sn_upload_attachment`, `sn_list_attachments`, `sn_get_attachment`

Upload files to any record, list attachments on a record, and retrieve attachment metadata/content.

### 📊 Aggregation (1 tool)
`sn_aggregate_table` — run aggregate queries (COUNT, SUM, AVG, MIN, MAX) via the `/api/now/stats` endpoint with optional grouping and encoded query filters

### 📥 Import Sets (2 tools)
`sn_create_import_set`, `sn_run_transform`

Create import set rows and run transform maps to load data into ServiceNow tables programmatically.

## 📡 MCP Resources

Resources always use the default instance.

| URI | Description |
|---|---|
| `servicenow://incidents` | 20 most recent incidents |
| `servicenow://users` | Active users (limit 50) |
| `servicenow://knowledge` | Published knowledge articles |
| `servicenow://tables` | Available table definitions |
| `servicenow://tables/{table}` | Records from any table |
| `servicenow://schema/{table}` | Table schema (fields, types) |
| `servicenow://incidents/{number}` | Specific incident by number |

## 🧪 Development

```bash
# Type check
bun run typecheck

# Run tests (279 tests across 26 files)
bun test

# Dev mode (auto-reload)
bun run dev
```

## 🏗️ Architecture

```
src/
  index.ts          # stdio entry point (--config support)
  http.ts           # Streamable HTTP entry point (--config support)
  server.ts         # MCP server setup, modular tool registration
  config.ts         # JSON config loader + Zod validation
  auth/             # Basic & OAuth providers (per-instance)
  client/
    index.ts        # ServiceNow REST client
    registry.ts     # InstanceRegistry — maps instance names to clients
    errors.ts       # SN-specific error classes
    types.ts        # API response types
  config/
    table-definitions.json  # 100 pre-cached table definitions
  tools/            # 28 domain tool modules
    tables.ts               # Generic Table API CRUD (any table)
    incidents.ts            # Incident management + smart resolution
    changes.ts              # Change requests + tasks + approvals
    users.ts                # Users, groups, members
    catalog.ts              # Service catalog items/categories/variables/validation
    knowledge.ts            # Knowledge bases, categories, articles
    workflows.ts            # Workflows + orchestration (version/activities/transitions/publish)
    scripts.ts              # Script includes
    changesets.ts           # Update sets + move/clone
    agile.ts                # Stories, epics, scrum tasks, projects
    cmdb.ts                 # CMDB CIs + relationships
    schema.ts               # Schema discovery / table introspection
    search.ts               # Natural language search
    batch.ts                # Batch create/update/delete with progress
    background-scripts.ts   # Background script execution via sys_trigger
    platform-scripts.ts     # Business rules, client scripts, UI policies/actions/scripts
    scripted-rest.ts        # Scripted REST API definitions + operations
    widgets.ts              # Service Portal widgets (sp_widget)
    ui-pages.ts             # UI pages (sys_ui_page)
    flows.ts                # Flow Designer (sys_hub_flow + related)
    app-scope.ts            # Application scope management
    script-sync.ts          # Script sync / local development workflow
    problems.ts             # Problem management
    requests.ts             # Service requests + requested items (RITM)
    attachments.ts          # File attachments (upload/list/get)
    aggregation.ts          # Aggregate stats (COUNT/SUM/AVG/MIN/MAX)
    import-sets.ts          # Import sets + transform maps
    instances.ts            # Instance management (always available)
  resources/        # 7 servicenow:// MCP resources (default instance)
  packages/         # 10 role-based tool package definitions
  utils/
    logger.ts               # Logger (stderr-safe)
    query.ts                # Encoded query builder
    resolve.ts              # Smart name/number resolution
    progress.ts             # MCP progress notification helper
    table-metadata.ts       # Static table metadata loader

config/
  servicenow-config.example.json  # Config template
```

## 📦 Dependencies

- `@modelcontextprotocol/sdk` — MCP protocol implementation
- `zod` — Schema validation

Zero other runtime dependencies. Bun provides native fetch, test runner, and TypeScript execution.

## 📄 License

MIT
