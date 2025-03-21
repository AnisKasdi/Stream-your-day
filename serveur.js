const express = require("express");
const { MongoClient } = require("mongodb");
const cookieParser = require("cookie-parser");
const bodyParser = require("body-parser");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const port = 8080;

// Créer un serveur HTTP pour Express et Socket.IO
const server = http.createServer(app);
const io = new Server(server);

// MongoDB connection
const uri = "mongodb://localhost:27017";
const client = new MongoClient(uri);
let db;

async function connectToMongo() {
    try {
        await client.connect();
        db = client.db("streamYourDay");
        console.log("Connected to MongoDB");
    } catch (err) {
        console.error("Failed to connect to MongoDB", err);
    }
}

connectToMongo();

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
app.post("/api/create-account", async (req, res) => {
    const { username, password, email } = req.body;
    if (!username || !password || !email) {
        return res.status(400).json({ error: "Username, password, and email required" });
    }

    try {
        const existingUser = await db.collection("accounts").findOne({ username });
        if (existingUser) {
            return res.status(409).json({ error: "Username already exists" });
        }

        const result = await db.collection("accounts").insertOne({
            username,
            password, // In production, hash the password (e.g., using bcrypt)
            email,
            displayName: username,
            profilePicture: "/uploads/default.jpg",
            favorites: [],
            watchHistory: [],
            subscriptions: [], // Ajouté pour les abonnements
        });

        res.cookie("username", username, {
            maxAge: 86400000, // 24 hours
            path: "/",
            sameSite: "strict",
        });
        res.json({ message: "Account created", id: result.insertedId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API : Login
app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: "Username and password required" });
    }

    try {
        const user = await db.collection("accounts").findOne({ username, password });
        if (!user) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        res.cookie("username", username, {
            maxAge: 86400000, // 24 hours
            path: "/",
            sameSite: "strict",
        });
        res.json({ message: "Login successful" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API : Get Profile Info
app.get("/api/profile", async (req, res) => {
    const username = req.cookies.username;
    if (!username) {
        return res.status(401).json({ error: "Not logged in" });
    }

    try {
        const user = await db.collection("accounts").findOne({ username });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        res.json({
            username: user.username,
            displayName: user.displayName,
            profilePicture: user.profilePicture,
            favorites: user.favorites,
            watchHistory: user.watchHistory,
            subscriptions: user.subscriptions,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API : Logout
app.get("/api/logout", (req, res) => {
    res.clearCookie("username", { path: "/" });
    res.json({ message: "Déconnexion réussie" });
});

// API : Démarrer un stream
app.post("/api/start-stream", async (req, res) => {
    const username = req.cookies.username;
    if (!username) {
        return res.status(401).json({ error: "Non connecté" });
    }

    const { title, category, description, chatEnabled, privateStream } = req.body;
    try {
        const streamId = `${username}-${Date.now()}`; // Identifiant unique temporaire
        const stream = {
            streamId,
            username,
            title,
            category,
            description,
            chatEnabled,
            privateStream,
            startTime: new Date(),
            viewers: 0,
            active: true,
        };
        await db.collection("streams").insertOne(stream);
        res.json({ message: "Stream démarré", streamId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API : Liste des streams actifs
app.get("/api/active-streams", async (req, res) => {
    try {
        const streams = await db.collection("streams").find({ active: true }).toArray();
        res.json(streams);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API : S'abonner à un utilisateur
app.post("/api/subscribe", async (req, res) => {
    const subscriber = req.cookies.username;
    const { streamer } = req.body;
    if (!subscriber) {
        return res.status(401).json({ error: "Non connecté" });
    }

    try {
        await db.collection("accounts").updateOne(
            { username: subscriber },
            { $addToSet: { subscriptions: streamer } } // Ajoute le streamer aux abonnements
        );
        res.json({ message: `Abonné à ${streamer}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API : Ajouter un like/favori à un stream
app.post("/api/like-stream", async (req, res) => {
    const username = req.cookies.username;
    const { streamId } = req.body;
    if (!username) {
        return res.status(401).json({ error: "Non connecté" });
    }

    try {
        await db.collection("accounts").updateOne(
            { username },
            { $addToSet: { favorites: streamId } }
        );
        res.json({ message: "Stream ajouté aux favoris" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// api pour stoper le stream 
app.post("/api/stop-stream", async (req, res) => {
    const { streamId } = req.body;
    const username = req.cookies.username;
    if (!username) return res.status(401).json({ error: "Non connecté" });

    try {
        await db.collection("streams").updateOne(
            { streamId, username },
            { $set: { active: false } }
        );
        res.json({ message: "Stream arrêté" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Gestion des connexions WebRTC avec Socket.IO
io.on("connection", (socket) => {
    console.log("Utilisateur connecté :", socket.id);

    socket.on("start-stream", (streamId) => {
        socket.join(streamId); // Le streamer rejoint sa propre "room"
        socket.broadcast.emit("new-stream", streamId); // Notifie les autres d’un nouveau stream
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

// Démarrer le serveur HTTP avec Socket.IO
server.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
});