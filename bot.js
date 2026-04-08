// ============================================
// ML DEVLOPPING — Bot Discord v3 (FIXED)
// ============================================
// FIXES:
//   - Ajout des intents nécessaires pour les DMs (Partials)
//   - Détection robuste des channels (par DB, pas par nom)
//   - Gestion correcte des commandes ^^
//   - Meilleure gestion d'erreurs DM
//   - findGuildMember amélioré avec fetch forcé
// ============================================
// Installation: npm install discord.js @supabase/supabase-js node-fetch express
// Node.js 18+ requis
// ============================================

const { Client, GatewayIntentBits, EmbedBuilder, Partials } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');

// ── EXPRESS SERVER (Keep-Alive pour Render) ──────────────────────
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.json({
    status: 'online',
    bot: client.user?.tag || 'connecting...',
    uptime: Math.floor(process.uptime()) + 's',
    timestamp: new Date().toISOString(),
  });
});

app.get('/ping', (req, res) => {
  res.json({ pong: true, timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🌐 Serveur Express actif sur le port ${PORT}`);
});

// ── AUTO PING (toutes les 5 minutes) ─────────────────────────────
const RENDER_URL = process.env.RENDER_URL;

function startKeepAlive() {
  if (!RENDER_URL) {
    console.warn('⚠️  RENDER_URL non défini — keep-alive désactivé');
    return;
  }
  setInterval(async () => {
    try {
      const res = await fetch(`${RENDER_URL}/ping`);
      const data = await res.json();
      console.log(`🏓 Keep-alive ping OK — ${data.timestamp}`);
    } catch (err) {
      console.error('❌ Keep-alive ping échoué:', err.message);
    }
  }, 5 * 60 * 1000);
  console.log(`🔁 Keep-alive démarré → ${RENDER_URL}/ping`);
}

// ── CONFIG — Variables d'environnement ──────────────────────────
const DISCORD_TOKEN        = process.env.DISCORD_TOKEN;
const GUILD_ID             = process.env.GUILD_ID;
const ORDERS_CATEGORY_ID   = process.env.ORDERS_CATEGORY_ID;
const CONTACTS_CATEGORY_ID = process.env.CONTACTS_CATEGORY_ID;
const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_KEY         = process.env.SUPABASE_KEY;

const REQUIRED_ENV = [
  'DISCORD_TOKEN', 'GUILD_ID', 'ORDERS_CATEGORY_ID',
  'CONTACTS_CATEGORY_ID', 'SUPABASE_URL', 'SUPABASE_KEY',
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ Variable d'environnement manquante : ${key}`);
    process.exit(1);
  }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── FIX CRITIQUE : Partials nécessaires pour les DMs ─────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,       // FIX: nécessaire pour fetchMembers
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.DirectMessageTyping,
  ],
  partials: [
    Partials.Channel,    // FIX: requis pour recevoir/envoyer des DMs
    Partials.Message,
    Partials.User,
    Partials.GuildMember,
  ],
});

const STATUS_LABELS = {
  pending:      '⏳ En attente',
  en_cours:     '⚙️ En cours',
  preparation:  '🎨 Préparation',
  finalisation: '🔍 Finalisation',
  termine:      '✅ Terminée',
};

const STATUS_COLORS = {
  pending:      0xf59e0b,
  en_cours:     0x3b82f6,
  preparation:  0xa855f7,
  finalisation: 0xec4899,
  termine:      0x22c55e,
};

// ── BOT READY ────────────────────────────────────────────────────
client.once('ready', async () => {
  console.log(`✅ Bot connecté : ${client.user.tag}`);

  // FIX: Pré-charger les membres du serveur au démarrage
  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (guild) {
      await guild.members.fetch();
      console.log(`👥 ${guild.memberCount} membres chargés pour ${guild.name}`);
    } else {
      console.error('❌ Guild introuvable au démarrage. Vérifiez GUILD_ID.');
    }
  } catch (err) {
    console.error('Erreur chargement membres:', err.message);
  }

  setInterval(checkNotifications, 10000);
  startKeepAlive();
});

