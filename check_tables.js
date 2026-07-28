const { Pool } = require('pg');

const pool = new Pool({
    user: 'avnadmin', // Votre utilisateur Aiven (souvent avnadmin)
    host: 'VOTRE_VRAI_HOTE_AIVEN.aivencloud.com', // Copiez l'hôte depuis Aiven
    database: 'defaultdb', // Le nom de votre base
    password: 'VOTRE_VRAI_MOT_DE_PASSE',
    port: 24700, // Votre port Aiven
    ssl: {
        rejectUnauthorized: false
    }
});

async function verifierTables() {
    try {
        const query = `
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name;
        `;
        
        const res = await pool.query(query);
        console.log("📊 Tables présentes dans la base de données :");
        if (res.rows.length === 0) {
            console.log("Aucune table trouvée dans le schéma public.");
        } else {
            res.rows.forEach((row, index) => {
                console.log(`${index + 1}. ${row.table_name}`);
            });
        }
    } catch (err) {
        console.error("❌ Erreur lors de la vérification des tables :", err);
    } finally {
        await pool.end();
    }
}

verifierTables();
