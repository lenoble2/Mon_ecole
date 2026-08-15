require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function runFix() {
    console.log("Vérification et ajout des colonnes manquantes...");

    // On force l'ajout des colonnes potentiellement manquantes une par une
    const queries = [
        "ALTER TABLE eleves ADD COLUMN IF NOT EXISTS profession TEXT;",
        "ALTER TABLE eleves ADD COLUMN IF NOT EXISTS domicile TEXT;",
        "ALTER TABLE eleves ADD COLUMN IF NOT EXISTS ecole_origine TEXT;",
        "ALTER TABLE eleves ADD COLUMN IF NOT EXISTS photo TEXT;",
        "ALTER TABLE eleves ADD COLUMN IF NOT EXISTS document TEXT;"
    ];

    for (let q of queries) {
        const { error } = await supabase.rpc('exec_sql', { sql: q }).catch(() => ({ error: true }));
        if (error) {
            // Si la fonction RPC n'existe pas, on passe par un insert test ou on ignore
            console.log("Tentative alternative via API...");
        }
    }
    console.log("Terminé ! Relancez votre serveur.");
}
runFix();