// ── UTILITAIRE : trouver un membre Discord par son username ──────
// FIX: Re-fetch à chaque fois pour éviter le cache périmé
async function findGuildMember(discordUsername) {
  if (!discordUsername) return null;
  const cleanUsername = discordUsername.replace(/^@/, '').trim().toLowerCase();

  try {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
      console.error('❌ Guild introuvable dans findGuildMember');
      return null;
    }

    // 1. Chercher dans le cache d'abord
    let member = guild.members.cache.find(m =>
      m.user.username.toLowerCase() === cleanUsername ||
      m.user.tag?.toLowerCase() === cleanUsername ||
      (m.nickname && m.nickname.toLowerCase() === cleanUsername) ||
      m.user.globalName?.toLowerCase() === cleanUsername
    );

    // 2. Si pas trouvé en cache, essayer de fetch directement
    if (!member) {
      console.log(`🔍 Membre "${cleanUsername}" absent du cache, tentative de fetch...`);
      try {
        // Tenter un fetch de tous les membres
        const freshMembers = await guild.members.fetch({ force: true });
        member = freshMembers.find(m =>
          m.user.username.toLowerCase() === cleanUsername ||
          m.user.tag?.toLowerCase() === cleanUsername ||
          (m.nickname && m.nickname.toLowerCase() === cleanUsername) ||
          m.user.globalName?.toLowerCase() === cleanUsername
        );
      } catch (fetchErr) {
        console.error('Erreur fetch membres:', fetchErr.message);
      }
    }

    if (member) {
      console.log(`✅ Membre trouvé : ${member.user.tag}`);
    } else {
      console.warn(`⚠️ Membre introuvable pour username : "${cleanUsername}"`);
    }

    return member || null;
  } catch (err) {
    console.error('Erreur findGuildMember:', err.message);
    return null;
  }
}

// ── UTILITAIRE : envoyer un DM à un membre ───────────────────────
// FIX: Meilleure gestion d'erreurs avec codes Discord
async function sendDM(discordUsername, embed, fallbackText = null) {
  if (!discordUsername) return false;

  try {
    const member = await findGuildMember(discordUsername);
    if (!member) {
      console.warn(`⚠️ Impossible d'envoyer un DM : membre "${discordUsername}" introuvable.`);
      return false;
    }

    // Vérifier si le bot peut envoyer des DMs (membre non bot, DMs non désactivés)
    const dmChannel = await member.createDM();

    if (embed) {
      await dmChannel.send({ embeds: [embed] });
    } else if (fallbackText) {
      await dmChannel.send(fallbackText);
    }

    console.log(`📨 DM envoyé avec succès à ${member.user.tag}`);
    return true;
  } catch (err) {
    // Code 50007 = Cannot send messages to this user (DMs désactivés)
    if (err.code === 50007) {
      console.warn(`⚠️ DM impossible pour ${discordUsername} : DMs désactivés ou bot bloqué.`);
    } else {
      console.error(`❌ Erreur DM vers ${discordUsername}: [${err.code}] ${err.message}`);
    }
    return false;
  }
}

// ── POLL : vérifier nouvelles notifs ─────────────────────────────
async function checkNotifications() {
  try {
    const { data: notifs, error } = await supabase
      .from('discord_notifications')
      .select('*')
      .eq('processed', false)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Erreur lecture notifications:', error.message);
      return;
    }
    if (!notifs?.length) return;

    for (const notif of notifs) {
      try {
        if (notif.type === 'order' && notif.order_id) {
          await handleNewOrder(notif);
        } else if (notif.type === 'contact' && notif.contact_id) {
          const { data: contact } = await supabase
            .from('contacts').select('*').eq('id', notif.contact_id).single();

          if (contact?.discord_channel_id) {
            await handleClientContactReply(contact);
          } else {
            await handleNewContact(notif);
          }
        } else if (notif.type === 'order_message' && notif.order_id) {
          await handleClientOrderMessage(notif);
        }
      } catch (notifErr) {
        console.error(`❌ Erreur traitement notif #${notif.id}:`, notifErr.message);
      }

      // Marquer comme traité même en cas d'erreur pour éviter les boucles
      await supabase
        .from('discord_notifications')
        .update({ processed: true })
        .eq('id', notif.id);
    }
  } catch (err) {
    console.error('Erreur polling:', err.message);
  }
}

