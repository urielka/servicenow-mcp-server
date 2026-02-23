# ServiceNow MCP Server - Project Tracker

> **Runtime:** Bun | **Language:** TypeScript | **Transport:** stdio + Streamable HTTP
> **Sources:** echelon-ai-labs/servicenow-mcp, Happy-Technologies-LLC/mcp-servicenow-nodejs, michaelbuckner/servicenow-mcp, sn-11ty (sn.jace.pro)

---

## Research & Planning

- [x] Research MCP SDK & protocol (TypeScript)
- [x] Research echelon-ai-labs/servicenow-mcp (Python, 206 stars) — tool packages, domain coverage, SSE
- [x] Research Happy-Technologies-LLC/mcp-servicenow-nodejs — multi-instance, schema discovery, NL search, batch ops, MCP resources, 160+ tables
- [x] Research michaelbuckner/servicenow-mcp (Python) — clean resource URIs, NL update, script sync
- [x] Explore sn-11ty knowledge base — encoded query operators, GlideRecord patterns, ACL model, API namespaces, 25k+ system properties, field attributes, REST API patterns
- [x] Finalize architecture & plan

---

## Phase 1 — Project Scaffold

- [x] Initialize bun project (`bun init`)
- [x] `package.json` with deps: `@modelcontextprotocol/sdk`, `zod`
- [x] `tsconfig.json` (strict, ES2022, NodeNext)
- [x] `.gitignore`
- [x] `config/servicenow-config.example.json`
- [x] Directory structure: `src/`, `src/auth/`, `src/client/`, `src/tools/`, `src/resources/`, `src/packages/`, `src/utils/`, `tests/`, `config/`

## Phase 2 — Config Module

- [x] `src/config.ts` — Zod-validated JSON config
  - Single JSON config file (`config/servicenow-config.json`)
  - Multi-instance support with per-instance auth
  - `--config <path>` CLI argument
  - Tool package selection, debug mode, HTTP settings — all in JSON

## Phase 3 — Logger

- [x] `src/utils/logger.ts` — stderr-only logger (critical for stdio transport)
  - Levels: debug, info, warn, error
  - Timestamp prefix
  - Controlled by `SN_DEBUG` env var

## Phase 4 — Auth Module

- [x] `src/auth/types.ts` — `AuthProvider` interface (`getHeaders(): Promise<Record<string, string>>`)
- [x] `src/auth/basic.ts` — Basic auth (Base64 `user:pass` → `Authorization` header)
- [x] `src/auth/oauth.ts` — OAuth 2.0 client credentials
  - POST to `/oauth_token.do`
  - Token caching + auto-refresh before expiry
  - Support for `client_id`, `client_secret`, `username`, `password`
- [x] `src/auth/index.ts` — Factory: `createAuthProvider(config)` returns correct provider

## Phase 5 — ServiceNow HTTP Client

- [x] `src/client/types.ts` — API response types, pagination types, query params
- [x] `src/client/errors.ts` — SN-specific error classes, HTTP status mapping
  - Map SN error codes: 400 BadRequest, 401 Unauthorized, 403 Forbidden, 404 NotFound, 409 Conflict
- [x] `src/client/index.ts` — Main client class
  - `get()`, `post()`, `put()`, `patch()`, `delete()`
  - Auth header injection via AuthProvider
  - Base URL construction: `{instance_url}/api/now/table/{table}`
  - ServiceNow query params: `sysparm_query`, `sysparm_fields`, `sysparm_limit`, `sysparm_offset`, `sysparm_display_value`, `sysparm_exclude_reference_link`, `sysparm_suppress_pagination_header`, `sysparm_query_no_domain`
  - Response unwrapping (SN wraps in `{ result: ... }`)
  - Pagination support via `Link` header or `X-Total-Count`
  - Rate limit handling

## Phase 6 — Encoded Query Builder Utility

- [x] `src/utils/query.ts` — ServiceNow encoded query builder
  - Operators from sn-11ty docs: `=`, `!=`, `<`, `<=`, `>`, `>=`, `LIKE`, `NOT LIKE`, `STARTSWITH`, `ENDSWITH`, `IN`, `NOT IN`, `ISEMPTY`, `ISNOTEMPTY`, `BETWEEN`, `SAMEAS`, `NSAMEAS`, `VALCHANGES`, `CHANGESFROM`, `CHANGESTO`, `GT_FIELD`, `LT_FIELD`, `MORETHAN`, `LESSTHAN`, `ANYTHING`
  - Logical: `^` (AND), `^OR` (OR), `^NQ` (new query)
  - `ORDERBY`, `ORDERBYDESC`
  - Relative date operators: `RELATIVEGE`, `RELATIVELE`, etc.

## Phase 7 — MCP Server Core

- [x] `src/server.ts` — Server setup & modular tool registration
  - Create `McpServer` instance with name/version
  - Load config → create auth → create client
  - Register tools from each module via `register(server, client)` pattern
  - Register MCP resources
  - Apply tool package filtering (if `SN_TOOL_PACKAGE` is set)

## Phase 8 — stdio Transport Entry Point

- [x] `src/index.ts` — stdio entry point
  - `StdioServerTransport` from MCP SDK
  - Wire up server + transport
  - Never write to stdout (all logging to stderr)

---

## Phase 9 — Generic Table API Tools (5 tools)

> Foundation — all domain tools build on this

- [x] `src/tools/tables.ts`
  - [ ] `sn_query_table` — Query any table with encoded query, field selection, limit, offset, order, display values
  - [ ] `sn_get_record` — Get single record by sys_id from any table
  - [ ] `sn_create_record` — Create a record on any table (JSON body)
  - [ ] `sn_update_record` — Update a record by sys_id on any table
  - [ ] `sn_delete_record` — Delete a record by sys_id from any table

## Phase 10 — Incident Management Tools (7 tools)

