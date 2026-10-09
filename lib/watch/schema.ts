/**
 * Proposed changes from the source watchers (PLAN 253). They live in the accounts database, beside reports and corrections: it survives a vendor reload and is
 * not part of the world that is swapped, and a proposal is a record of a decision (who approved what, when) that must outlast a rebuild.
 *
 * A proposal is never applied by writing it: only an admin's approval does that (built in a later step). `target_key` names the thing a change is about in a way that
 * survives the source being re-read; at most one proposal per (source, target_key) is pending at a time. `fingerprint` is a hash of what the change would set the value to,
 * so a change an admin rejected is not raised again until the source says something different.
 */
export const PROPOSAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS proposals (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  target_key TEXT NOT NULL,
  label TEXT NOT NULL,
  old_json TEXT,
  new_json TEXT,
  evidence_json TEXT,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','superseded')),
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT,
  note TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_proposal_pending ON proposals(source, target_key) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_proposal_status ON proposals(status, source);
CREATE INDEX IF NOT EXISTS idx_proposal_memory ON proposals(source, target_key, fingerprint) WHERE status = 'rejected';
`;
