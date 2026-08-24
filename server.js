const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.get("/", (req, res) => {
    res.send("Backend is running!");
});

app.post("/feedback", (req, res) => {
    const message = req.body.message;

    if (!message || !message.trim()) {
        return res.status(400).json({ error: "Feedback can't be empty." });
    }

    const entry = `[${new Date().toISOString()}] ${message.trim()}\n---\n`;

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
            const shuffledChoices = [...question.choices].sort(() => Math.random() - 0.5);
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
        const question = req.body.question;
        const chosen = req.body.chosen;
        const correctAnswer = req.body.correctAnswer;

        if (!question || !chosen || !correctAnswer) {
            return res.status(400).json({ error: "Missing question info." });
        }

        const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

        const prompt = `A student answered a quiz question wrong. Explain briefly and clearly why the correct answer is right and why their answer was wrong. Keep it to 2-3 short sentences, friendly and simple, no headers or bullet points.

Question: ${question}
Student's answer: ${chosen}
Correct answer: ${correctAnswer}`;

        const result = await model.generateContent(prompt);
        const explanation = result.response.text().trim();

        res.json({ explanation: explanation });

    } catch (error) {
        console.error("Error generating explanation:", error);
        res.status(500).json({ error: "Could not get an explanation right now." });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
});