- [x] `src/tools/incidents.ts`
  - [ ] `sn_list_incidents` — List with filters (state, priority, assignment_group, assigned_to, category)
  - [ ] `sn_create_incident` — Create with short_description, description, urgency, impact, category, subcategory, assignment_group, assigned_to, caller_id
  - [ ] `sn_update_incident` — Update any incident fields
  - [ ] `sn_add_incident_comment` — Add customer-visible comment (comments field)
  - [ ] `sn_add_incident_work_notes` — Add internal work notes (work_notes field)
  - [ ] `sn_resolve_incident` — Set state=6, resolution_code, resolution_notes, close_code
  - [ ] `sn_close_incident` — Set state=7, close_code, close_notes

## Phase 11 — User & Group Management Tools (9 tools)

- [x] `src/tools/users.ts`
  - [ ] `sn_list_users` — Filter by active, department, role, name
  - [ ] `sn_get_user` — By sys_id, user_name, or email
  - [ ] `sn_create_user` — With user_name, first_name, last_name, email, department, title, manager
  - [ ] `sn_update_user` — Update any user fields
  - [ ] `sn_list_groups` — Filter by name, type, active
  - [ ] `sn_create_group` — With name, description, manager, parent, type
  - [ ] `sn_update_group` — Update any group fields
  - [ ] `sn_add_group_members` — Add user(s) to sys_user_grmember
  - [ ] `sn_remove_group_members` — Remove user(s) from sys_user_grmember

## Phase 12 — Change Management Tools (10 tools)

- [x] `src/tools/changes.ts`
  - [ ] `sn_list_change_requests` — Filter by type (normal/standard/emergency), state, risk, assignment_group
  - [ ] `sn_get_change_request` — Details by sys_id or number
  - [ ] `sn_create_change_request` — With type, short_description, description, risk, impact, start_date, end_date, assignment_group
  - [ ] `sn_update_change_request` — Update any fields
  - [ ] `sn_add_change_task` — Create change_task linked to parent change
  - [ ] `sn_submit_change_for_approval` — Set state to appropriate approval state
  - [ ] `sn_approve_change` — Update sysapproval_approver record
  - [ ] `sn_reject_change` — Reject via sysapproval_approver
  - [ ] `sn_add_change_comment` — Customer-visible comment
  - [ ] `sn_add_change_work_notes` — Internal work notes

## Phase 13 — Service Catalog Tools (12 tools)

- [x] `src/tools/catalog.ts`
  - [ ] `sn_list_catalogs` — List sc_catalog records
  - [ ] `sn_list_catalog_items` — List sc_cat_item with category filter
  - [ ] `sn_get_catalog_item` — Get item details + variables
  - [ ] `sn_update_catalog_item` — Update item fields
  - [ ] `sn_list_catalog_categories` — List sc_category records
  - [ ] `sn_create_catalog_category` — Create category with title, parent, catalog
  - [ ] `sn_update_catalog_category` — Update category
  - [ ] `sn_move_catalog_items` — Move items between categories
  - [ ] `sn_create_catalog_variable` — Create item_option_new record (variable types: string, integer, boolean, reference, select, multi_select, etc.)
  - [ ] `sn_list_catalog_variables` — List variables for a catalog item
  - [ ] `sn_update_catalog_variable` — Update variable properties
  - [ ] `sn_get_catalog_recommendations` — Basic optimization analysis

## Phase 14 — Knowledge Base Tools (8 tools)

- [x] `src/tools/knowledge.ts`
  - [ ] `sn_list_knowledge_bases` — List kb_knowledge_base records
  - [ ] `sn_create_knowledge_base` — Create a knowledge base
  - [ ] `sn_create_kb_category` — Create kb_category record
  - [ ] `sn_list_articles` — List kb_knowledge with filters (kb, category, workflow_state)
  - [ ] `sn_get_article` — Get article by sys_id or number
  - [ ] `sn_create_article` — Create with title, text, kb_category, kb_knowledge_base
  - [ ] `sn_update_article` — Update article fields
  - [ ] `sn_publish_article` — Set workflow_state to published

## Phase 15 — Workflow Management Tools (5 tools)

- [x] `src/tools/workflows.ts`
  - [ ] `sn_list_workflows` — List wf_workflow records
  - [ ] `sn_get_workflow` — Get workflow with activities (wf_activity)
  - [ ] `sn_create_workflow` — Create wf_workflow record
  - [ ] `sn_update_workflow` — Update workflow
  - [ ] `sn_delete_workflow` — Delete workflow

## Phase 16 — Script Include Tools (5 tools)

- [x] `src/tools/scripts.ts`
  - [ ] `sn_list_script_includes` — List sys_script_include with filters
  - [ ] `sn_get_script_include` — Get script include by sys_id or name
  - [ ] `sn_create_script_include` — Create with name, script, api_name, active, accessible_from
  - [ ] `sn_update_script_include` — Update (commonly used to push script content)
  - [ ] `sn_delete_script_include` — Delete

## Phase 17 — Update Set / Changeset Tools (7 tools)

- [x] `src/tools/changesets.ts`
  - [ ] `sn_list_update_sets` — List sys_update_set with state filter
  - [ ] `sn_get_update_set` — Get details including sys_update_xml records
  - [ ] `sn_create_update_set` — Create with name, description, application
  - [ ] `sn_update_update_set` — Update fields
  - [ ] `sn_set_current_update_set` — Set as current (user preference)
  - [ ] `sn_commit_update_set` — Set state to complete
  - [ ] `sn_add_to_update_set` — Add record to update set

## Phase 18 — Agile Management Tools (12 tools)

- [x] `src/tools/agile.ts`
  - [ ] `sn_list_stories` — List rm_story records
  - [ ] `sn_create_story` — Create user story
  - [ ] `sn_update_story` — Update story
  - [ ] `sn_list_epics` — List rm_epic records
  - [ ] `sn_create_epic` — Create epic
  - [ ] `sn_update_epic` — Update epic
  - [ ] `sn_list_scrum_tasks` — List rm_scrum_task records
  - [ ] `sn_create_scrum_task` — Create scrum task
  - [ ] `sn_update_scrum_task` — Update scrum task
  - [ ] `sn_list_projects` — List pm_project records
  - [ ] `sn_create_project` — Create project
  - [ ] `sn_update_project` — Update project

