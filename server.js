const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const bcrypt = require("bcryptjs");

const app = express();
const PORT = process.env.PORT || 3000;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024 }
});
const usersFile = path.join(__dirname, "users.json");
const visitsFile = path.join(__dirname, "visits.json");
const STATS_KEY = process.env.STATS_KEY || "zane-only";

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(function(req, res, next) {
    if (req.method === "GET" && (req.path === "/" || req.path === "/index.html" || req.path === "/app.html")) {
        try { addVisit(); } catch (err) {}
    }
    next();
});
app.use(express.static(__dirname));

app.get("/", function(req, res) {
    res.sendFile(path.join(__dirname, "index.html"));
});

function readUsers() {
    try {
        return JSON.parse(fs.readFileSync(usersFile, "utf8"));
    } catch (err) {
        return [];
    }
}

function writeUsers(users) {
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

function currentEmail(req) {
    const raw = (req.headers.cookie || "").split(";").map(function(part) {
        return part.trim();
    }).find(function(part) {
        return part.indexOf("studyai_email=") === 0;
    });
    return raw ? decodeURIComponent(raw.split("=")[1]) : "";
}

function setLoginCookie(res, email) {
    res.setHeader("Set-Cookie", "studyai_email=" + encodeURIComponent(email) + "; Path=/; SameSite=Lax; Max-Age=2592000");
}

function readVisits() {
    try {
        return JSON.parse(fs.readFileSync(visitsFile, "utf8")).count || 0;
    } catch (err) {
        return 0;
    }
}

function addVisit() {
    const count = readVisits() + 1;
    fs.writeFileSync(visitsFile, JSON.stringify({ count: count }));
    return count;
}

app.get("/me", function(req, res) {
    const email = currentEmail(req);
    const user = readUsers().find(function(item) { return item.email === email; });
    res.json({ email: email || null, plan: user ? user.plan : "free" });
});

app.post("/register", async function(req, res) {
    try {
        const email = (req.body.email || "").trim().toLowerCase();
        const password = req.body.password || "";
        if (!email || !password) return res.status(400).json({ error: "Enter an email and password." });
        if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
        const users = readUsers();
        if (users.some(function(user) { return user.email === email; })) {
            return res.status(400).json({ error: "That email is already used. Click Log in." });
        }
        users.push({
            email: email,
            password: await bcrypt.hash(password, 10),
            plan: "free",
            savedSets: []
        });
        writeUsers(users);
        setLoginCookie(res, email);
        res.json({ success: true, email: email, plan: "free" });
    } catch (err) {
        res.status(500).json({ error: "Could not create account." });
    }
});

app.post("/login", async function(req, res) {
    try {
        const email = (req.body.email || "").trim().toLowerCase();
        const password = req.body.password || "";
        const user = readUsers().find(function(item) { return item.email === email; });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ error: "Wrong email or password." });
        }
        setLoginCookie(res, email);
        res.json({ success: true, email: email, plan: user.plan || "free" });
    } catch (err) {
        res.status(500).json({ error: "Could not log in." });
    }
});

app.post("/logout", function(req, res) {
    res.setHeader("Set-Cookie", "studyai_email=; Path=/; Max-Age=0");
    res.json({ success: true });
});

app.post("/change-password", async function(req, res) {
    try {
        const email = currentEmail(req);
        const currentPassword = req.body.currentPassword || "";
        const newPassword = req.body.newPassword || "";
        if (!email) return res.status(400).json({ error: "Log in first." });
        if (newPassword.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters." });
        const users = readUsers();
        const user = users.find(function(item) { return item.email === email; });
        if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
            return res.status(400).json({ error: "Current password is wrong." });
        }
        user.password = await bcrypt.hash(newPassword, 10);
        writeUsers(users);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Could not change password." });
    }
});

app.get("/my-sets", function(req, res) {
    const email = currentEmail(req);
    const user = readUsers().find(function(item) { return item.email === email; });
    res.json({ sets: user && user.savedSets ? user.savedSets : [] });
});

app.post("/save-sets", function(req, res) {
    const email = currentEmail(req);
    if (!email) return res.status(400).json({ error: "Log in first." });
    const users = readUsers();
    const user = users.find(function(item) { return item.email === email; });
    if (!user) return res.status(400).json({ error: "Log in first." });
    user.savedSets = req.body.sets || [];
    writeUsers(users);
    res.json({ success: true });
});

app.get("/mystats", function(req, res) {
    if (req.query.key !== STATS_KEY) {
        return res.status(404).send("Not found");
    }
    res.send("Visits: " + readVisits());
});

app.post("/feedback", function(req, res) {
    const message = req.body.message;
    if (!message || !message.trim()) {
        return res.status(400).json({ error: "Feedback can't be empty." });
    }
    const entry = "[" + new Date().toISOString() + "] " + message.trim() + "\n---\n";
    fs.appendFile("feedback.txt", entry, function(err) {
        if (err) return res.status(500).json({ error: "Could not save feedback." });
        res.json({ success: true });
    });
});

