import express from "express";
import path from 'path'
import { fileURLToPath } from 'url';
import bodyParser from "body-parser";
import  pg from "pg";
import axios from "axios";
const app = express();
const PORT = process.env.PORT || 3001;
app.use(bodyParser.urlencoded({ extended: true }));


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));

app.use('/css', express.static(
  path.join(__dirname, 'node_modules/bootstrap/dist/css')
))
app.use('/js', express.static(
  path.join(__dirname, 'node_modules/bootstrap/dist/js')
))


const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false   // required by Render’s free Postgres
  }
});

db.connect();


app.get("/",async (req,res)=>{
    try
    { 
      const books =(await db.query("SELECT * FROM my_books")).rows
      books.forEach(book=>book.end_date = new Date(book.end_date).toISOString().slice(0, 10));
       res.render("index.ejs",{books:books})
    }
    catch(err)
    {

    }
});


app.post("/add",async (req,res)=>{
    
        try{
            if (req.body["author_name"]&&req.body["book_name"]&&req.body["rating"]&&req.body["introduction"]&&req.body["notes"]&&req.body["end_date"])
              {
                  let title = req.body["book_name"];
                  let author=req.body["author_name"];
                  const url = "https://openlibrary.org/search.json";
                  const params = {
                        title,
                        author,
                        limit: 1,
                        fields: "title,cover_i,author_name"
                  };

                const {data} = await axios.get(url,{params});
                console.log(data.docs[0].author_name,data.docs[0].cover_i,data.docs[0].title);
                try
                {
                    db.query("INSERT INTO my_books (title,introduction,notes,author_name,rating,end_date,cover_i) VALUES ($1,$2,$3,$4,$5,$6,$7)",[req.body["book_name"],req.body["introduction"],req.body["notes"],req.body["author_name"],req.body["rating"],req.body["end_date"],data.docs[0].cover_i])
                    res.redirect("/");
                }
                catch(err)
                {

                }
                

                }
                

            }
            catch(err)
            {


            }

     
    

});

app.get("/add",async (req,res)=>{

  
      try{
            res.render("add.ejs")
        }
         catch(err)
         {

         }

});

app.get("/edit",async (req,res)=>{
  
  const id = parseInt(req.query.id, 10);
      try{
          const book = (await db.query("SELECT * FROM my_books WHERE id = $1",[id])).rows[0];
            book.end_date = new Date(book.end_date).toISOString().slice(0, 10)
            res.render("edit.ejs",{book:book})
        }
         catch(err)
         {

         }
         

});
app.post("/edit",async (req,res)=>{
  
   const id = req.body["id"];
      try{
           db.query("UPDATE  my_books SET introduction = $1 ,notes = $2,rating  = $3,end_date= $4  WHERE id = $5",[req.body["introduction"],req.body["notes"],req.body["rating"],req.body["end_date"],id])
            res.redirect("/");
        }
         catch(err)
         {

         }
         

});

app.post("/delete",async (req,res)=>{
  console.log("dsddd");
     const id = req.body["id"];
     console.log(id,"dsddd");
   try 
  {
  
    await db.query("DELETE FROM  my_books WHERE id = $1",[id])
    res.redirect("/");
  }
  catch(err)
  {
    console.log(err);
  }

});


app.get("/continue",async (req,res)=>{
const id = parseInt(req.query.id, 10);
      try{
          const book = (await db.query("SELECT * FROM my_books WHERE id = $1",[id])).rows[0];
            book.end_date = new Date(book.end_date).toISOString().slice(0, 10)
            res.render("continue.ejs",{book:book})
        }
         catch(err)
         {

         }

});

app.listen(PORT,()=>{
      console.log(`Server running on port ${PORT}`);

});
