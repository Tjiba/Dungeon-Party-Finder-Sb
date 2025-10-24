import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ButtonBuilder,
  ActionRowBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  InteractionType,
} from "discord.js";
import dotenv from "dotenv";
import express from "express"; // ✅ ajout pour keep-alive
dotenv.config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// === Données globales ===
const partyData = new Map();
const playerCataCache = new Map(); // 🧠 Nouveau cache Catacombs (24h)

// === Création de l’embed party ===
function createPartyEmbed(party) {
  const membersList =
    party.members.length > 0
      ? party.members
          .map(
            (m) =>
              `<@${m.id}> — ${m.class}${
                m.cata ? ` (Cata ${m.cata})` : " ⚠️ Niveau non défini (temporaire)"
              }`
          )
          .join("\n")
      : "_Aucun joueur_";

  return new EmbedBuilder()
    .setTitle("🏰 Party Finder")
    .setColor(party.mode === "Master" ? 0xff0000 : 0x00ff00)
    .setDescription(`${membersList}\n(${party.members.length}/${party.size} joueurs)`)
    .addFields(
      { name: "Mode", value: party.mode, inline: true },
      { name: "Floor", value: party.floor, inline: true }
    )
    .setFooter({
      text: "⚙️ Système temporaire — saisie manuelle du niveau Catacombs (mémorisé 24h)",
    });
}

client.once("ready", () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
});

// === Commande /pf ===
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "pf") return;

  const modeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("mode_normal").setLabel("Normal").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("mode_master").setLabel("Master").setStyle(ButtonStyle.Danger)
  );

  await interaction.reply({
    content: "Choisis le **mode du donjon** 👇",
    components: [modeRow],
    ephemeral: true,
  });
});