app.post("/generate-quiz", async function(req, res) {
    try {
        const quiz = await makeQuiz(req.body.notes, parseInt(req.body.questionCount) || 5);
        res.json({ quiz: quiz });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "The AI is a bit busy right now. Click below to try again." });
    }
});

app.post("/upload-pdf", upload.single("pdf"), async function(req, res) {
    try {
        if (!req.file) return res.status(400).json({ error: "Choose a PDF first." });
        const parsed = await pdfParse(req.file.buffer);
        const notes = (parsed.text || "").replace(/\s+/g, " ").trim().slice(0, 12000);
        if (notes.length < 50) return res.status(400).json({ error: "Could not read enough text from that PDF." });
        const quiz = await makeQuiz(notes, parseInt(req.body.questionCount) || 5);
        res.json({ notes: notes.slice(0, 3000), quiz: quiz });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Could not read that PDF. Try a smaller text PDF." });
    }
});

app.post("/upload-photo", upload.single("photo"), async function(req, res) {
    try {
        if (!req.file) return res.status(400).json({ error: "Choose a photo first." });
        const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
        const questionCount = parseInt(req.body.questionCount) || 5;
        const result = await model.generateContent([
            {
                text: `Read the textbook page in this photo.
First write short study notes from the page.
Then create ${questionCount} multiple-choice questions from those notes.
Return ONLY valid JSON in this exact format:
{"notes":"short notes here","quiz":[{"question":"question text","choices":["A","B","C","D"],"correctAnswer":"A"}]}`
            },
            {
                inlineData: {
                    mimeType: req.file.mimetype || "image/jpeg",
                    data: req.file.buffer.toString("base64")
                }
            }
        ]);
        const cleaned = result.response.text().replace(/```json/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleaned);
        const quiz = (parsed.quiz || []).map(function(question) {
            const shuffledChoices = (question.choices || []).slice().sort(function() { return Math.random() - 0.5; });
            return {
                question: question.question,
                choices: shuffledChoices,
                correctAnswer: question.correctAnswer
            };
        });
        res.json({ notes: parsed.notes || "", quiz: quiz });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Could not read that photo. Use a clear picture of one page." });
    }
});

app.post("/explain", async function(req, res) {
    try {
        const question = req.body.question || "";
        const chosen = req.body.chosen || "";
        const correctAnswer = req.body.correctAnswer || "";
        const notes = (req.body.notes || "").slice(0, 4000);
        if (!question || !chosen || !correctAnswer) {
            return res.status(400).json({ error: "Missing question info." });
        }
        const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
        const prompt = `You are a tutor.
Question: ${question}
Student chose: ${chosen}
Correct answer: ${correctAnswer}
Notes: ${notes || "No notes given."}

Write:
Why it's correct:
Why your answer doesn't fit:
How to remember it:`;
        const result = await model.generateContent(prompt);
        res.json({ explanation: result.response.text().trim() });
    } catch (error) {
        res.status(500).json({ error: "Could not get an explanation right now." });
    }
});

app.post("/topic-quiz", async function(req, res) {
    try {
        const topic = (req.body.topic || "").trim();
        const gradeLevel = req.body.gradeLevel || "Grade 10";
        const difficulty = req.body.difficulty || "medium";
        const questionCount = parseInt(req.body.questionCount) || 5;
        if (!topic) return res.status(400).json({ error: "Type a topic first." });

        const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
        const prompt = `Create ${questionCount} original multiple-choice questions about this exact topic: "${topic}".
Audience: ${gradeLevel}
Difficulty: ${difficulty}
Rules:
- Stay on that topic only.
- Use the student's wording. If they say "sig digs" or "significant digits", use "significant digits", not "significant figures".
- Do not add extra topics unless they asked for them.
- Write original school practice questions.
Return ONLY valid JSON. No markdown. No extra words.
Format:
[{"question":"Q","choices":["A","B","C","D"],"correctAnswer":"A"}]`;

        const result = await model.generateContent(prompt);
        let text = result.response.text().replace(/```json/g, "").replace(/```/g, "").trim();
        const start = text.indexOf("[");
        const end = text.lastIndexOf("]");
        if (start !== -1 && end !== -1) text = text.slice(start, end + 1);
        const quizData = JSON.parse(text);
        const quiz = quizData.map(function(question) {
            const choices = (question.choices || []).slice().sort(function() { return Math.random() - 0.5; });
            return {
                question: question.question,
                choices: choices,
                correctAnswer: question.correctAnswer
            };
        });
        if (!quiz.length) return res.status(500).json({ error: "Could not make that topic quiz. Try a simpler topic." });
        res.json({ quiz: quiz, notes: topic + " · " + gradeLevel + " · " + difficulty });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Could not make that topic quiz. Try again." });
    }
});

async function makeQuiz(notes, questionCount) {
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
    return quizData.map(function(question) {
        const shuffledChoices = question.choices.slice().sort(function() { return Math.random() - 0.5; });
        return {
            question: question.question,
            choices: shuffledChoices,
            correctAnswer: question.correctAnswer
        };
    });
}

app.listen(PORT, function() {
    console.log("Server is running at http://localhost:" + PORT);
});
