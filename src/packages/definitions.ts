/**
 * Tool package definitions.
 * Each package maps to a set of tool module keys that should be loaded.
 * The "full" package loads everything.
 */

export const TOOL_PACKAGES: Record<string, string[]> = {
  /** All tools — default */
  full: [
    "tables", "incidents", "users", "changes", "catalog",
    "knowledge", "workflows", "scripts", "changesets", "agile",
    "cmdb", "schema", "search", "batch",
    "background_scripts", "platform_scripts", "scripted_rest",
  ],

  /** Service desk agents — incidents, users, knowledge */
  service_desk: [
    "tables", "incidents", "users", "knowledge", "search",
  ],

  /** Change coordinators — change lifecycle */
  change_coordinator: [
    "tables", "changes", "users", "search",
  ],

  /** Catalog builders — catalog items, categories, variables */
  catalog_builder: [
    "tables", "catalog", "search",
  ],

  /** Knowledge authors — KB management */
  knowledge_author: [
    "tables", "knowledge", "search",
  ],

  /** Platform developers — scripts, workflows, update sets, background scripts, all script types, REST APIs */
  platform_developer: [
    "tables", "scripts", "platform_scripts", "workflows", "changesets",
    "schema", "search", "background_scripts", "scripted_rest",
  ],

  /** System administrators — users, groups, schema */
  system_admin: [
    "tables", "users", "schema", "search", "batch",
  ],

  /** Agile teams — stories, epics, tasks, projects */
  agile: [
    "tables", "agile", "users", "search",
  ],

  /** Integration developers — REST APIs, scripts, schema, batch */
  integration_developer: [
    "tables", "scripts", "platform_scripts", "scripted_rest",
    "schema", "search", "batch", "background_scripts",
  ],
};
