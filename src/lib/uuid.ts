const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `id` has the shape Postgres accepts for a uuid (guards ids taken from URLs). */
export const isUuid = (id: string): boolean => UUID.test(id);
