import { pathToFileURL } from 'node:url';
import { audit, accountEmail } from './access.js';
// Deliberately local-only: no endpoint, password, or automatic account creation.
export async function bootstrapSudo(database,email) {
  accountEmail({email});
  return database.transaction(async db=>{
    const [user]=await db.query('SELECT email FROM users WHERE email=? FOR UPDATE',[email]);
    if(!user) throw new Error('Sudo bootstrap requires an exact existing account email.');
    const result=await db.query('INSERT IGNORE INTO sudo_admins(email) VALUES(?)',[email]);
    if(result.affectedRows) await audit(db,'local-operator',email,'*','sudo.bootstrap','Explicit local bootstrap for an existing account');
    return {email,isSudo:true};
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const database=await import('../db.js');
  try {
    if(process.argv.length!==3) throw new Error('Usage: npm run admin:bootstrap -- exact-existing@email.example');
    console.log(await bootstrapSudo(database,process.argv[2]));
  }catch(error){console.error(error.message);process.exitCode=1;}
  finally{await database.closeDatabase();}
}
