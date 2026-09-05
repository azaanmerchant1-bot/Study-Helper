const generateBtn = document.getElementById("generateBtn");
const output = document.getElementById("output");
const flashcardsBox = document.getElementById("flashcards");
const matchBox = document.getElementById("matchBox");
const notesInput = document.getElementById("notesInput");
const questionCountInput = document.getElementById("questionCount");
const shareBtn = document.getElementById("shareBtn");
const saveBtn = document.getElementById("saveBtn");
const savedList = document.getElementById("savedList");
const streakBadge = document.getElementById("streakBadge");
const nameModal = document.getElementById("nameModal");
const nameModalTitle = document.getElementById("nameModalTitle");
const setNameInput = document.getElementById("setNameInput");
const nameModalStatus = document.getElementById("nameModalStatus");
const pdfBtn = document.getElementById("pdfBtn");
const pdfInput = document.getElementById("pdfInput");
const topicBtn = document.getElementById("topicBtn");
const topicInput = document.getElementById("topicInput");
const gradeLevel = document.getElementById("gradeLevel");
const difficulty = document.getElementById("difficulty");
const photoBtn = document.getElementById("photoBtn");
const photoInput = document.getElementById("photoInput");
const DAILY_LIMIT = 5;
const USAGE_KEY = "studyai_usage_v2";

let currentMode = "quiz";
let lastQuiz = [];
let allCards = [];
let queue = [];
let knownCards = [];
let learningCards = [];
let quizAnswers = [];
let showingAllCards = false;
let questions = [];
let answers = [];
let selectedQuestion = null;
let selectedAnswer = null;
let matchWrong = 0;
let matchCombo = 0;
let maxCombo = 0;
let missedPairs = [];
let matchStart = 0;
let penaltySeconds = 0;
let timerId = null;
let bestTime = Number(localStorage.getItem("studyai_best_match") || 0);
let matchedCount = 0;
let renameId = null;

document.querySelectorAll("[data-mode]").forEach(function(btn) {
    btn.addEventListener("click", function() {
        setMode(btn.getAttribute("data-mode"));
    });
});

shareBtn.addEventListener("click", shareSet);
saveBtn.addEventListener("click", function() { openNameModal("save"); });
document.getElementById("cancelName").addEventListener("click", closeNameModal);
document.getElementById("confirmName").addEventListener("click", confirmNameModal);
loadSharedSet();
restoreLastSet();
renderSavedSets();
updateLimitDisplay();
updateStreakDisplay();

function getTodayString() {
    const now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
}

function getUsageData() {
    const today = getTodayString();
    const raw = localStorage.getItem(USAGE_KEY);
    if (!raw) return { date: today, count: 0 };
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.date !== today || typeof parsed.count !== "number") return { date: today, count: 0 };
        return parsed;
    } catch (err) {
        return { date: today, count: 0 };
    }
}

function getRemaining() {
    return Math.max(0, DAILY_LIMIT - getUsageData().count);
}

function useOneGeneration() {
    const usage = getUsageData();
    usage.count += 1;
    localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
}

function updateLimitDisplay() {
    let badge = document.getElementById("limitBadge");
    if (!badge) {
        badge = document.createElement("span");
        badge.id = "limitBadge";
        badge.className = "limit-badge";
        generateBtn.insertAdjacentElement("afterend", badge);
    }
    badge.textContent = getRemaining() + " free left today";
}

function updateStreak() {
    const today = getTodayString();
    const raw = localStorage.getItem("studyai_streak");
    let data = { count: 0, lastDate: null };
    try { if (raw) data = JSON.parse(raw); } catch (err) {}
    if (data.lastDate === today) return;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.getFullYear() + "-" + String(yesterday.getMonth() + 1).padStart(2, "0") + "-" + String(yesterday.getDate()).padStart(2, "0");
    data.count = data.lastDate === yesterdayStr ? data.count + 1 : 1;
    data.lastDate = today;
    localStorage.setItem("studyai_streak", JSON.stringify(data));
}

