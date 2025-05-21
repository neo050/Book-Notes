import express from "express";
import bodyParser from "body-parser";
import  pg from "pg";
const app = express();
const port = 3001;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));




