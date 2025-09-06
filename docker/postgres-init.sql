CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS books (
  work_key            TEXT PRIMARY KEY,
  title               TEXT,
  authors             TEXT[],
  first_publish_year  INT,
  languages           TEXT[],
  subjects            TEXT[],
  description         TEXT,
  edition_key         TEXT,
  cover_i             INT,
  has_fulltext        BOOLEAN,
  public_scan         BOOLEAN,
  ia                  TEXT[],
  metadata            JSONB,
  embedding           VECTOR(1536)
);

-- Track content hash to avoid re-embedding unchanged rows
ALTER TABLE books ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Vector index for pgvector (cosine distance)
DO $$
BEGIN
  BEGIN
    CREATE INDEX books_vec_idx ON books
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
  EXCEPTION WHEN duplicate_table THEN
    NULL;
  END;
END$$;

-- Full-text search column + trigger (cannot use GENERATED because expression isn't IMMUTABLE)
ALTER TABLE books
  ADD COLUMN IF NOT EXISTS tsv tsvector;

CREATE OR REPLACE FUNCTION books_tsv_update() RETURNS trigger AS $$
BEGIN
  NEW.tsv := to_tsvector('simple',
    coalesce(NEW.title,'') || ' ' ||
    array_to_string(NEW.authors,' ') || ' ' ||
    coalesce(NEW.description,'') || ' ' ||
    array_to_string(NEW.subjects,' ') || ' ' ||
    array_to_string(NEW.languages,' ')
  );
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER books_tsv_trg
  BEFORE INSERT OR UPDATE ON books
  FOR EACH ROW EXECUTE FUNCTION books_tsv_update();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS books_tsv_idx ON books USING gin (tsv);