// ── NOUVELLE COMMANDE ─────────────────────────────────────────────
async function handleNewOrder(notif) {
  const { data: order, error: orderError } = await supabase
    .from('orders').select('*').eq('id', notif.order_id).single();

  if (orderError || !order) {
    console.error('Commande introuvable:', notif.order_id);
    return;
  }

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return console.error('Guild introuvable.');

  const discordUsername = order.discord_username;

  // ── Vérification membre Discord ──
  if (discordUsername) {
    const member = await findGuildMember(discordUsername);
    if (!member) {
      console.warn(`⚠️ Client Discord "${discordUsername}" introuvable pour commande #${order.id}`);
    }
  }

  // ── Numérotation du ticket ──
  const { count } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .not('discord_channel_id', 'is', null);
  const channelNum = String((count || 0) + 1).padStart(3, '0');
  const channelName = `commande-${channelNum}`;

  // ── Créer le channel ──
  let channel;
  try {
    channel = await guild.channels.create({
      name: channelName,
      type: 0, // GUILD_TEXT
      parent: ORDERS_CATEGORY_ID,
      topic: `Commande #${order.id} — ${order.client_username} — ${order.plan}`,
    });
  } catch (err) {
    console.error('Erreur création channel:', err.message);
    return;
  }

  await supabase.from('orders')
    .update({ discord_channel_id: channel.id })
    .eq('id', order.id);

  // ── Embed ticket ──
  const ticketEmbed = new EmbedBuilder()
    .setColor(0x1a3dbf)
    .setTitle(`📦 Nouvelle commande #${order.id}`)
    .setDescription(`**${order.plan}** — ${order.price}€/mois`)
    .addFields(
      { name: '👤 Client', value: order.client_name || 'N/A', inline: true },
      { name: '🏷️ Username', value: order.client_username || 'N/A', inline: true },
      { name: '📧 Email', value: order.client_email || 'N/A', inline: true },
      { name: '💬 Discord', value: discordUsername ? `@${discordUsername}` : 'Non renseigné', inline: true },
      { name: '📋 Description', value: order.description || '*Aucune description*', inline: false },
      { name: '📌 Statut', value: STATUS_LABELS[order.status] || STATUS_LABELS.pending, inline: true },
      { name: '🕐 Date', value: new Date(order.created_at).toLocaleString('fr-FR'), inline: true },
    )
    .setFooter({ text: 'ML Devlopping — Panel de gestion' })
    .setTimestamp();

  const commandsHelp = [
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '**📋 Commandes disponibles :**',
    '`^^en_cours` — Marquer en cours',
    '`^^preparation` — Marquer en préparation',
    '`^^finalisation` — Marquer en finalisation',
    '`^^terminer` — Marquer comme terminée',
    '`^^contact <message>` — Envoyer un DM Discord au client',
    '',
    '> ✅ Le statut se met à jour en **temps réel** sur le site.',
    '> 💬 Les messages du client depuis le site apparaissent ici automatiquement.',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  ].join('\n');

  await channel.send({ embeds: [ticketEmbed] });
  await channel.send(commandsHelp);

  // ── DM récapitulatif au client ──
  if (discordUsername) {
    const recapEmbed = new EmbedBuilder()
      .setColor(0x1a3dbf)
      .setTitle('🎉 Votre commande a bien été reçue !')
      .setDescription(`Merci pour votre confiance, **${order.client_name}** !\n\nVoici le récapitulatif de votre commande chez **ML Devlopping**.`)
      .addFields(
        { name: '📦 Plan souscrit', value: `**${order.plan}**`, inline: true },
        { name: '💰 Tarif', value: `**${order.price}€/mois**`, inline: true },
        { name: '📋 Description', value: order.description || '*Aucune description fournie*', inline: false },
        { name: '📌 Statut initial', value: STATUS_LABELS['pending'], inline: true },
        { name: '🕐 Date de commande', value: new Date(order.created_at).toLocaleString('fr-FR'), inline: true },
        { name: '🔔 Notifications', value: 'Vous recevrez un DM à chaque changement de statut et pour chaque message de notre équipe.', inline: false },
      )
      .setFooter({ text: `ML Devlopping — Commande #${order.id}` })
      .setTimestamp();

    const sent = await sendDM(discordUsername, recapEmbed);
    if (!sent) {
      await channel.send(`⚠️ **Impossible d'envoyer le DM de récapitulatif** à \`${discordUsername}\`. Le client n'est peut-être pas membre du serveur ou a les DM désactivés.`);
    }
  }

  console.log(`✅ Channel créé : #${channelName} pour commande #${order.id}`);
}

