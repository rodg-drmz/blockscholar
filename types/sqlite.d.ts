declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): {
      get(...values: (string | number)[]): Record<string, unknown> | undefined;
      all(...values: (string | number)[]): Record<string, unknown>[];
      run(...values: (string | number)[]): unknown;
    };
    close(): void;
  }
}
