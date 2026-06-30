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
    ssl: { rejectUnauthorized: false }
});

client.connect((err) => {
    if (err) console.error('ERREUR CRITIQUE DE CONNEXION :', err.stack);
    else console.log('CONNEXION RÉUSSIE À LA BASE DE DONNÉES AIVEN !');
});


// --- ROUTES DE BASE ---
app.get('/', (req, res) => res.sendFile(__dirname + '/login.html'));



// --- INSCRIPTION ---
app.post('/inscription', async (req, res) => {
    const { schoolName, telephone, password, confirmPassword } = req.body;

    // 1. Vérification de la correspondance des mots de passe
    if (password !== confirmPassword) {
        return res.send("<script>alert('Mots de passe différents'); window.history.back();</script>");
    }

    try {
        // 2. Vérifier si l'école existe déjà
        const check = await client.query("SELECT * FROM utilisateurs WHERE nom_ecole = $1", [schoolName]);
        if (check.rows.length > 0) {
            return res.send("<script>alert('École déjà enregistrée'); window.history.back();</script>");
        }

        // 3. Hachage du mot de passe
        const hash = await bcrypt.hash(password, 10);

        // 4. Insertion dans la base de données
        await client.query(
            "INSERT INTO utilisateurs (nom_ecole, telephone, password) VALUES ($1, $2, $3)",
            [schoolName, telephone, hash]
        );

        res.send("<script>alert('Inscription réussie !'); window.location.href='/login.html';</script>");
    } catch (err) {
        console.error("Erreur inscription :", err);
        res.status(500).send("Erreur lors de l'inscription");
    }
});

// --- LOGIN ---
app.post('/login', async (req, res) => {
    const { schoolName, password } = req.body;

    try {
        // 1. Récupérer l'utilisateur dans la base
        const result = await client.query("SELECT * FROM utilisateurs WHERE nom_ecole = $1", [schoolName]);

        if (result.rows.length === 0) {
            return res.send("<script>alert('École non trouvée'); window.history.back();</script>");
        }

        const user = result.rows[0];

        // 2. Comparer le mot de passe fourni avec le hash stocké
        const match = await bcrypt.compare(password, user.password);

        if (match) {
            // 3. Créer la session en cas de succès
            req.session.nomEcole = user.nom_ecole;
            res.redirect('/accueil.html');
        } else {
            res.send("<script>alert('Mot de passe incorrect'); window.history.back();</script>");
        }
    } catch (err) {
        console.error("Erreur login :", err);
        res.status(500).send("Erreur serveur lors de la connexion");
    }
});




// --- API CONFIGURATION ---
app.get('/api/nom-ecole', (req, res) => {
    res.json({ nom: req.session.nomEcole || "Nom de l'école" });
});

// --- GESTION ÉLÈVES (Isolation par école) ---
app.get('/api/eleves/:annee', async (req, res) => {
    try {
        const result = await client.query(
            "SELECT * FROM eleves WHERE annee = $1 AND nom_ecole = $2",
            [req.params.annee, req.session.nomEcole]
        );
        res.json(result.rows);
    } catch (err) {
        console.error("Erreur récupération élèves :", err);
        res.status(500).send("Erreur lors de la récupération.");
    }
});

// --- IMPORTATION CSV ---
app.post('/importer', upload.single('fichier_csv'), (req, res) => {
    if (!req.file) return res.status(400).send("Aucun fichier sélectionné.");
    
    const anneeImport = req.body.annee_import || '2025';
    const nomEcole = req.session.nomEcole;
    const results = [];

    fs.createReadStream(req.file.path)
        .pipe(csv({ separator: ',' }))
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            try {
                await client.query('BEGIN');
                // Ajout des colonnes photo et document
                const sql = `INSERT INTO eleves (
                    annee, matricule, nom, prenoms, sexe, date_naissance,
                    pays, localite, mere, pere, contact, nationalite,
                    num_acte, date_etab, lieu_etab, ecole, niveau, nom_ecole, photo, document
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`;
                
                for (const row of results) {
                    await client.query(sql, [
                        anneeImport, row.matricule || '', row.nom || '', row.prenoms || '',
                        row.sexe || '', row.date_naissance || '', row.pays || '',
                        row.localite || '', row.mere || '', row.pere || '',
                        row.contact || '', row.nationalite || '', row.num_acte || '',
                        row.date_etab || '', row.lieu_etab || '', row.ecole || '', 
                        row.niveau || '', nomEcole, null, null // photo et document vides par défaut pour le CSV
                    ]);
                }
                await client.query('COMMIT');
                fs.unlinkSync(req.file.path);
                res.redirect(`/liste.html?annee=${anneeImport}`);
            } catch (err) {
                await client.query('ROLLBACK');
                console.error("Erreur lors de l'insertion CSV :", err);
                res.status(500).send("Erreur lors de l'importation.");
            }
        });
});



