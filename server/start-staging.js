// Safe dedicated entry point: never load production .env or default DB settings.
if (process.env.SPORTSYNC_ENVIRONMENT && process.env.SPORTSYNC_ENVIRONMENT !== "staging") throw new Error("Staging entry point rejects another environment");
process.env.SPORTSYNC_ENVIRONMENT = "staging";
require("./index");
