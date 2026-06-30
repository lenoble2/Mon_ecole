require('dotenv').config();
const express = require('express');
const fs = require('fs');
const csv = require('csv-parser');
const { Client } = require('pg'); 
const multer = require('multer');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Configuration PostgreSQL unique
const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('.'));
app.use(session({
    secret: 'monSecret',
    resave: false,
    saveUninitialized: true
}));

// INITIALISATION ET CONNEXION
client.connect()
    .then(async () => {
        console.log('Connecté à Aiven avec succès !');

        // INITIALISATION DES TABLES (déplacé ici pour être dans la fonction async)
        try {
            await client.query(`CREATE TABLE IF NOT EXISTS configuration (
                nom_ecole TEXT PRIMARY KEY,
                drena TEXT, iepp TEXT, nom_directeur TEXT, logo_iepp TEXT, logo_ecole TEXT
            )`);

            await client.query(`CREATE TABLE IF NOT EXISTS eleves (
                id SERIAL PRIMARY KEY,
                annee TEXT, matricule TEXT, nom TEXT, prenoms TEXT, sexe TEXT,
                date_naissance TEXT, pays TEXT, localite TEXT, mere TEXT, pere TEXT,
                contact TEXT, nationalite TEXT, num_acte TEXT, date_etab TEXT,
                lieu_etab TEXT, ecole TEXT, niveau TEXT, nom_ecole TEXT,
                moyenne REAL, rang INTEGER, photo TEXT, document TEXT
            )`);

            await client.query(`CREATE TABLE IF NOT EXISTS utilisateurs (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE,
                password TEXT,
                nom_ecole TEXT,
                telephone TEXT
            )`);
            console.log('Tables vérifiées/créées.');
        } catch (err) {
            console.error('Erreur lors de la création des tables :', err);
        }
    })
    .catch(err => {
        console.error('Erreur de connexion à la base de données :', err);
    });

const PORT = process.env.PORT || 8081;

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur actif sur le port ${PORT}`);
});

