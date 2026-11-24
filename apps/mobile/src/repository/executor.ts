export type SqlValue = string | number | null;
type Column<Row> = Extract<keyof Row, string>;

export interface Table<Row extends Record<keyof Row, SqlValue>> {
  readonly name: string;
  readonly key: readonly Column<Row>[];
  readonly schema: string;
}

export type Where<Row> = Partial<{ [K in keyof Row]: Row[K] | {
  op: ">" | "<=" | "in";
  value: Row[K] | readonly Row[K][];
} }>;
export type Select<Row> = { order?: readonly Column<Row>[]; limit?: number };

export interface Rows {
  select<Row extends Record<keyof Row, SqlValue>>(table: Table<Row>, where: Where<NoInfer<Row>>, options?: Select<NoInfer<Row>>): Promise<Row[]>;
  put<Row extends Record<keyof Row, SqlValue>>(table: Table<Row>, row: NoInfer<Row>): Promise<void>;
  update<Row extends Record<keyof Row, SqlValue>>(table: Table<Row>, where: Where<NoInfer<Row>>, patch: Partial<NoInfer<Row>>): Promise<void>;
  remove<Row extends Record<keyof Row, SqlValue>>(table: Table<Row>, where: Where<NoInfer<Row>>): Promise<void>;
}

export interface Executor {
  read<T>(work: (rows: Pick<Rows, "select">) => Promise<T>): Promise<T>;
  transaction<T>(work: (rows: Rows) => Promise<T>): Promise<T>;
}

// Every read and transaction takes its turn on the same connection. Expo's
// exclusive transaction API opens a second connection, without our cipher key.
export function serialize() {
  let tail = Promise.resolve();
  return function schedule<T>(work: () => Promise<T>): Promise<T> {
    const result = tail.then(work);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
}
