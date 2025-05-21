import express from "express";
import path from 'path'
import bodyParser from "body-parser";
import  pg from "pg";
import axios from "axios";
const app = express();
const port = 3001;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use('/css', express.static(
  path.join(__dirname, 'node_modules/bootstrap/dist/css')
))
app.use('/js', express.static(
  path.join(__dirname, 'node_modules/bootstrap/dist/js')
))

const db = new pg.Client({
  user: "postgres",
  host: "localhost",
  database: "books",
  password: "neoray123",
  port: 9977,
});
db.connect();


app.get("/",async (res,req)=>{

});


app.post("/add",async (res,req)=>{

});

app.post("/edit",async (res,req)=>{

});

app.post("/delete",async (res,req)=>{

});

app.listen(port,()=>{
      console.log(`Server running on port ${port}`);

});