## Phase 19 — CMDB Tools (5 tools)

- [x] `src/tools/cmdb.ts`
  - [ ] `sn_list_ci` — List cmdb_ci (or subclasses like cmdb_ci_server, cmdb_ci_computer)
  - [ ] `sn_get_ci` — Get CI details
  - [ ] `sn_create_ci` — Create CI
  - [ ] `sn_list_ci_relationships` — List cmdb_rel_ci records
  - [ ] `sn_create_ci_relationship` — Create relationship between CIs

## Phase 20 — Schema Discovery Tools (3 tools)

> Inspired by Happy-Technologies — runtime table introspection

- [x] `src/tools/schema.ts`
  - [ ] `sn_get_table_schema` — GET `/api/now/table/sys_dictionary?sysparm_query=name={table}` → returns field definitions, types, max_length, reference targets
  - [ ] `sn_discover_table` — Full discovery: fields + relationships + parent table hierarchy (uses sys_db_object + sys_dictionary)
  - [ ] `sn_list_tables` — List available tables from sys_db_object

## Phase 21 — Natural Language Search (1 tool)

> Inspired by Happy-Technologies + michaelbuckner — translates plain English to encoded queries

- [x] `src/tools/search.ts`
  - [ ] `sn_natural_language_search` — Pattern matching to convert NL → encoded query
    - "high priority incidents assigned to me" → `priority=1^assigned_to=javascript:gs.getUserID()`
    - "open problems from network team" → `state!=7^assignment_group.name=Network`
    - "emergency changes created this week" → `type=emergency^sys_created_onONThis week@javascript:gs.beginningOfThisWeek()@javascript:gs.endOfThisWeek()`
    - Support 15+ common query patterns based on sn-11ty operator docs

## Phase 22 — Batch Operations (2 tools)

> Inspired by Happy-Technologies — parallel bulk operations

- [x] `src/tools/batch.ts`
  - [ ] `sn_batch_create` — Create multiple records across tables in parallel
  - [ ] `sn_batch_update` — Update multiple records across tables in parallel

## Phase 23 — MCP Resources (read-only URIs)

> Inspired by michaelbuckner + Happy-Technologies

- [x] `src/resources/index.ts`
  - [ ] `servicenow://incidents` — Recent incidents (last 20)
  - [ ] `servicenow://incidents/{number}` — Specific incident by number
  - [ ] `servicenow://users` — Active user list
  - [ ] `servicenow://knowledge` — Recent knowledge articles
  - [ ] `servicenow://tables` — Available table list
  - [ ] `servicenow://tables/{table}` — Recent records from any table
  - [ ] `servicenow://schema/{table}` — Table schema/field definitions

## Phase 24 — Tool Packages System

> Inspired by echelon-ai-labs — role-based tool subsets

- [x] `src/packages/definitions.ts` — Package definitions
  - `full` — all tools (default)
  - `service_desk` — incidents, comments, work_notes, users, knowledge lookup
  - `change_coordinator` — changes, tasks, approvals
  - `catalog_builder` — catalog items, categories, variables
  - `knowledge_author` — KB bases, categories, articles
  - `platform_developer` — scripts, workflows, update sets, schema discovery
  - `system_admin` — users, groups, tables, schema
  - `agile` — stories, epics, tasks, projects
- [x] `src/packages/index.ts` — Package loader (reads `SN_TOOL_PACKAGE` env, filters tool registration)

## Phase 25 — Streamable HTTP Transport

- [x] `src/http.ts` — HTTP entry point using Bun.serve()
  - MCP SDK's `StreamableHTTPServerTransport`
  - Health check endpoint (`/health`)
  - MCP endpoint (`/mcp`)

---

## Phase 26 — Tests

- [x] `tests/mocks/servicenow.ts` — Mock SN API responses (incident, user, change, etc.)
- [x] `tests/auth/basic.test.ts` — Basic auth header generation
- [x] `tests/auth/oauth.test.ts` — OAuth token fetch, caching, refresh
- [x] `tests/client/client.test.ts` — Client methods, error handling, pagination
- [x] `tests/tools/tables.test.ts` — Generic CRUD tools
- [x] `tests/tools/incidents.test.ts` — Incident tools
- [x] `tests/tools/users.test.ts` — User/group tools
- [x] `tests/tools/changes.test.ts` — Change management tools
- [x] `tests/tools/catalog.test.ts` — Catalog tools
- [x] `tests/tools/knowledge.test.ts` — Knowledge tools
- [x] `tests/tools/schema.test.ts` — Schema discovery tools
- [x] `tests/utils/query.test.ts` — Encoded query builder

## Phase 27 — Documentation & Polish

- [x] `README.md` — Full docs with setup, config, tool list, examples
- [x] `config/servicenow-config.example.json` — Config template
- [x] Review all tool descriptions for LLM clarity
- [x] Verify bun build & run

---

## Phase 28 — Multi-Instance Support

> Inspired by Happy-Technologies-LLC/mcp-servicenow-nodejs, but using stateless per-call instance parameter instead of mutable state switching.