function updateStreakDisplay() {
    const today = getTodayString();
    const raw = localStorage.getItem("studyai_streak");
    let data = { count: 0, lastDate: null };
    try { if (raw) data = JSON.parse(raw); } catch (err) {}
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.getFullYear() + "-" + String(yesterday.getMonth() + 1).padStart(2, "0") + "-" + String(yesterday.getDate()).padStart(2, "0");
    const displayCount = (data.lastDate === today || data.lastDate === yesterdayStr) ? data.count : 0;
    if (streakBadge) streakBadge.textContent = displayCount > 0 ? "Streak: " + displayCount + " day" : "Start your streak today";
}

function setMode(mode) {
    currentMode = mode;
    showingAllCards = false;
    document.querySelectorAll("[data-mode]").forEach(function(btn) {
        btn.classList.toggle("active", btn.getAttribute("data-mode") === mode);
    });
    output.classList.toggle("hidden", mode !== "quiz");
    flashcardsBox.classList.toggle("hidden", mode !== "flashcards");
    matchBox.classList.toggle("hidden", mode !== "games");
    if (mode === "quiz" && !lastQuiz.length) output.innerHTML = "<div class='empty-state'>Generate a study set, then take the quiz.</div>";
    if (mode === "flashcards") renderFlashcards();
    if (mode === "games") renderMatchStart();
}

generateBtn.addEventListener("click", async function() {
    if (getRemaining() <= 0) {
        showError("You've used today's free generations. Come back tomorrow for 5 more.");
        return;
    }
    const notesText = notesInput.value.trim();
    if (!notesText) {
        showError("Paste some notes first.");
        return;
    }
    generateBtn.disabled = true;
    setMode("quiz");
    output.innerHTML = "<p class='loading'>Generating your study set...</p>";
    try {
        const response = await fetch("/generate-quiz", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notes: notesText, questionCount: questionCountInput.value })
        });
        const data = await response.json();
        if (data.error) { showError(data.error); return; }
        useOneGeneration();
        updateLimitDisplay();
        updateStreak();
        updateStreakDisplay();
        applySet(data.quiz || [], notesText);
    } catch (err) {
        showError("Could not reach the server.");
    } finally {
        generateBtn.disabled = false;
        updateLimitDisplay();
    }
});

pdfBtn.addEventListener("click", async function() {
    if (!pdfInput.files[0]) {
        showError("Choose a PDF first.");
        return;
    }
    if (getRemaining() <= 0) {
        showError("You've used today's free generations. Come back tomorrow for 5 more.");
        return;
    }
    const form = new FormData();
    form.append("pdf", pdfInput.files[0]);
    form.append("questionCount", questionCountInput.value);
    pdfBtn.disabled = true;
    setMode("quiz");
    output.innerHTML = "<p class='loading'>Reading your PDF...</p>";
    try {
        const response = await fetch("/upload-pdf", { method: "POST", body: form });
        const data = await response.json();
        if (data.error) { showError(data.error); return; }
        useOneGeneration();
        updateLimitDisplay();
        updateStreak();
        updateStreakDisplay();
        applySet(data.quiz || [], data.notes || "");
    } catch (err) {
        showError("Could not upload that PDF.");
    } finally {
        pdfBtn.disabled = false;
    }
});
topicBtn.addEventListener("click", async function() {
    if (getRemaining() <= 0) {
        showError("You've used today's free generations. Come back tomorrow for 5 more.");
        return;
    }
    const topic = topicInput.value.trim();
    if (!topic) {
        showError("Type a topic first.");
        return;
    }
    topicBtn.disabled = true;
    setMode("quiz");
    output.innerHTML = "<p class='loading'>Making your topic quiz...</p>";
    try {
        const response = await fetch("/topic-quiz", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                topic: topic,
                gradeLevel: gradeLevel.value,
                difficulty: difficulty.value,
                questionCount: questionCountInput.value
            })
        });
        const data = await response.json();
        if (data.error) { showError(data.error); return; }
        useOneGeneration();
        updateLimitDisplay();
        updateStreak();
        updateStreakDisplay();
        applySet(data.quiz || [], data.notes || topic);
    } catch (err) {
        showError("Could not make that topic quiz.");
    } finally {
        topicBtn.disabled = false;
    }
});
photoBtn.addEventListener("click", async function() {
    if (!photoInput.files[0]) {
        showError("Choose a page photo first.");
        return;
    }
    if (getRemaining() <= 0) {
        showError("You've used today's free generations. Come back tomorrow for 5 more.");
        return;
    }
    const form = new FormData();
    form.append("photo", photoInput.files[0]);
    form.append("questionCount", questionCountInput.value);
    photoBtn.disabled = true;
    setMode("quiz");
    output.innerHTML = "<p class='loading'>Reading your page photo...</p>";
    try {
        const response = await fetch("/upload-photo", { method: "POST", body: form });
        const data = await response.json();
        if (data.error) { showError(data.error); return; }
        useOneGeneration();
        updateLimitDisplay();
        updateStreak();
        updateStreakDisplay();
        applySet(data.quiz || [], data.notes || "");
    } catch (err) {
        showError("Could not upload that photo.");
    } finally {
        photoBtn.disabled = false;
    }
});
function applySet(quiz, notesText) {
    lastQuiz = quiz;
    allCards = lastQuiz.map(function(q, i) { return { id: i, front: q.question, back: q.correctAnswer }; });
    if (notesText) notesInput.value = notesText;
    resetFlashProgress();
    localStorage.setItem("studyai_last_set", JSON.stringify({ quiz: lastQuiz, notes: notesInput.value }));
    displayQuiz(lastQuiz);
}

