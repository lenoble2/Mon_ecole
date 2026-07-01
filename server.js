require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const session = require('express-session');
const path = require('path');
const multer = require('multer');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Configuration PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Connexion robuste
async function connectDB() {
    try {
        await pool.query('SELECT NOW()');
        console.log('✅ Connecté à PostgreSQL avec succès !');
    } catch (err) {
        console.error('❌ Erreur, nouvelle tentative dans 5s...', err.message);
        setTimeout(connectDB, 5000);
    }
}
connectDB();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Route test
app.get('/test-db', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT NOW()');
        res.json({ status: "Connecté", time: rows[0] });
    } catch (err) {
        res.status(500).send("Erreur DB");
    }
});


// Assurez-vous d'avoir : const { Pool } = require('pg');
// Assurez-vous d'avoir : const bcrypt = require('bcryptjs');

// --- INITIALISATION DES TABLES ---
async function initDB() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS configuration (
            nom_ecole TEXT PRIMARY KEY,
            drena TEXT, iepp TEXT, nom_directeur TEXT, logo_iepp TEXT, logo_ecole TEXT
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS eleves (
            id SERIAL PRIMARY KEY,
            annee TEXT, matricule TEXT, nom TEXT, prenoms TEXT, sexe TEXT,
            date_naissance TEXT, pays TEXT, localite TEXT, mere TEXT, pere TEXT,
            contact TEXT, nationalite TEXT, num_acte TEXT, date_etab TEXT,
            lieu_etab TEXT, ecole TEXT, niveau TEXT, nom_ecole TEXT,
            moyenne REAL, rang INTEGER, photo TEXT, document TEXT
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS utilisateurs (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE,
            password TEXT,
            nom_ecole TEXT,
            telephone TEXT
        )`);
        console.log('✅ Tables vérifiées/créées.');
    } catch (err) {
        console.error('❌ Erreur lors de la création des tables :', err);
    }
}

// Lancement de l'initialisation
initDB();

// --- INSCRIPTION ---
app.post('/inscription', async (req, res) => {
    const { schoolName, telephone, password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
        return res.send("<script>alert('Mots de passe différents'); window.history.back();</script>");
    }

    try {
        // Utilisation de pool.query
        const check = await pool.query("SELECT * FROM utilisateurs WHERE nom_ecole = $1", [schoolName]);
        if (check.rows.length > 0) {
            return res.send("<script>alert('École déjà enregistrée'); window.history.back();</script>");
        }

        const hash = await bcrypt.hash(password, 10);
        await pool.query("INSERT INTO utilisateurs (nom_ecole, telephone, password) VALUES ($1, $2, $3)",
            [schoolName, telephone, hash]);

        res.send("<script>alert('Inscription réussie !'); window.location.href='/login.html';</script>");
    } catch (err) {
        console.error("❌ Erreur inscription :", err);
        res.status(500).send("Erreur lors de l'inscription");
    }
});

// --- LOGIN ---
app.post('/login', async (req, res) => {
    const { schoolName, password } = req.body;

    try {
        // Utilisation de pool.query
        const result = await pool.query("SELECT * FROM utilisateurs WHERE nom_ecole = $1", [schoolName]);

        if (result.rows.length === 0) {
            return res.send("<script>alert('École non trouvée'); window.history.back();</script>");
        }

        const user = result.rows[0];
        const match = await bcrypt.compare(password, user.password);

        if (match) {
            req.session.nomEcole = user.nom_ecole;
            res.redirect('/accueil.html');
        } else {
            res.send("<script>alert('Mot de passe incorrect'); window.history.back();</script>");
        }
    } catch (err) {
        console.error("❌ Erreur login :", err);
        res.status(500).send("Erreur serveur lors de la connexion");
    }
});




// Lancement
const PORT = process.env.PORT || 8081;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Serveur actif sur le port ${PORT}`);
});

