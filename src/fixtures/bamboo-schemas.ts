/**
 * The zod schemas of the Bamboo responses live in ONE module, the one the
 * client and the adapters parse with. The fixture generator's tests validate
 * what it writes against that same module: this file only re-exports it, so
 * the generated files and the client can never disagree.
 */
export * from "../modules/bamboo-client/schemas";
