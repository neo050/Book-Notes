-- Ensure the FTS tsvector includes languages for better ranking
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

-- Backfill existing rows to refresh tsv with languages included
-- UPDATE books SET title = title;

