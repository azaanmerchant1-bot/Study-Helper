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

const API_BASE = "";
const DAILY_LIMIT = 5;

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

document.querySelectorAll("[data-mode]").forEach(function(btn) {
    btn.addEventListener("click", function() {
        setMode(btn.getAttribute("data-mode"));
    });
});

shareBtn.addEventListener("click", shareSet);
saveBtn.addEventListener("click", saveCurrentSet);
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
    const raw = localStorage.getItem("studyai_usage");
    if (!raw) return { date: today, count: 0 };
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        return { date: today, count: 0 };
    }
    if (!parsed || parsed.date !== today || typeof parsed.count !== "number") {
        return { date: today, count: 0 };
    }
    return parsed;
}

function saveUsageData(data) {
    localStorage.setItem("studyai_usage", JSON.stringify(data));
}

function getRemaining() {
    return Math.max(0, DAILY_LIMIT - getUsageData().count);
}

function useOneGeneration() {
    const usage = getUsageData();
    usage.count += 1;
    saveUsageData(usage);
}

function updateLimitDisplay() {
    const remaining = getRemaining();
    let badge = document.getElementById("limitBadge");
    if (!badge) {
        badge = document.createElement("span");
        badge.id = "limitBadge";
        badge.className = "limit-badge";
        generateBtn.insertAdjacentElement("afterend", badge);
    }
    badge.textContent = remaining + " free left today";
}

function updateStreak() {
    const today = getTodayString();
    const raw = localStorage.getItem("studyai_streak");
    let data = raw ? JSON.parse(raw) : { count: 0, lastDate: null };

    if (data.lastDate === today) return;

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.getFullYear() + "-" + String(yesterday.getMonth() + 1).padStart(2, "0") + "-" + String(yesterday.getDate()).padStart(2, "0");

    if (data.lastDate === yesterdayStr) {
        data.count += 1;
    } else {
        data.count = 1;
    }

    data.lastDate = today;
    localStorage.setItem("studyai_streak", JSON.stringify(data));
}

function updateStreakDisplay() {
    const raw = localStorage.getItem("studyai_streak");
    const data = raw ? JSON.parse(raw) : { count: 0, lastDate: null };

    const today = getTodayString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.getFullYear() + "-" + String(yesterday.getMonth() + 1).padStart(2, "0") + "-" + String(yesterday.getDate()).padStart(2, "0");

    let displayCount = data.count;
    if (data.lastDate !== today && data.lastDate !== yesterdayStr) {
        displayCount = 0;
    }

    if (!streakBadge) return;
    streakBadge.textContent = displayCount > 0 ? "🔥 " + displayCount + " day streak" : "Start your streak today";
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
    if (mode === "quiz" && !lastQuiz.length) {
        output.innerHTML = "<div class='empty-state'>Generate a study set, then take the quiz.</div>";
    }
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
        const response = await fetch(API_BASE + "/generate-quiz", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notes: notesText, questionCount: questionCountInput.value })
        });
        const data = await response.json();
        if (data.error) {
            showError(data.error);
            updateLimitDisplay();
            return;
        }

        useOneGeneration();
        updateLimitDisplay();
        updateStreak();
        updateStreakDisplay();
        applySet(data.quiz || [], notesText);
    } catch (err) {
        showError("Could not reach the server. Is it running?");
        updateLimitDisplay();
    } finally {
        generateBtn.disabled = false;
    }
});

function applySet(quiz, notesText) {
    lastQuiz = quiz;
    allCards = lastQuiz.map(function(q, i) {
        return { id: i, front: q.question, back: q.correctAnswer };
    });
    if (notesText) notesInput.value = notesText;
    resetFlashProgress();
    saveLastSet();
    displayQuiz(lastQuiz);
}

function resetFlashProgress() {
    queue = allCards.slice();
    knownCards = [];
    learningCards = [];
}

function showError(message) {
    setMode("quiz");
    output.innerHTML = `<div class="empty-state"><p>${message}</p><button id="retryBtn">Try Again</button></div>`;
    document.getElementById("retryBtn").addEventListener("click", function() {
        generateBtn.click();
    });
}

