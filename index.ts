import express from "express";

const app = express();
const port = process.env.PORT ?? 8003;

app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ message: "BangkokTOR backend is running" });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
