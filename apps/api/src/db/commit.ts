import type { RequestScope } from "./scope";

export interface CommandStatement {
  readonly sql: string;
  readonly params?: readonly unknown[];
}

export interface CommandInput<T> {
  readonly statements: readonly [CommandStatement, ...CommandStatement[]];
  readonly decode: (results: readonly D1Result[]) => T;
}

export interface PreparedCommand<T> {
  readonly statements: D1PreparedStatement[];
  readonly decode: CommandInput<T>["decode"];
}

// Preparation is synchronous: callers can combine statements into a single primary batch.
export function prepareCommand<T>(ctx: Pick<RequestScope, "binding">, input: CommandInput<T>): PreparedCommand<T> {
  const statements = input.statements.map(({ sql, params }) => {
    const statement = ctx.binding.prepare(sql);
    return params?.length ? statement.bind(...params) : statement;
  });
  return { statements, decode: input.decode };
}

export async function commitCommand<T>(ctx: Pick<RequestScope, "binding">, command: PreparedCommand<T>): Promise<T> {
  return command.decode(await ctx.binding.batch(command.statements));
}