- [x] **Config** — Extended `config.ts` with `InstanceSchema`, `InstancesFileSchema`, JSON config file loading (`config/servicenow-instances.json`), env var fallback for single-instance backward compat
- [x] **Auth refactor** — Changed `createAuthProvider(instanceUrl, auth)` for per-instance auth (basic or OAuth independently per instance)
- [x] **InstanceRegistry** — `src/client/registry.ts`: `resolve(instanceName?)`, `listInstances()`, `getInstanceInfo()`, `getDefaultName()`, immutable after construction
- [x] **Server wiring** — `server.ts` builds `InstanceRegistry` from `config.instances`, passes to all tool modules and resources. Version bumped to 0.2.0
- [x] **Tool refactor** — All 14 tool modules updated: `instance` Zod param in every tool's inputSchema, `registry.resolve(instance)` per-call
- [x] **Instance tools** — `src/tools/instances.ts`: `sn_list_instances`, `sn_instance_info` (always available regardless of package)
- [x] **Resources** — `resources/index.ts` updated to use `InstanceRegistry` (default instance for all resources)
- [x] **Tests** — Updated all test files: `createMockRegistry()` helper, registry tests, instance tool tests, updated config/server/auth/tool tests for new shapes
- [x] **Docs** — Updated README.md, todo.md with multi-instance documentation
- [x] **Config simplification** — Removed all env var configuration (.env, SERVICENOW_*, SN_*). Single JSON config file is the only config source. Added `--config <path>` CLI argument. Deleted `.env.example`. Renamed config file to `servicenow-config.json`. Server-level settings (toolPackage, debug, http) moved into the JSON config file. Config auto-discovers `config/servicenow-config.json` or `servicenow-config.json`.

---

## Architecture

```
servicenow-mcp-server/
├── src/
│   ├── index.ts                         # stdio entry point
│   ├── http.ts                          # Streamable HTTP entry point
│   ├── server.ts                        # MCP server setup, tool/resource registration
│   ├── config.ts                        # Multi-instance config (JSON file + env var fallback)
│   │
│   ├── auth/
│   │   ├── index.ts                     # Auth provider factory (per-instance)
│   │   ├── basic.ts                     # Basic auth (Base64)
│   │   ├── oauth.ts                     # OAuth 2.0 (client creds, auto-refresh)
│   │   └── types.ts                     # AuthProvider interface
│   │
│   ├── client/
│   │   ├── index.ts                     # ServiceNow REST client (fetch wrapper)
│   │   ├── registry.ts                  # InstanceRegistry — maps names → clients
│   │   ├── errors.ts                    # SN-specific error handling
│   │   └── types.ts                     # API response/pagination types
│   │
│   ├── tools/
│   │   ├── instances.ts                 # Instance management (list/info, always available)
│   │   ├── tables.ts                    # Generic Table API CRUD (any table)
│   │   ├── incidents.ts                 # Incident management + convenience
│   │   ├── changes.ts                   # Change requests + tasks + approvals
│   │   ├── users.ts                     # Users, groups, members
│   │   ├── catalog.ts                   # Service catalog items/categories/variables
│   │   ├── knowledge.ts                 # Knowledge bases, categories, articles
│   │   ├── workflows.ts                 # Workflows + orchestration (version/activities/transitions/publish)
│   │   ├── scripts.ts                   # Script includes
│   │   ├── changesets.ts                # Update sets / changesets
│   │   ├── agile.ts                     # Stories, epics, scrum tasks, projects
│   │   ├── cmdb.ts                      # CMDB CIs + relationships
│   │   ├── schema.ts                    # Schema discovery / table introspection
│   │   ├── search.ts                    # Natural language search
│   │   ├── batch.ts                     # Batch create/update
│   │   ├── background-scripts.ts        # Background script execution via sys_trigger
│   │   ├── platform-scripts.ts          # Business rules, client scripts, UI policies/actions/scripts
│   │   ├── scripted-rest.ts             # Scripted REST API definitions + operations
│   │   ├── widgets.ts                   # Service Portal widgets (sp_widget)
│   │   ├── ui-pages.ts                  # UI pages (sys_ui_page)
│   │   ├── flows.ts                     # Flow Designer (sys_hub_flow + related tables)
│   │   ├── app-scope.ts                 # Application scope management
│   │   └── script-sync.ts              # Script sync / local dev workflow
│   │
│   ├── resources/
│   │   └── index.ts                     # servicenow:// URI resources (default instance)
│   │
│   ├── packages/
│   │   ├── index.ts                     # Package loader
│   │   └── definitions.ts              # Role-based package definitions
│   │
│   └── utils/
│       ├── logger.ts                    # stderr-safe logger
│       └── query.ts                     # Encoded query builder (all SN operators)
│
├── config/
│   └── servicenow-instances.example.json  # Multi-instance config template
│
├── tests/
│   ├── mocks/index.ts                   # Mock client + mock registry
│   ├── auth/
│   ├── client/
│   ├── tools/
│   └── utils/
│
├── todo.md                              # ← You are here
├── package.json
├── tsconfig.json
├── .gitignore
└── README.md
```

## Tool Count Summary

| Module | Tools | Table(s) |
|--------|-------|----------|
| Instance Management | 2 | — (always available) |
| Generic Table API | 5 | any |
| Incidents | 7 | incident |
| Users & Groups | 9 | sys_user, sys_user_group, sys_user_grmember |
| Change Management | 10 | change_request, change_task, sysapproval_approver |
| Service Catalog | 12 | sc_catalog, sc_cat_item, sc_category, item_option_new |
| Knowledge Base | 8 | kb_knowledge_base, kb_category, kb_knowledge |
| Workflows | 9 | wf_workflow, wf_workflow_version, wf_activity, wf_transition, wf_condition |
| Script Includes | 5 | sys_script_include |
| Update Sets | 7 | sys_update_set, sys_update_xml |
| Agile | 12 | rm_story, rm_epic, rm_scrum_task, pm_project |
| CMDB | 5 | cmdb_ci, cmdb_rel_ci |
| Schema Discovery | 3 | sys_dictionary, sys_db_object |
| NL Search | 1 | any |
| Batch Operations | 2 | any |
| Background Scripts | 2 | sys_trigger |
| Platform Scripts | 25 | sys_script, sys_script_client, sys_ui_policy, sys_ui_action, sys_ui_script |
| Scripted REST APIs | 7 | sys_ws_definition, sys_ws_operation |
| Widgets | 5 | sp_widget |
| UI Pages | 5 | sys_ui_page |
| Flow Designer | 6 | sys_hub_flow, sys_hub_flow_logic, sys_hub_flow_variable, sys_hub_flow_stage |
| App Scope | 2 | sys_scope, sys_user_preference |
| Script Sync | 3 | — (local file system + any script table) |
| **Total** | **151** | |

