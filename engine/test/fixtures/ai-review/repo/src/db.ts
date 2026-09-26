/**
 * Type surface of the persistence layer the API code is compiled against.
 *
 * The concrete implementation is provided by the host application; only the
 * shapes the handlers depend on are declared here.
 */

export interface Order {
  id: string;
  device: string;
  totalCents: number;
  items: Array<{ sku: string; quantity: number }>;
}

export interface UserRow {
  id: string;
  display_name: string;
  address: { city: string; country: string } | null;
  plan_code: string | null;
}

export interface SessionRow {
  id: string;
  deviceId: string;
  expiresAt: number;
}

export interface StoredObject {
  id: string;
  etag: string;
  size: number;
}

export interface RowSet {
  [column: string]: unknown;
}

export interface Database {
  query(sql: string, params: unknown[]): Promise<RowSet[]>;
  objects: {
    put(key: string, body: Uint8Array): Promise<StoredObject>;
  };
  orders: {
    findById(id: string): Promise<Order | null>;
    listForDevice(deviceId: string): Promise<Order[]>;
    markReconciled(orderId: string, etag: string): Promise<void>;
    delete(id: string): Promise<void>;
  };
  users: {
    findById(id: string): Promise<UserRow | null>;
  };
  sessions: {
    listForDevice(deviceId: string): Promise<SessionRow[]>;
    listAll(): Promise<SessionRow[]>;
    markRevoked(sessionId: string, at: number): Promise<void>;
    delete(sessionId: string): Promise<void>;
  };
}
