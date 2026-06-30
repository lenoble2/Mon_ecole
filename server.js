require('dotenv').config();
const express = require('express');
const { Client } = require('pg');
const session = require('express-session');
const app = express();

// --- CONFIGURATION ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('.'));

app.use(session({
    secret: 'CHANGEZ_CE_SECRET_PAR_QUELQUE_CHOSE_DE_LONG',
    resave: false,
    saveUninitialized: false
}));

// --- CONNEXION BASE DE DONNÉES ---
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// TEST DE CONNEXION IMMÉDIAT
client.connect((err) => {
  if (err) {
    console.error('ERREUR CRITIQUE DE CONNEXION :', err.stack);
  } else {
    console.log('CONNEXION RÉUSSIE À LA BASE DE DONNÉES AIVEN !');
  }
});


// --- ROUTES DE BASE ---
app.get('/', (req, res) => res.sendFile(__dirname + '/login.html'));

// Ajoutez vos routes ici, exemple :
// app.post('/login', async (req, res) => { ... });

// --- LANCEMENT ---
const PORT = process.env.PORT || 8081;
app.listen(PORT, '0.0.0.0', () => console.log(`Serveur actif sur le port ${PORT}`));
