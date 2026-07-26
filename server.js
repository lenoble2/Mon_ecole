
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const session = require('express-session');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const csv = require('csv-parser');

const app = express();
const upload = multer({ dest: 'uploads/' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function connectDB() {
    try {
        await pool.query('SELECT NOW()');
    } catch (err) {
        console.error('❌ Erreur de connexion, nouvelle tentative dans 5s...', err.message);
        setTimeout(connectDB, 5000);
    }
}
connectDB();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: 'secret-key-ecole',
    resave: false,
    saveUninitialized: false
}));

app.get('/test-db', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT NOW()');
        res.json({ status: "Connecté", time: rows[0] });
    } catch (err) {
        res.status(500).send("Erreur DB");
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.use(express.static(__dirname));
app.use('/uploads', express.static('uploads'));

async function initDB() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS configuration (
            nom_ecole TEXT PRIMARY KEY,
            drena TEXT, iepp TEXT, nom_directeur TEXT, logo_iepp TEXT, logo_ecole TEXT
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS eleves (
            id SERIAL PRIMARY KEY,
            annee TEXT, matricule TEXT, nom TEXT, prenoms TEXT, sexe TEXT, date_naissance TEXT, pays TEXT, localite TEXT, mere TEXT, pere TEXT, contact TEXT, nationalite TEXT, num_acte TEXT, date_etab TEXT, lieu_etab TEXT, ecole TEXT, niveau TEXT, nom_ecole TEXT, moyenne REAL, rang INTEGER, photo TEXT, document TEXT, ecole_origine TEXT
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS utilisateurs (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE,
            password TEXT,
            nom_ecole TEXT,
            telephone TEXT
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS notes_matieres (
            id SERIAL PRIMARY KEY,
            nom_ecole TEXT NOT NULL,
            annee TEXT NOT NULL,
            niveau TEXT NOT NULL,
            periode TEXT NOT NULL,
            matricule TEXT NOT NULL,
            matiere TEXT NOT NULL,
            note REAL,
            UNIQUE(nom_ecole, annee, niveau, periode, matricule, matiere)
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS resultats_synthese (
            id SERIAL PRIMARY KEY,
            nom_ecole TEXT NOT NULL,
            annee TEXT NOT NULL,
            niveau TEXT NOT NULL,
            periode TEXT NOT NULL,
            matricule TEXT NOT NULL,
            total REAL,
            moyen REAL,
            rang INTEGER,
            decision TEXT,
            UNIQUE(nom_ecole, annee, niveau, periode, matricule)
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS resultats_compositions (
            id SERIAL PRIMARY KEY,
            nom_ecole TEXT NOT NULL,
            annee TEXT NOT NULL,
            niveau TEXT NOT NULL,
            periode TEXT NOT NULL,
            matricule TEXT NOT NULL,
            nom TEXT,
            prenoms TEXT,
            date_naissance TEXT,
            sexe TEXT,
            graphisme REAL,
            disc_visuelle REAL,
            exp_ecrite REAL,
            copie REAL,
            dictee REAL,
            ecriture REAL,
            exp_texte REAL,
            aem REAL,
            math REAL,
            edhc REAL,
            lecture REAL,
            dessin REAL,
            poesie REAL,
            total REAL,
            moyen REAL,
            rang INTEGER,
            decision TEXT,
            UNIQUE(nom_ecole, annee, niveau, periode, matricule)
        )`);
        console.log('✅ Tables vérifiées/créées.');
    } catch (err) {
        console.error('❌ Erreur lors de la création des tables :', err);
    }
}

app.post('/inscription', async (req, res) => {
    const { schoolName, telephone, password, confirmPassword } = req.body;
    if (password !== confirmPassword) {
        return res.send("<script>alert('Mots de passe différents'); window.history.back();</script>");
    }
    try {
        const check = await pool.query("SELECT * FROM utilisateurs WHERE nom_ecole = $1", [schoolName]);
        if (check.rows.length > 0) {
            return res.send("<script>alert('École déjà enregistrée'); window.history.back();</script>");
        }
        const hash = await bcrypt.hash(password, 10);
        await pool.query("INSERT INTO utilisateurs (nom_ecole, telephone, password) VALUES ($1, $2, $3)", [schoolName, telephone, hash]);
        res.redirect('/index.html');
    } catch (err) {
        console.error("❌ Erreur inscription :", err);
        res.status(500).send("Erreur lors de l'inscription");
    }
});

app.post('/login', async (req, res) => {
    const { schoolName, password } = req.body;
    try {
        const result = await pool.query("SELECT * FROM utilisateurs WHERE nom_ecole = $1", [schoolName]);
        if (result.rows.length === 0) {
            return res.send("<script>alert('École non trouvée'); window.location.href='/index.html';</script>");
        }
        const user = result.rows[0];
        const match = await bcrypt.compare(password, user.password);
        if (match) {
            req.session.nomEcole = user.nom_ecole;
            res.redirect('/accueil.html');
        } else {
            res.send("<script>alert('Mot de passe incorrect'); window.location.href='/index.html';</script>");
        }
    } catch (err) {
        console.error("❌ Erreur login :", err);
        res.status(500).send("Erreur serveur lors de la connexion");
    }
});

app.get('/api/nom-ecole', (req, res) => {
    res.json({ nom: req.session.nomEcole || "Nom de l'école" });
});

app.get('/api/eleves/:annee', async (req, res) => {
    try {
        const { annee } = req.params;
        const { periode } = req.query;
        const nomEcole = req.session.nomEcole;

        if (periode) {
            const query = `
                SELECT e.*, rc.graphisme, rc.disc_visuelle, rc.exp_ecrite, rc.copie, rc.dictee,
                       rc.ecriture, rc.exp_texte, rc.aem, rc.math, rc.edhc, rc.lecture,
                       rc.dessin, rc.poesie, rc.total, rc.moyen, rc.rang, rc.decision
                FROM eleves e
                LEFT JOIN resultats_compositions rc
                  ON e.matricule = rc.matricule
                  AND e.annee = rc.annee
                  AND e.nom_ecole = rc.nom_ecole
                  AND rc.periode = $3
                WHERE e.annee = $1 AND e.nom_ecole = $2
            `;
            const result = await pool.query(query, [annee, nomEcole, periode]);
            
            const rowsFormatted = result.rows.map(row => {
                return {
                    ...row,
                    notes: {
                        graphisme: row.graphisme,
                        disc_visuelle: row.disc_visuelle,
                        exp_ecrite: row.exp_ecrite,
                        copie: row.copie,               // 👈 Ajouté
                        dictee: row.dictee,             // 👈 Ajouté
                        ecriture: row.ecriture,         // 👈 Ajouté
                        exp_texte: row.exp_texte,
                        aem: row.aem,
                        math: row.math,
                        edhc: row.edhc,
                        lecture: row.lecture,
                        dessin: row.dessin,
                        poesie: row.poesie              // 👈 Ajouté
                    }
                };
            });
            return res.json(rowsFormatted);
        } else {
            const result = await pool.query(
                "SELECT * FROM eleves WHERE annee = $1 AND nom_ecole = $2",
                [annee, nomEcole]
            );
            res.json(result.rows);
        }
    } catch (err) {
        console.error("❌ Erreur récupération élèves/notes :", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/importer', upload.single('fichier_csv'), (req, res) => {
    const anneeImport = req.body.annee_import || '2025';
    const nomEcole = req.session.nomEcole;
    const results = [];
    
    fs.createReadStream(req.file.path)
        .pipe(csv({ separator: ',' }))
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const sql = `INSERT INTO eleves (
                    annee, matricule, nom, prenoms, sexe, date_naissance, pays,
                    localite, mere, pere, contact, nationalite, num_acte,
                    date_etab, lieu_etab, ecole_origine, niveau, nom_ecole
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`;

                for (const row of results) {
                    await client.query(sql, [
                        anneeImport,
                        row.matricule || '',
                        row.nom || '',
                        row.prenoms || '',
                        row.sexe || '',
                        row.date_naissance || '',
                        row.pays || '',
                        row.localite || '',
                        row.mere || '',
                        row.pere || '',
                        row.contact || '',
                        row.nationalite || '',
                        row.num_acte || '',
                        row.date_etab || '',
                        row.lieu_etab || '',
                        row.ecole_origine || '',
                        row.niveau || '',
                        nomEcole
                    ]);
                }
                await client.query('COMMIT');
                fs.unlinkSync(req.file.path);
                res.redirect(`/liste.html?annee=${anneeImport}`);
            } catch (err) {
                await client.query('ROLLBACK');
                console.error("❌ Erreur lors de l'insertion CSV :", err);
                res.status(500).send("Erreur lors de l'importation.");
            } finally {
                client.release();
            }
        });
});

app.post('/ajouter-eleve', upload.fields([{ name: 'photo' }, { name: 'document' }]), async (req, res) => {
    try {
        const d = req.body;
        const nomEcole = req.session.nomEcole;
        const date_naissance = (d.jour && d.mois && d.annee_nais) ? `${d.jour}/${d.mois}/${d.annee_nais}` : (d.date_naissance || '');
        const sql = `INSERT INTO eleves (
            annee, matricule, nom, prenoms, sexe, date_naissance, pays, localite, mere, pere, contact, nationalite, num_acte, date_etab, lieu_etab, ecole, niveau, nom_ecole
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`;
        
        await pool.query(sql, [
            d.annee, d.matricule?.trim() || '', d.nom?.trim() || '', d.prenoms?.trim() || '',
            d.sexe, date_naissance, d.pays, d.localite, d.mere, d.pere, d.contact,
            d.nationalite, d.num_acte, d.date_etab, d.lieu_etab, d.ecole, d.niveau, nomEcole
        ]);
        res.redirect(`/liste.html?annee=${d.annee}`);
    } catch (err) {
        console.error("❌ Erreur ajout manuel :", err);
        res.status(500).send("Erreur lors de l'enregistrement.");
    }
});

app.post('/supprimer-eleves', async (req, res) => {
    try {
        const ids = JSON.parse(req.body.ids);
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
        await pool.query(
            `DELETE FROM eleves WHERE matricule IN (${placeholders}) AND nom_ecole = $${ids.length + 1}`,
            [...ids, req.session.nomEcole]
        );
        res.redirect('/liste.html');
    } catch (err) {
        console.error("❌ Erreur suppression :", err);
        res.status(500).send("Erreur suppression.");
    }
});

app.get('/api/eleve/:id', async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM eleves WHERE TRIM(matricule) = $1 AND nom_ecole = $2",
            [req.params.id.trim(), req.session.nomEcole]
        );
        result.rows.length > 0 ? res.json(result.rows[0]) : res.status(404).send("Non trouvé");
    } catch (err) {
        console.error("❌ Erreur détail élève :", err);
        res.status(500).send("Erreur serveur");
    }
});

app.post('/api/importer-notes', async (req, res) => {
    const nomEcole = req.session.nomEcole;
    const { annee, periode, donnees } = req.body;
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        for (const item of donnees) {
            const matricule = item.matricule ? item.matricule.trim() : '';
            if (!matricule) continue;

            // 1. Récupérer proprement le niveau avec TRIM
            const resEleve = await client.query(
                `SELECT niveau FROM eleves WHERE TRIM(matricule) = TRIM($1) AND annee = $2 AND nom_ecole = $3 LIMIT 1`,
                [matricule, annee, nomEcole]
            );
            
            // On nettoie et met en majuscules pour éviter les soucis de casse ("Cm1" -> "CM1")
            const niveauEleve = resEleve.rows.length > 0 && resEleve.rows[0].niveau 
                ? resEleve.rows[0].niveau.trim().toUpperCase() 
                : '';

            if (!niveauEleve) {
                console.warn(`⚠️ Élève non trouvé ou niveau vide pour le matricule : ${matricule}`);
                continue;
            }

            const n = item.notes || {};

            // 2. Insérer ou mettre à jour dans resultats_compositions
            await client.query(`
                INSERT INTO resultats_compositions (
                    nom_ecole, annee, niveau, periode, matricule,
                    graphisme, disc_visuelle, exp_ecrite, copie, dictee, ecriture,
                    exp_texte, aem, math, edhc, lecture, dessin, poesie,
                    total, moyen, rang, decision
                ) VALUES (
                    $1, $2, $3, $4, $5,
                    $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
                )
                ON CONFLICT (nom_ecole, annee, niveau, periode, matricule)
                DO UPDATE SET
                    graphisme = COALESCE(EXCLUDED.graphisme, resultats_compositions.graphisme),
                    disc_visuelle = COALESCE(EXCLUDED.disc_visuelle, resultats_compositions.disc_visuelle),
                    exp_ecrite = COALESCE(EXCLUDED.exp_ecrite, resultats_compositions.exp_ecrite),
                    copie = COALESCE(EXCLUDED.copie, resultats_compositions.copie),
                    dictee = COALESCE(EXCLUDED.dictee, resultats_compositions.dictee),
                    ecriture = COALESCE(EXCLUDED.ecriture, resultats_compositions.ecriture),
                    exp_texte = COALESCE(EXCLUDED.exp_texte, resultats_compositions.exp_texte),
                    aem = COALESCE(EXCLUDED.aem, resultats_compositions.aem),
                    math = COALESCE(EXCLUDED.math, resultats_compositions.math),
                    edhc = COALESCE(EXCLUDED.edhc, resultats_compositions.edhc),
                    lecture = COALESCE(EXCLUDED.lecture, resultats_compositions.lecture),
                    dessin = COALESCE(EXCLUDED.dessin, resultats_compositions.dessin),
                    poesie = COALESCE(EXCLUDED.poesie, resultats_compositions.poesie),
                    total = COALESCE(EXCLUDED.total, resultats_compositions.total),
                    moyen = COALESCE(EXCLUDED.moyen, resultats_compositions.moyen),
                    rang = COALESCE(EXCLUDED.rang, resultats_compositions.rang),
                    decision = COALESCE(EXCLUDED.decision, resultats_compositions.decision)
            `, [
                nomEcole,
                annee,
                niveauEleve,
                periode,
                matricule,
                n.graphisme || null,
                n.disc_visuelle || null,
                n.exp_ecrite || null,
                n.copie || null,
                n.dictee || null,
                n.ecriture || null,
                n.exp_texte || null,
                n.aem || null,
                n.math || null,
                n.edhc || null,
                n.lecture || null,
                n.dessin || null,
                n.poesie || null,
                item.total || 0,
                item.moyenne || 0,
                item.rang || 0,
                item.decision || ''
            ]);
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Erreur import notes :", err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        client.release();
    }
});


app.post('/api/eleve/:id', upload.fields([{ name: 'photo' }, { name: 'document' }]), async (req, res) => {
    const matricule = req.params.id.trim();
    const d = req.body;
    const nomEcole = req.session.nomEcole;
    try {
        let fields = [];
        let params = [];
        let i = 1;
        const updateFields = {
            nom: d.nom?.trim() || '', prenoms: d.prenoms?.trim() || '', sexe: d.sexe,
            date_naissance: d.date_naissance, pays: d.pays, localite: d.localite,
            mere: d.mere, pere: d.pere, contact: d.contact, nationalite: d.nationalite,
            num_acte: d.num_acte, date_etab: d.date_etab, lieu_etab: d.lieu_etab,
            niveau: d.niveau, ecole: d.ecole
        };
        for (const [key, value] of Object.entries(updateFields)) {
            fields.push(`${key}=$${i++}`);
            params.push(value);
        }
        if (req.files?.photo) {
            fields.push(`photo=$${i++}`);
            params.push('/uploads/' + req.files['photo'][0].filename);
        }
        if (req.files?.document) {
            fields.push(`document=$${i++}`);
            params.push('/uploads/' + req.files['document'][0].filename);
        }
        params.push(matricule, nomEcole);
        const sql = `UPDATE eleves SET ${fields.join(', ')} WHERE TRIM(matricule)=$${i++} AND nom_ecole=$${i++}`;
        await pool.query(sql, params);
        res.json({ success: true });
    } catch (err) {
        console.error("❌ Erreur lors de la modification :", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/exporter', async (req, res) => {
    try {
        const nomEcole = req.session.nomEcole;
        const result = await pool.query("SELECT * FROM eleves WHERE nom_ecole = $1", [nomEcole]);
        const headers = ["annee", "matricule", "nom", "prenoms", "sexe", "date_naissance", "pays", "localite", "mere", "pere", "contact", "nationalite", "num_acte", "date_etab", "lieu_etab", "ecole", "niveau"];
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
        console.error("❌ Erreur lors de l'exportation :", err);
        res.status(500).send("Erreur serveur : " + err.message);
    }
});

app.post('/api/basculer-eleves', async (req, res) => {
    const { decisions, annee_source } = req.body;
    const annee_cible = (parseInt(annee_source) + 1).toString();
    const nomEcole = req.session.nomEcole;
    const passageNiveau = { 'CP1': 'CP2', 'CP2': 'CE1', 'CE1': 'CE2', 'CE2': 'CM1', 'CM1': 'CM2', 'CM2': 'FIN' };
    const client = await pool.connect();
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
                    annee, matricule, nom, prenoms, sexe, date_naissance, pays, localite, mere, pere, contact, nationalite, num_acte, date_etab, lieu_etab, ecole, niveau, nom_ecole
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
                    [annee_cible, e.matricule, e.nom, e.prenoms, e.sexe, e.date_naissance, e.pays,
                    e.localite, e.mere, e.pere, e.contact, e.nationalite, e.num_acte,
                    e.date_etab, e.lieu_etab, e.ecole, nouveauNiveau, nomEcole]);
            }
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Erreur lors de la bascule :", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.post('/api/update-notes', async (req, res) => {
    const nomEcole = req.session.nomEcole;
    const { updates, annee, periode } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        for (const u of updates) {
            const matricule = u.matricule ? u.matricule.trim() : '';
            if (!matricule) continue;

            const resEleve = await client.query(
                `SELECT niveau FROM eleves WHERE TRIM(matricule) = TRIM($1) AND annee = $2 AND nom_ecole = $3 LIMIT 1`,
                [matricule, annee, nomEcole]
            );

            const niveauEleve = resEleve.rows.length > 0 && resEleve.rows[0].niveau
                ? resEleve.rows[0].niveau.trim().toUpperCase()
                : '';
            if (!niveauEleve) continue;

            const n = u.notes || {};
            const valeurMoyen = u.moyen !== '' && u.moyen !== undefined ? u.moyen : (u.moyenne !== '' && u.moyenne !== undefined ? u.moyenne : 0);

            await client.query(`
                INSERT INTO resultats_compositions (
                    nom_ecole, annee, niveau, periode, matricule,
                    graphisme, disc_visuelle, exp_ecrite, copie, dictee, ecriture,
                    exp_texte, aem, math, edhc, lecture, dessin, poesie,
                    total, moyen, rang, decision
                ) VALUES (
                    $1, $2, $3, $4, $5,
                    $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
                )
                ON CONFLICT (nom_ecole, annee, niveau, periode, matricule)
                DO UPDATE SET
                    graphisme = COALESCE(EXCLUDED.graphisme, resultats_compositions.graphisme),
                    disc_visuelle = COALESCE(EXCLUDED.disc_visuelle, resultats_compositions.disc_visuelle),
                    exp_ecrite = COALESCE(EXCLUDED.exp_ecrite, resultats_compositions.exp_ecrite),
                    copie = COALESCE(EXCLUDED.copie, resultats_compositions.copie),
                    dictee = COALESCE(EXCLUDED.dictee, resultats_compositions.dictee),
                    ecriture = COALESCE(EXCLUDED.ecriture, resultats_compositions.ecriture),
                    exp_texte = COALESCE(EXCLUDED.exp_texte, resultats_compositions.exp_texte),
                    aem = COALESCE(EXCLUDED.aem, resultats_compositions.aem),
                    math = COALESCE(EXCLUDED.math, resultats_compositions.math),
                    edhc = COALESCE(EXCLUDED.edhc, resultats_compositions.edhc),
                    lecture = COALESCE(EXCLUDED.lecture, resultats_compositions.lecture),
                    dessin = COALESCE(EXCLUDED.dessin, resultats_compositions.dessin),
                    poesie = COALESCE(EXCLUDED.poesie, resultats_compositions.poesie),
                    total = COALESCE(EXCLUDED.total, resultats_compositions.total),
                    moyen = COALESCE(EXCLUDED.moyen, resultats_compositions.moyen),
                    rang = COALESCE(EXCLUDED.rang, resultats_compositions.rang),
                    decision = COALESCE(EXCLUDED.decision, resultats_compositions.decision)
            `, [
                nomEcole, annee, niveauEleve, periode, matricule,
                n.graphisme !== '' && n.graphisme !== undefined ? n.graphisme : null,
                n.disc_visuelle !== '' && n.disc_visuelle !== undefined ? n.disc_visuelle : null,
                n.exp_ecrite !== '' && n.exp_ecrite !== undefined ? n.exp_ecrite : null,
                n.copie !== '' && n.copie !== undefined ? n.copie : null,               // 👈 Paramètre $9
                n.dictee !== '' && n.dictee !== undefined ? n.dictee : null,             // 👈 Paramètre $10
                n.ecriture !== '' && n.ecriture !== undefined ? n.ecriture : null,       // 👈 Paramètre $11
                n.exp_texte !== '' && n.exp_texte !== undefined ? n.exp_texte : null,
                n.aem !== '' && n.aem !== undefined ? n.aem : null,
                n.math !== '' && n.math !== undefined ? n.math : null,
                n.edhc !== '' && n.edhc !== undefined ? n.edhc : null,
                n.lecture !== '' && n.lecture !== undefined ? n.lecture : null,
                n.dessin !== '' && n.dessin !== undefined ? n.dessin : null,
                n.poesie !== '' && n.poesie !== undefined ? n.poesie : null,             // 👈 Paramètre $18
                u.total !== '' && u.total !== undefined ? u.total : 0,
                valeurMoyen,
                u.rang !== '' && u.rang !== undefined ? u.rang : 0,
                u.decision || ''
            ]);

            await client.query(
                `UPDATE eleves SET moyenne = $1, rang = $2 WHERE TRIM(matricule) = TRIM($3) AND annee = $4 AND nom_ecole = $5`,
                [valeurMoyen, u.rang || 0, matricule, annee, nomEcole]
            );
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Erreur mise à jour notes :", err);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

app.post('/api/sauvegarder-bulletin', async (req, res) => {
    const nomEcole = req.session.nomEcole;
    const { annee, niveau, periode, lignesEleves } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const eleve of lignesEleves) {
            const n = eleve.notes || {};
            await client.query(`
                INSERT INTO resultats_compositions (
                    nom_ecole, annee, niveau, periode, matricule,
                    nom, prenoms, date_naissance, sexe,
                    graphisme, disc_visuelle, exp_ecrite, copie, dictee, ecriture,
                    exp_texte, aem, math, edhc, lecture, dessin, poesie,
                    total, moyen, rang, decision
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9,
                    $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
                    $23, $24, $25, $26
                )
                ON CONFLICT (nom_ecole, annee, niveau, periode, matricule)
                DO UPDATE SET
                    nom = EXCLUDED.nom,
                    prenoms = EXCLUDED.prenoms,
                    date_naissance = EXCLUDED.date_naissance,
                    sexe = EXCLUDED.sexe,
                    graphisme = EXCLUDED.graphisme,
                    disc_visuelle = EXCLUDED.disc_visuelle,
                    exp_ecrite = EXCLUDED.exp_ecrite,
                    copie = EXCLUDED.copie,
                    dictee = EXCLUDED.dictee,
                    ecriture = EXCLUDED.ecriture,
                    exp_texte = EXCLUDED.exp_texte,
                    aem = EXCLUDED.aem,
                    math = EXCLUDED.math,
                    edhc = EXCLUDED.edhc,
                    lecture = EXCLUDED.lecture,
                    dessin = EXCLUDED.dessin,
                    poesie = EXCLUDED.poesie,
                    total = EXCLUDED.total,
                    moyen = EXCLUDED.moyen,
                    rang = EXCLUDED.rang,
                    decision = EXCLUDED.decision
            `, [
                nomEcole, annee, niveau, periode, eleve.matricule,
                eleve.nom || '', eleve.prenoms || '', eleve.date_naissance || '', eleve.sexe || '',
                n.graphisme || null, n.disc_visuelle || null, n.exp_ecrite || null,
                n.copie || null, n.dictee || null, n.ecriture || null, n.exp_texte || null,
                n.aem || null, n.math || null, n.edhc || null, n.lecture || null,
                n.dessin || null, n.poesie || null,
                eleve.total || 0, eleve.moyen || 0, eleve.rang || 0, eleve.decision || ''
            ]);
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("❌ Erreur sauvegarde bulletin linéaire :", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

app.get('/api/notes/:annee/:niveau/:periode', async (req, res) => {
    const nomEcole = req.session.nomEcole;
    try {
        const { annee, niveau, periode } = req.params;
        const result = await pool.query(
            `SELECT * FROM resultats_compositions WHERE nom_ecole = $1 AND annee = $2 AND niveau = $3 AND periode = $4`,
            [nomEcole, annee, niveau, periode]
        );
        res.json(result.rows);
    } catch (err) {
        console.error("❌ Erreur récupération bulletins :", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/config-prof', upload.fields([{ name: 'logo_iepp' }, { name: 'logo_ecole' }]), async (req, res) => {
    const { drena, iepp, nom_directeur } = req.body;
    const nomEcole = req.session.nomEcole;
    const lIepp = req.files?.logo_iepp ? '/uploads/' + req.files['logo_iepp'][0].filename : null;
    const lEcole = req.files?.logo_ecole ? '/uploads/' + req.files['logo_ecole'][0].filename : null;
    try {
        const sql = `INSERT INTO configuration (nom_ecole, drena, iepp, nom_directeur, logo_iepp, logo_ecole)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (nom_ecole) DO UPDATE SET
                     drena = EXCLUDED.drena,
                     iepp = EXCLUDED.iepp,
                     nom_directeur = EXCLUDED.nom_directeur,
                     logo_iepp = COALESCE(EXCLUDED.logo_iepp, configuration.logo_iepp),
                     logo_ecole = COALESCE(EXCLUDED.logo_ecole, configuration.logo_ecole)`;
        await pool.query(sql, [nomEcole, drena, iepp, nom_directeur, lIepp, lEcole]);
        res.json({ success: true });
    } catch (err) {
        console.error("❌ Erreur config:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/config-prof', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM configuration WHERE nom_ecole = $1", [req.session.nomEcole]);
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.json({ drena: '', iepp: '', nom_directeur: '', logo_iepp: '', logo_ecole: '' });
        }
    } catch (err) {
        console.error("❌ Erreur config-prof :", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/eleves/details/:id', async (req, res) => {
    const matricule = req.params.id;
    const nomEcole = req.session.nomEcole;
    try {
        const result = await pool.query(
            "SELECT * FROM eleves WHERE matricule = $1 AND nom_ecole = $2 ORDER BY annee DESC",
            [matricule, nomEcole]
        );
        if (result.rows.length > 0) {
            const historique = result.rows.map(row => ({
                annee: row.annee,
                niveau: row.niveau,
                moyenne: row.moyenne || 'N/A',
                rang: row.rang || 'N/A'
            }));
            res.json({ ...result.rows[0], historique });
        } else {
            res.status(404).json({ error: "Élève non trouvé" });
        }
    } catch (err) {
        console.error("❌ Erreur détails élève :", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/utilisateurs', async (req, res) => {
    try {
        const result = await pool.query("SELECT id, nom_ecole, telephone FROM utilisateurs");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Erreur lors de la récupération des utilisateurs" });
    }
});

app.post('/api/admin/reset-password/:id', async (req, res) => {
    try {
        const hash = await bcrypt.hash(req.body.password, 10);
        await pool.query("UPDATE utilisateurs SET password = $1 WHERE id = $2", [hash, req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.delete('/api/admin/delete-user/:id', async (req, res) => {
    try {
        await pool.query("DELETE FROM utilisateurs WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

async function startServer() {
    await initDB();
    const PORT = process.env.PORT || 8081;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Serveur actif sur le port ${PORT}`);
    });
}

startServer();
