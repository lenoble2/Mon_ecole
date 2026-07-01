require('dotenv').config();
const express = require('express');
const fs = require('fs');
const csv = require('csv-parser');
const { Client } = require('pg'); 
const multer = require('multer');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();

// --- CONFIGURATION ---
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const upload = multer({ dest: uploadDir });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('.'));
app.use('/uploads', express.static(uploadDir));

app.use(session({
    secret: 'CHANGEZ_CE_SECRET_PAR_QUELQUE_CHOSE_DE_LONG',
    resave: false,
    saveUninitialized: false
}));

// --- CONNEXION BASE DE DONNÉES ---
const client = new Client({
    connectionString: process.env.DATABASE_URL,
    host: process.env.PGHOST,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    port: process.env.PGPORT,
    ssl: { rejectUnauthorized: false }
});

client.connect()
    .then(() => console.log('Connexion réussie à la base Railway !'))
    .catch(err => console.error('Erreur de connexion :', err.stack));

// --- ROUTES ---
// Exemple pour tester la lecture de votre table :
app.get('/test-db', (req, res) => {
    client.query('SELECT * FROM "Monecole"', (err, result) => {
        if (err) {
            res.status(500).send('Erreur : ' + err.message);
        } else {
            res.json(result.rows);
        }
    });
});



// Route pour ajouter un élève
app.post('/ajouter', (req, res) => {
    const nomEleve = req.body.nom; // Le nom envoyé depuis votre formulaire HTML
    
    // On utilise bien les guillemets doubles pour le nom de la table
    const query = 'INSERT INTO "Monecole" (nom) VALUES ($1)';
    
    client.query(query, [nomEleve], (err, result) => {
        if (err) {
            console.error('Erreur lors de l\'ajout :', err);
            return res.status(500).send('Erreur serveur');
        }
        res.send('Donnée ajoutée avec succès !');
    });
});



app.listen(process.env.PORT || 8081, () => {
    console.log('Serveur actif sur le port ' + (process.env.PORT || 8081));
});

