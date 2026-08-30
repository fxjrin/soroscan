CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE contracts (
  id smallserial PRIMARY KEY,
  contract_id bytea NOT NULL UNIQUE
);

CREATE TABLE functions (
  id smallserial PRIMARY KEY,
  name text NOT NULL UNIQUE
);

CREATE TABLE arg_addresses (
  id serial PRIMARY KEY,
  address text NOT NULL UNIQUE
);

CREATE TABLE contract_transactions (
  contract_id smallint NOT NULL,
  tx_hash bytea NOT NULL,
  ledger integer NOT NULL,
  ledger_closed_at timestamptz NOT NULL,
  function smallint NOT NULL,
  args jsonb,
  fee_charged bigint NOT NULL,
  PRIMARY KEY (tx_hash, ledger_closed_at)
);

ALTER TABLE contract_transactions ALTER COLUMN args SET COMPRESSION lz4;

SELECT create_hypertable('contract_transactions', by_range('ledger_closed_at', INTERVAL '7 days'));

ALTER TABLE contract_transactions SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'contract_id',
  timescaledb.compress_orderby = 'ledger DESC'
);

SELECT add_compression_policy('contract_transactions', INTERVAL '30 days');

CREATE INDEX contract_transactions_contract_ledger_idx
  ON contract_transactions (contract_id, ledger DESC);

CREATE TABLE checkpoints (
  name text PRIMARY KEY,
  last_ledger bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
