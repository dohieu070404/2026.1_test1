import * as SQLite from "expo-sqlite";

export type SqlResult = {
  rows: {
    length: number;
    item(index: number): any;
    raw(): any[];
  };
};

/** A small adapter keeps the capture/outbox domain independent of the storage SDK. */
export class SqlConnection {
  constructor(private readonly native: SQLite.SQLiteDatabase) {}

  async executeSql(
    sql: string,
    params: SQLite.SQLiteBindValue[] = [],
  ): Promise<[SqlResult]> {
    let rows: any[] = [];
    if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql)) {
      rows = await this.native.getAllAsync(sql, params);
    } else {
      await this.native.runAsync(sql, params);
    }
    return [
      {
        rows: {
          length: rows.length,
          item: (index) => rows[index],
          raw: () => rows,
        },
      },
    ];
  }
}

export async function openCaptureDatabase() {
  return new SqlConnection(await SQLite.openDatabaseAsync("smartinsole.db"));
}