// === Boutons ===
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;
  const userId = interaction.user.id;

  // Mode
  if (interaction.customId === "mode_normal" || interaction.customId === "mode_master") {
    const mode = interaction.customId === "mode_normal" ? "Normal" : "Master";

    const floorButtons = Array.from({ length: 7 }, (_, i) =>
      new ButtonBuilder()
        .setCustomId(`floor_${mode}_${i + 1}`)
        .setLabel(`${mode === "Normal" ? "F" : "M"}${i + 1}`)
        .setStyle(mode === "Normal" ? ButtonStyle.Success : ButtonStyle.Danger)
    );

    const row1 = new ActionRowBuilder().addComponents(floorButtons.slice(0, 5));
    const row2 = new ActionRowBuilder().addComponents(floorButtons.slice(5));

    await interaction.update({
      content: `Mode **${mode}** sélectionné. Choisis un floor :`,
      components: [row1, row2],
    });
  }

  // Floor
  else if (interaction.customId.startsWith("floor_")) {
    const [_, mode, floorNumber] = interaction.customId.split("_");
    const floor = (mode === "Normal" ? "F" : "M") + floorNumber;

    const party = { owner: userId, mode, floor, members: [], size: 5 };
    partyData.set(userId, party);

    const sizeButtons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`size_2_${userId}`).setLabel("2 joueurs").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`size_3_${userId}`).setLabel("3 joueurs").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`size_4_${userId}`).setLabel("4 joueurs").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`size_5_${userId}`).setLabel("5 joueurs").setStyle(ButtonStyle.Secondary)
    );

    await interaction.update({
      content: `**Floor ${floor} (${mode})** sélectionné !\nCombien de joueurs veux-tu dans ta party ? 👇`,
      components: [sizeButtons],
    });
  }

  // Taille
  else if (interaction.customId.startsWith("size_")) {
    const [_, size, ownerId] = interaction.customId.split("_");
    if (interaction.user.id !== ownerId)
      return interaction.reply({ content: "❌ Seul le créateur peut choisir la taille.", ephemeral: true });

    const party = partyData.get(ownerId);
    party.size = Number(size);

    const classButtons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("class_Berserker").setLabel("🗡 Berserker").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("class_Tank").setLabel("🛡 Tank").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("class_Healer").setLabel("💚 Healer").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("class_Archer").setLabel("🏹 Archer").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("class_Mage").setLabel("🔥 Mage").setStyle(ButtonStyle.Danger)
    );

    const manageButtons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("leave_party").setLabel("Quitter la party").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("delete_party").setLabel("Supprimer la party").setStyle(ButtonStyle.Danger)
    );

    const embed = createPartyEmbed(party);
    const msg = await interaction.channel.send({ embeds: [embed], components: [classButtons, manageButtons] });
    party.messageId = msg.id;

    await interaction.update({
      content: `✅ Party créée pour **${party.floor} (${party.mode})** avec **${party.size} joueurs max** !`,
      components: [],
    });
  }

  // Classe
  else if (interaction.customId.startsWith("class_")) {
    const chosenClass = interaction.customId.split("_")[1];
    const party = Array.from(partyData.values()).find((p) => p.messageId === interaction.message.id);
    if (!party) return interaction.reply({ content: "⚠️ Aucune party trouvée.", ephemeral: true });

    let member = party.members.find((m) => m.id === interaction.user.id);
    if (!member) {
      if (party.members.length >= party.size)
        return interaction.reply({ content: "❌ La party est déjà complète !", ephemeral: true });

      const cached = playerCataCache.get(interaction.user.id);
      if (cached && cached.expires > Date.now()) {
        member = { id: interaction.user.id, class: chosenClass, cata: cached.level };
      } else {
        member = { id: interaction.user.id, class: chosenClass };
      }
      party.members.push(member);
    } else member.class = chosenClass;

    if (party.members.length === party.size) {
      const mentions = party.members.map((m) => `<@${m.id}>`).join(", ");
      const message = await interaction.channel.send(
        `✅ **La party est complète !**\n👥 ${mentions}\n<@${party.owner}>, tu peux maintenant **inviter tout le monde** dans ton groupe en jeu !`
      );
      setTimeout(() => message.delete().catch(() => {}), 60000);
    }

    const embed = createPartyEmbed(party);
    await interaction.update({ embeds: [embed] });

    if (!member.cata) {
      await interaction.followUp({
        content: `🧱 <@${interaction.user.id}>, entre ton **niveau Catacombs** (ex: 38) :`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`enter_cata_${interaction.user.id}`)
              .setLabel("Entrer mon niveau Catacombs")
              .setStyle(ButtonStyle.Primary)
          ),
        ],
        ephemeral: true,
      });
    }
  }

  // Entrer le niveau
  else if (interaction.customId.startsWith("enter_cata_")) {
    const targetUserId = interaction.customId.split("_")[2];
    if (interaction.user.id !== targetUserId)
      return interaction.reply({ content: "❌ Ce bouton n’est pas pour toi.", ephemeral: true });

    const modal = new ModalBuilder()
      .setCustomId(`modal_cata_${interaction.user.id}`)
      .setTitle("Entrer ton niveau Catacombs")
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("cata_level")
            .setLabel("Ton niveau Catacombs (ex: 38)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
        )
      );

    await interaction.showModal(modal);
  }

  // Quitter ou supprimer
  else if (["leave_party", "delete_party"].includes(interaction.customId)) {
    const party = Array.from(partyData.values()).find((p) => p.messageId === interaction.message.id);
    if (!party) return;

    if (interaction.customId === "delete_party") {
      if (interaction.user.id !== party.owner)
        return interaction.reply({ content: "❌ Seul le créateur peut supprimer la party.", ephemeral: true });

      await interaction.message.delete();
      partyData.delete(party.owner);
    } else {
      party.members = party.members.filter((m) => m.id !== interaction.user.id);
      const embed = createPartyEmbed(party);
      await interaction.update({ embeds: [embed] });
    }
  }
});

// === Modal : sauvegarde du niveau ===
client.on("interactionCreate", async (interaction) => {
  if (interaction.type !== InteractionType.ModalSubmit) return;
  if (!interaction.customId.startsWith("modal_cata_")) return;

  const user = interaction.user;
  const level = interaction.fields.getTextInputValue("cata_level");

  playerCataCache.set(user.id, {
    level,
    expires: Date.now() + 24 * 60 * 60 * 1000,
  });

  const party = Array.from(partyData.values()).find((p) => p.members.some((m) => m.id === user.id));
  if (!party) return;

  const member = party.members.find((m) => m.id === user.id);
  member.cata = level;

  const embed = createPartyEmbed(party);
  const msg = await interaction.channel.messages.fetch(party.messageId);
  await msg.edit({ embeds: [embed] });

  await interaction.reply({
    content: `✅ Niveau Catacombs défini sur **${level}** (mémorisé pendant 24h).`,
    ephemeral: true,
  });
});

client.login(process.env.TOKEN);

// --- Keep-alive pour Railway + UptimeRobot ---
const app = express();
app.get("/", (req, res) => res.send("Bot actif."));
app.listen(3000, () => console.log("🌐 Keep-alive actif sur le port 3000"));
