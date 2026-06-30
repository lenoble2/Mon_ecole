require('dotenv').config();
const express = require('express');
const { Client } = require('pg');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('.'));

// Configuration client PostgreSQL
const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Connexion simple
client.connect()
    .then(() => console.log('Connecté à Aiven avec succès !'))
    .catch(err => console.error('Erreur de connexion :', err));

const PORT = process.env.PORT || 8081;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur actif sur le port ${PORT}`);
});