function resetFlashProgress() {
    queue = allCards.slice();
    knownCards = [];
    learningCards = [];
}

function showError(message) {
    setMode("quiz");
    output.innerHTML = "<div class='empty-state'><p>" + message + "</p><button id='retryBtn'>Try Again</button></div>";
    document.getElementById("retryBtn").addEventListener("click", function() { generateBtn.click(); });
}

function displayQuiz(quiz) {
    output.innerHTML = "";
    quizAnswers = [];
    quiz.forEach(function(q, index) {
        const card = document.createElement("div");
        card.className = "question-card";
        card.innerHTML = "<p class='question-text'>" + (index + 1) + ". " + escapeHtml(q.question) + "</p>";
        q.choices.forEach(function(choice) {
            const btn = document.createElement("button");
            btn.className = "choice-btn";
            btn.textContent = choice;
            btn.addEventListener("click", function() {
                if (quizAnswers.some(function(a) { return a.index === index; })) return;
                const isCorrect = choice === q.correctAnswer;
                quizAnswers.push({ index: index, question: q.question, chosen: choice, correctAnswer: q.correctAnswer, isCorrect: isCorrect });
                card.querySelectorAll(".choice-btn").forEach(function(b) {
                    b.disabled = true;
                    if (b.textContent === q.correctAnswer) b.classList.add("correct");
                });
                if (!isCorrect) {
                    btn.classList.add("incorrect");
                    addExplainButton(card, q.question, choice, q.correctAnswer);
                }
                addFlagButton(card, q.question);
                if (quizAnswers.length === quiz.length) showQuizResults(quiz);
            });
            card.appendChild(btn);
        });
        output.appendChild(card);
    });
}

function smarterFallback(chosen, correctAnswer) {
    return "Why it's correct:\n- \"" + correctAnswer + "\" matches this question.\n\nWhy your answer doesn't fit:\n- \"" + chosen + "\" is not the answer this question is asking for.\n\nHow to remember it:\n- Say the question out loud, then repeat the correct answer in your own words.";
}

function addExplainButton(card, question, chosen, correctAnswer) {
    const explainBtn = document.createElement("button");
    explainBtn.className = "explain-btn";
    explainBtn.textContent = "Why was I wrong?";
    explainBtn.addEventListener("click", async function() {
        explainBtn.textContent = "Explaining...";
        explainBtn.disabled = true;
        let text = smarterFallback(chosen, correctAnswer);
        try {
            const response = await fetch("/explain", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    question: question,
                    chosen: chosen,
                    correctAnswer: correctAnswer,
                    notes: notesInput.value
                })
            });
            const data = await response.json();
            if (data.explanation) text = data.explanation;
        } catch (err) {}
        const box = document.createElement("div");
        box.className = "explain-box";
        box.textContent = text;
        explainBtn.replaceWith(box);
    });
    card.appendChild(explainBtn);
}

