const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const commands = [
  new SlashCommandBuilder()
    .setName('pf')
    .setDescription('Créer une Party Finder pour Skyblock')
    .toJSON()
];

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('🔄 Enregistrement de la commande /pf...');

    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );

    console.log('✅ Commande /pf enregistrée avec succès sur ton serveur !');
  } catch (error) {
    console.error('❌ Erreur lors de l’enregistrement des commandes :', error);
  }
})();