// ── NOUVEAU CONTACT ──────────────────────────────────────────────
async function handleNewContact(notif) {
  const { data: contact, error } = await supabase
    .from('contacts').select('*').eq('id', notif.contact_id).single();

  if (error || !contact) return console.error('Contact introuvable:', notif.contact_id);

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;

  const discordUsername = contact.discord_username;

  // ── Numérotation ──
  const { count } = await supabase
    .from('contacts')
    .select('*', { count: 'exact', head: true })
    .not('discord_channel_id', 'is', null);
  const channelNum = String((count || 0) + 1).padStart(3, '0');
  const channelName = `contact-${channelNum}`;

  let channel;
  try {
    channel = await guild.channels.create({
      name: channelName,
      type: 0,
      parent: CONTACTS_CATEGORY_ID,
      topic: `Contact #${contact.id} — ${contact.email} — ${contact.subject}`,
    });
  } catch (err) {
    console.error('Erreur création channel contact:', err.message);
    return;
  }

  await supabase.from('contacts')
    .update({ discord_channel_id: channel.id })
    .eq('id', contact.id);

  const embed = new EmbedBuilder()
    .setColor(0x2d5be3)
    .setTitle(`✉️ Nouveau message de contact #${contact.id}`)
    .addFields(
      { name: '👤 Nom', value: `${contact.first_name} ${contact.last_name}`, inline: true },
      { name: '📧 Email', value: contact.email, inline: true },
      { name: '💬 Discord', value: discordUsername ? `@${discordUsername}` : 'Non renseigné', inline: true },
      { name: '📌 Objet', value: contact.subject, inline: false },
      { name: '💬 Message', value: contact.message, inline: false },
      { name: '🕐 Date', value: new Date(contact.created_at).toLocaleString('fr-FR'), inline: true },
    )
    .setFooter({ text: 'ML Devlopping — Formulaire de contact' })
    .setTimestamp();

  const helpText = [
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '**📋 Commandes disponibles :**',
    '`^^answer <votre message>` — Répondre au client en DM Discord',
    '',
    '> 💬 Les messages de suivi du client depuis le site apparaissent automatiquement ici.',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  ].join('\n');

  await channel.send({ embeds: [embed] });
  await channel.send(helpText);

  // ── DM de confirmation au client ──
  if (discordUsername) {
    const confirmEmbed = new EmbedBuilder()
      .setColor(0x2d5be3)
      .setTitle('✅ Votre message a bien été reçu !')
      .setDescription(`Bonjour **${contact.first_name}** !\n\nNous avons bien reçu votre message. Notre équipe vous répondra directement ici en DM Discord sous 24h.`)
      .addFields(
        { name: '📌 Objet', value: contact.subject, inline: false },
        { name: '💬 Votre message', value: contact.message.slice(0, 300) + (contact.message.length > 300 ? '…' : ''), inline: false },
      )
      .setFooter({ text: 'ML Devlopping — Support' })
      .setTimestamp();

    const sent = await sendDM(discordUsername, confirmEmbed);
    if (!sent) {
      await channel.send(`⚠️ **Impossible d'envoyer le DM de confirmation** à \`${discordUsername}\`.`);
    }
  }

  console.log(`✅ Channel contact créé : #${channelName}`);
}

// ── SUIVI CLIENT CONTACT (message follow-up depuis le site) ──────
async function handleClientContactReply(contact) {
  const { data: msgs } = await supabase
    .from('discord_messages')
    .select('*')
    .eq('contact_id', contact.id)
    .eq('direction', 'in')
    .order('created_at', { ascending: false })
    .limit(1);

  if (!msgs?.length) return;
  const lastMsg = msgs[0];

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;
  const channel = guild.channels.cache.get(contact.discord_channel_id);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0x4f7af8)
    .setTitle('💬 Nouveau message du client (depuis le site)')
    .setDescription(lastMsg.content)
    .addFields(
      { name: '👤 Client', value: `${contact.first_name} ${contact.last_name}`, inline: true },
      { name: '📧 Email', value: contact.email, inline: true },
      { name: '💬 Discord', value: contact.discord_username ? `@${contact.discord_username}` : 'N/A', inline: true },
    )
    .setFooter({ text: `Contact #${contact.id} — répondez avec ^^answer <message>` })
    .setTimestamp();

  await channel.send({ embeds: [embed] });
  console.log(`📨 Message client contact relayé dans #${channel.name}`);
}