function addFlagButton(card, question) {
    const flagBtn = document.createElement("button");
    flagBtn.className = "flag-btn";
    flagBtn.textContent = "This question is off";
    flagBtn.addEventListener("click", function() {
        const flags = JSON.parse(localStorage.getItem("studyai_flags") || "[]");
        flags.push({ question: question, time: new Date().toISOString() });
        localStorage.setItem("studyai_flags", JSON.stringify(flags));
        fetch("/feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: "Flagged question: " + question })
        }).catch(function() {});
        flagBtn.textContent = "Reported";
        flagBtn.disabled = true;
    });
    card.appendChild(flagBtn);
}

function showQuizResults(quiz) {
    const correctCount = quizAnswers.filter(function(a) { return a.isCorrect; }).length;
    const percent = quiz.length ? Math.round((correctCount / quiz.length) * 100) : 0;
    const missed = quizAnswers.filter(function(a) { return !a.isCorrect; });
    const box = document.createElement("div");
    box.className = "results-box";
    box.innerHTML = "<h2>Quiz score: " + correctCount + " / " + quiz.length + " (" + percent + "%)</h2>" +
        (missed.length ? "<div class='work-box'><h3>What to work on</h3>" + missed.map(function(item) {
            return "<div class='work-item'><p><strong>" + escapeHtml(item.question) + "</strong></p><p class='wrong'>Your answer: " + escapeHtml(item.chosen) + "</p><p class='right'>Correct: " + escapeHtml(item.correctAnswer) + "</p></div>";
        }).join("") + "</div>" : "<p>Perfect score.</p>");
    const jump = document.createElement("button");
    jump.className = "jump-btn";
    jump.textContent = "Play Match";
    jump.addEventListener("click", function() { setMode("games"); });
    box.appendChild(jump);
    output.prepend(box);
}
function renderFlashcards() {
    if (!allCards.length) {
        flashcardsBox.innerHTML = "<div class='empty-state'>Generate a study set first.</div>";
        return;
    }
    if (showingAllCards) return renderAllCards();
    const knownPercent = allCards.length ? Math.round((knownCards.length / allCards.length) * 100) : 0;
    if (!queue.length) {
        if (learningCards.length) {
            queue = learningCards.slice();
            learningCards = [];
            flashcardsBox.innerHTML = "<div class='empty-state'><p>You knew " + knownCards.length + " of " + allCards.length + " (" + knownPercent + "%).</p><div class='flash-actions'><button id='startReview'>Review those cards</button><button id='seeAllBtn'>See all cards</button></div></div>";
            document.getElementById("startReview").addEventListener("click", renderFlashcards);
            document.getElementById("seeAllBtn").addEventListener("click", function() { showingAllCards = true; renderAllCards(); });
            return;
        }
        flashcardsBox.innerHTML = "<div class='empty-state'><p>Finished. You knew " + knownCards.length + " of " + allCards.length + " (" + knownPercent + "%).</p><div class='flash-actions'><button id='restartCards'>Study again</button><button id='seeAllBtn'>See all cards</button></div></div>";
        document.getElementById("restartCards").addEventListener("click", function() { resetFlashProgress(); renderFlashcards(); });
        document.getElementById("seeAllBtn").addEventListener("click", function() { showingAllCards = true; renderAllCards(); });
        return;
    }
    const card = queue[0];
    flashcardsBox.innerHTML = "<div class='flash-wrap'><p class='flash-progress'>Known " + knownCards.length + " · Left " + (queue.length + learningCards.length) + " · " + knownPercent + "%</p><div class='flash-card' id='flashCard'><div class='flash-inner'><div class='flash-front'>" + escapeHtml(card.front) + "</div><div class='flash-back'>" + escapeHtml(card.back) + "</div></div></div><div class='flash-actions'><button id='learningBtn'>Still learning</button><button id='knowBtn'>I know this</button><button id='seeAllBtn'>See all cards</button></div></div>";
    document.getElementById("flashCard").addEventListener("click", function() { this.classList.toggle("flipped"); });
    document.getElementById("knowBtn").addEventListener("click", function() { knownCards.push(queue.shift()); renderFlashcards(); });
    document.getElementById("learningBtn").addEventListener("click", function() {
        const current = queue.shift();
        if (!learningCards.some(function(c) { return c.id === current.id; })) learningCards.push(current);
        renderFlashcards();
    });
    document.getElementById("seeAllBtn").addEventListener("click", function() { showingAllCards = true; renderAllCards(); });
}