## MCP Resources: 7

| URI | Description |
|-----|-------------|
| `servicenow://incidents` | Recent incidents |
| `servicenow://incidents/{number}` | Specific incident by number |
| `servicenow://users` | Active users |
| `servicenow://knowledge` | Knowledge articles |
| `servicenow://tables` | Available tables |
| `servicenow://tables/{table}` | Records from any table |
| `servicenow://schema/{table}` | Table schema |

## Key Insights from sn-11ty Knowledge Base

### Encoded Query Operators (for query builder)
`=` `!=` `<` `<=` `>` `>=` `LIKE` `NOT LIKE` `STARTSWITH` `ENDSWITH` `IN` `NOT IN` `ISEMPTY` `ISNOTEMPTY` `BETWEEN` `SAMEAS` `NSAMEAS` `VALCHANGES` `CHANGESFROM` `CHANGESTO` `GT_FIELD` `LT_FIELD` `MORETHAN` `LESSTHAN` `ANYTHING` `RELATIVEGE` `RELATIVELE` `DATEPART` `DYNAMIC`

### Logical Operators
`^` (AND) `^OR` (OR) `^NQ` (new query) `ORDERBY` `ORDERBYDESC`

### Key ServiceNow API Patterns
- Table API: `GET/POST/PUT/PATCH/DELETE /api/now/table/{table_name}`
- Query params: `sysparm_query`, `sysparm_fields`, `sysparm_limit`, `sysparm_offset`, `sysparm_display_value`, `sysparm_exclude_reference_link`, `sysparm_suppress_pagination_header`
- Response wrapper: `{ "result": [ ... ] }` or `{ "result": { ... } }`
- Auth: Basic (Base64), OAuth 2.0 (POST `/oauth_token.do`)
- sys_id: 32-char GUID primary key on every record
- Display value vs stored value: `sysparm_display_value=true|false|all`

### Important SN Tables (from sn-11ty)
- **Core ITSM:** incident, problem, change_request, change_task, sc_request, sc_req_item, sysapproval_approver
- **Service Catalog:** sc_catalog, sc_cat_item, sc_cat_item_guide, sc_category, item_option_new, catalog_ui_policy
- **Users:** sys_user, sys_user_group, sys_user_grmember, sys_user_role
- **CMDB:** cmdb_ci, cmdb_ci_server, cmdb_ci_computer, cmdb_rel_ci, alm_asset
- **Platform Dev:** sys_script, sys_script_include, sys_script_client, sys_ui_policy, sys_ui_action
- **Update Sets:** sys_update_set, sys_update_xml
- **Workflows:** wf_workflow, wf_activity, wf_transition, wf_context, wf_executing, wf_history
- **Flow Designer:** sys_hub_flow, sys_hub_flow_base, sys_hub_flow_logic, sys_hub_flow_variable
- **Integration:** sys_rest_message, sys_ws_definition, sys_import_set, sys_transform_map
- **Knowledge:** kb_knowledge_base, kb_category, kb_knowledge
- **Agile:** rm_story, rm_epic, rm_scrum_task, pm_project

### REST Error Codes to Handle
- 400 Bad Request (sn_ws_err.BadRequestError)
- 401 Unauthorized
- 403 Forbidden
- 404 Not Found (sn_ws_err.NotFoundError)
- 406 Not Acceptable (sn_ws_err.NotAcceptableError)
- 409 Conflict (sn_ws_err.ConflictError)
- 415 Unsupported Media Type (sn_ws_err.UnsupportedMediaTypeError)
- 429 Rate Limited

## Dependencies

```json
{
  "@modelcontextprotocol/sdk": "latest",
  "zod": "^3.x"
}
```

Zero other deps. Bun provides native fetch, native test runner, native TypeScript.

---

## Gap Analysis & Future Phases

> Compared against: Happy-Technologies-LLC/mcp-servicenow-nodejs v2.1.5

### Where We're Ahead
- **OAuth 2.0** support (they only have basic auth)
- **Stateless multi-instance** (per-call `instance` param vs their mutable state switching)
- **Dedicated domain tools** (93 tools vs their 44 generic + auto-gen wrappers)
- **Tool packages** (8 role-based subsets; they have none)
- **Streamable HTTP** transport (modern MCP protocol; they only have legacy SSE)
- **Change Management** (10 dedicated tools; they use generic)
- **Service Catalog** (12 dedicated tools; they use generic)
- **Users & Groups** (9 dedicated tools; they use generic)
- **Knowledge Base** (8 dedicated tools; they use generic)
- **Agile/PPM** (12 dedicated tools; they have none)
- **CMDB** (5 dedicated tools; they use generic)

### Where They're Ahead
- **Background script execution** via `sys_trigger` — we have nothing
- **Platform script types** — they have `sys_script`, `sys_script_client`, etc. via generic; we only have `sys_script_include`
- **Workflow orchestration** — they build workflow+version+activities+transitions+publish in one call; we have basic CRUD
- **Flow Designer** — they read `sys_hub_flow` tables; we have nothing
- **Script sync / local dev** — sync files to/from SN with watch mode; we have nothing
- **Application scope management** — switch scope via UI API; we have nothing
- **Progress reporting** — MCP `notifications/progress` for batch ops; we have nothing
- **Catalog validation** — validate catalog item config; we have nothing

---

## Phase A — Background Script Execution (2 tools)

> Execute server-side JavaScript via `sys_trigger` mechanism — critical for platform development.