function displayQuiz(quiz) {
    output.innerHTML = "";
    quizAnswers = [];
    quiz.forEach(function(q, index) {
        const card = document.createElement("div");
        card.className = "question-card";
        card.innerHTML = `<p class="question-text">${index + 1}. ${escapeHtml(q.question)}</p>`;
        q.choices.forEach(function(choice) {
            const btn = document.createElement("button");
            btn.className = "choice-btn";
            btn.textContent = choice;
            btn.addEventListener("click", function() {
                if (quizAnswers.some(function(a) { return a.index === index; })) return;
                const isCorrect = choice === q.correctAnswer;
                quizAnswers.push({
                    index: index,
                    question: q.question,
                    chosen: choice,
                    correctAnswer: q.correctAnswer,
                    isCorrect: isCorrect
                });
                card.querySelectorAll(".choice-btn").forEach(function(b) {
                    b.disabled = true;
                    if (b.textContent === q.correctAnswer) b.classList.add("correct");
                });
                if (!isCorrect) {
                    btn.classList.add("incorrect");
                    addExplainButton(card, q.question, choice, q.correctAnswer);
                }
                if (quizAnswers.length === quiz.length) showQuizResults(quiz);
            });
            card.appendChild(btn);
        });
        output.appendChild(card);
    });
}

function addExplainButton(card, question, chosen, correctAnswer) {
    const explainBtn = document.createElement("button");
    explainBtn.className = "explain-btn";
    explainBtn.textContent = "Explain this";
    explainBtn.addEventListener("click", async function() {
        explainBtn.textContent = "Getting explanation...";
        explainBtn.disabled = true;
        try {
            const response = await fetch(API_BASE + "/explain", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question: question, chosen: chosen, correctAnswer: correctAnswer })
            });
            const data = await response.json();
            const box = document.createElement("div");
            box.className = "explain-box";
            box.textContent = data.explanation || data.error || "No explanation available.";
            explainBtn.replaceWith(box);
        } catch (err) {
            explainBtn.textContent = "Could not load explanation";
            explainBtn.disabled = false;
        }
    });
    card.appendChild(explainBtn);
}

function showQuizResults(quiz) {
    const correctCount = quizAnswers.filter(function(a) { return a.isCorrect; }).length;
    const missed = quizAnswers.filter(function(a) { return !a.isCorrect; });
    const box = document.createElement("div");
    box.className = "results-box";
    box.innerHTML = `<h2>Quiz score: ${correctCount} / ${quiz.length}</h2>` +
        (missed.length ? `<div class="work-box"><h3>What to work on</h3>${missed.map(function(item) {
            return `<div class="work-item"><p><strong>${escapeHtml(item.question)}</strong></p><p class="wrong">Your answer: ${escapeHtml(item.chosen)}</p><p class="right">Correct: ${escapeHtml(item.correctAnswer)}</p></div>`;
        }).join("")}</div>` : "<p>Perfect score.</p>");
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
    if (!queue.length) {
        if (learningCards.length) {
            queue = learningCards.slice();
            learningCards = [];
            flashcardsBox.innerHTML = `<div class="empty-state"><p>You knew ${knownCards.length} of ${allCards.length}.</p><p>Review the ${queue.length} you marked Still learning.</p><div class="flash-actions"><button id="startReview">Review those cards</button><button id="seeAllBtn" class="secondary-btn">See all cards</button></div></div>`;
            document.getElementById("startReview").addEventListener("click", renderFlashcards);
            document.getElementById("seeAllBtn").addEventListener("click", function() { showingAllCards = true; renderAllCards(); });
            return;
        }
        flashcardsBox.innerHTML = `<div class="empty-state"><p>Finished. You knew ${knownCards.length} of ${allCards.length}.</p><div class="flash-actions"><button id="restartCards">Study again</button><button id="seeAllBtn" class="secondary-btn">See all cards</button></div></div>`;
        document.getElementById("restartCards").addEventListener("click", function() { resetFlashProgress(); renderFlashcards(); });
        document.getElementById("seeAllBtn").addEventListener("click", function() { showingAllCards = true; renderAllCards(); });
        return;
    }
    const card = queue[0];
    flashcardsBox.innerHTML = `<div class="flash-wrap"><p class="flash-progress">Known ${knownCards.length} · Left ${queue.length + learningCards.length}</p><div class="flash-card" id="flashCard"><div class="flash-inner"><div class="flash-front">${escapeHtml(card.front)}</div><div class="flash-back">${escapeHtml(card.back)}</div></div></div><div class="flash-actions"><button id="learningBtn">Still learning</button><button id="knowBtn">I know this</button><button id="seeAllBtn" class="secondary-btn">See all cards</button></div></div>`;
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
    flashcardsBox.innerHTML = `<div class="flash-wrap"><p class="flash-progress">All cards</p><div class="all-list">${allCards.map(function(card, i) {
        return `<div class="all-card"><p><strong>${i + 1}. ${escapeHtml(card.front)}</strong></p><p>${escapeHtml(card.back)}</p></div>`;
    }).join("")}</div><button id="backToStudy">Back to study</button></div>`;
    document.getElementById("backToStudy").addEventListener("click", function() { showingAllCards = false; renderFlashcards(); });
}

