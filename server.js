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

// Lancement
const PORT = process.env.PORT || 8081;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Serveur actif sur le port ${PORT}`);
});