- [x] `src/tools/background-scripts.ts`
  - [x] `sn_execute_background_script` — Create one-shot `sys_trigger` (trigger_type=0, state=0, next_action=now+1s), wrap script in try/finally self-delete. Falls back to local fix script.
  - [x] `sn_create_fix_script` — Create local `.js` file in `scripts/` for manual execution in SN's Scripts-Background UI.
- [x] Register module in `server.ts` with key `background_scripts`
- [x] Add to `platform_developer` and `full` packages

## Phase B — Platform Script Types (25 tools, 5 per type)

> CRUD for all major ServiceNow scripting record types.

- [x] `src/tools/platform-scripts.ts`
  - Business Rules (`sys_script`): list, get, create, update, delete
    - Key fields: name, table, when (before/after/async/display), order, script, condition, active, filter_condition
  - Client Scripts (`sys_script_client`): list, get, create, update, delete
    - Key fields: name, table, type (onChange/onLoad/onSubmit/onCellEdit), script, field_name, active
  - UI Policies (`sys_ui_policy`): list, get, create, update, delete
    - Key fields: table, short_description, conditions, script_true, script_false, on_load, reverse_if_false, active
  - UI Actions (`sys_ui_action`): list, get, create, update, delete
    - Key fields: name, table, script, condition, active, form_button, form_link, list_button, list_link, order
  - UI Scripts (`sys_ui_script`): list, get, create, update, delete
    - Key fields: name, script, active, description, global
- [x] Register module in `server.ts` with key `platform_scripts`
- [x] Add to `platform_developer` and `full` packages

## Phase C — Enhanced Workflow Orchestration (4 new tools)

> One-call workflow building: base → version → activities → transitions → publish.

- [x] Enhance `src/tools/workflows.ts`
  - [x] `sn_create_workflow_full` — Orchestrate: wf_workflow → wf_workflow_version → wf_activity[] → wf_transition[] → optional publish. Activities referenced by name. Returns full created structure.
  - [x] `sn_create_workflow_activity` — Add activity to existing workflow version
  - [x] `sn_create_workflow_transition` — Create transition between activities with optional wf_condition
  - [x] `sn_publish_workflow` — Set start activity + published=true on a workflow version

## Phase D — Scripted REST API Management (7 tools)

> Full CRUD for Scripted REST APIs and their resources/operations.

- [x] `src/tools/scripted-rest.ts`
  - [x] `sn_list_scripted_rest_apis` — List `sys_ws_definition` records
  - [x] `sn_get_scripted_rest_api` — Get API + all `sys_ws_operation` records in parallel
  - [x] `sn_create_scripted_rest_api` — Create API definition (name, namespace, base_uri, active)
  - [x] `sn_update_scripted_rest_api` — Update API definition
  - [x] `sn_create_rest_resource` — Create `sys_ws_operation` (method, path, script, produces, consumes)
  - [x] `sn_update_rest_resource` — Update operation
  - [x] `sn_delete_rest_resource` — Delete operation
- [x] Register module in `server.ts` with key `scripted_rest`
- [x] Add to `platform_developer`, `full` packages. Add to new `integration_developer` package.

## Phase E — Service Portal Widgets (5 tools)

- [x] `src/tools/widgets.ts`
  - [x] `sn_list_widgets` — List `sp_widget` with name/category filters
  - [x] `sn_get_widget` — Get widget with all script bodies (template, css, client_script, server_script, link, demo_data, option_schema)
  - [x] `sn_create_widget` — Create widget with template, css, client_script, server_script, link
  - [x] `sn_update_widget` — Update (push script changes)
  - [x] `sn_delete_widget` — Delete
- [x] Register module in `server.ts` with key `widgets`
- [x] Add to `platform_developer`, `full` packages. Add to new `portal_developer` package.

## Phase F — UI Pages (5 tools)

- [x] `src/tools/ui-pages.ts`
  - [x] `sn_list_ui_pages` — List `sys_ui_page` records
  - [x] `sn_get_ui_page` — Get with html, client_script, processing_script
  - [x] `sn_create_ui_page` — Create page
  - [x] `sn_update_ui_page` — Update
  - [x] `sn_delete_ui_page` — Delete
- [x] Register module in `server.ts` with key `ui_pages`
- [x] Add to `platform_developer`, `full`, `portal_developer` packages.

## Phase G — Flow Designer (6 tools)

> Read-only + basic create. Logic blocks can't be created via REST (SN limitation).

- [x] `src/tools/flows.ts`
  - [x] `sn_list_flows` — Query `sys_hub_flow`
  - [x] `sn_get_flow` — Get flow + logic blocks + variables in parallel
  - [x] `sn_create_flow` — Create basic flow definition (logic blocks must be added in UI)
  - [x] `sn_list_flow_variables` — List `sys_hub_flow_variable` for a flow
  - [x] `sn_create_flow_variable` — Create flow input/output variable
  - [x] `sn_list_flow_stages` — List `sys_hub_flow_stage`
- [x] Register module in `server.ts` with key `flows`
- [x] Add to `platform_developer` and `full` packages.

## Phase H — Application Scope Management (2 tools)

- [x] `src/tools/app-scope.ts`
  - [x] `sn_get_current_application` — Get current scope (concoursepicker API with user_preference fallback)
  - [x] `sn_set_application_scope` — Switch scope by sys_id or scope string. Uses concoursepicker API, falls back to user_preference.
- [x] Register module in `server.ts` with key `app_scope`
- [x] Add to `platform_developer`, `system_admin`, `full` packages.

## Phase I — Script Sync / Local Dev (3 tools)

- [x] `src/tools/script-sync.ts`
  - [x] `sn_sync_script_to_local` — Download script record to local file(s). Multi-field records (widgets, UI pages) create one file per field in a subdirectory.
  - [x] `sn_sync_local_to_script` — Upload local file to SN record. Auto-detects target from `.sn-sync.json` manifest.
  - [x] `sn_watch_and_sync` — Watch file for changes (polling), auto-sync on save. Runs in background.