function renderAllCards() {
    flashcardsBox.innerHTML = "<div class='flash-wrap'><div class='all-list'>" + allCards.map(function(card, i) {
        return "<div class='all-card'><p><strong>" + (i + 1) + ". " + escapeHtml(card.front) + "</strong></p><p>" + escapeHtml(card.back) + "</p></div>";
    }).join("") + "</div><button id='backToStudy'>Back to study</button></div>";
    document.getElementById("backToStudy").addEventListener("click", function() { showingAllCards = false; renderFlashcards(); });
}

function renderMatchStart() {
    stopTimer();
    if (!allCards.length) {
        matchBox.innerHTML = "<div class='empty-state'>Generate a study set first, then play Match.</div>";
        return;
    }
    matchBox.innerHTML = "<div class='empty-state'><h2>Match</h2><p>Click a purple question, then the green answer.</p><p>Best time: " + (bestTime ? formatTime(bestTime) : "none yet") + "</p><button id='startMatch'>Start Match</button></div>";
    document.getElementById("startMatch").addEventListener("click", startMatch);
}

function startMatch() {
    const pairs = shuffle(allCards.slice()).slice(0, Math.min(6, allCards.length));
    questions = pairs.map(function(card) { return { id: card.id, text: card.front, matched: false }; });
    answers = shuffle(pairs.map(function(card) { return { id: card.id, text: card.back, matched: false }; }));
    selectedQuestion = null;
    selectedAnswer = null;
    matchWrong = 0;
    matchCombo = 0;
    maxCombo = 0;
    missedPairs = [];
    penaltySeconds = 0;
    matchedCount = 0;
    matchStart = Date.now();
    drawMatch();
    stopTimer();
    timerId = setInterval(function() {
        const timeEl = document.getElementById("matchTime");
        if (timeEl) timeEl.textContent = formatTime(currentMatchTime());
    }, 100);
}

function drawMatch() {
    matchBox.innerHTML =
        "<div class='match-bar'><span>Time <span id='matchTime'>" + formatTime(currentMatchTime()) + "</span></span><span>Combo " + matchCombo + "</span><span>Matched " + matchedCount + "/" + questions.length + "</span></div>" +
        "<p class='match-help'>Left = questions. Right = answers.</p>" +
        "<div class='match-grid'><div>" + questions.map(function(q) {
            return "<button class='match-item question" + (q.matched ? " matched" : "") + (selectedQuestion === q.id ? " selected" : "") + "' data-qid='" + q.id + "'>" + escapeHtml(q.text) + "</button>";
        }).join("") + "</div><div>" + answers.map(function(a) {
            return "<button class='match-item answer" + (a.matched ? " matched" : "") + (selectedAnswer === a.id ? " selected" : "") + "' data-aid='" + a.id + "'>" + escapeHtml(a.text) + "</button>";
        }).join("") + "</div></div>";
    matchBox.querySelectorAll("[data-qid]").forEach(function(btn) {
        btn.addEventListener("click", function() {
            const id = Number(btn.getAttribute("data-qid"));
            if (questions.find(function(q) { return q.id === id && !q.matched; })) {
                selectedQuestion = id;
                tryMatch();
            }
        });
    });
    matchBox.querySelectorAll("[data-aid]").forEach(function(btn) {
        btn.addEventListener("click", function() {
            const id = Number(btn.getAttribute("data-aid"));
            if (answers.find(function(a) { return a.id === id && !a.matched; })) {
                selectedAnswer = id;
                tryMatch();
            }
        });
    });
}

