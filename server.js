require('dotenv').config();
const express = require('express');
const fs = require('fs');
const csv = require('csv-parser');
const { Pool } = require('pg'); // Importation unique de Pool
const multer = require('multer');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Configuration PostgreSQL avec Pool (plus robuste)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

// Test de connexion
pool.query('SELECT NOW()')
    .then(() => console.log('Connecté à Aiven avec succès !'))
    .catch(err => console.error('Erreur connexion base de données :', err));

// Middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('.'));
app.use(session({
    secret: process.env.SESSION_SECRET || 'monSecretTresSecurise',
    resave: false,
    saveUninitialized: true
}));

// ATTENTION : Partout dans votre code, remplacez 'client.query' par 'pool.query'

// --- INITIALISATION DES TABLES ---
// On utilise une fonction asynchrone auto-exécutée pour créer les tables au démarrage
(async () => {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS configuration (
            nom_ecole TEXT PRIMARY KEY,
            drena TEXT, 
            iepp TEXT, 
            nom_directeur TEXT, 
            logo_iepp TEXT, 
            logo_ecole TEXT
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS eleves (
            id SERIAL PRIMARY KEY,
            annee TEXT, 
            matricule TEXT, 
            nom TEXT, 
            prenoms TEXT, 
            sexe TEXT,
            date_naissance TEXT, 
            pays TEXT, 
            localite TEXT, 
            mere TEXT, 
            pere TEXT, 
            contact TEXT, 
            nationalite TEXT, 
            num_acte TEXT, 
            date_etab TEXT, 
            lieu_etab TEXT, 
            ecole TEXT, 
            niveau TEXT, 
            nom_ecole TEXT,
            moyenne REAL, 
            rang INTEGER, 
            photo TEXT, 
            document TEXT
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS utilisateurs (
            id SERIAL PRIMARY KEY,
            nom_ecole TEXT UNIQUE,
            password TEXT,
            telephone TEXT
        )`);
        
        console.log('Tables vérifiées/créées avec succès.');
    } catch (err) {
        console.error('Erreur lors de la création des tables :', err);
    }
})();

// --- ROUTE DE STATUT ---
app.get('/api/status', (req, res) => {
    res.json({ message: "Serveur et Base de données opérationnels" });
});

// Fermeture propre en cas d'arrêt du processus
process.on('SIGINT', async () => {
    await pool.end(); // On ferme le pool proprement
    process.exit();
});



// --- INSCRIPTION ---
app.post('/inscription', async (req, res) => {
    const { schoolName, telephone, password, confirmPassword } = req.body;

    // Validation basique
    if (password !== confirmPassword) {
        return res.send("<script>alert('Les mots de passe ne correspondent pas.'); window.history.back();</script>");
    }

    try {
        // Vérifier si l'école existe déjà
        const check = await pool.query("SELECT * FROM utilisateurs WHERE nom_ecole = $1", [schoolName]);
        if (check.rows.length > 0) {
            return res.send("<script>alert('Cette école est déjà enregistrée.'); window.history.back();</script>");
        }

        // Hachage du mot de passe
        const saltRounds = 10;
        const hash = await bcrypt.hash(password, saltRounds);

        // Insertion
        await pool.query(
            "INSERT INTO utilisateurs (nom_ecole, telephone, password) VALUES ($1, $2, $3)",
            [schoolName, telephone, hash]
        );

        res.send("<script>alert('Inscription réussie ! Vous pouvez vous connecter.'); window.location.href='/login.html';</script>");
    } catch (err) {
        console.error("Erreur lors de l'inscription :", err);
        res.status(500).send("Une erreur est survenue lors de l'inscription.");
    }
});

// --- LOGIN ---
app.post('/login', async (req, res) => {
    const { schoolName, password } = req.body;

    try {
        // 1. Récupérer l'utilisateur
        const result = await pool.query("SELECT * FROM utilisateurs WHERE nom_ecole = $1", [schoolName]);

        if (result.rows.length === 0) {
            return res.send("<script>alert('École non trouvée.'); window.history.back();</script>");
        }

        const user = result.rows[0];

        // 2. Comparer le mot de passe hashé
        const match = await bcrypt.compare(password, user.password);

        if (match) {
            // 3. Créer la session
            req.session.nomEcole = user.nom_ecole;
            req.session.userId = user.id;
            
            res.redirect('/accueil.html');
        } else {
            res.send("<script>alert('Mot de passe incorrect.'); window.history.back();</script>");
        }
    } catch (err) {
        console.error("Erreur lors du login :", err);
        res.status(500).send("Erreur interne du serveur lors de la connexion.");
    }
});




// --- CONFIGURATION ---
app.get('/api/nom-ecole', (req, res) => {
    res.json({ nom: req.session.nomEcole || "Nom de l'école" });
});

// --- GESTION ÉLÈVES (Isolation par école) ---
app.get('/api/eleves/:annee', async (req, res) => {
    if (!req.session.nomEcole) return res.status(401).send("Non connecté");

    try {
        const result = await pool.query(
            "SELECT * FROM eleves WHERE annee = $1 AND nom_ecole = $2 ORDER BY nom ASC",
            [req.params.annee, req.session.nomEcole]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).send("Erreur lors de la récupération.");
    }
});

// --- IMPORTATION CSV (Optimisée avec Pool) ---
app.post('/importer', upload.single('fichier_csv'), (req, res) => {
    if (!req.file) return res.status(400).send("Aucun fichier sélectionné.");
    if (!req.session.nomEcole) return res.status(401).send("Non connecté");

    const anneeImport = req.body.annee_import || '2025';
    const nomEcole = req.session.nomEcole;
    const results = [];

    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            // On extrait un client du pool pour gérer la transaction
            const client = await pool.connect(); 
            try {
                await client.query('BEGIN');

                const sql = `INSERT INTO eleves (
                    annee, matricule, nom, prenoms, sexe, date_naissance,
                    pays, localite, mere, pere, contact, nationalite,
                    num_acte, date_etab, lieu_etab, ecole, niveau, nom_ecole
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`;

                // Insertion sécurisée
                for (const row of results) {
                    await client.query(sql, [
                        anneeImport, row.matricule || '', row.nom || '', row.prenoms || '',
                        row.sexe || '', row.date_naissance || '', row.pays || '',
                        row.localite || '', row.mere || '', row.pere || '',
                        row.contact || '', row.nationalite || '', row.num_acte || '',
                        row.date_etab || '', row.lieu_etab || '', row.ecole || '',
                        row.niveau || '', nomEcole
                    ]);
                }

                await client.query('COMMIT');
                fs.unlinkSync(req.file.path);
                res.redirect(`/liste.html?annee=${anneeImport}`);
            } catch (err) {
                await client.query('ROLLBACK');
                console.error("Erreur lors de l'insertion CSV :", err);
                res.status(500).send("Erreur lors de l'importation.");
            } finally {
                client.release(); // Libération du client vers le pool
            }
        });
});



// --- AJOUT MANUEL ---
app.post('/ajouter-eleve', upload.fields([{ name: 'photo' }, { name: 'document' }]), async (req, res) => {
    try {
        const d = req.body;
        const nomEcole = req.session.nomEcole;
        if (!nomEcole) return res.status(401).send("Erreur : session expirée.");

        const date_naissance = (d.jour && d.mois && d.annee_nais) ? `${d.jour}/${d.mois}/${d.annee_nais}` : '';

        const sql = `INSERT INTO eleves (
            annee, matricule, nom, prenoms, sexe, date_naissance, pays, localite,
            mere, pere, contact, nationalite, num_acte, date_etab, lieu_etab,
            ecole, niveau, nom_ecole
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`;

        await pool.query(sql, [
            d.annee, d.matricule?.trim() || '', d.nom?.trim() || '', d.prenoms?.trim() || '',
            d.sexe, date_naissance, d.pays, d.localite, d.mere, d.pere, d.contact,
            d.nationalite, d.num_acte, d.date_etab, d.lieu_etab, d.ecole, d.niveau, nomEcole
        ]);
        
        res.redirect(`/liste.html?annee=${d.annee}`);
    } catch (err) {
        console.error("Erreur ajout manuel :", err);
        res.status(500).send("Erreur lors de l'enregistrement.");
    }
});

// --- SUPPRESSION ---
app.post('/supprimer-eleves', async (req, res) => {
    if (!req.session.nomEcole) return res.status(401).send("Non connecté");
    
    try {
        const ids = JSON.parse(req.body.ids);
        if (!ids || ids.length === 0) return res.status(400).send("Aucun identifiant reçu.");

        // Construction dynamique des placeholders pour la requête IN
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');

        await pool.query(
            `DELETE FROM eleves WHERE matricule IN (${placeholders}) AND nom_ecole = $${ids.length + 1}`,
            [...ids, req.session.nomEcole]
        );
        res.redirect('/liste.html');
    } catch (err) {
        console.error("Erreur suppression :", err);
        res.status(500).send("Erreur lors de la suppression.");
    }
});

// --- DÉTAIL ÉLÈVE ---
app.get('/api/eleve/:id', async (req, res) => {
    if (!req.session.nomEcole) return res.status(401).send("Non connecté");

    try {
        const result = await pool.query(
            "SELECT * FROM eleves WHERE TRIM(matricule) = $1 AND nom_ecole = $2",
            [req.params.id.trim(), req.session.nomEcole]
        );
        
        result.rows.length > 0 ? res.json(result.rows[0]) : res.status(404).send("Élève non trouvé");
    } catch (err) {
        console.error("Erreur détail élève :", err);
        res.status(500).send("Erreur serveur");
    }
});


// --- MODIFICATION ÉLÈVE ---
app.post('/api/eleve/:id', upload.fields([{ name: 'photo' }, { name: 'document' }]), async (req, res) => {
    if (!req.session.nomEcole) return res.status(401).send("Non connecté");
    
    const matricule = req.params.id.trim();
    const d = req.body;
    const nomEcole = req.session.nomEcole;

    try {
        let fields = [];
        let params = [];
        let i = 1;

        const updateFields = {
            nom: d.nom?.trim() || '', 
            prenoms: d.prenoms?.trim() || '', 
            sexe: d.sexe || '',
            date_naissance: d.date_naissance || '', 
            pays: d.pays || '', 
            localite: d.localite || '',
            mere: d.mere || '', 
            pere: d.pere || '', 
            contact: d.contact || '', 
            nationalite: d.nationalite || '',
            num_acte: d.num_acte || '', 
            date_etab: d.date_etab || '', 
            lieu_etab: d.lieu_etab || '',
            niveau: d.niveau || '', 
            ecole: d.ecole || ''
        };

        for (const [key, value] of Object.entries(updateFields)) {
            fields.push(`${key}=$${i++}`);
            params.push(value);
        }

        // Ajout des conditions WHERE
        params.push(matricule, nomEcole);
        
        // La requête finale : SET fields WHERE matricule=$i AND nom_ecole=$(i+1)
        const query = `UPDATE eleves SET ${fields.join(', ')} WHERE matricule=$${i++} AND nom_ecole=$${i}`;

        await pool.query(query, params);
        
        res.send("<script>alert('Modification réussie !'); window.location.href='/liste.html';</script>");
    } catch (err) {
        console.error("Erreur modification :", err);
        res.status(500).send("Erreur lors de la mise à jour.");
    }
});


// --- MODIFICATION ÉLÈVE (Avec gestion fichiers) ---
app.post('/api/eleve/:id', upload.fields([{ name: 'photo' }, { name: 'document' }]), async (req, res) => {
    if (!req.session.nomEcole) return res.status(401).json({ success: false, error: "Non connecté" });

    const matricule = req.params.id.trim();
    const d = req.body;
    const nomEcole = req.session.nomEcole;

    try {
        let fields = [];
        let params = [];
        let i = 1;

        const updateFields = {
            nom: d.nom?.trim() || '', prenoms: d.prenoms?.trim() || '', sexe: d.sexe || '',
            date_naissance: d.date_naissance || '', pays: d.pays || '', localite: d.localite || '',
            mere: d.mere || '', pere: d.pere || '', contact: d.contact || '', nationalite: d.nationalite || '',
            num_acte: d.num_acte || '', date_etab: d.date_etab || '', lieu_etab: d.lieu_etab || '',
            niveau: d.niveau || '', ecole: d.ecole || ''
        };

        for (const [key, value] of Object.entries(updateFields)) {
            fields.push(`${key}=$${i++}`);
            params.push(value);
        }

        // Gestion des fichiers optionnels
        if (req.files?.photo) {
            fields.push(`photo=$${i++}`);
            params.push('/uploads/' + req.files['photo'][0].filename);
        }
        if (req.files?.document) {
            fields.push(`document=$${i++}`);
            params.push('/uploads/' + req.files['document'][0].filename);
        }

        params.push(matricule, nomEcole);
        const sql = `UPDATE eleves SET ${fields.join(', ')} WHERE TRIM(matricule)=$${i++} AND nom_ecole=$${i}`;

        await pool.query(sql, params);
        res.json({ success: true });
    } catch (err) {
        console.error("Erreur modification :", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- ROUTE D'EXPORTATION CSV ---
app.get('/exporter', async (req, res) => {
    const nomEcole = req.session.nomEcole;
    if (!nomEcole) return res.status(401).send("Non autorisé");

    try {
        const result = await pool.query("SELECT * FROM eleves WHERE nom_ecole = $1", [nomEcole]);
        
        // Définition des colonnes attendues
        const headers = ["annee","matricule","nom","prenoms","sexe","date_naissance","pays","localite","mere","pere","contact","nationalite","num_acte","date_etab","lieu_etab","ecole","niveau"];

        let csvContent = headers.join(",") + "\n";
        result.rows.forEach(row => {
            const values = headers.map(h => row[h] || '');
            const sanitized = values.map(v => `"${String(v).replace(/"/g, '""')}"`);
            csvContent += sanitized.join(",") + "\n";
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="eleves.csv"');
        res.send(csvContent);
    } catch (err) {
        console.error("Erreur exportation :", err);
        res.status(500).send("Erreur serveur : " + err.message);
    }
});


// --- BASCULEMENT DES ÉLÈVES ---
app.post('/api/basculer-eleves', async (req, res) => {
    const { decisions, annee_source } = req.body;
    const annee_cible = (parseInt(annee_source) + 1).toString();
    const nomEcole = req.session.nomEcole;

    if (!nomEcole) return res.status(401).json({ error: "Non autorisé" });

    const passageNiveau = { 'CP1': 'CP2', 'CP2': 'CE1', 'CE1': 'CE2', 'CE2': 'CM1', 'CM1': 'CM2', 'CM2': 'FIN' };

    const client = await pool.connect(); // On extrait un client du pool
    try {
        await client.query('BEGIN');

        for (const item of decisions) {
            const resSelect = await client.query(
                "SELECT * FROM eleves WHERE matricule = $1 AND annee = $2 AND nom_ecole = $3",
                [item.matricule, annee_source, nomEcole]
            );

            if (resSelect.rows.length > 0) {
                const e = resSelect.rows[0];
                let nouveauNiveau = (item.decision === 'A' && passageNiveau[e.niveau]) ? passageNiveau[e.niveau] : e.niveau;

                await client.query(`INSERT INTO eleves (
                    annee, matricule, nom, prenoms, sexe, date_naissance, pays,
                    localite, mere, pere, contact, nationalite, num_acte,
                    date_etab, lieu_etab, ecole, niveau, nom_ecole
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
                [annee_cible, e.matricule, e.nom, e.prenoms, e.sexe, e.date_naissance, e.pays,
                 e.localite, e.mere, e.pere, e.contact, e.nationalite, e.num_acte,
                 e.date_etab, e.lieu_etab, e.ecole, nouveauNiveau, nomEcole]);
            }
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Erreur lors de la bascule :", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release(); // Libération indispensable
    }
});

// --- MISE À JOUR NOTES ---
app.post('/api/update-notes', async (req, res) => {
    const nomEcole = req.session.nomEcole;
    if (!nomEcole) return res.status(401).json({ error: "Non autorisé" });

    const { updates, annee } = req.body;
    const client = await pool.connect(); // Extraction d'un client pour la transaction
    try {
        await client.query('BEGIN');

        for (const u of updates) {
            await client.query(
                `UPDATE eleves
                 SET moyenne = $1, rang = $2
                 WHERE matricule = $3 AND annee = $4 AND nom_ecole = $5`,
                [u.moyenne, u.rang, u.matricule, annee, nomEcole]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Erreur mise à jour notes :", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release(); // Libération indispensable
    }
});



// --- CONFIGURATION PROF ---
app.post('/api/config-prof', upload.fields([{ name: 'logo_iepp' }, { name: 'logo_ecole' }]), async (req, res) => {
    const { drena, iepp, nom_directeur } = req.body;
    const nomEcole = req.session.nomEcole;

    if (!nomEcole) {
        return res.status(401).json({ success: false, message: "Non connecté" });
    }

    // Gestion des chemins des logos (null si aucun fichier envoyé)
    const lIepp = req.files['logo_iepp'] ? '/uploads/' + req.files['logo_iepp'][0].filename : null;
    const lEcole = req.files['logo_ecole'] ? '/uploads/' + req.files['logo_ecole'][0].filename : null;

    try {
        // Upsert PostgreSQL (Insert ou Update si le nom_ecole existe déjà)
        // On utilise COALESCE pour conserver l'ancien logo si le nouveau est null
        const sql = `
            INSERT INTO configuration (nom_ecole, drena, iepp, nom_directeur, logo_iepp, logo_ecole)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (nom_ecole) DO UPDATE SET
                drena = EXCLUDED.drena,
                iepp = EXCLUDED.iepp,
                nom_directeur = EXCLUDED.nom_directeur,
                logo_iepp = COALESCE(EXCLUDED.logo_iepp, configuration.logo_iepp),
                logo_ecole = COALESCE(EXCLUDED.logo_ecole, configuration.logo_ecole)
        `;

        await pool.query(sql, [nomEcole, drena, iepp, nom_directeur, lIepp, lEcole]);
        
        res.json({ success: true, message: "Configuration enregistrée avec succès" });
    } catch (err) {
        console.error("Erreur config:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});


// --- GET CONFIGURATION ---
app.get('/api/config-prof', async (req, res) => {
    if (!req.session.nomEcole) return res.status(401).json({ error: "Non connecté" });

    try {
        const result = await pool.query("SELECT * FROM configuration WHERE nom_ecole = $1", [req.session.nomEcole]);
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.json({ drena: '', iepp: '', nom_directeur: '', logo_iepp: '', logo_ecole: '' });
        }
    } catch (err) {
        console.error("Erreur récupération config :", err);
        res.status(500).json({ error: err.message });
    }
});

// --- DÉTAILS ÉLÈVE (Avec Historique) ---
app.get('/api/eleves/details/:id', async (req, res) => {
    const matricule = req.params.id;
    const nomEcole = req.session.nomEcole;

    if (!nomEcole) return res.status(401).json({ error: "Non connecté" });

    try {
        const result = await pool.query(
            "SELECT * FROM eleves WHERE matricule = $1 AND nom_ecole = $2 ORDER BY annee DESC",
            [matricule, nomEcole]
        );

        if (result.rows.length > 0) {
            const historique = result.rows.map(row => ({
                annee: row.annee,
                niveau: row.niveau,
                moyenne: row.moyenne !== null ? row.moyenne : 'N/A',
                rang: row.rang !== null ? row.rang : 'N/A'
            }));

            res.json({ ...result.rows[0], historique });
        } else {
            res.status(404).json({ error: "Élève non trouvé" });
        }
    } catch (err) {
        console.error("Erreur détails élève :", err);
        res.status(500).json({ error: err.message });
    }
});

// --- LOGOUT ---
app.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Erreur lors de la déconnexion :", err);
            return res.status(500).send("Erreur lors de la déconnexion");
        }
        res.redirect('/login.html');
    });
});


// --- LANCEMENT DU SERVEUR ---
const PORT = process.env.PORT || 8081;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur actif sur le port ${PORT}`);
});
