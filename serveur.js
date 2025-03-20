
const http = require("http");
const fs = require("fs");
const path = require("path");
//const axios = require("axios"); maybe we will need it later
const url = require("url");
//const sqlite3 = require("sqlite3").verbose();
//const multer = require("multer"); maybe we will need it later
const uploadDir = path.join(__dirname, "src");
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Partie coockies 
function parseCookies(request) {
    const list = {};
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader) return list;
    cookieHeader.split(';').forEach(cookie => {
        let parts = cookie.split('=');
        list[parts.shift().trim()] = decodeURI(parts.join('='));
    });
    return list;
}
const server = http.createServer(async (request, response) => {
    const parsedUrl = url.parse(request.url, true);
    const urlWithoutQuery = parsedUrl.pathname;
    const filePath = "./src" + (urlWithoutQuery === "/" ? "/index.html" : urlWithoutQuery);
    const ext = path.extname(filePath);
    const mimeTypes = {
        ".html": "text/html",
        ".css": "text/css",
        ".js": "text/javascript",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".json": "application/json"
    };
    const contentType = mimeTypes[ext] || "application/octet-stream";
    const encoding = (contentType.startsWith("text") || contentType === "application/json") ? "utf8" : null;
    if (parsedUrl.pathname === "/api/create-account" && request.method === "POST") {
        try {
            const body = await parseRequestBody(request);
            const { username, password } = body;
            if (!username || !password) {
                response.statusCode = 400;
                response.end(JSON.stringify({ error: "Username et password requis" }));
                return;
            }
            db.run("INSERT INTO accounts (username, password, displayName, profilePicture, favorites, watchHistory) VALUES (?, ?, ?, ?, ?, ?)",
                [username, password, username, "/uploads/default.jpg", JSON.stringify([]), JSON.stringify([])],
                function (err) {
                    if (err) {
                        response.statusCode = 500;
                        response.end(JSON.stringify({ error: err.message }));
                    } else {
                        response.setHeader("Content-Type", "application/json");
                        response.setHeader("Set-Cookie", `username=${username}; Path=/; Max-Age=86400; SameSite=Strict`);
                        response.end(JSON.stringify({ message: "Compte créé", id: this.lastID }));
                    }
                }
            );
        } catch (err) {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: "Requête invalide" }));
        }
        return;
    }

    // Route API pour la connexion
    if (parsedUrl.pathname === "/api/login" && request.method === "POST") {
        try {
            const body = await parseRequestBody(request);
            const { username, password } = body;
            if (!username || !password) {
                response.statusCode = 400;
                response.end(JSON.stringify({ error: "Username et password requis" }));
                return;
            }
            db.get("SELECT * FROM accounts WHERE username = ? AND password = ?", [username, password], (err, row) => {
                if (err) {
                    response.statusCode = 500;
                    response.end(JSON.stringify({ error: err.message }));
                } else if (row) {
                    response.setHeader("Content-Type", "application/json");
                    response.setHeader("Set-Cookie", `username=${username}; Path=/; Max-Age=86400; SameSite=Strict`);
                    response.end(JSON.stringify({ message: "Connexion réussie" }));
                } else {
                    response.statusCode = 401;
                    response.end(JSON.stringify({ error: "Identifiants invalides" }));
                }
            });
        } catch (err) {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: "Requête invalide" }));
        }
        return;
    }

    // Route API pour mettre à jour le mot de passe
    if (parsedUrl.pathname === "/api/update-password" && request.method === "POST") {
        try {
            const body = await parseRequestBody(request);
            const { username, oldPassword, newPassword } = body;
            if (!username || !oldPassword || !newPassword) {
                response.statusCode = 400;
                response.end(JSON.stringify({ error: "Tous les champs sont requis" }));
                return;
            }
            db.get("SELECT * FROM accounts WHERE username = ? AND password = ?", [username, oldPassword], (err, row) => {
                if (err) {
                    response.statusCode = 500;
                    response.end(JSON.stringify({ error: err.message }));
                } else if (row) {
                    db.run("UPDATE accounts SET password = ? WHERE username = ?", [newPassword, username], (err2) => {
                        if (err2) {
                            response.statusCode = 500;
                            response.end(JSON.stringify({ error: err2.message }));
                        } else {
                            response.end(JSON.stringify({ message: "Mot de passe mis à jour" }));
                        }
                    });
                } else {
                    response.statusCode = 401;
                    response.end(JSON.stringify({ error: "Ancien mot de passe incorrect" }));
                }
            });
        } catch (err) {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: "Requête invalide" }));
        }
        return;
    }
    fs.readFile(filePath, encoding, (err, data) => {
        if (err) {
            response.statusCode = 404;
            response.setHeader("Content-Type", "text/html");
            response.end(fs.readFileSync("./src/404.html", "utf8"));
        } else {
            response.setHeader("Content-Type", contentType);
            response.end(data);
        }
    });
});

const port = 8081;
server.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
});