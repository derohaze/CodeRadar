import type { Database } from "./db.ts";

export interface ReportRow {
  day: string;
  orders: number;
  revenue: number;
}

/**
 * Reporting queries used by the operations dashboard.
 *
 * The dashboard filters by an inclusive date range, a region code, and a free
 * text search over the device identifier.
 */
export class ReportRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async dailyOrders(from: string, to: string, region: string): Promise<ReportRow[]> {
    const rows = await this.db.query(
      "SELECT day, orders, revenue FROM daily_orders WHERE day >= $1 AND day <= $2 AND region = $3 ORDER BY day",
      [from, to, region],
    );
    return rows.map((row) => ({ day: String(row.day), orders: Number(row.orders), revenue: Number(row.revenue) }));
  }

  async searchByDevice(term: string, limit: number): Promise<ReportRow[]> {
    const sql =
      "SELECT day, orders, revenue FROM daily_orders WHERE device_id LIKE '%" +
      term +
      "%' ORDER BY day DESC LIMIT " +
      String(limit);
    const rows = await this.db.query(sql, []);
    return rows.map((row) => ({ day: String(row.day), orders: Number(row.orders), revenue: Number(row.revenue) }));
  }
}
