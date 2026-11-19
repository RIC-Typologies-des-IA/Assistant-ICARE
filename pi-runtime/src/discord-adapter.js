import {
  ChannelType, Client, Events, GatewayIntentBits, MessageFlags,
  PermissionFlagsBits, Partials, REST, Routes, SlashCommandBuilder
} from "discord.js";
import {
  bindDiscordChannelToProject, getDiscordBoundProject,
  initializeDiscordBindingStore, unbindDiscordChannel
} from "./discord-store.js";
import {
  bootstrapDiscordProjectOwner, getDiscordProjectAccess,
  grantDiscordProjectMember, listDiscordProjectMembers,
  revokeDiscordProjectMember
} from "./discord-access.js";

const MAX_DISCORD_MESSAGE = 1900;

function commandDefinition() {
  return new SlashCommandBuilder()
    .setName("icare")
    .setDescription("Relier Discord à un projet ICARE")
    .addSubcommand(command => command
      .setName("bind").setDescription("Relier ce salon à un projet ICARE")
      .addStringOption(option => option.setName("project_id")
        .setDescription("Identifiant du projet ICARE").setRequired(true)))
    .addSubcommand(command => command
      .setName("unbind").setDescription("Retirer le lien de ce salon"))
    .addSubcommand(command => command
      .setName("status").setDescription("Afficher le projet ICARE lié à ce salon"))
    .addSubcommand(command => command
      .setName("invite").setDescription("Ajouter un membre au projet lié")
      .addUserOption(option => option.setName("user").setDescription("Personne à inviter").setRequired(true))
      .addStringOption(option => option.setName("role").setDescription("Rôle ICARE")
        .addChoices({ name: "Membre", value: "member" }, { name: "Propriétaire", value: "owner" })))
    .addSubcommand(command => command
      .setName("revoke").setDescription("Retirer un membre du projet lié")
      .addUserOption(option => option.setName("user").setDescription("Personne à retirer").setRequired(true)))
    .addSubcommand(command => command
      .setName("members").setDescription("Lister les membres du projet lié"))
    .addSubcommand(command => command
      .setName("help").setDescription("Afficher les commandes ICARE"));
}

function channelBindingId(channel) {
  return channel?.isThread?.() ? channel.parentId : channel?.id;
}

async function sendLongMessage(channel, text) {
  const output = String(text || "").trim() || "Je n'ai pas produit de réponse textuelle.";
  for (let offset = 0; offset < output.length; offset += MAX_DISCORD_MESSAGE) {
    await channel.send({ content: output.slice(offset, offset + MAX_DISCORD_MESSAGE), allowedMentions: { parse: [] } });
  }
}

async function readChatStream(response) {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Le runtime ICARE a répondu HTTP " + response.status + ".");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let streamError = null;
  const consume = block => {
    let eventName = "";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    let payload;
    try { payload = JSON.parse(data); } catch { return; }
    if (eventName === "delta") answer += payload.text || "";
    if (eventName === "persistence" && payload.created > 0) {
      answer += "\n\n✓ " + payload.created + " proposition(s) candidate(s) enregistrée(s) dans ICARE.";
    } else if (eventName === "persistence" && payload.unconfirmedClaim) {
      answer += "\n\n⚠️ Aucune proposition n'a été retrouvée dans le registre ICARE.";
    } else if (eventName === "persistence" && payload.reconciliationError) {
      answer += "\n\n⚠️ Vérification de persistance impossible : " + payload.reconciliationError;
    }
    if (eventName === "error") streamError = payload.message || "Erreur de conversation ICARE.";
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      consume(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);
  if (streamError && !answer) throw new Error(streamError);
  return answer || (streamError ? "La réponse a rencontré une erreur : " + streamError : "");
}

async function callIcareChat({ port, projectId, sessionId, message }) {
  const response = await fetch("http://127.0.0.1:" + port + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, sessionId, message }),
    signal: AbortSignal.timeout(180000)
  });
  return readChatStream(response);
}

async function registerCommands(clientId, token, guildId) {
  const rest = new REST({ version: "10" }).setToken(token);
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);
  await rest.put(route, { body: [commandDefinition().toJSON()] });
}

