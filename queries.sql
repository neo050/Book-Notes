CREATE TABLE my_books(
id serial PRIMARY KEY,
title VARCHAR(100) NOT NULL,
introduction VARCHAR(1000) NOT NULL,
notes VARCHAR(10000) NOT NULL,
author_name VARCHAR(100) NOT NULL,
rating smallint	NOT NULL,
end_date DATE NOT NULL,
cover_i int NOT NULL

);