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
    "widgets", "ui_pages", "flows", "app_scope", "script_sync",
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

  /** Platform developers — full dev toolkit */
  platform_developer: [
    "tables", "scripts", "platform_scripts", "workflows", "flows",
    "changesets", "schema", "search", "background_scripts",
    "scripted_rest", "widgets", "ui_pages", "app_scope", "script_sync",
  ],

  /** System administrators — users, groups, schema, update sets */
  system_admin: [
    "tables", "users", "schema", "search", "batch", "app_scope", "changesets",
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

  /** Portal developers — widgets, UI pages, catalog, scripts */
  portal_developer: [
    "tables", "widgets", "ui_pages", "catalog", "scripts",
    "platform_scripts", "search", "schema", "script_sync",
  ],
};