function renderMatchStart() {
    stopTimer();
    if (!allCards.length) {
        matchBox.innerHTML = "<div class='empty-state'>Generate a study set first, then play Match.</div>";
        return;
    }
    matchBox.innerHTML = `<div class="empty-state"><h2>Match</h2><p>Click one question on the left, then the matching answer on the right.</p><p>Wrong match adds 1 second. Best time: ${bestTime ? formatTime(bestTime) : "none yet"}</p><button id="startMatch">Start Match</button></div>`;
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
    matchBox.innerHTML = `
        <div class="match-bar">
            <span>Time <span id="matchTime">${formatTime(currentMatchTime())}</span></span>
            <span>Combo ${matchCombo}</span>
            <span>Matched ${matchedCount}/${questions.length}</span>
        </div>
        <p class="match-help">Click a purple question, then a green answer.</p>
        <div class="match-grid">
            <div class="match-col">
                <h3>Questions</h3>
                ${questions.map(function(q) {
                    return `<button class="match-item question${q.matched ? " matched" : ""}${selectedQuestion === q.id ? " selected" : ""}" data-qid="${q.id}">${escapeHtml(q.text)}</button>`;
                }).join("")}
            </div>
            <div class="match-col">
                <h3>Answers</h3>
                ${answers.map(function(a) {
                    return `<button class="match-item answer${a.matched ? " matched" : ""}${selectedAnswer === a.id ? " selected" : ""}" data-aid="${a.id}">${escapeHtml(a.text)}</button>`;
                }).join("")}
            </div>
        </div>`;

    matchBox.querySelectorAll("[data-qid]").forEach(function(btn) {
        btn.addEventListener("click", function() {
            const id = Number(btn.getAttribute("data-qid"));
            const item = questions.find(function(q) { return q.id === id; });
            if (!item || item.matched) return;
            selectedQuestion = id;
            tryMatch();
        });
    });
    matchBox.querySelectorAll("[data-aid]").forEach(function(btn) {
        btn.addEventListener("click", function() {
            const id = Number(btn.getAttribute("data-aid"));
            const item = answers.find(function(a) { return a.id === id; });
            if (!item || item.matched) return;
            selectedAnswer = id;
            tryMatch();
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
        if (matchedCount === questions.length) {
            stopTimer();
            finishMatch();
            return;
        }
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
    matchBox.innerHTML = `<div class="results-box"><h2>Match complete</h2><p>Time: ${formatTime(time)}</p><p>Wrong matches: ${matchWrong}</p><p>Best combo: ${maxCombo}</p><p>Personal best: ${formatTime(bestTime)}</p>${missedPairs.length ? `<div class="work-box"><h3>What to work on</h3>${missedPairs.map(function(p) {
        return `<div class="work-item"><p><strong>${escapeHtml(p.front)}</strong></p><p class="right">${escapeHtml(p.back)}</p></div>`;
    }).join("")}</div>` : "<p>Perfect accuracy.</p>"}<button id="playAgain">Play again</button></div>`;
    document.getElementById("playAgain").addEventListener("click", startMatch);
}

function currentMatchTime() {
    return (Date.now() - matchStart) / 1000 + penaltySeconds;
}

function stopTimer() {
    if (timerId) { clearInterval(timerId); timerId = null; }
}

function getSavedSets() {
    const raw = localStorage.getItem("studyai_saved_sets");
    return raw ? JSON.parse(raw) : [];
}

function writeSavedSets(sets) {
    localStorage.setItem("studyai_saved_sets", JSON.stringify(sets));
}

function saveLastSet() {
    localStorage.setItem("studyai_last_set", JSON.stringify({
        quiz: lastQuiz,
        notes: notesInput.value
    }));
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

function saveCurrentSet() {
    if (!lastQuiz.length) {
        alert("Generate a study set first.");
        return;
    }
    const name = prompt("Name this study set:", "My study set");
    if (!name) return;
    const sets = getSavedSets();
    sets.unshift({
        id: Date.now(),
        name: name.trim(),
        notes: notesInput.value,
        quiz: lastQuiz,
        created: new Date().toLocaleDateString()
    });
    writeSavedSets(sets);
    renderSavedSets();
    saveBtn.textContent = "Saved";
    setTimeout(function() { saveBtn.textContent = "Save set"; }, 1200);
}

function renderSavedSets() {
    const sets = getSavedSets();
    if (!sets.length) {
        savedList.innerHTML = "<div class='empty-state'>No saved sets yet.</div>";
        return;
    }
    savedList.innerHTML = sets.map(function(set) {
        return `<div class="saved-item">
            <div>
                <strong>${escapeHtml(set.name)}</strong>
                <p>${set.quiz.length} questions · ${escapeHtml(set.created)}</p>
            </div>
            <div class="saved-actions">
                <button class="load-btn" data-load="${set.id}">Open</button>
                <button class="secondary-btn" data-rename="${set.id}">Rename</button>
                <button class="delete-btn" data-delete="${set.id}">Delete</button>
            </div>
        </div>`;
    }).join("");

    savedList.querySelectorAll("[data-load]").forEach(function(btn) {
        btn.addEventListener("click", function() {
            const id = Number(btn.getAttribute("data-load"));
            const set = getSavedSets().find(function(s) { return s.id === id; });
            if (!set) return;
            applySet(set.quiz, set.notes || "");
            setMode("quiz");
            window.scrollTo({ top: 0, behavior: "smooth" });
        });
    });

    savedList.querySelectorAll("[data-rename]").forEach(function(btn) {
        btn.addEventListener("click", function() {
            const id = Number(btn.getAttribute("data-rename"));
            const sets = getSavedSets();
            const set = sets.find(function(s) { return s.id === id; });
            if (!set) return;
            const newName = prompt("Rename this study set:", set.name);
            if (!newName || !newName.trim()) return;
            set.name = newName.trim();
            writeSavedSets(sets);
            renderSavedSets();
        });
    });

    savedList.querySelectorAll("[data-delete]").forEach(function(btn) {
        btn.addEventListener("click", function() {
            const id = Number(btn.getAttribute("data-delete"));
            writeSavedSets(getSavedSets().filter(function(s) { return s.id !== id; }));
            renderSavedSets();
        });
    });
}

function shareSet() {
    if (!lastQuiz.length) {
        alert("Generate a study set first.");
        return;
    }
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify({ quiz: lastQuiz, cards: allCards }))));
    const url = location.origin + location.pathname + location.search + "#set=" + encoded;
    navigator.clipboard.writeText(url).then(function() {
        shareBtn.textContent = "Link copied";
        setTimeout(function() { shareBtn.textContent = "Share set"; }, 1500);
    }).catch(function() {
        prompt("Copy this share link:", url);
    });
}

function loadSharedSet() {
    if (location.hash.indexOf("#set=") !== 0) return;
    try {
        const data = JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(5)))));
        applySet(data.quiz || [], "");
    } catch (err) {
        console.error(err);
    }
}

function shuffle(list) {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = copy[i];
        copy[i] = copy[j];
        copy[j] = t;
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

feedbackBtn.addEventListener("click", function() {
    feedbackModal.classList.remove("hidden");
});
closeFeedback.addEventListener("click", function() {
    feedbackModal.classList.add("hidden");
    feedbackText.value = "";
    feedbackStatus.textContent = "";
});
submitFeedback.addEventListener("click", async function() {
    const message = feedbackText.value.trim();
    if (!message) {
        feedbackStatus.textContent = "Please write something first.";
        return;
    }
    submitFeedback.disabled = true;
    feedbackStatus.textContent = "Sending...";
    try {
        const response = await fetch(API_BASE + "/feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: message })
        });
        const data = await response.json();
        if (data.success) {
            feedbackStatus.textContent = "Thanks! Feedback sent.";
            feedbackText.value = "";
            setTimeout(function() {
                feedbackModal.classList.add("hidden");
                feedbackStatus.textContent = "";
            }, 1200);
        } else {
            feedbackStatus.textContent = data.error || "Something went wrong.";
        }
    } catch (err) {
        feedbackStatus.textContent = "Could not reach the server.";
    } finally {
        submitFeedback.disabled = false;
    }
});