function tryMatch() {
    if (selectedQuestion === null || selectedAnswer === null) {
        drawMatch();
        return;
    }
    if (selectedQuestion === selectedAnswer) {
        questions.find(function(q) { return q.id === selectedQuestion; }).matched = true;
        answers.find(function(a) { return a.id === selectedAnswer; }).matched = true;
        matchedCount += 1;
        matchCombo += 1;
        if (matchCombo > maxCombo) maxCombo = matchCombo;
        selectedQuestion = null;
        selectedAnswer = null;
        if (matchedCount === questions.length) { stopTimer(); finishMatch(); return; }
    } else {
        matchWrong += 1;
        penaltySeconds += 1;
        matchCombo = 0;
        const pair = allCards.find(function(c) { return c.id === selectedQuestion; });
        if (pair && !missedPairs.some(function(p) { return p.id === pair.id; })) missedPairs.push(pair);
        selectedQuestion = null;
        selectedAnswer = null;
    }
    drawMatch();
}

function finishMatch() {
    const time = currentMatchTime();
    if (!bestTime || time < bestTime) {
        bestTime = time;
        localStorage.setItem("studyai_best_match", String(bestTime));
    }
    const attempts = questions.length + matchWrong;
    const percent = attempts ? Math.round((questions.length / attempts) * 100) : 0;
    matchBox.innerHTML = "<div class='results-box'><h2>Match complete</h2><p>Time: " + formatTime(time) + "</p><p>Accuracy: " + percent + "%</p><p>Wrong matches: " + matchWrong + "</p><p>Best combo: " + maxCombo + "</p>" +
        (missedPairs.length ? "<div class='work-box'><h3>What to work on</h3>" + missedPairs.map(function(p) {
            return "<div class='work-item'><p><strong>" + escapeHtml(p.front) + "</strong></p><p class='right'>" + escapeHtml(p.back) + "</p></div>";
        }).join("") + "</div>" : "<p>Perfect accuracy.</p>") +
        "<button id='playAgain'>Play again</button></div>";
    document.getElementById("playAgain").addEventListener("click", startMatch);
}

function currentMatchTime() { return (Date.now() - matchStart) / 1000 + penaltySeconds; }
function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

function getSavedSets() {
    try { return JSON.parse(localStorage.getItem("studyai_saved_sets") || "[]"); } catch (err) { return []; }
}

function openNameModal(mode, id) {
    renameId = mode === "rename" ? id : null;
    nameModalTitle.textContent = mode === "rename" ? "Rename this study set" : "Name this study set";
    setNameInput.value = "";
    nameModalStatus.textContent = "";
    if (mode === "save" && !lastQuiz.length) {
        alert("Generate a study set first.");
        return;
    }
    if (mode === "rename") {
        const set = getSavedSets().find(function(s) { return s.id === id; });
        if (set) setNameInput.value = set.name;
    }
    nameModal.classList.remove("hidden");
    requestAnimationFrame(function() {
        nameModal.classList.add("open");
    });
    setNameInput.focus();
}

function closeNameModal() {
    nameModal.classList.remove("open");
    setTimeout(function() {
        nameModal.classList.add("hidden");
        renameId = null;
    }, 200);
}

function confirmNameModal() {
    const name = setNameInput.value.trim();
    if (!name) {
        nameModalStatus.textContent = "Please type a name.";
        return;
    }
    const sets = getSavedSets();
    if (renameId) {
        const set = sets.find(function(s) { return s.id === renameId; });
        if (set) set.name = name;
    } else {
        sets.unshift({
            id: Date.now(),
            name: name,
            notes: notesInput.value,
            quiz: lastQuiz,
            created: new Date().toLocaleDateString()
        });
    }
    localStorage.setItem("studyai_saved_sets", JSON.stringify(sets));
    renderSavedSets();
    closeNameModal();
}

