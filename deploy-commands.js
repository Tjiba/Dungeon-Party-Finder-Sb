import { REST, Routes, SlashCommandBuilder } from "discord.js";
import dotenv from "dotenv";
dotenv.config();

export default async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("pf")
      .setDescription("Créer une Party Finder pour Skyblock")
      .toJSON(),
  ];

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  try {
    console.log("🔄 Enregistrement de /pf...");
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log("✅ /pf enregistrée avec succès !");
  } catch (error) {
    console.error("❌ Erreur lors de l’enregistrement :", error);
  }
}

if (process.argv[1].includes("deploy-commands.js")) registerCommands();
