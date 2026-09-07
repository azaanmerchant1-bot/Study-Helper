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
