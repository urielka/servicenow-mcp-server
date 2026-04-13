import { z } from "zod";
import { readFileSync } from "fs";
import { resolve } from "path";
import { logger } from "./utils/logger.ts";

// ── Auth schemas ─────────────────────────────────────────────────────

const AuthBasicSchema = z.object({
  type: z.literal("basic"),
  username: z.string().min(1, "username is required"),
  password: z.string().min(1, "password is required"),
});

const AuthOAuthSchema = z.object({
  type: z.literal("oauth"),
  clientId: z.string().min(1, "clientId is required"),
  clientSecret: z.string().min(1, "clientSecret is required"),
  username: z.string().optional(),
  password: z.string().optional(),
});

const AuthTokenSchema = z.object({
  type: z.literal("token"),
  token: z.string().min(1, "token is required"),
});

const AuthSchema = z.discriminatedUnion("type", [
  AuthBasicSchema,
  AuthOAuthSchema,
  AuthTokenSchema,
]);

// ── Per-instance schema ──────────────────────────────────────────────

const InstanceSchema = z.object({
  name: z.string().min(1, "Instance name is required"),
  url: z
    .string()
    .url("Instance URL must be a valid URL")
    .transform((url) => url.replace(/\/+$/, "")),
  auth: AuthSchema,
  default: z.boolean().default(false),
  description: z.string().optional(),
  requestTimeoutMs: z.number().int().positive().default(30_000).describe("HTTP request timeout in milliseconds (default: 30000)"),
});

// ── Full config file schema ──────────────────────────────────────────

const ConfigFileSchema = z
  .object({
    instances: z.array(InstanceSchema).min(1, "At least one instance is required"),
    toolPackage: z.string().default("full"),
    debug: z.boolean().default(false),
    http: z
      .object({
        port: z.number().int().positive().default(3000),
        host: z.string().default("127.0.0.1"),
      })
      .default({ port: 3000, host: "127.0.0.1" }),
  })
  .refine(
    (data) => data.instances.filter((i) => i.default).length <= 1,
    "At most one instance can be marked as default"
  );

// ── Top-level config type (output of Zod parse) ─────────────────────

export const ConfigSchema = z.object({
  instances: z.array(InstanceSchema).min(1),
  toolPackage: z.string().default("full"),
  debug: z.boolean().default(false),
  http: z
    .object({
      port: z.number().int().positive().default(3000),
      host: z.string().default("127.0.0.1"),
    })
    .default({ port: 3000, host: "127.0.0.1" }),
});

export type Config = z.infer<typeof ConfigSchema>;
export type InstanceConfig = z.infer<typeof InstanceSchema>;
export type AuthBasicConfig = z.infer<typeof AuthBasicSchema>;
export type AuthOAuthConfig = z.infer<typeof AuthOAuthSchema>;
export type AuthTokenConfig = z.infer<typeof AuthTokenSchema>;
export type AuthConfig = z.infer<typeof AuthSchema>;

/**
 * Default paths to search for the config file (resolved relative to cwd).
 */
const CONFIG_FILE_PATHS = [
  "config/servicenow-config.json",
  "servicenow-config.json",
];

/**
 * Load and validate config from a JSON file.
 *
 * @param configPath  Explicit path to the config file (from --config CLI arg).
 *                    If omitted, auto-discovers from CONFIG_FILE_PATHS.
 * @returns Validated Config object
 * @throws  Error if no config file is found or if validation fails
 */
export function loadConfig(configPath?: string): Config {
  if (configPath) {
    return loadFromFile(resolve(process.cwd(), configPath), configPath);
  }

  // Auto-discover
  for (const relPath of CONFIG_FILE_PATHS) {
    const absPath = resolve(process.cwd(), relPath);
    try {
      const config = loadFromFile(absPath, relPath);
      logger.info(`Loaded config from ${relPath}`);
      return config;
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
        continue; // file not found, try next path
      }
      throw err; // re-throw parse/validation errors
    }
  }

  throw new Error(
    `No config file found. Searched:\n` +
    CONFIG_FILE_PATHS.map((p) => `  - ${p}`).join("\n") +
    `\n\nCreate config/servicenow-config.json or use --config <path>.\n` +
    `See config/servicenow-config.example.json for the template.`
  );
}

/**
 * Read, parse, and validate a single config file.
 */
function loadFromFile(absPath: string, displayPath: string): Config {
  const raw = readFileSync(absPath, "utf-8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in config file: ${displayPath}`);
  }

  const result = ConfigFileSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid config file (${displayPath}):\n${issues}`);
  }

  logger.info(`Loaded ${result.data.instances.length} instance(s) from ${displayPath}`);
  return result.data;
}
