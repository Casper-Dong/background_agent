import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  API_PORT: z.coerce.number().default(3001),
  API_URL: z.string().default("http://localhost:3001"),
  WEB_URL: z.string().default("http://localhost:1259"),
  API_SECRET: z.string().default("change-me-to-a-random-string"),

  POSTGRES_HOST: z.string().default("localhost"),
  POSTGRES_PORT: z.coerce.number().default(5432),
  POSTGRES_DB: z.string().default("background_agent"),
  POSTGRES_USER: z.string().default("agent"),
  POSTGRES_PASSWORD: z.string().default("agent-local-dev"),

  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().default(6379),

  GITHUB_TOKEN: z.string().default(""),
  GITHUB_OWNER: z.string().default(""),
  GITHUB_REPO: z.string().default(""),
  GITHUB_DEFAULT_BRANCH: z.string().default("main"),

  SLACK_BOT_TOKEN: z.string().default(""),
  SLACK_SIGNING_SECRET: z.string().default(""),

  AGENT_TYPE: z.enum(["claude-code", "codex", "opencode", "mock"]).optional(),
  ANTHROPIC_API_KEY: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),

  SANDBOX_IMAGE: z.string().default("background-agent-sandbox"),
  SANDBOX_TIMEOUT_SECONDS: z.coerce.number().default(1800),
  SANDBOX_MAX_ITERATIONS: z.coerce.number().default(5),
  DOCKER_SOCKET: z.string().default("/var/run/docker.sock"),

  COMMAND_ALLOWLIST: z.string().default(
    "git,node,npm,npx,pnpm,yarn,python,python3,pip,docker,docker-compose,make,cargo,go,cat,ls,echo,mkdir,cp,mv,rm,chmod,grep,find,sed,awk,head,tail,wc,sort,uniq,diff,patch,curl,wget,tar,unzip,jq"
  ),
});

const parsedEnv = envSchema.parse(process.env);

function resolveDefaultAgentType(): "claude-code" | "codex" | "opencode" | "mock" {
  // Treat "mock" as fallback-only so a leftover demo setting does not
  // silently disable real agents when API keys are configured.
  if (parsedEnv.AGENT_TYPE && parsedEnv.AGENT_TYPE !== "mock") return parsedEnv.AGENT_TYPE;
  if (parsedEnv.OPENAI_API_KEY) return "codex";
  if (parsedEnv.ANTHROPIC_API_KEY) return "claude-code";
  if (parsedEnv.AGENT_TYPE === "mock") return "mock";
  return "mock";
}

export const config = {
  ...parsedEnv,
  AGENT_TYPE: resolveDefaultAgentType(),
};

export type Config = typeof config;