// ── MESSAGE CLIENT COMMANDE (depuis le site) ─────────────────────
async function handleClientOrderMessage(notif) {
  const { data: order } = await supabase
    .from('orders').select('*').eq('id', notif.order_id).single();

  if (!order || !order.discord_channel_id) return;

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;
  const channel = guild.channels.cache.get(order.discord_channel_id);
  if (!channel) return;

  const { data: msgs } = await supabase
    .from('discord_messages')
    .select('*')
    .eq('order_id', order.id)
    .eq('direction', 'in')
    .order('created_at', { ascending: false })
    .limit(1);

  if (!msgs?.length) return;
  const lastMsg = msgs[0];

  const embed = new EmbedBuilder()
    .setColor(0x4f7af8)
    .setTitle('💬 Nouveau message du client (depuis le site)')
    .setDescription(lastMsg.content)
    .addFields(
      { name: '👤 Client', value: order.client_name || 'N/A', inline: true },
      { name: '🏷️ Username', value: order.client_username || 'N/A', inline: true },
      { name: '💬 Discord', value: order.discord_username ? `@${order.discord_username}` : 'N/A', inline: true },
    )
    .setFooter({ text: `Commande #${order.id} — répondez avec ^^contact <message>` })
    .setTimestamp();

  await channel.send({ embeds: [embed] });
  console.log(`📨 Message client commande relayé dans #${channel.name}`);
}