function renderSavedSets() {
    const sets = getSavedSets();
    if (!sets.length) {
        savedList.innerHTML = "<div class='empty-state'>No saved sets yet.</div>";
        return;
    }
    savedList.innerHTML = sets.map(function(set) {
        return "<div class='saved-item'><div><strong>" + escapeHtml(set.name) + "</strong><p>" + set.quiz.length + " questions · " + escapeHtml(set.created) + "</p></div><div class='saved-actions'><button class='load-btn' data-load='" + set.id + "'>Open</button><button class='secondary-btn' data-rename='" + set.id + "'>Rename</button><button class='delete-btn' data-delete='" + set.id + "'>Delete</button></div></div>";
    }).join("");
    savedList.querySelectorAll("[data-load]").forEach(function(btn) {
        btn.addEventListener("click", function() {
            const set = getSavedSets().find(function(s) { return s.id === Number(btn.getAttribute("data-load")); });
            if (!set) return;
            applySet(set.quiz, set.notes || "");
            setMode("quiz");
        });
    });
    savedList.querySelectorAll("[data-rename]").forEach(function(btn) {
        btn.addEventListener("click", function() {
            openNameModal("rename", Number(btn.getAttribute("data-rename")));
        });
    });
    savedList.querySelectorAll("[data-delete]").forEach(function(btn) {
        btn.addEventListener("click", function() {
            localStorage.setItem("studyai_saved_sets", JSON.stringify(getSavedSets().filter(function(s) { return s.id !== Number(btn.getAttribute("data-delete")); })));
            renderSavedSets();
        });
    });
}

function shareSet() {
    if (!lastQuiz.length) { alert("Generate a study set first."); return; }
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify({ quiz: lastQuiz, cards: allCards }))));
    const url = location.origin + location.pathname + location.search + "#set=" + encoded;
    navigator.clipboard.writeText(url).then(function() {
        shareBtn.textContent = "Link copied";
        setTimeout(function() { shareBtn.textContent = "Share set"; }, 1500);
    }).catch(function() { prompt("Copy this share link:", url); });
}

function loadSharedSet() {
    if (location.hash.indexOf("#set=") !== 0) return;
    try {
        applySet(JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(5))))).quiz || [], "");
    } catch (err) {}
}

function restoreLastSet() {
    if (location.hash.indexOf("#set=") === 0) return;
    const raw = localStorage.getItem("studyai_last_set");
    if (!raw) return;
    try {
        const data = JSON.parse(raw);
        if (data.quiz && data.quiz.length) applySet(data.quiz, data.notes || "");
    } catch (err) {}
}

function shuffle(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = copy[i]; copy[i] = copy[j]; copy[j] = t;
    }
    return copy;
}
function formatTime(seconds) { return seconds.toFixed(1) + "s"; }
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

const feedbackBtn = document.getElementById("feedbackBtn");
const feedbackModal = document.getElementById("feedbackModal");
const closeFeedback = document.getElementById("closeFeedback");
const submitFeedback = document.getElementById("submitFeedback");
const feedbackText = document.getElementById("feedbackText");
const feedbackStatus = document.getElementById("feedbackStatus");

feedbackBtn.addEventListener("click", function() { feedbackModal.classList.remove("hidden"); });
closeFeedback.addEventListener("click", function() {
    feedbackModal.classList.add("hidden");
    feedbackText.value = "";
    feedbackStatus.textContent = "";
});
submitFeedback.addEventListener("click", async function() {
    const message = feedbackText.value.trim();
    if (!message) { feedbackStatus.textContent = "Please write something first."; return; }
    submitFeedback.disabled = true;
    try {
        const response = await fetch("/feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: message })
        });
        const data = await response.json();
        feedbackStatus.textContent = data.success ? "Thanks! Feedback sent." : (data.error || "Something went wrong.");
    } catch (err) {
        feedbackStatus.textContent = "Saved on this computer. Server not reached.";
    } finally {
        submitFeedback.disabled = false;
    }
});
