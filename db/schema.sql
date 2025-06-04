
CREATE TABLE IF NOT EXISTS users (
  id        SERIAL PRIMARY KEY,
  email     VARCHAR(100) UNIQUE NOT NULL,
  password  VARCHAR(100)
);


 CREATE TABLE IF NOT EXISTS users (
  id           SERIAL PRIMARY KEY,
 
  email        VARCHAR(100) UNIQUE NOT NULL,

  password  VARCHAR(100)
 
);
CREATE TABLE IF NOT EXISTS my_books (
  id           SERIAL PRIMARY KEY,
  user_id      INT REFERENCES users(id),
  title        VARCHAR(100)  NOT NULL,
  introduction VARCHAR(1000) NOT NULL,
  notes        VARCHAR(10000) NOT NULL,
  author_name  VARCHAR(100)  NOT NULL,
  rating       SMALLINT      NOT NULL,
  end_date     DATE          NOT NULL,
  cover_i      INT           NOT NULL
);

);