export async function startDiscordBot({
  db, port, defaultProjectId = process.env.ICARE_DISCORD_DEFAULT_PROJECT_ID || ""
}) {
  const token = process.env.DISCORD_BOT_TOKEN || "";
  const clientId = process.env.DISCORD_CLIENT_ID || "";
  if (!token) return null;
  if (!clientId) {
    throw new Error("DISCORD_BOT_TOKEN et DISCORD_CLIENT_ID doivent être configurés ensemble.");
  }
  initializeDiscordBindingStore(db);
  if (defaultProjectId && !db.prepare("SELECT id FROM projects WHERE id=?").get(defaultProjectId)) {
    throw new Error("ICARE_DISCORD_DEFAULT_PROJECT_ID ne correspond à aucun projet local.");
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
  });

  client.once(Events.ClientReady, async readyClient => {
    console.log("[ICARE Discord] Bot connecté :", readyClient.user.tag);
    try {
      await registerCommands(clientId, token, process.env.DISCORD_GUILD_ID || "");
      console.log("[ICARE Discord] Commandes /icare enregistrées.");
    } catch (error) {
      console.error("[ICARE Discord] Échec d'enregistrement des commandes :", error.message || error);
    }
  });

  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "icare") return;
    const subcommand = interaction.options.getSubcommand();
    const bindingId = channelBindingId(interaction.channel);
    try {
      if (subcommand === "bind") {
        if (!interaction.inGuild() ||
            !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({
            content: "La liaison d'un salon exige la permission Discord Gérer le serveur.",
            flags: MessageFlags.Ephemeral
          });
        }
        const projectId = interaction.options.getString("project_id", true);
        const access = bootstrapDiscordProjectOwner(db, projectId, interaction.user.id);
        if (!access) throw new Error("Impossible d'établir votre appartenance au projet.");
        if (access.roleConflict || !["owner", "member"].includes(access.role)) {
          throw new Error("Votre appartenance présente un conflit de rôle ou n'est pas valide. Demandez à un propriétaire de clarifier vos droits.");
        }
        bindDiscordChannelToProject(db, {
          channelId: bindingId || interaction.channelId,
          projectId, boundBy: interaction.user.id
        });
        return interaction.reply({
          content: "Ce salon est relié au projet ICARE " + projectId +
            (access.role === "owner" ? ". Vous êtes propriétaire du projet." : ". Vous êtes membre du projet.") +
            " Mentionnez le bot pour démarrer une conversation ; les échanges suivants se poursuivent dans le fil créé.",
          flags: MessageFlags.Ephemeral
        });
      }
      if (subcommand === "unbind") {
        if (!interaction.inGuild() ||
            !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({
            content: "La suppression d'un lien exige la permission Discord Gérer le serveur.",
            flags: MessageFlags.Ephemeral
          });
        }
        const removed = unbindDiscordChannel(db, bindingId || interaction.channelId);
        return interaction.reply({
          content: removed ? "Lien ICARE retiré." : "Aucun lien ICARE n'était configuré ici.",
          flags: MessageFlags.Ephemeral
        });
      }
      if (subcommand === "status") {
        const projectId = getDiscordBoundProject(db, {
          channelId: interaction.channelId, parentChannelId: interaction.channel?.parentId,
          defaultProjectId: interaction.inGuild() ? null : defaultProjectId
        });
        return interaction.reply({
          content: projectId ? "Projet ICARE lié : " + projectId :
            "Aucun projet lié. Un administrateur peut utiliser /icare bind.",
          flags: MessageFlags.Ephemeral
        });
      }
      if (["invite", "revoke", "members"].includes(subcommand)) {
        const projectId = getDiscordBoundProject(db, {
          channelId: interaction.channelId, parentChannelId: interaction.channel?.parentId,
          defaultProjectId: interaction.inGuild() ? null : defaultProjectId
        });
        if (!projectId) throw new Error("Aucun projet ICARE n'est lié à ce salon.");
        const access = getDiscordProjectAccess(db, projectId, interaction.user.id);
        if (!access) throw new Error("Vous n'êtes pas membre de ce projet.");
        if (subcommand === "members") {
          const members = listDiscordProjectMembers(db, projectId);
          const lines = members.map(member => "• " + member.principalId + " — " + member.role);
          return interaction.reply({
            content: lines.length ? "Membres du projet " + projectId + " :\n" + lines.join("\n") : "Aucun membre enregistré.",
            flags: MessageFlags.Ephemeral
          });
        }
        if (access.role !== "owner" || access.roleConflict) {
          throw new Error("Seul un propriétaire du projet peut gérer ses membres.");
        }
        const target = interaction.options.getUser("user", true);
        if (subcommand === "invite") {
          const existing = getDiscordProjectAccess(db, projectId, target.id);
          if (existing) throw new Error("Cette personne est déjà membre du projet.");
          const role = interaction.options.getString("role") || "member";
          grantDiscordProjectMember(db, {
            projectId, discordUserId: target.id, role,
            actorDiscordUserId: interaction.user.id
          });
          return interaction.reply({
            content: target.username + " a été ajouté au projet avec le rôle " + role + ".",
            flags: MessageFlags.Ephemeral
          });
        }
        const removed = revokeDiscordProjectMember(db, {
          projectId, discordUserId: target.id,
          actorDiscordUserId: interaction.user.id
        });
        return interaction.reply({
          content: removed ? target.username + " a été retiré du projet." : "Cette personne n'était pas membre du projet.",
          flags: MessageFlags.Ephemeral
        });
      }
      return interaction.reply({
        content: "Dans un salon lié, mentionnez le bot pour démarrer une conversation. " +
          "Utilisez /icare bind pour lier un projet, /icare invite pour ajouter un membre, /icare members pour les lister.",
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      const content = error.message || "Impossible de modifier le lien ICARE.";
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      }
    }
  });

  client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;
    const isDm = message.channel.type === ChannelType.DM;
    const isThread = message.channel.isThread?.() === true;
    const threadProject = isThread ? getDiscordBoundProject(db, {
      channelId: message.channel.id, defaultProjectId: null
    }) : null;
    const mentioned = client.user ? message.mentions.has(client.user) : false;
    if (!isDm && !isThread && !mentioned) return;
    if (isThread && !threadProject && !mentioned) return;

    const projectId = getDiscordBoundProject(db, {
      channelId: message.channel.id,
      parentChannelId: message.channel.parentId || null,
      defaultProjectId: isDm ? defaultProjectId : null
    });
    if (!projectId) {
      await message.reply("Aucun projet ICARE n'est lié à ce salon. Un administrateur peut utiliser /icare bind.");
      return;
    }
    if (!getDiscordProjectAccess(db, projectId, message.author.id)) {
      await message.reply("Vous n'êtes pas membre de ce projet. Demandez à un propriétaire de vous inviter avec /icare invite.");
      return;
    }
    if (isThread && !threadProject) {
      bindDiscordChannelToProject(db, {
        channelId: message.channel.id, projectId, boundBy: message.author.id
      });
    }

    let target = message.channel;
    if (!isDm && !isThread && mentioned && typeof message.startThread === "function") {
      try {
        target = await message.startThread({
          name: ("ICARE — " + message.author.username).slice(0, 90),
          autoArchiveDuration: 1440
        });
        bindDiscordChannelToProject(db, {
          channelId: target.id, projectId, boundBy: message.author.id
        });
      } catch {
        target = message.channel;
      }
    }

    const content = String(message.content || "")
      .replace(new RegExp("<@!?" + client.user.id + ">", "g"), "")
      .trim();
    if (!content) {
      await target.send({ content: "Je suis prêt. Quel est le sujet de travail ?", allowedMentions: { parse: [] } });
      return;
    }
    const sessionId = ("discord-" + target.id).slice(0, 100);
    try {
      await target.sendTyping();
      const answer = await callIcareChat({ port, projectId, sessionId, message: content });
      await sendLongMessage(target, answer);
    } catch (error) {
      await target.send({ content: "Je n'ai pas pu traiter ce message dans ICARE : " +
        (error.message || String(error)).slice(0, 1200), allowedMentions: { parse: [] } });
    }
  });

  client.on("error", error => {
    console.error("[ICARE Discord] Erreur du client :", error.message || error);
  });

  await client.login(token);
  return client;
}
