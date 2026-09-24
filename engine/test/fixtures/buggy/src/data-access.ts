/** Fixture: intentionally buggy. Review input for the engine's own tests. */

export interface QueryRunner {
  query(sql: string): Promise<unknown[]>;
}

export function findUserByEmail(runner: QueryRunner, email: string): Promise<unknown[]> {
  return runner.query(`SELECT id, email FROM users WHERE email = '${email}'`);
}
