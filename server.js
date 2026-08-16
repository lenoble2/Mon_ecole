
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const session = require('express-session');
const path = require('path');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const csv = require('csv-parser');

const app = express();
const upload = multer({ dest: 'uploads/' });

// ==========================================
// 1. INITIALISATION DE LA BASE DE DONNÉES SUPABASE
// ==========================================
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function connectDB() {
    try {
        const { data, error } = await supabase.from('utilisateurs').select('id', { count: 'exact', head: true });
        if (error) throw error;
        console.log('✅ Connecté avec succès à Supabase via API HTTP !');
    } catch (err) {
        console.error('❌ Erreur de connexion Supabase :', err.message);
        setTimeout(connectDB, 5000);
    }
}
connectDB();

async function initDB() {
    try {
        const { error } = await supabase.from('utilisateurs').select('id').limit(1);
        if (error && error.code !== 'PGRST116') {
            console.log('⚠️ Remarque tables :', error.message);
        } else {
            console.log('✅ Tables vérifiées/connectées sur Supabase.');
        }
    } catch (err) {
        console.error('❌ Erreur lors de l\'initialisation :', err.message);
        setTimeout(initDB, 5000);
    }
}

// ==========================================
// 2. MIDDLEWARES ET CONFIGURATION EXPRESS
// ==========================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret-key-ecole',
    resave: false,
    saveUninitialized: false
}));

app.use(express.static(__dirname));
app.use('/uploads', express.static('uploads'));

// ==========================================
// 3. ROUTES DE BASE ET AUTHENTIFICATION
// ==========================================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/test-db', async (req, res) => {
    try {
        const { data, error } = await supabase.from('utilisateurs').select('id').limit(1);
        if (error) throw error;
        res.json({ status: "Connecté à Supabase", time: new Date().toISOString() });
    } catch (err) {
        res.status(500).send("Erreur DB");
    }
});

app.post('/inscription', async (req, res) => {
    const { schoolName, telephone, password, confirmPassword } = req.body;
    if (password !== confirmPassword) {
        return res.send("<script>alert('Mots de passe différents'); window.history.back();</script>");
    }
    try {
        const { data: check } = await supabase.from('utilisateurs').select('*').eq('nom_ecole', schoolName);
        if (check && check.length > 0) {
            return res.send("<script>alert('École déjà enregistrée'); window.history.back();</script>");
        }
        const hash = await bcrypt.hash(password, 10);
        const { error } = await supabase.from('utilisateurs').insert([
            { nom_ecole: schoolName, telephone: telephone, password: hash }
        ]);
        if (error) throw error;
        res.redirect('/index.html');
    } catch (err) {
        console.error("❌ Erreur inscription :", err);
        res.status(500).send("Erreur lors de l'inscription");
    }
});

app.post('/login', async (req, res) => {
    const { schoolName, password } = req.body;
    try {
        const { data: users, error } = await supabase
            .from('utilisateurs')
            .select('*')
            .eq('nom_ecole', schoolName)
            .limit(1);

        if (error) throw error;

        if (!users || users.length === 0) {
            return res.send("<script>alert('École non trouvée'); window.location.href='/';</script>");
        }

        const user = users[0];
        const match = await bcrypt.compare(password, user.password);

        if (match) {
            req.session.nomEcole = user.nom_ecole;
            res.redirect('/accueil.html');
        } else {
            res.send("<script>alert('Mot de passe incorrect'); window.location.href='/';</script>");
        }
    } catch (err) {
        console.error("❌ Erreur login :", err);
        res.status(500).send("Erreur serveur lors de la connexion");
    }
});

app.get('/accueil.html', (req, res) => {
    if (!req.session.nomEcole) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'accueil.html'));
});

app.get('/api/nom-ecole', (req, res) => {
    res.json({ nom: req.session.nomEcole || "Nom de l'école" });
});