// ── COMMANDES DISCORD ─────────────────────────────────────────────
// FIX CRITIQUE : On identifie les channels par la DB, pas par le nom
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return; // Ignorer les DMs entrants

  const content = message.content.trim();
  const channelId = message.channel.id;

  // ── IDENTIFIER LE TYPE DE CHANNEL VIA LA BASE DE DONNÉES ──────
  // On cherche d'abord si c'est un channel de commande
  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('discord_channel_id', channelId)
    .maybeSingle();

  if (order) {
    // ── C'est un channel de commande ──────────────────────────────
    const statusCommands = {
      '^^en_cours':     'en_cours',
      '^^preparation':  'preparation',
      '^^finalisation': 'finalisation',
      '^^terminer':     'termine',
    };

    // ── Changement de statut ──
    if (statusCommands[content]) {
      const newStatus = statusCommands[content];

      const { error: updateError } = await supabase
        .from('orders')
        .update({ status: newStatus })
        .eq('id', order.id);

      if (updateError) {
        await message.reply(`❌ Erreur lors de la mise à jour du statut : ${updateError.message}`);
        return;
      }

      const ticketEmbed = new EmbedBuilder()
        .setColor(STATUS_COLORS[newStatus] || 0x22c55e)
        .setTitle('✅ Statut mis à jour')
        .setDescription(`Commande **#${order.id}** → ${STATUS_LABELS[newStatus]}`)
        .setTimestamp();

      await message.channel.send({ embeds: [ticketEmbed] });
      await message.react('✅');

      // ── DM de notification au client ──
      if (order.discord_username) {
        const dmEmbed = new EmbedBuilder()
          .setColor(STATUS_COLORS[newStatus] || 0x22c55e)
          .setTitle('🔔 Mise à jour de votre commande !')
          .setDescription(`Bonjour **${order.client_name}**, votre commande vient d'être mise à jour.`)
          .addFields(
            { name: '📦 Plan', value: order.plan, inline: true },
            { name: '📌 Nouveau statut', value: STATUS_LABELS[newStatus], inline: true },
            { name: '🔍 Suivre', value: 'Consultez votre espace client sur notre site pour voir les détails.', inline: false },
          )
          .setFooter({ text: `ML Devlopping — Commande #${order.id}` })
          .setTimestamp();

        const sent = await sendDM(order.discord_username, dmEmbed);
        if (!sent) {
          await message.channel.send(`⚠️ Impossible d'envoyer le DM de statut à \`${order.discord_username}\`.`);
        }
      }

      console.log(`Commande #${order.id} → statut: ${newStatus}`);
      return;
    }

    // ── ^^contact <message> ──
    if (content.startsWith('^^contact ')) {
      const msg = content.slice('^^contact '.length).trim();
      if (!msg) {
        return message.reply('❌ Syntaxe : `^^contact <votre message>`');
      }

      await supabase.from('orders').update({ ml_message: msg }).eq('id', order.id);
      await supabase.from('discord_messages').insert({
        order_id: order.id,
        direction: 'out',
        content: msg,
      });

      const ticketEmbed = new EmbedBuilder()
        .setColor(0x4f7af8)
        .setTitle('💬 Message envoyé au client')
        .setDescription(msg)
        .setFooter({ text: `Commande #${order.id} — visible sur le site + DM Discord` })
        .setTimestamp();

      await message.channel.send({ embeds: [ticketEmbed] });
      await message.react('📨');

      // ── DM au client ──
      if (order.discord_username) {
        const dmEmbed = new EmbedBuilder()
          .setColor(0x4f7af8)
          .setTitle('📨 Message de ML Devlopping')
          .setDescription(`Bonjour **${order.client_name}**, notre équipe vous a envoyé un message concernant votre commande.`)
          .addFields(
            { name: '📦 Commande', value: `${order.plan} — #${order.id}`, inline: false },
            { name: '💬 Message', value: msg, inline: false },
          )
          .setFooter({ text: 'ML Devlopping — Support' })
          .setTimestamp();

        const sent = await sendDM(order.discord_username, dmEmbed);
        if (!sent) {
          await message.channel.send(`⚠️ Impossible d'envoyer le DM à \`${order.discord_username}\`.`);
        }
      }
      return;
    }

    // Commande inconnue dans un channel commande
    if (content.startsWith('^^')) {
      await message.reply([
        '❌ Commande inconnue. Commandes disponibles :',
        '`^^en_cours` `^^preparation` `^^finalisation` `^^terminer` `^^contact <message>`',
      ].join('\n'));
    }
    return;
  }

  // ── IDENTIFIER SI C'EST UN CHANNEL CONTACT ────────────────────
  const { data: contact } = await supabase
    .from('contacts')
    .select('*')
    .eq('discord_channel_id', channelId)
    .maybeSingle();

  if (contact) {
    // ── ^^answer <message> ──
    if (content.startsWith('^^answer ')) {
      const reply = content.slice('^^answer '.length).trim();
      if (!reply) {
        return message.reply('❌ Syntaxe : `^^answer <votre réponse>`');
      }

      await supabase.from('discord_messages').insert({
        contact_id: contact.id,
        direction: 'out',
        content: reply,
      });
      await supabase.from('contacts').update({ status: 'replied' }).eq('id', contact.id);

      const ticketEmbed = new EmbedBuilder()
        .setColor(0x22c55e)
        .setTitle('📨 Réponse envoyée')
        .addFields(
          { name: 'Destinataire', value: `${contact.first_name} ${contact.last_name} (${contact.email})`, inline: false },
          { name: '💬 Discord', value: contact.discord_username ? `@${contact.discord_username}` : 'Non renseigné', inline: false },
          { name: 'Message', value: reply, inline: false },
        )
        .setTimestamp();

      await message.channel.send({ embeds: [ticketEmbed] });
      await message.react('✅');

      // ── DM au client ──
      if (contact.discord_username) {
        const dmEmbed = new EmbedBuilder()
          .setColor(0x22c55e)
          .setTitle('📨 Réponse de ML Devlopping')
          .setDescription(`Bonjour **${contact.first_name}**, notre équipe a répondu à votre message !`)
          .addFields(
            { name: '📌 Objet initial', value: contact.subject, inline: false },
            { name: '💬 Réponse', value: reply, inline: false },
            { name: '↩️ Répondre', value: 'Vous pouvez répondre directement ici en DM, ou depuis notre site.', inline: false },
          )
          .setFooter({ text: 'ML Devlopping — Support' })
          .setTimestamp();

        const sent = await sendDM(contact.discord_username, dmEmbed);
        if (!sent) {
          await message.channel.send(`⚠️ Impossible d'envoyer le DM à \`${contact.discord_username}\`.`);
        }
      }
      return;
    }

    if (content.startsWith('^^')) {
      await message.reply('❌ Commande inconnue. Seule commande disponible ici : `^^answer <message>`');
    }
  }
});

// ── DÉMARRAGE ────────────────────────────────────────────────────
client.login(DISCORD_TOKEN).catch(err => {
  console.error('❌ Erreur de connexion Discord:', err.message);
  process.exit(1);
});