- [x] `.sn-sync.json` manifest for mapping local paths to SN sys_ids + table + field
- [x] Register module in `server.ts` with key `script_sync`
- [x] Add to `platform_developer`, `portal_developer`, `full` packages.

## Phase J — Progress Reporting (infrastructure)

- [ ] Wire MCP SDK `notifications/progress` into batch, workflow orchestration, script sync
- [ ] No new tools, just infra changes

## Phase K — Problem Management (7 tools)

- [ ] `src/tools/problems.ts` — Same pattern as incidents
  - list, get, create, update, add_comment, add_work_notes, close
- [ ] Tables: `problem`, `problem_task`

## Phase L — Service Request / RITM (6 tools)

- [ ] `src/tools/requests.ts`
  - list_requests, get_request, list_request_items, get_request_item, update_request_item, submit_catalog_request

## Phase M — Catalog Validation (1 tool)

- [ ] Add `sn_validate_catalog_item` to `src/tools/catalog.ts`

## Phase N — Extras (6 tools)

- [ ] Attachments: upload, download via `/api/now/attachment/file`
- [ ] Aggregation: `sn_aggregate_table` via `/api/now/stats/{table}`
- [ ] Batch delete: `sn_batch_delete` in batch.ts
- [ ] Import sets: `sn_create_import_set`, `sn_run_transform`

## Phase O — Smart Name/Number Resolution (utility + tool enhancements) ⚡ HIGH PRIORITY

> Their biggest UX advantage: tools auto-resolve human-readable names ("Beth Anglin") and record
> numbers ("INC0010045") to sys_ids. Our tools require raw sys_ids, which forces callers to do
> manual lookups. This phase adds a resolution utility layer and wires it into existing tools.

- [x] `src/utils/resolve.ts` — Resolution utility module
  - [x] `resolveUserIdentifier(client, value)` — sys_id pass-through, user_name exact, email exact, name LIKE fuzzy. Ambiguous multi-match throws with list.
  - [x] `resolveRecordIdentifier(client, value, table?)` — sys_id pass-through, INC/CHG/PRB/RITM/REQ/KB/STRY/CTASK/PTASK/STASK prefix mapping, tableHint fallback.
  - [x] `resolveGroupIdentifier(client, value)` — sys_id pass-through, exact name, LIKE fuzzy. Ambiguous multi-match throws with list.
  - [x] `resolveOptionalUser`, `resolveOptionalGroup`, `resolveOptionalRecord` — convenience wrappers (undefined pass-through)
- [x] Wire resolution into existing incident tools:
  - [x] `sn_create_incident` — resolve `assigned_to`, `caller_id`, `assignment_group`
  - [x] `sn_update_incident` — resolve record identifier + `assigned_to`, `caller_id`, `assignment_group` in data
  - [x] `sn_add_incident_comment` / `sn_add_incident_work_notes` — accept INC number or sys_id
  - [x] `sn_resolve_incident` / `sn_close_incident` — accept INC number or sys_id
- [x] Wire resolution into existing change tools:
  - [x] `sn_create_change_request` — resolve `assigned_to`, `assignment_group`
  - [x] `sn_update_change_request` — resolve CHG number + `assigned_to`, `requested_by`, `assignment_group` in data
  - [x] `sn_add_change_task` — resolve CHG number + `assigned_to`, `assignment_group`
  - [x] `sn_submit_change_for_approval` / `sn_approve_change` / `sn_reject_change` — accept CHG number or sys_id
  - [x] `sn_add_change_comment` / `sn_add_change_work_notes` — accept CHG number or sys_id
- [x] Wire resolution into existing user tools:
  - [x] `sn_add_group_members` — accept user names/emails or sys_ids, group name or sys_id
  - [x] `sn_remove_group_members` — accept user names/emails or sys_ids, group name or sys_id
- [x] Add tests for the resolution utility in `tests/utils/resolve.test.ts` (33 tests)

## Phase P — Update Set Move & Clone (2 tools)

> Their `SN-Move-Records-To-Update-Set` and `SN-Clone-Update-Set` tools. Useful for developers
> reorganizing work across update sets or duplicating a set as a starting point.

- [x] Add to `src/tools/changesets.ts`:
  - [x] `sn_move_to_update_set` — Move records by sys_ids, source update set, or time range. Reports moved/failed counts.
  - [x] `sn_clone_update_set` — Clone an update set (create new set + copy all `sys_update_xml` records with name/type/target_name/payload/category/action)
- [x] Register in packages: `platform_developer`, `system_admin`, `full` (added `changesets` to `system_admin`)

## Phase Q — Update Set Inspection (enhancement to existing tool)

> Their inspection groups `sys_update_xml` records by type and shows component breakdown.
> Our `sn_get_update_set` just returns raw records. This enriches the response.

- [x] Enhance `sn_get_update_set` in `src/tools/changesets.ts`:
  - [x] After fetching `sys_update_xml` records, group them by `type` field
  - [x] Return structured breakdown: `{ summary: { total_records, types, by_type }, components: { "Business Rule": [...], ... } }`
  - [x] Include `action` (INSERT/UPDATE/DELETE) in each component entry

## Phase R — Static Table Metadata Cache

> Their `comprehensive-table-definitions.json` has 94 tables with label, key_field, display_field,
> required_fields. This avoids hitting the live API for common schema lookups and enables
> better tool descriptions and validation.

