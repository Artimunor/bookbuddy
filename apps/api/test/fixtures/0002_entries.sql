CREATE TABLE fixture_entries (
  id INTEGER PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES fixture_parents(id),
  label TEXT NOT NULL
);

INSERT INTO fixture_entries (parent_id, label) VALUES ('parent', 'seed');