// ==========================================
// 4. ROUTES API - GESTION DES ÉLÈVES
// ==========================================
app.get('/api/eleves/details/:id', async (req, res) => {
    const matricule = req.params.id.trim();
    const nomEcole = req.session.nomEcole;
    try {
        const { data: eleveData, error: errEleve } = await supabase
            .from('eleves')
            .select('*')
            .eq('matricule', matricule)
            .eq('nom_ecole', nomEcole)
            .order('annee', { ascending: false });

        if (errEleve) throw errEleve;

        if (eleveData && eleveData.length > 0) {
            const historique = [];
            const { data: rcData, error: errRc } = await supabase
                .from('resultats_compositions')
                .select('*')
                .eq('matricule', matricule)
                .eq('nom_ecole', nomEcole);

            if (errRc) throw errRc;

            for (const row of eleveData) {
                const yearRCs = rcData.filter(rc => rc.annee === row.annee);
                const rc_fin = yearRCs.find(rc => rc.periode === 'FIN_ANNEE');
                const rc1 = yearRCs.find(rc => rc.periode === 'COMPO1');
                const rc2 = yearRCs.find(rc => rc.periode === 'COMPO2');
                const rc3 = yearRCs.find(rc => rc.periode === 'COMPO3');
                const rc_pass = yearRCs.find(rc => rc.periode === 'PASSAGE');

                let mTotalFinal = row.moyenne || 0;
                let rangFinal = row.rang || '';
                let decisionFinal = '';

                if (rc_fin || rc1 || rc2 || rc3 || rc_pass) {
                    let m1 = rc1 ? parseFloat(rc1.moyen) || 0 : 0;
                    let m2 = rc2 ? parseFloat(rc2.moyen) || 0 : 0;
                    let m3 = rc3 ? parseFloat(rc3.moyen) || 0 : 0;
                    let mPassBrut = rc_pass ? parseFloat(rc_pass.moyen) || 0 : 0;

                    let countCompo = 0;
                    if (m1 > 0) countCompo++;
                    if (m2 > 0) countCompo++;
                    if (m3 > 0) countCompo++;

                    let moyenCompoN = countCompo > 0 ? ((m1 + m2 + m3) / countCompo) : 0;
                    let moyenPassage = mPassBrut * 2;
                    let diviseurTotal = 0;
                    let sommeTotale = 0;

                    if (moyenCompoN > 0) { sommeTotale += moyenCompoN; diviseurTotal++; }
                    if (moyenPassage > 0) { sommeTotale += moyenPassage; diviseurTotal++; }

                    let moyenTotal = diviseurTotal > 0 ? (sommeTotale / diviseurTotal) : 0;

                    if (moyenTotal > 0) {
                        mTotalFinal = moyenTotal.toFixed(2);
                    } else if (rc_fin && rc_fin.moyen) {
                        mTotalFinal = rc_fin.moyen;
                    } else {
                        mTotalFinal = "";
                    }
                    if (rc_fin && rc_fin.rang) rangFinal = rc_fin.rang;
                    if (rc_fin && rc_fin.decision) decisionFinal = rc_fin.decision;
                }

                historique.push({
                    annee: row.annee,
                    niveau: row.niveau,
                    moyen_total: mTotalFinal,
                    rang: rangFinal,
                    observation: decisionFinal
                });
            }

            res.json({ ...eleveData[0], historique });
        } else {
            res.status(404).json({ error: "Élève non trouvé" });
        }
    } catch (err) {
        console.error("❌ Erreur détails élève :", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/eleves/:annee', async (req, res) => {
    try {
        const { annee } = req.params;
        const { periode } = req.query;
        const nomEcole = req.session.nomEcole;

        const { data: eleves, error: elevesError } = await supabase
            .from('eleves')
            .select('*')
            .eq('annee', annee)
            .eq('nom_ecole', nomEcole)
            .order('nom', { ascending: true });

        if (elevesError) throw elevesError;

        if (periode) {
            const { data: rcData, error: rcError } = await supabase
                .from('resultats_compositions')
                .select('*')
                .eq('annee', annee)
                .eq('nom_ecole', nomEcole);

            if (rcError) throw rcError;

            if (periode === 'FIN_ANNEE') {
                const rowsCalculated = eleves.map(row => {
                    const eMatricule = String(row.matricule).trim();
                    const studentRCs = rcData.filter(rc => String(rc.matricule).trim() === eMatricule);
                    const rc_fin = studentRCs.find(rc => rc.periode === 'FIN_ANNEE') || {};
                    const rc1 = studentRCs.find(rc => rc.periode === 'COMPO1') || {};
                    const rc2 = studentRCs.find(rc => rc.periode === 'COMPO2') || {};
                    const rc3 = studentRCs.find(rc => rc.periode === 'COMPO3') || {};
                    const rc_pass = studentRCs.find(rc => rc.periode === 'PASSAGE') || {};

                    let m1 = parseFloat(rc1.moyen) || 0;
                    let m2 = parseFloat(rc2.moyen) || 0;
                    let m3 = parseFloat(rc3.moyen) || 0;
                    let mPassBrut = parseFloat(rc_pass.moyen) || 0;

                    let moyenCompoN = (m1 > 0 || m2 > 0 || m3 > 0) ? ((m1 + m2 + m3) / 3) : 0;
                    let moyenPassage = mPassBrut * 2;
                    let moyenTotal = (moyenCompoN > 0 || moyenPassage > 0) ? ((moyenCompoN + moyenPassage) / 3) : 0;

                    return {
                        ...row,
                        total: rc_fin.total,
                        moyen: rc_fin.moyen,
                        rang: rc_fin.rang,
                        decision: rc_fin.decision,
                        moyen_compo1: m1.toFixed(2),
                        moyen_compo2: m2.toFixed(2),
                        moyen_compo3: m3.toFixed(2),
                        moyen_compoN: moyenCompoN.toFixed(2),
                        moyen_compo_de_passage: moyenPassage.toFixed(2),
                        moyen_total: moyenTotal.toFixed(2)
                    };
                });
                return res.json(rowsCalculated);
            }

            const rowsFormatted = eleves.map(row => {
                const rc = rcData.find(r => String(r.matricule).trim() === String(row.matricule).trim() && r.periode === periode) || {};
                return {
                    ...row,
                    total: rc.total,
                    moyen: rc.moyen,
                    rang: rc.rang,
                    decision: rc.decision,
                    moyen_compo1: rc.moyen_compo1,
                    moyen_compo2: rc.moyen_compo2,
                    moyen_compo3: rc.moyen_compo3,
                    moyen_compoN: rc.moyen_compoN,
                    moyen_compo_de_passage: rc.moyen_compo_de_passage,
                    moyen_total: rc.moyen_total,
                    notes: {
                        graphisme: rc.graphisme, disc_visuelle: rc.disc_visuelle, exp_ecrite: rc.exp_ecrite,
                        copie: rc.copie, dictee: rc.dictee, ecriture: rc.ecriture, exp_texte: rc.exp_texte,
                        aem: rc.aem, math: rc.math, edhc: rc.edhc, lecture: rc.lecture, dessin: rc.dessin, poesie: rc.poesie
                    }
                };
            });
            return res.json(rowsFormatted);
        } else {
            res.json(eleves || []);
        }
    } catch (err) {
        console.error("❌ Erreur récupération élèves/notes :", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/eleve/:id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('eleves')
            .select('*')
            .eq('matricule', req.params.id.trim())
            .eq('nom_ecole', req.session.nomEcole)
            .limit(1);

        if (error) throw error;
        data && data.length > 0 ? res.json(data[0]) : res.status(404).send("Non trouvé");
    } catch (err) {
        console.error("❌ Erreur détail élève :", err);
        res.status(500).send("Erreur serveur");
    }
});

app.post('/api/eleve/:id', upload.fields([{ name: 'photo' }, { name: 'document' }]), async (req, res) => {
    const matricule = req.params.id.trim();
    const d = req.body;
    const nomEcole = req.session.nomEcole;

    try {
        const updateFields = {
            nom: d.nom?.trim() || '', prenoms: d.prenoms?.trim() || '', sexe: d.sexe,
            date_naissance: d.date_naissance, pays: d.pays, localite: d.localite,
            mere: d.mere, pere: d.pere, profession: d.profession?.trim() || '', domicile: d.domicile?.trim() || '', contact: d.contact, nationalite: d.nationalite,
            num_acte: d.num_acte, date_etab: d.date_etab, lieu_etab: d.lieu_etab,
            niveau: d.niveau, ecole: d.ecole
        };

        if (req.files?.photo) {
            const file = req.files['photo'][0];
            const fileBuffer = fs.readFileSync(file.path);
            const fileName = `photos/${Date.now()}-${file.originalname}`;
            const { error: uploadError } = await supabase.storage.from('Fichier').upload(fileName, fileBuffer, { contentType: file.mimetype, upsert: true });
            if (!uploadError) {
                const { data: pubData } = supabase.storage.from('Fichier').getPublicUrl(fileName);
                updateFields.photo = pubData.publicUrl;
            }
            try { fs.unlinkSync(file.path); } catch(e) {}
        }

        if (req.files?.document) {
            const file = req.files['document'][0];
            const fileBuffer = fs.readFileSync(file.path);
            const fileName = `documents/${Date.now()}-${file.originalname}`;
            const { error: uploadError } = await supabase.storage.from('Fichier').upload(fileName, fileBuffer, { contentType: file.mimetype, upsert: true });
            if (!uploadError) {
                const { data: pubData } = supabase.storage.from('Fichier').getPublicUrl(fileName);
                updateFields.document = pubData.publicUrl;
            }
            try { fs.unlinkSync(file.path); } catch(e) {}
        }

        const { error } = await supabase
            .from('eleves')
            .update(updateFields)
            .eq('matricule', matricule)
            .eq('nom_ecole', nomEcole);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error("❌ Erreur lors de la modification :", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 5. IMPORTATIONS ET AJOUTS D'ÉLÈVES
// ==========================================
app.post('/api/importer-eleves', async (req, res) => {
    const nomEcole = req.session.nomEcole;
    const { annee, eleves } = req.body;

    if (!eleves || !Array.isArray(eleves)) {
        return res.status(400).json({ success: false, message: "Aucune donnée d'élève valide fournie." });
    }

    try {
        const insertData = eleves.map(e => ({
            annee: annee || '2025',
            matricule: e.matricule || '',
            nom: e.nom || '',
            prenoms: e.prenoms || e.prenom || '',
            sexe: e.sexe || '',
            date_naissance: e.date_naissance || e.date_naiss || e.datenaissance || '',
            pays: e.pays || '',
            localite: e.localite || '',
            mere: e.mere || '',
            pere: e.pere || '',
            profession: e.profession || '',
            domicile: e.domicile || '',
            contact: e.contact_parent || e.contact || e.telephone || '',
            nationalite: e.nationalite || '',
            num_acte: e.n_acte_naissance || e.acte_naissance || e.num_acte || '',
            date_etab: e.date_etab || '',
            lieu_etab: e.lieu_etab || '',
            ecole: e.ecole || '',
            niveau: e.niveau || '',
            nom_ecole: nomEcole
        }));

        const { error } = await supabase.from('eleves').upsert(insertData, { ignoreDuplicates: true });
        if (error) throw error;

        res.json({ success: true });
    } catch (err) {
        console.error("❌ Erreur lors de l'importation JSON des élèves :", err);
        res.status(500).json({ success: false, message: err.message });
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
            try {
                const insertData = results.map(row => {
                    // Normalisation des clés pour accepter les espaces, majuscules et accents
                    const cleanRow = {};
                    for (let key in row) {
                        const cleanKey = key.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '_');
                        cleanRow[cleanKey] = row[key];
                    }

                    return {
                        annee: anneeImport,
                        matricule: cleanRow.matricule || '',
                        nom: cleanRow.nom || '',
                        prenoms: cleanRow.prenoms || cleanRow.prenom || '',
                        sexe: cleanRow.sexe || '',
                        date_naissance: cleanRow.date_naissance || cleanRow.date_naiss || cleanRow.datenaissance || '',
                        pays: cleanRow.pays || '',
                        localite: cleanRow.localite || '',
                        mere: cleanRow.mere || '',
                        pere: cleanRow.pere || '',
                        profession: cleanRow.profession || '',
                        domicile: cleanRow.domicile || '',
                        contact: cleanRow.contact || cleanRow.telephone || '',
                        nationalite: cleanRow.nationalite || '',
                        num_acte: cleanRow.num_acte || cleanRow.n_acte_naissance || cleanRow.acte_naissance || '',
                        date_etab: cleanRow.date_etab || '',
                        lieu_etab: cleanRow.lieu_etab || '',
                        ecole_origine: cleanRow.ecole_origine || '',
                        niveau: cleanRow.niveau || '',
                        nom_ecole: nomEcole
                    };
                });

                const { error } = await supabase.from('eleves').insert(insertData);
                if (error) throw error;

                fs.unlinkSync(req.file.path);
                res.redirect(`/liste.html?annee=${anneeImport}`);
            } catch (err) {
                console.error("❌ Erreur lors de l'insertion CSV :", err);
                res.status(500).send("Erreur lors de l'importation.");
            }
        });
});

app.post('/ajouter-eleve', upload.fields([{ name: 'photo' }, { name: 'document' }]), async (req, res) => {
    try {
        const d = req.body;
        const nomEcole = req.session.nomEcole;
        const date_naissance = (d.jour && d.mois && d.annee_nais) ? `${d.jour}/${d.mois}/${d.annee_nais}` : (d.date_naissance || '');

        let photoUrl = '';
        let docUrl = '';

        if (req.files?.photo) {
            const file = req.files['photo'][0];
            const fileBuffer = fs.readFileSync(file.path);
            const fileName = `photos/${Date.now()}-${file.originalname}`;
            const { error: uploadError } = await supabase.storage.from('Fichier').upload(fileName, fileBuffer, { contentType: file.mimetype, upsert: true });
            if (!uploadError) {
                const { data: pubData } = supabase.storage.from('Fichier').getPublicUrl(fileName);
                photoUrl = pubData.publicUrl;
            }
            try { fs.unlinkSync(file.path); } catch(e) {}
        }

        if (req.files?.document) {
            const file = req.files['document'][0];
            const fileBuffer = fs.readFileSync(file.path);
            const fileName = `documents/${Date.now()}-${file.originalname}`;
            const { error: uploadError } = await supabase.storage.from('Fichier').upload(fileName, fileBuffer, { contentType: file.mimetype, upsert: true });
            if (!uploadError) {
                const { data: pubData } = supabase.storage.from('Fichier').getPublicUrl(fileName);
                docUrl = pubData.publicUrl;
            }
            try { fs.unlinkSync(file.path); } catch(e) {}
        }

        const insertData = {
            annee: d.annee, matricule: d.matricule?.trim() || '', nom: d.nom?.trim() || '', prenoms: d.prenoms?.trim() || '',
            sexe: d.sexe, date_naissance, pays: d.pays, localite: d.localite, mere: d.mere, pere: d.pere, profession: d.profession?.trim() || '', domicile: d.domicile?.trim() || '', contact: d.contact,
            nationalite: d.nationalite, num_acte: d.num_acte, date_etab: d.date_etab, lieu_etab: d.lieu_etab, ecole: d.ecole, niveau: d.niveau, nom_ecole: nomEcole
        };

        if (photoUrl) insertData.photo = photoUrl;
        if (docUrl) insertData.document = docUrl;

        const { error } = await supabase.from('eleves').insert([insertData]);
        if (error) throw error;

        res.redirect(`/liste.html?annee=${d.annee}`);
    } catch (err) {
        console.error("❌ Erreur ajout manuel :", err);
        res.status(500).send("Erreur lors de l'enregistrement.");
    }
});

app.post('/supprimer-eleves', async (req, res) => {
    try {
        const ids = JSON.parse(req.body.ids);
        const { error } = await supabase
            .from('eleves')
            .delete()
            .in('matricule', ids)
            .eq('nom_ecole', req.session.nomEcole);

        if (error) throw error;
        res.redirect('/liste.html');
    } catch (err) {
        console.error("❌ Erreur suppression :", err);
        res.status(500).send("Erreur suppression.");
    }
});

// ==========================================
// 6. GESTION DES NOTES ET BULLETINS
// ==========================================
app.post('/api/importer-notes', async (req, res) => {
    const nomEcole = req.session.nomEcole;
    const { annee, periode, donnees } = req.body;

    try {
        const matricules = donnees.map(d => d.matricule?.trim()).filter(Boolean);
        const { data: elevesLevels } = await supabase
            .from('eleves')
            .select('matricule, niveau')
            .eq('annee', annee)
            .eq('nom_ecole', nomEcole)
            .in('matricule', matricules);

        const upsertData = [];
        for (const item of donnees) {
            const matricule = item.matricule?.trim();
            if (!matricule) continue;

            const eleve = elevesLevels?.find(e => String(e.matricule).trim() === matricule);
            const niveauEleve = eleve?.niveau ? eleve.niveau.trim().toUpperCase() : '';

            if (!niveauEleve) {
                console.warn(`⚠️ Élève non trouvé ou niveau vide pour le matricule : ${matricule}`);
                continue;
            }

            const n = item.notes || {};
            upsertData.push({
                nom_ecole: nomEcole, annee, niveau: niveauEleve, periode, matricule,
                graphisme: n.graphisme || null, disc_visuelle: n.disc_visuelle || null, exp_ecrite: n.exp_ecrite || null,
                copie: n.copie || null, dictee: n.dictee || null, ecriture: n.ecriture || null,
                exp_texte: n.exp_texte || null, aem: n.aem || null, math: n.math || null, edhc: n.edhc || null,
                lecture: n.lecture || null, dessin: n.dessin || null, poesie: n.poesie || null,
                total: item.total || 0, moyen: item.moyenne || 0, rang: item.rang || 0, decision: item.decision || ''
            });
        }

        if (upsertData.length > 0) {
            const { error } = await supabase.from('resultats_compositions').upsert(upsertData, {
                onConflict: 'nom_ecole,annee,niveau,periode,matricule'
            });
            if (error) throw error;
        }

        res.json({ success: true });
    } catch (err) {
        console.error("❌ Erreur import notes :", err);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/update-notes', async (req, res) => {
    const nomEcole = req.session.nomEcole;
    const { updates, annee, periode } = req.body;

    try {
        const matricules = updates.map(u => u.matricule?.trim()).filter(Boolean);
        const { data: elevesLevels } = await supabase
            .from('eleves')
            .select('matricule, niveau')
            .eq('annee', annee)
            .eq('nom_ecole', nomEcole)
            .in('matricule', matricules);

        const upsertData = [];
        for (const u of updates) {
            const matricule = u.matricule?.trim();
            if (!matricule) continue;

            const eleve = elevesLevels?.find(e => String(e.matricule).trim() === matricule);
            const niveauEleve = eleve?.niveau ? eleve.niveau.trim().toUpperCase() : '';
            if (!niveauEleve) continue;

            const n = u.notes || {};
            const valeurMoyen = u.moyen !== '' && u.moyen !== undefined ? u.moyen : (u.moyenne !== '' && u.moyenne !== undefined ? u.moyenne : 0);

            upsertData.push({
                nom_ecole: nomEcole, annee, niveau: niveauEleve, periode, matricule,
                graphisme: n.graphisme !== '' && n.graphisme !== undefined ? n.graphisme : null,
                disc_visuelle: n.disc_visuelle !== '' && n.disc_visuelle !== undefined ? n.disc_visuelle : null,
                exp_ecrite: n.exp_ecrite !== '' && n.exp_ecrite !== undefined ? n.exp_ecrite : null,
                copie: n.copie !== '' && n.copie !== undefined ? n.copie : null,
                dictee: n.dictee !== '' && n.dictee !== undefined ? n.dictee : null,
                ecriture: n.ecriture !== '' && n.ecriture !== undefined ? n.ecriture : null,
                exp_texte: n.exp_texte !== '' && n.exp_texte !== undefined ? n.exp_texte : null,
                aem: n.aem !== '' && n.aem !== undefined ? n.aem : null,
                math: n.math !== '' && n.math !== undefined ? n.math : null,
                edhc: n.edhc !== '' && n.edhc !== undefined ? n.edhc : null,
                lecture: n.lecture !== '' && n.lecture !== undefined ? n.lecture : null,
                dessin: n.dessin !== '' && n.dessin !== undefined ? n.dessin : null,
                poesie: n.poesie !== '' && n.poesie !== undefined ? n.poesie : null,
                total: u.total !== '' && u.total !== undefined ? u.total : 0,
                moyen: valeurMoyen,
                rang: u.rang !== '' && u.rang !== undefined ? u.rang : 0,
                decision: u.decision || ''
            });

            await supabase.from('eleves')
                .update({ moyenne: valeurMoyen, rang: u.rang || 0 })
                .eq('matricule', matricule)
                .eq('annee', annee)
                .eq('nom_ecole', nomEcole);
        }

        if (upsertData.length > 0) {
            const { error } = await supabase.from('resultats_compositions').upsert(upsertData, {
                onConflict: 'nom_ecole,annee,niveau,periode,matricule'
            });
            if (error) throw error;
        }

        res.json({ success: true });
    } catch (err) {
        console.error("❌ Erreur mise à jour notes :", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/sauvegarder-bulletin', async (req, res) => {
    const nomEcole = req.session.nomEcole;
    const { annee, niveau, periode, lignesEleves } = req.body;

    try {
        const upsertData = lignesEleves.map(eleve => {
            const n = eleve.notes || {};
            return {
                nom_ecole: nomEcole, annee, niveau, periode, matricule: eleve.matricule,
                nom: eleve.nom || '', prenoms: eleve.prenoms || '', date_naissance: eleve.date_naissance || '', sexe: eleve.sexe || '',
                graphisme: n.graphisme || null, disc_visuelle: n.disc_visuelle || null, exp_ecrite: n.exp_ecrite || null,
                copie: n.copie || null, dictee: n.dictee || null, ecriture: n.ecriture || null, exp_texte: n.exp_texte || null,
                aem: n.aem || null, math: n.math || null, edhc: n.edhc || null, lecture: n.lecture || null,
                dessin: n.dessin || null, poesie: n.poesie || null, total: eleve.total || 0, moyen: eleve.moyen || 0, rang: eleve.rang || 0, decision: eleve.decision || ''
            };
        });

        if (upsertData.length > 0) {
            const { error } = await supabase.from('resultats_compositions').upsert(upsertData, {
                onConflict: 'nom_ecole,annee,niveau,periode,matricule'
            });
            if (error) throw error;
        }

        res.json({ success: true });
    } catch (err) {
        console.error("❌ Erreur sauvegarde bulletin linéaire :", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/notes/:annee/:niveau/:periode', async (req, res) => {
    const nomEcole = req.session.nomEcole;
    try {
        const { annee, niveau, periode } = req.params;
        const { data, error } = await supabase
            .from('resultats_compositions')
            .select('*')
            .eq('nom_ecole', nomEcole)
            .eq('annee', annee)
            .eq('niveau', niveau)
            .eq('periode', periode);

        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        console.error("❌ Erreur récupération bulletins :", err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 7. EXPORTATIONS ET BASCULE D'ANNÉE
// ==========================================
app.get('/exporter', async (req, res) => {
    try {
        const nomEcole = req.session.nomEcole;
        const annee = req.query.annee || '2025';

        const { data: eleves, error: errEleves } = await supabase
            .from('eleves')
            .select('annee, matricule, nom, prenoms, sexe, niveau')
            .eq('nom_ecole', nomEcole)
            .eq('annee', annee);

        const { data: resultats, error: errResultats } = await supabase
            .from('resultats_compositions')
            .select('matricule, total, moyen, rang, decision')
            .eq('nom_ecole', nomEcole)
            .eq('annee', annee);

        if (errEleves || errResultats) throw (errEleves || errResultats);

        const headers = ["annee", "matricule", "nom", "prenoms", "sexe", "niveau", "total", "moyen", "rang", "decision"];
        let csvContent = "\uFEFF" + headers.join(",") + "\n";

        eleves.forEach(e => {
            const rc = resultats.find(r => String(r.matricule).trim() === String(e.matricule).trim()) || {};
            const rowData = { ...e, ...rc };
            const values = headers.map(h => rowData[h] !== null && rowData[h] !== undefined ? rowData[h] : '');
            const sanitized = values.map(v => `"${String(v).replace(/"/g, '""')}"`);
            csvContent += sanitized.join(",") + "\n";
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="resultats_eleves.csv"');
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

    try {
        const matricules = decisions.map(d => d.matricule);
        const { data: elevesExistants } = await supabase
            .from('eleves')
            .select('*')
            .eq('annee', annee_source)
            .eq('nom_ecole', nomEcole)
            .in('matricule', matricules);

        const insertData = [];
        for (const item of decisions) {
            const e = elevesExistants?.find(el => el.matricule === item.matricule);
            if (e) {
                // Nettoyage et mise en majuscule du niveau pour correspondre à passageNiveau
                const niveauActuel = e.niveau ? e.niveau.trim().toUpperCase() : '';
                let nouveauNiveau = (item.decision === 'A' && passageNiveau[niveauActuel]) ? passageNiveau[niveauActuel] : niveauActuel;

                insertData.push({
                    annee: annee_cible,
                    matricule: e.matricule,
                    nom: e.nom,
                    prenoms: e.prenoms,
                    sexe: e.sexe,
                    date_naissance: e.date_naissance,
                    pays: e.pays,
                    localite: e.localite,
                    mere: e.mere,
                    pere: e.pere,
                    profession: e.profession,
                    domicile: e.domicile,
                    contact: e.contact,
                    nationalite: e.nationalite,
                    num_acte: e.num_acte,
                    date_etab: e.date_etab,
                    lieu_etab: e.lieu_etab,
                    ecole: e.ecole,
                    niveau: nouveauNiveau, // Utilisation du nouveau niveau calculé (ou le même si redoublement / fin)
                    nom_ecole: nomEcole
                });
            }
        }

        if (insertData.length > 0) {
            // Retrait de "ignoreDuplicates: true" pour permettre la mise à jour du niveau si l'élève existe déjà
            const { error } = await supabase.from('eleves').upsert(insertData, {
                onConflict: 'nom_ecole,annee,matricule'
            });
            if (error) throw error;
        }

        res.json({ success: true });
    } catch (err) {
        console.error("❌ Erreur lors de la bascule :", err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 8. CONFIGURATION DE L'ÉCOLE ET ADMIN
// ==========================================
app.post('/api/config-prof', upload.fields([{ name: 'logo_iepp' }, { name: 'logo_ecole' }]), async (req, res) => {
    const { drena, iepp, nom_directeur } = req.body;
    const nomEcole = req.session.nomEcole;

    try {
        const upsertObj = { nom_ecole: nomEcole, drena, iepp, nom_directeur };

        if (req.files?.logo_iepp) {
            const file = req.files['logo_iepp'][0];
            const fileBuffer = fs.readFileSync(file.path);
            const fileName = `logos/${Date.now()}-${file.originalname}`;
            const { error: uploadError } = await supabase.storage.from('Fichier').upload(fileName, fileBuffer, { contentType: file.mimetype, upsert: true });
            if (!uploadError) {
                const { data: pubData } = supabase.storage.from('Fichier').getPublicUrl(fileName);
                upsertObj.logo_iepp = pubData.publicUrl;
            }
            try { fs.unlinkSync(file.path); } catch(e) {}
        }

        if (req.files?.logo_ecole) {
            const file = req.files['logo_ecole'][0];
            const fileBuffer = fs.readFileSync(file.path);
            const fileName = `logos/${Date.now()}-${file.originalname}`;
            const { error: uploadError } = await supabase.storage.from('Fichier').upload(fileName, fileBuffer, { contentType: file.mimetype, upsert: true });
            if (!uploadError) {
                const { data: pubData } = supabase.storage.from('Fichier').getPublicUrl(fileName);
                upsertObj.logo_ecole = pubData.publicUrl;
            }
            try { fs.unlinkSync(file.path); } catch(e) {}
        }

        const { error } = await supabase.from('configuration').upsert(upsertObj, { onConflict: 'nom_ecole' });
        if (error) throw error;

        res.json({ success: true });
    } catch (err) {
        console.error("❌ Erreur config:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/config-prof', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('configuration')
            .select('*')
            .eq('nom_ecole', req.session.nomEcole)
            .limit(1);

        if (error) throw error;

        if (data && data.length > 0) {
            res.json(data[0]);
        } else {
            res.json({ drena: '', iepp: '', nom_directeur: '', logo_iepp: '', logo_ecole: '' });
        }
    } catch (err) {
        console.error("❌ Erreur config-prof :", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/utilisateurs', async (req, res) => {
    try {
        const { data, error } = await supabase.from('utilisateurs').select('id, nom_ecole, telephone');
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: "Erreur lors de la récupération des utilisateurs" });
    }
});

app.post('/api/admin/reset-password/:id', async (req, res) => {
    try {
        const hash = await bcrypt.hash(req.body.password, 10);
        const { error } = await supabase
            .from('utilisateurs')
            .update({ password: hash })
            .eq('id', req.params.id);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.delete('/api/admin/delete-user/:id', async (req, res) => {
    try {
        const { error } = await supabase
            .from('utilisateurs')
            .delete()
            .eq('id', req.params.id);

        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error("❌ Erreur suppression utilisateur :", err);
        res.status(500).json({ success: false });
    }
});

// ==========================================
// ROUTES POUR L'ÉTAT DU PERSONNEL
// ==========================================
app.post('/api/save-personnel', async (req, res) => {
    try {
        const personnelList = req.body;

        if (!Array.isArray(personnelList) || personnelList.length === 0) {
            return res.status(400).json({ success: false, message: "Aucune donnée à enregistrer." });
        }

        let successCount = 0;
        let errors = [];

        // Traiter chaque ligne une par une de façon sécurisée
        for (const item of personnelList) {
            // Nettoyage des champs vides ou superflus
            const matricule = item.matricule ? String(item.matricule).trim() : '';
            const nomPrenoms = item.nom_prenoms ? String(item.nom_prenoms).trim() : '';

            // Si la ligne n'a ni matricule ni nom, on l'ignore
            if (!matricule && !nomPrenoms) continue;

            // Préparation de l'objet à envoyer (on retire l'id vide pour laisser Postgres/Supabase l'incrémenter)
            const cleanItem = { ...item };
            delete cleanItem.id;

            console.log(`Tentative d'enregistrement pour : ${nomPrenoms} (Matricule: ${matricule})`);

            // Utilisation directe de upsert sur la contrainte unique du matricule
            const { data, error } = await supabase
                .from('personnel')
                .upsert([cleanItem], { onConflict: 'matricule' });

            if (error) {
                console.error(`Erreur pour ${nomPrenoms}:`, error.message);
                errors.push(`${nomPrenoms}: ${error.message}`);
            } else {
                successCount++;
            }
        }

        if (errors.length > 0 && successCount === 0) {
            return res.status(500).json({ success: false, message: "Erreurs : " + errors.join(' | ') });
        }

        res.json({ success: true, message: `${successCount} personne(s) enregistrée(s) avec succès !` });
    } catch (err) {
        console.error("Erreur générale sauvegarde personnel:", err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Route unique et robuste pour supprimer un membre du personnel
app.delete('/api/delete-personnel/:identifier', async (req, res) => {
    const identifier = req.params.identifier;

    if (!identifier || identifier === 'undefined' || identifier.trim() === '') {
        return res.json({ success: true, message: "Ligne locale supprimée." });
    }

    try {
        // On vérifie si l'identifiant est un nombre (ID de la base) ou une chaîne (Matricule)
        let query = supabase.from('personnel').delete();

        if (!isNaN(identifier)) {
            query = query.eq('id', identifier);
        } else {
            query = query.eq('matricule', identifier);
        }

        const { error } = await query;
        if (error) throw error;

        res.json({ success: true, message: "Supprimé avec succès de Supabase !" });
    } catch (error) {
        console.error("Erreur suppression personnel:", error.message);
        res.status(500).json({ success: false, message: "Erreur serveur: " + error.message });
    }
});

// Route pour récupérer l'état du personnel depuis Supabase
app.get('/api/get-personnel', async (req, res) => {
    try {
        // La session est la source la plus sûre, on l'utilise en priorité
        const ecole = req.session.nomEcole || req.query.ecole;
        
        let query = supabase.from('personnel').select('*');
        
        if (ecole && ecole.trim() !== '') {
            query = query.eq('nom_ecole', ecole);
        }
        
        const { data, error } = await query;
        if (error) throw error;
        
        res.json(data || []);
    } catch (err) {
        console.error("Erreur chargement personnel:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 9. LANCEMENT DU SERVEUR
// ==========================================
async function startServer() {
    await initDB();
    const PORT = process.env.PORT || 8081;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Serveur actif sur le port ${PORT}`);
    });
}

startServer();