- [x] `src/config/table-definitions.json` — Static metadata for 100 common SN tables
  - [x] Fields per entry: `label`, `key_field`, `display_field`, `required_fields[]`, `common_fields[]`
  - [x] Covers: ITSM (incident, change_request, problem, sc_request, sc_req_item, sc_task, task), users (sys_user, sys_user_group, sys_user_role, sys_user_grmember, sys_user_has_role), CMDB (cmdb_ci, cmdb_ci_server, cmdb_ci_service, cmdb_ci_computer, cmdb_ci_database, cmdb_ci_app_server, cmdb_rel_ci), knowledge (kb_knowledge, kb_knowledge_base, kb_category), catalog (sc_catalog, sc_cat_item, sc_cat_item_category, item_option_new, sc_cat_item_producer), platform scripts (sys_script, sys_script_include, sys_ui_policy, sys_ui_action, sys_ui_script, sys_client_script, sys_ui_page), update sets (sys_update_set, sys_update_xml), workflows (wf_workflow, wf_workflow_version, wf_activity), flows (sys_hub_flow, sys_hub_flow_variable, sys_hub_flow_stage), REST (sys_web_service, sys_ws_operation, sys_rest_message, sys_rest_message_fn), widgets (sp_widget, sp_portal, sp_page, sp_instance, sp_header_footer), agile (rm_story, rm_epic, rm_sprint, rm_scrum_task), projects (pm_project, pm_project_task), approvals, emails, events, imports, security ACLs, assets, reports, dashboards, and more
- [x] `src/utils/table-metadata.ts` — Loader + lookup functions
  - [x] `getTableMetadata(tableName): TableDefinition | undefined`
  - [x] `getDisplayField(tableName): string` — returns display_field or falls back to `"name"`
  - [x] `getKeyField(tableName): string` — returns key_field or falls back to `"sys_id"`
  - [x] `getRequiredFields(tableName): string[]`
  - [x] `getCommonFields(tableName): string[]`
  - [x] `isKnownTable(tableName): boolean`
  - [x] `listKnownTables(): string[]`
  - [x] `knownTableCount(): number`
- [x] Wire into `src/tools/tables.ts` — `sn_query_table` auto-uses cached common_fields when caller omits `fields` param; includes `table_label` and `display_field` in response
- [x] Wire into `src/tools/schema.ts` — `sn_get_table_schema`, `sn_discover_table` include `cached_metadata` in response; `sn_list_tables` annotates each table with `has_cached_metadata`
- [x] Added `resolveJsonModule` to tsconfig.json for JSON imports
- [x] Tests in `tests/utils/table-metadata.test.ts` (17 tests)

## Phase S — Enhanced Schema Discovery (enhancements to existing tools)

> Their `SN-Discover-Table-Schema` optionally fetches choice lists, UI policies, business rules,
> and field constraints alongside basic dictionary info. Our schema tools only query
> `sys_db_object` + `sys_dictionary` + reference extraction.

- [x] Enhance `sn_get_table_schema` in `src/tools/schema.ts`:
  - [x] Add optional `include_choices` (boolean) — fetch `sys_choice` records grouped by field
  - [x] Add optional `include_policies` (boolean) — fetch `sys_data_policy2` records for the table
  - [x] Add optional `include_business_rules` (boolean) — fetch `sys_script` records for the table
  - [x] Add optional `include_constraints` (boolean) — fetch `sys_index` constraint info
  - [x] All optional params default to `false` to keep current behavior unchanged
  - [x] All enrichment queries run in parallel with the base dictionary fetch
- [x] New tool `sn_explain_field` in `src/tools/schema.ts`:
  - [x] Input: `table`, `field`
  - [x] Returns: field type, label, max_length, mandatory, read_only, default_value, reference target, calculation, dependent_on_field, display flag, help/hint text, choice list
  - [x] Query: `sys_dictionary` + `sys_documentation` + `sys_choice` in parallel
  - [x] Includes cached_hints from static table metadata (is_required, is_common_field, is_display_field)
- [x] Tests: 16 tests in `tests/tools/schema.test.ts`

## Phase T — Progress Reporting (replaces Phase J)

> Wire MCP SDK `notifications/progress` for long-running operations. Their server reports
> progress with adaptive frequency for batch/workflow/move operations.

- [x] `src/utils/progress.ts` — Progress reporting utility
  - [x] `createProgressReporter(extra, total)` — returns `{ advance(n?, message?), complete(message?), fail(msg) }`
  - [x] Adaptive throttling: skip notifications if < 100ms since last one (avoid flooding)
  - [x] `force` flag on complete/fail to bypass throttling
  - [x] No-op when client doesn't provide `progressToken` (safe to call unconditionally)
  - [x] Wire into `sn_batch_update` / `sn_batch_create` in `src/tools/batch.ts`
  - [x] Wire into `sn_move_to_update_set` and `sn_clone_update_set` in `src/tools/changesets.ts`
  - [x] Wire into `sn_sync_script_to_local` in `src/tools/script-sync.ts`
- [x] Tests: 19 tests in `tests/utils/progress.test.ts`

---

## Updated Tool Count Projection

| Phase | New Tools | Running Total | Status |
|-------|-----------|---------------|--------|
| Original | 93 | 93 | Done |
| A: Background Scripts | +2 | 95 | Done |
| B: Platform Scripts | +25 | 120 | Done |
| C: Enhanced Workflows | +4 | 124 | Done |
| D: Scripted REST APIs | +7 | 131 | Done |
| E: Widgets | +5 | 136 | Done |
| F: UI Pages | +5 | 141 | Done |
| G: Flow Designer | +6 | 147 | Done |
| H: App Scope | +2 | 149 | Done |
| I: Script Sync | +3 | 151 | Done |
| J: Progress Reporting | — | — | Replaced by Phase T |
| O: Smart Resolution | +0 (enhancements) | 151 | **Done** |
| P: Update Set Move/Clone | +2 | 153 | **Done** |
| Q: Update Set Inspection | +0 (enhancement) | 153 | **Done** |
| R: Static Table Metadata | +0 (infra) | 153 | **Done** |
| S: Enhanced Schema | +1 | **154** (217 tests) | **Done** |
| T: Progress Reporting | +0 (infra) | **154** (236 tests) | **Done** |
| K: Problem Mgmt | +7 | 161 | Pending |
| L: Requests/RITM | +6 | 167 | Pending |
| M: Catalog Validation | +1 | 168 | Pending |
| N: Extras | +6 | **174** | Pending |
