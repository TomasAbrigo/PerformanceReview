/** Quote an SQL identifier (table or column name). */
export const quote = (id: string) => `"${id.replaceAll('"', '""')}"`;

/** An SQL string literal. Only for values we build ourselves (file paths). */
export const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;
