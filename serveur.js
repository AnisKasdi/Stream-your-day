const express = require("express");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const port = process.env.PORT || 8080;
const server = http.createServer(app);
const io = new Server(server);

// Initialisation de SQLite
const db = new sqlite3.Database("./streamYourDay.db", (err) => {
    if (err) {
        console.error("Erreur lors de la connexion à SQLite :", err.message);
    } else {
        console.log("Connected to SQLite database");
    }
});

// Création des tables si elles n'existent pas
db.serialize(() => {
    // Table accounts
    db.run(`
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            email TEXT NOT NULL,
            displayName TEXT,
            profilePicture TEXT DEFAULT '/uploads/default.jpg',
            favorites TEXT DEFAULT '[]', -- Stocké en JSON
            watchHistory TEXT DEFAULT '[]', -- Stocké en JSON
            subscriptions TEXT DEFAULT '[]' -- Stocké en JSON
        )
    `);

    // Table streams
    db.run(`
        CREATE TABLE IF NOT EXISTS streams (
            streamId TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            title TEXT NOT NULL,
            category TEXT NOT NULL,
            description TEXT,
            chatEnabled INTEGER DEFAULT 1,
            privateStream INTEGER DEFAULT 0,
            startTime TEXT NOT NULL,
            viewers INTEGER DEFAULT 0,
            active INTEGER DEFAULT 1,
            FOREIGN KEY (username) REFERENCES accounts(username)
        )
    `);
});

// Middleware
app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "src")));

// Gestion des fichiers statiques
app.get("*", (req, res, next) => {
    const filePath = path.join(__dirname, "src", req.path === "/" ? "index.html" : req.path);
    const ext = path.extname(filePath);
    const mimeTypes = {
        ".html": "text/html",
        ".css": "text/css",
        ".js": "text/javascript",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".json": "application/json",
    };
    const contentType = mimeTypes[ext] || "application/octet-stream";

    if (fs.existsSync(filePath)) {
        res.setHeader("Content-Type", contentType);
        res.sendFile(filePath);
    } else if (!req.path.startsWith("/api")) {
        res.status(404).sendFile(path.join(__dirname, "src", "404.html"));
    } else {
        next();
    }
});

// API : Create Account
app.post("/api/create-account", (req, res) => {
    const { username, password, email } = req.body;
    if (!username || !password || !email) {
        return res.status(400).json({ error: "Username, password, and email required" });
    }

    db.get("SELECT username FROM accounts WHERE username = ?", [username], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) return res.status(409).json({ error: "Username already exists" });

        db.run(
            "INSERT INTO accounts (username, password, email, displayName) VALUES (?, ?, ?, ?)",
            [username, password, email, username],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.cookie("username", username, { maxAge: 86400000, path: "/", sameSite: "strict" });
                res.json({ message: "Account created", id: this.lastID });
            }
        );
    });
});

// API : Login
app.post("/api/login", (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
    }

    db.get("SELECT * FROM accounts WHERE username = ? AND password = ?", [username, password], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(401).json({ error: "Invalid credentials" });

        res.cookie("username", username, { maxAge: 86400000, path: "/", sameSite: "strict" });
        res.json({ message: "Login successful" });
    });
});

// API : Get Profile Info
app.get("/api/profile", (req, res) => {
    const username = req.cookies.username;
    if (!username) return res.status(401).json({ error: "Not logged in" });

    db.get("SELECT * FROM accounts WHERE username = ?", [username], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "User not found" });

        res.json({
            username: row.username,
            displayName: row.displayName,
            profilePicture: row.profilePicture,
            favorites: JSON.parse(row.favorites),
            watchHistory: JSON.parse(row.watchHistory),
            subscriptions: JSON.parse(row.subscriptions),
        });
    });
});

// API : Logout
app.get("/api/logout", (req, res) => {
    res.clearCookie("username", { path: "/" });
    res.json({ message: "Déconnexion réussie" });
});

// API : Démarrer un stream
app.post("/api/start-stream", (req, res) => {
    const username = req.cookies.username;
    if (!username) return res.status(401).json({ error: "Non connecté" });

    const { title, category, description, chatEnabled, privateStream } = req.body;
    const streamId = `${username}-${Date.now()}`;
    const startTime = new Date().toISOString();

    db.run(
        "INSERT INTO streams (streamId, username, title, category, description, chatEnabled, privateStream, startTime) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [streamId, username, title, category, description, chatEnabled ? 1 : 0, privateStream ? 1 : 0, startTime],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Stream démarré", streamId });
        }
    );
});

// API : Liste des streams actifs
app.get("/api/active-streams", (req, res) => {
    db.all("SELECT * FROM streams WHERE active = 1", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// API : S'abonner à un utilisateur
app.post("/api/subscribe", (req, res) => {
    const subscriber = req.cookies.username;
    const { streamer } = req.body;
    if (!subscriber) return res.status(401).json({ error: "Non connecté" });

    db.get("SELECT subscriptions FROM accounts WHERE username = ?", [subscriber], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        let subscriptions = JSON.parse(row.subscriptions || "[]");
        if (!subscriptions.includes(streamer)) subscriptions.push(streamer);

        db.run(
            "UPDATE accounts SET subscriptions = ? WHERE username = ?",
            [JSON.stringify(subscriptions), subscriber],
            (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: `Abonné à ${streamer}` });
            }
        );
    });
});

// API : Ajouter un like/favori à un stream
app.post("/api/like-stream", (req, res) => {
    const username = req.cookies.username;
    const { streamId } = req.body;
    if (!username) return res.status(401).json({ error: "Non connecté" });

    db.get("SELECT favorites FROM accounts WHERE username = ?", [username], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        let favorites = JSON.parse(row.favorites || "[]");
        if (!favorites.includes(streamId)) favorites.push(streamId);

        db.run(
            "UPDATE accounts SET favorites = ? WHERE username = ?",
            [JSON.stringify(favorites), username],
            (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: "Stream ajouté aux favoris" });
            }
        );
    });
});

// Gestion des connexions WebRTC avec Socket.IO
io.on("connection", (socket) => {
    console.log("Utilisateur connecté :", socket.id);

    socket.on("start-stream", (streamId) => {
        socket.join(streamId);
        socket.broadcast.emit("new-stream", streamId);
    });

    socket.on("offer", (offer, streamId) => {
        socket.to(streamId).emit("offer", offer, socket.id);
    });

    socket.on("answer", (answer, callerId) => {
        socket.to(callerId).emit("answer", answer);
    });

    socket.on("ice-candidate", (candidate, streamId) => {
        socket.to(streamId).emit("ice-candidate", candidate);
    });

    socket.on("disconnect", () => {
        console.log("Utilisateur déconnecté :", socket.id);
    });
});

// Démarrer le serveur
server.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
});