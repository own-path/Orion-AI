# Snowflake Setup

## Create the database objects

```sql
CREATE DATABASE IF NOT EXISTS ORION;
CREATE SCHEMA IF NOT EXISTS ORION.PUBLIC;
USE DATABASE ORION;
USE SCHEMA PUBLIC;

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
);
```

## Required environment variables

- `SNOWFLAKE_ACCOUNT`
- `SNOWFLAKE_USERNAME`
- `SNOWFLAKE_PASSWORD`
- `SNOWFLAKE_WAREHOUSE`
- `SNOWFLAKE_DATABASE`
- `SNOWFLAKE_SCHEMA`
- `SNOWFLAKE_ROLE`

## Runtime behavior

- `agent-service` calls `ensureAuditTable()` on boot
- every bot command can emit audit rows
- every autonomous decision always writes an audit row
- `/history` reads from Snowflake, not from local memory

## Recommended privileges

Grant the runtime user:

- usage on warehouse
- usage on database and schema
- create table on schema for first boot
- insert and select on `ORION_AUDIT_LOGS`
