import express from "express";
import cors from "cors";
import {answerVideoQuery} from "./agent.js"
const port = process.env.PORT||3000;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());


app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.post("/generate", async (req, res) => {
  try {
    // req.body { query: "...", video_id: "..." }
    const answer = await answerVideoQuery(req.body);
    res.send({ answer });
  } catch (err) {
    console.error(err);
    res.status(400).send({ error: err.message });
  }
});


app.listen(port,()=>{
    console.log(`Server is running on port ${port}`)
});