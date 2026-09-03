const multer = require("multer");
const pdfParse = require("pdf-parse");
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 }
});
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

app.get("/", function(req, res) {
    res.sendFile(path.join(__dirname, "index.html"));
});

app.post("/feedback", (req, res) => {
    const message = req.body.message;

    if (!message || !message.trim()) {
        return res.status(400).json({ error: "Feedback can't be empty." });
    }

    const entry = "[" + new Date().toISOString() + "] " + message.trim() + "\n---\n";

    fs.appendFile("feedback.txt", entry, function(err) {
        if (err) {
            console.error("Error saving feedback:", err);
            return res.status(500).json({ error: "Could not save feedback." });
        }
        res.json({ success: true });
    });
});

app.post("/generate-quiz", async (req, res) => {
    try {
        const notes = req.body.notes;
        const questionCount = parseInt(req.body.questionCount) || 5;
        const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

        const prompt = `Based on these notes, create exactly ${questionCount} multiple-choice quiz questions.
If the notes are too short to make that many unique, meaningful questions, create as many good questions as reasonably possible instead of repeating or making up unrelated content.
Return ONLY valid JSON, no other text, in this exact format:
[
  {
    "question": "question text here",
    "choices": ["choice A", "choice B", "choice C", "choice D"],
    "correctAnswer": "choice A"
  }
]

Notes: ${notes}`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        const cleanedText = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
        const quizData = JSON.parse(cleanedText);

        const shuffledQuiz = quizData.map(function(question) {
            const shuffledChoices = question.choices.slice().sort(function() { return Math.random() - 0.5; });
            return {
                question: question.question,
                choices: shuffledChoices,
                correctAnswer: question.correctAnswer
            };
        });

        res.json({ quiz: shuffledQuiz });
    } catch (error) {
        console.error("Error generating quiz:", error);
        res.status(500).json({ error: "The AI is a bit busy right now. Click below to try again." });
    }
});

app.post("/explain", async (req, res) => {
    try {
        const question = req.body.question || "";
        const chosen = req.body.chosen || "";
        const correctAnswer = req.body.correctAnswer || "";
        const notes = (req.body.notes || "").slice(0, 4000);

        if (!question || !chosen || !correctAnswer) {
            return res.status(400).json({ error: "Missing question info." });
        }

        const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

        const prompt = `You are a tutor helping a student learn from a missed quiz question.
Use the student's notes if they help. Do not invent facts that are not in the notes or the question.

Question: ${question}
Student chose: ${chosen}
Correct answer: ${correctAnswer}
Notes: ${notes || "No notes given."}

Write exactly 3 short parts:

Why it's correct:
One or two sentences.

Why your answer doesn't fit:
One or two sentences. Be specific, not "it is a different idea."

How to remember it:
One simple study tip.`;

        const result = await model.generateContent(prompt);
        res.json({ explanation: result.response.text().trim() });
    } catch (error) {
        console.error("Error generating explanation:", error);
        res.status(500).json({ error: "Could not get an explanation right now." });
    }
});
app.post("/upload-pdf", upload.single("pdf"), async function(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "Choose a PDF first." });
        }

        const parsed = await pdfParse(req.file.buffer);
        const notes = (parsed.text || "").replace(/\s+/g, " ").trim().slice(0, 12000);

        if (notes.length < 50) {
            return res.status(400).json({ error: "Could not read enough text from that PDF." });
        }

        const questionCount = parseInt(req.body.questionCount) || 5;
        const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

        const prompt = `Based on these notes, create exactly ${questionCount} multiple-choice quiz questions.
Return ONLY valid JSON, no other text, in this exact format:
[
  {
    "question": "question text here",
    "choices": ["choice A", "choice B", "choice C", "choice D"],
    "correctAnswer": "choice A"
  }
]

Notes: ${notes}`;

        const result = await model.generateContent(prompt);
        const cleanedText = result.response.text().replace(/```json/g, "").replace(/```/g, "").trim();
        const quizData = JSON.parse(cleanedText);

        res.json({
            notes: notes.slice(0, 3000),
            quiz: quizData.map(function(question) {
                const shuffledChoices = question.choices.slice().sort(function() { return Math.random() - 0.5; });
                return {
                    question: question.question,
                    choices: shuffledChoices,
                    correctAnswer: question.correctAnswer
                };
            })
        });
    } catch (error) {
        console.error("Error reading PDF:", error);
        res.status(500).json({ error: "Could not read that PDF. Try a smaller text PDF." });
    }
});
app.listen(PORT, () => {
    console.log("Server is running at http://localhost:" + PORT);
});
