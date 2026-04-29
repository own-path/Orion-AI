import snowflake from "snowflake-sdk";
import { config } from "../shared/config.js";

function hasSnowflakeConfig() {
  const values = Object.values(config.snowflake);
  return values.every(Boolean);
}

export class SnowflakeAuditService {
  constructor() {
    this.connection = null;
  }

  async connect() {
    if (this.connection) {
      return this.connection;
    }

    if (!hasSnowflakeConfig()) {
      if (config.snowflakeRequired) {
        throw new Error("Snowflake configuration is incomplete");
      }
      return null;
    }

    this.connection = snowflake.createConnection({
      account: config.snowflake.account,
      username: config.snowflake.username,
      password: config.snowflake.password,
      warehouse: config.snowflake.warehouse,
      database: config.snowflake.database,
      schema: config.snowflake.schema,
      role: config.snowflake.role
    });

    await new Promise((resolve, reject) => {
      this.connection.connect((err, conn) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(conn);
      });
    });

    return this.connection;
  }

  async execute(sqlText, binds = []) {
    const connection = await this.connect();
    if (!connection) {
      return [];
    }

    return new Promise((resolve, reject) => {
      connection.execute({
        sqlText,
        binds,
        complete: (err, _stmt, rows) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(rows || []);
        }
      });
    });
  }

  async ensureAuditTable() {
    await this.execute(`
      CREATE TABLE IF NOT EXISTS ORION_AUDIT_LOGS (
        ID INTEGER AUTOINCREMENT,
        EVENT_TIME TIMESTAMP_NTZ,
        USER_ID STRING,
        EVENT_TYPE STRING,
        ACTION STRING,
        REASON STRING,
        CONFIDENCE FLOAT,
        STATUS STRING,
        STRATEGY STRING,
        TX_SIGNATURE STRING,
        METADATA VARIANT
      )
    `);
  }

  async logAuditEvent(event) {
    await this.execute(
      `
        INSERT INTO ORION_AUDIT_LOGS (
          EVENT_TIME,
          USER_ID,
          EVENT_TYPE,
          ACTION,
          REASON,
          CONFIDENCE,
          STATUS,
          STRATEGY,
          TX_SIGNATURE,
          METADATA
        )
        SELECT
          TO_TIMESTAMP_NTZ(?),
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          ?,
          PARSE_JSON(?)
      `,
      [
        event.timestamp,
        String(event.userId),
        event.eventType,
        event.action || null,
        event.reason || null,
        event.confidence ?? null,
        event.status,
        event.strategy || null,
        event.txSignature || null,
        JSON.stringify(event.metadata || {})
      ]
    );
  }

  async getAuditHistory(userId, limit = 10) {
    return this.execute(
      `
        SELECT
          EVENT_TIME,
          USER_ID,
          EVENT_TYPE,
          ACTION,
          REASON,
          CONFIDENCE,
          STATUS,
          STRATEGY,
          TX_SIGNATURE,
          METADATA
        FROM ORION_AUDIT_LOGS
        WHERE USER_ID = ?
        ORDER BY EVENT_TIME DESC
        LIMIT ?
      `,
      [String(userId), Number(limit)]
    );
  }
}