// --- AJOUT MANUEL ---
app.post('/ajouter-eleve', upload.fields([{ name: 'photo' }, { name: 'document' }]), async (req, res) => {
    try {
        const d = req.body;
        const nomEcole = req.session.nomEcole;
        if (!nomEcole) return res.status(401).send("Erreur : session expirée.");

        const date_naissance = (d.jour && d.mois && d.annee_nais) 
            ? `${d.jour}/${d.mois}/${d.annee_nais}` 
            : (d.date_naissance || '');

        // Récupération des chemins des fichiers
        const photoPath = req.files['photo'] ? '/uploads/' + req.files['photo'][0].filename : null;
        const docPath = req.files['document'] ? '/uploads/' + req.files['document'][0].filename : null;

        // Requête corrigée avec ajout de photo et document
        const sql = `INSERT INTO eleves (
            annee, matricule, nom, prenoms, sexe, date_naissance, pays, localite,
            mere, pere, contact, nationalite, num_acte, date_etab, lieu_etab,
            ecole, niveau, nom_ecole, photo, document
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`;

        await client.query(sql, [
            d.annee, d.matricule?.trim() || '', d.nom?.trim() || '', d.prenoms?.trim() || '',
            d.sexe, date_naissance, d.pays, d.localite, d.mere, d.pere, d.contact,
            d.nationalite, d.num_acte, d.date_etab, d.lieu_etab, d.ecole, d.niveau, 
            nomEcole, photoPath, docPath
        ]);
        
        res.redirect(`/liste.html?annee=${d.annee}`);
    } catch (err) {
        console.error("Erreur ajout manuel :", err);
        res.status(500).send("Erreur lors de l'enregistrement.");
    }
});

// --- SUPPRESSION ---
app.post('/supprimer-eleves', async (req, res) => {
    try {
        const ids = JSON.parse(req.body.ids);
        if (!ids || ids.length === 0) return res.status(400).send("Aucun ID.");

        const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
        
        // Suppression sécurisée
        await client.query(
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
    try {
        const result = await client.query(
            "SELECT * FROM eleves WHERE TRIM(matricule) = $1 AND nom_ecole = $2",
            [req.params.id.trim(), req.session.nomEcole]
        );
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(404).send("Élève non trouvé");
        }
    } catch (err) {
        console.error("Erreur détail élève :", err);
        res.status(500).send("Erreur serveur");
    }
});


// --- MODIFICATION ÉLÈVE ---
app.post('/api/eleve/:id', upload.fields([{ name: 'photo' }, { name: 'document' }]), async (req, res) => {
    const matricule = req.params.id.trim();
    const d = req.body;
    const nomEcole = req.session.nomEcole;

    if (!nomEcole) return res.status(401).json({ success: false, error: "Non autorisé" });

    try {
        let fields = [];
        let params = [];
        let i = 1;

        // Champs de base à mettre à jour
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

        // Gestion des fichiers optionnels (si nouveaux fichiers uploadés)
        if (req.files?.photo) {
            fields.push(`photo=$${i++}`);
            params.push('/uploads/' + req.files['photo'][0].filename);
        }
        if (req.files?.document) {
            fields.push(`document=$${i++}`);
            params.push('/uploads/' + req.files['document'][0].filename);
        }

        // Ajout final des paramètres pour la clause WHERE
        params.push(matricule, nomEcole);

        // Construction et exécution de la requête
        const sql = `UPDATE eleves SET ${fields.join(', ')} WHERE TRIM(matricule)=$${i++} AND nom_ecole=$${i++}`;
        
        const result = await client.query(sql, params);

        if (result.rowCount === 0) {
            return res.status(404).json({ success: false, error: "Élève non trouvé ou accès refusé." });
        }

        res.json({ success: true });
    } catch (err) {
        console.error("Erreur lors de la modification :", err);
        res.status(500).json({ success: false, error: err.message });
    }
});



// --- ROUTE D'EXPORTATION ---
app.get('/exporter', async (req, res) => {
    try {
        const nomEcole = req.session.nomEcole;
        const result = await client.query("SELECT * FROM eleves WHERE nom_ecole = $1", [nomEcole]);

        // Ajout de photo et document aux headers
        const headers = ["annee", "matricule", "nom", "prenoms", "sexe", "date_naissance", "pays", "localite", "mere", "pere", "contact", "nationalite", "num_acte", "date_etab", "lieu_etab", "ecole", "niveau", "photo", "document"];
        
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
        console.error("Erreur lors de l'exportation :", err);
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

    try {
        await client.query('BEGIN'); // Début de transaction pour sécuriser la bascule

        for (const item of decisions) {
            const resSelect = await client.query(
                "SELECT * FROM eleves WHERE matricule = $1 AND annee = $2 AND nom_ecole = $3",
                [item.matricule, annee_source, nomEcole]
            );

            if (resSelect.rows.length > 0) {
                const e = resSelect.rows[0];
                let nouveauNiveau = (item.decision === 'A' && passageNiveau[e.niveau]) ? passageNiveau[e.niveau] : e.niveau;

                // Ajout des colonnes photo et document dans l'insertion
                await client.query(`INSERT INTO eleves (
                    annee, matricule, nom, prenoms, sexe, date_naissance, pays,
                    localite, mere, pere, contact, nationalite, num_acte,
                    date_etab, lieu_etab, ecole, niveau, nom_ecole, photo, document
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
                [
                    annee_cible, e.matricule, e.nom, e.prenoms, e.sexe, e.date_naissance, e.pays,
                    e.localite, e.mere, e.pere, e.contact, e.nationalite, e.num_acte,
                    e.date_etab, e.lieu_etab, e.ecole, nouveauNiveau, nomEcole, e.photo, e.document
                ]);
            }
        }
        await client.query('COMMIT'); // Validation des changements
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK'); // Annulation en cas d'erreur
        console.error("Erreur lors de la bascule :", err);
        res.status(500).json({ error: err.message });
    }
});



// --- MISE À JOUR NOTES ---
app.post('/api/update-notes', async (req, res) => {
    const nomEcole = req.session.nomEcole;
    
    // 1. Vérification de la session
    if (!nomEcole) {
        return res.status(401).json({ error: "Non autorisé" });
    }

    const { updates, annee } = req.body;

    // 2. Vérification des données entrantes
    if (!updates || !Array.isArray(updates)) {
        return res.status(400).json({ error: "Données de mise à jour invalides" });
    }

    try {
        // 3. Début de la transaction pour garantir l'intégrité des données
        await client.query('BEGIN');

        for (const u of updates) {
            // Mise à jour de la moyenne et du rang pour chaque élève
            await client.query(
                `UPDATE eleves 
                 SET moyenne = $1, rang = $2 
                 WHERE matricule = $3 AND annee = $4 AND nom_ecole = $5`,
                [u.moyenne, u.rang, u.matricule, annee, nomEcole]
            );
        }

        // 4. Validation des changements
        await client.query('COMMIT');
        res.json({ success: true });

    } catch (err) {
        // 5. Annulation en cas d'erreur pour éviter des données corrompues
        await client.query('ROLLBACK');
        console.error("Erreur lors de la mise à jour des notes :", err);
        res.status(500).json({ error: "Erreur lors de la mise à jour : " + err.message });
    }
});



// --- CONFIGURATION PROF ---
app.post('/api/config-prof', upload.fields([{ name: 'logo_iepp' }, { name: 'logo_ecole' }]), async (req, res) => {
    const { drena, iepp, nom_directeur } = req.body;
    const nomEcole = req.session.nomEcole;

    if (!nomEcole) return res.status(401).json({ success: false, message: "Non connecté" });

    // Récupération sécurisée des chemins des fichiers
    const lIepp = req.files?.['logo_iepp'] ? '/uploads/' + req.files['logo_iepp'][0].filename : null;
    const lEcole = req.files?.['logo_ecole'] ? '/uploads/' + req.files['logo_ecole'][0].filename : null;

    try {
        // Upsert PostgreSQL : insère si nouvelle ligne, met à jour si nom_ecole existe déjà
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
        await client.query(sql, [nomEcole, drena, iepp, nom_directeur, lIepp, lEcole]);
        res.json({ success: true });
    } catch (err) {
        console.error("Erreur config:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- GET CONFIGURATION ---
app.get('/api/config-prof', async (req, res) => {
    if (!req.session.nomEcole) return res.status(401).json({ error: "Non connecté" });

    try {
        const result = await client.query("SELECT * FROM configuration WHERE nom_ecole = $1", [req.session.nomEcole]);
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.json({ drena: '', iepp: '', nom_directeur: '', logo_iepp: '', logo_ecole: '' });
        }
    } catch (err) {
        console.error("Erreur récup config:", err);
        res.status(500).json({ error: err.message });
    }
});

// --- DÉTAILS ÉLÈVE (Historique) ---
app.get('/api/eleves/details/:id', async (req, res) => {
    const matricule = req.params.id;
    const nomEcole = req.session.nomEcole;

    if (!nomEcole) return res.status(401).json({ error: "Non connecté" });

    try {
        const result = await client.query(
            "SELECT * FROM eleves WHERE matricule = $1 AND nom_ecole = $2 ORDER BY annee DESC",
            [matricule, nomEcole]
        );

        if (result.rows.length > 0) {
            // Création de l'historique des années précédentes pour cet élève
            const historique = result.rows.map(row => ({
                annee: row.annee,
                niveau: row.niveau,
                moyenne: row.moyenne || 'N/A',
                rang: row.rang || 'N/A'
            }));
            // On renvoie les infos les plus récentes en premier + l'historique
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

// --- SERVIR FICHIERS STATIQUES ---
// Assurez-vous que ce dossier existe sur votre serveur Render
app.use('/uploads', express.static('uploads'));



app.get('/test-db', async (req, res) => {
    try {
        const result = await client.query('SELECT table_name FROM information_schema.tables WHERE table_schema = \'public\'');
        res.json({ success: true, tables: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});




// --- LANCEMENT ---
const PORT = process.env.PORT || 8081;
app.listen(PORT, '0.0.0.0', () => console.log(`Serveur actif sur le port ${PORT}`));
